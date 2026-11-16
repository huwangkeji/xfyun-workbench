'use strict';

/**
 * 插件市场（内置插件 + 自定义插件 + 远程技能，安装启用后可被智能体作为工具调用）
 *
 * 插件形态：
 *   - builtin：本文件内置实现（计算器 / 日期时间 / 单位换算 / 随机数 / 网页抓取）
 *   - local  ：后台上传的自定义 JS 代码，沙箱内执行 `async function run(args, ctx)`
 *   - remote ：远程技能（HTTP 接口），按参数发起 GET/POST，可配鉴权、超时与响应取值路径
 *
 * 安装状态存 db.json 顶层 plugins 数组：
 *   内置：{ key, enabled, installedAt }
 *   自定义：{ key, type:'local'|'remote', name, emoji, description, params, code|endpoint,
 *            method, headers, authType, authToken, authHeader, timeoutMs, resultPath,
 *            enabled, installedAt, updatedAt }
 *
 * 安全说明：自定义插件的代码由管理员上传，在 Node 的 vm 沙箱里运行（10s 同步超时、
 * 无 require / process 权限）。vm 不是硬件级隔离，请只安装可信来源的插件。
 */

const vm = require('vm');
const db = require('./db');

const MAX_CODE_BYTES = 64 * 1024;
const MAX_RESULT_CHARS = 4000;
const LOCAL_SYNC_TIMEOUT_MS = 10000;
const LOCAL_TOTAL_TIMEOUT_MS = 25000;
const REMOTE_MAX_TIMEOUT_MS = 60000;

function nowIso() { return new Date().toISOString(); }

function data() {
  const d = db.load();
  if (!Array.isArray(d.plugins)) d.plugins = [];
  return d;
}

/* ================= 内置插件清单 ================= */

const PLUGINS = {
  calculator: {
    key: 'calculator',
    name: '计算器',
    emoji: '🧮',
    description: '对数学表达式求值，支持 + - * / %、括号与常用函数（sqrt/abs/round 等）。',
    params: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要计算的数学表达式，如 "(3+5)*2" 或 "sqrt(16)"' }
      },
      required: ['expression']
    },
    execute(args) {
      const expr = String(args && args.expression || '').trim();
      if (!expr) throw new Error('缺少表达式');
      return String(safeEval(expr));
    }
  },
  datetime: {
    key: 'datetime',
    name: '日期时间',
    emoji: '🕒',
    description: '获取当前日期和时间，支持指定时区偏移。',
    params: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: '可选，如 "Asia/Shanghai" 或 UTC 偏移，留空为服务器本地时间' }
      }
    },
    execute(args) {
      const now = new Date();
      const tz = args && args.timezone;
      try {
        return tz ? now.toLocaleString('zh-CN', { timeZone: tz }) : now.toLocaleString('zh-CN');
      } catch (_) {
        return now.toLocaleString('zh-CN');
      }
    }
  },
  unit_convert: {
    key: 'unit_convert',
    name: '单位换算',
    emoji: '📏',
    description: '长度、重量、温度等常用单位换算。支持 千米/米/厘米/毫米、千克/克/磅、摄氏度/华氏度。',
    params: {
      type: 'object',
      properties: {
        value: { type: 'number', description: '数值' },
        from: { type: 'string', description: '源单位，如 km/m/cm/mm/kg/g/lb/c/f' },
        to: { type: 'string', description: '目标单位，同 from 的取值集合' }
      },
      required: ['value', 'from', 'to']
    },
    execute(args) {
      const v = Number(args.value);
      const from = String(args.from || '').toLowerCase();
      const to = String(args.to || '').toLowerCase();
      if (!Number.isFinite(v)) throw new Error('value 必须是数字');
      const result = convert(v, from, to);
      if (result === null) throw new Error(`不支持的单位换算：${from} → ${to}`);
      return `${v} ${from} = ${round(result, 6)} ${to}`;
    }
  },
  random: {
    key: 'random',
    name: '随机数',
    emoji: '🎲',
    description: '生成指定范围内的随机整数。',
    params: {
      type: 'object',
      properties: {
        min: { type: 'number', description: '最小值（含）' },
        max: { type: 'number', description: '最大值（含）' }
      },
      required: ['min', 'max']
    },
    execute(args) {
      const min = Math.ceil(Number(args.min));
      const max = Math.floor(Number(args.max));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Error('min/max 非法');
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }
  },
  http_fetch: {
    key: 'http_fetch',
    name: '网页抓取',
    emoji: '🌐',
    description: '抓取指定 URL 的网页内容并返回纯文本摘要（用于查询实时信息）。',
    params: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的完整 URL（http/https）' }
      },
      required: ['url']
    },
    async execute(args) {
      const url = String(args && args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('URL 必须以 http(s):// 开头');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'xfyun-workbench/2.0' } });
        const text = await resp.text();
        return stripHtml(text).slice(0, 4000);
      } finally {
        clearTimeout(timer);
      }
    }
  }
};

/* ================= 工具函数 ================= */

/** 安全数学表达式求值（白名单操作符/函数，非 eval） */
function safeEval(expr) {
  const s = String(expr).trim();
  if (!s) throw new Error('表达式为空');
  // 1) 把白名单函数名替换为 Math.*（供 new Function 求值）
  const replaced = s.replace(/\b(sqrt|abs|round|floor|ceil|pow|min|max|sin|cos|tan|log)\b/g, 'Math.$1');
  // 2) 安全校验：把「白名单函数名」与「Math. 前缀」都移除后，若还残留字母即含非法标识符。
  //    注意必须先移除函数名（Math.sqrt 去掉 sqrt → Math.，再去掉 Math. → 空），
  //    而不是先移除 Math.（那会把 sqrt 单独留下误判）。
  const sanitized = replaced
    .replace(/\b(sqrt|abs|round|floor|ceil|pow|min|max|sin|cos|tan|log)\b/g, '')
    .replace(/Math\./g, '')
    .replace(/[0-9+\-*/%().,\s]/g, '');
  if (sanitized.length) throw new Error('表达式包含非法字符或函数');
  // eslint-disable-next-line no-new-func
  const val = new Function(`"use strict"; return (${replaced});`)();
  if (!Number.isFinite(val)) throw new Error('表达式计算结果非法');
  return val;
}

/** 单位换算表（统一换算到基准单位再转出） */
const LENGTH = { km: 1000, m: 1, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254 };
const WEIGHT = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.0283495231, t: 1000 };

function convert(v, from, to) {
  if (from === to) return v;
  // 温度特殊处理
  const temp = { c: 'c', f: 'f', celsius: 'c', fahrenheit: 'f' };
  if (temp[from] && temp[to]) {
    if (temp[from] === temp[to]) return v;
    return temp[from] === 'c' ? v * 9 / 5 + 32 : (v - 32) * 5 / 9;
  }
  if (LENGTH[from] && LENGTH[to]) return v * LENGTH[from] / LENGTH[to];
  if (WEIGHT[from] && WEIGHT[to]) return v * WEIGHT[from] / WEIGHT[to];
  return null;
}

function round(v, n) {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text) {
  const s = String(text == null ? '' : text);
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}…（已截断）` : s;
}

/** 把工具返回值统一成可读文本 */
function resultText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return String(v);
}

/** 按 a.b.0.c 取响应字段（对象/数组都支持），取不到返回原值 */
function pickPath(obj, pathStr) {
  const parts = String(pathStr || '').split('.').map((s) => s.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return obj;
    cur = cur[p];
  }
  return cur === undefined ? obj : cur;
}

/* ================= 自定义插件：校验与规范化 ================= */

function isBuiltin(key) { return Object.prototype.hasOwnProperty.call(PLUGINS, key); }
function findInstalled(key) { return data().plugins.find((p) => p.key === key) || null; }
function isCustom(p) { return !!p && (p.type === 'local' || p.type === 'remote'); }

function normalizeParams(raw) {
  if (!raw || typeof raw !== 'object') return { error: '参数定义必须是 JSON 对象（键为参数名）' };
  const src = raw.properties && typeof raw.properties === 'object' ? raw : { properties: raw, required: [] };
  const props = {};
  const keys = Object.keys(src.properties || {});
  if (keys.length > 20) return { error: '参数最多 20 个' };
  for (const k of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) return { error: `参数名「${k}」不合法（字母/下划线开头）` };
    const v = src.properties[k];
    if (!v || typeof v !== 'object') return { error: `参数「${k}」定义必须是对象` };
    const type = ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(v.type) ? v.type : 'string';
    const item = { type };
    if (v.description) item.description = String(v.description).slice(0, 120);
    if (type === 'array' && v.items && typeof v.items === 'object') item.items = v.items;
    if (Array.isArray(v.enum)) item.enum = v.enum.slice(0, 20).map((x) => String(x).slice(0, 40));
    props[k] = item;
  }
  const req = (Array.isArray(src.required) ? src.required : [])
    .map((x) => String(x).trim()).filter((x) => props[x]);
  return { params: { type: 'object', properties: props, required: req } };
}

function validateCustom(body) {
  const errors = [];
  const type = body.type === 'remote' ? 'remote' : 'local';
  const name = String(body.name || '').trim().slice(0, 30);
  if (!name) errors.push('插件名称不能为空');
  const description = String(body.description || '').trim().slice(0, 200);
  if (!description) errors.push('描述不能为空（模型据此判断何时调用）');
  const emoji = String(body.emoji || '').trim().slice(0, 8) || '🧩';
  let key = String(body.key || '').trim();
  if (!key) key = `plugin_${Date.now().toString(36)}`;
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(key)) errors.push('标识需以字母开头，仅含字母/数字/下划线/连字符（2-41 位）');
  if (isBuiltin(key)) errors.push(`标识「${key}」与内置插件冲突，请更换`);

  const p = normalizeParams(body.params);
  if (p.error) errors.push(p.error);

  let code = '';
  let endpoint = '';
  let method = 'POST';
  let headers = {};
  let authType = 'none';
  let authToken = '';
  let authHeader = '';
  let timeoutMs = 15000;
  let resultPath = '';

  if (type === 'local') {
    code = String(body.code || '');
    if (!code.trim()) errors.push('代码不能为空（需定义 async function run(args, ctx)）');
    if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES) errors.push('代码超过 64KB 上限');
    if (code.trim() && !/\brun\s*\(/.test(code) && !/function\s+run\b/.test(code)) {
      errors.push('代码中未找到 run(args, ctx) 函数');
    }
  } else {
    endpoint = String(body.endpoint || '').trim();
    if (!/^https?:\/\//i.test(endpoint)) errors.push('远程地址必须是 http(s):// 开头的完整 URL');
    method = String(body.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
    authType = ['none', 'bearer', 'header'].includes(body.authType) ? body.authType : 'none';
    authToken = String(body.authToken || '').slice(0, 500);
    authHeader = String(body.authHeader || '').trim().slice(0, 60);
    if (authType === 'header' && !authHeader) errors.push('自定义请求头模式需要填写请求头名称');
    timeoutMs = Math.min(REMOTE_MAX_TIMEOUT_MS, Math.max(1000, Number(body.timeoutMs) || 15000));
    resultPath = String(body.resultPath || '').trim().slice(0, 120);
    if (body.headers !== undefined && body.headers !== null && body.headers !== '') {
      if (typeof body.headers !== 'object') errors.push('附加请求头必须是 JSON 对象');
      else {
        const ks = Object.keys(body.headers);
        if (ks.length > 20) errors.push('附加请求头最多 20 个');
        for (const k of ks) {
          if (!/^[A-Za-z0-9-]{1,60}$/.test(k)) { errors.push(`请求头名「${k}」不合法`); break; }
          headers[k] = String(body.headers[k]).slice(0, 500);
        }
      }
    }
  }

  return {
    errors,
    data: {
      key, type, name, emoji, description,
      params: p.params || { type: 'object', properties: {}, required: [] },
      code, endpoint, method, headers, authType, authToken, authHeader, timeoutMs, resultPath
    }
  };
}

/** 新建或更新自定义插件（key 已存在则更新） */
function saveCustom(body) {
  const v = validateCustom(body || {});
  if (v.errors.length) return { ok: false, errors: v.errors };
  const d = data();
  const idx = d.plugins.findIndex((p) => p.key === v.data.key);
  const existing = idx >= 0 ? d.plugins[idx] : null;
  if (existing && !isCustom(existing)) return { ok: false, errors: ['该标识已被内置插件占用'] };
  // 编辑远程技能时 Token 留空 = 不修改（避免每次保存都要重新粘贴密钥）
  if (body.keepToken && existing && existing.authToken && !v.data.authToken) {
    v.data.authToken = existing.authToken;
  }
  const record = {
    ...v.data,
    enabled: body.enabled === false ? false : true,
    installedAt: existing ? existing.installedAt : nowIso(),
    updatedAt: nowIso()
  };
  if (idx >= 0) d.plugins[idx] = record;
  else d.plugins.push(record);
  db.save();
  return { ok: true, data: publicMeta(record) };
}

/* ================= 执行 ================= */

/** 在 vm 沙箱里跑本地插件代码 */
function runLocal(record, args) {
  const sandbox = {
    args: { ...(args || {}) },
    ctx: {
      now: () => new Date().toISOString(),
      log: () => {},
      plugin: { key: record.key, name: record.name }
    },
    fetch,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    JSON, Math, Date, String, Number, Boolean, Array, Object, Promise, RegExp, Map, Set, Intl,
    TextEncoder, TextDecoder, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN
  };
  sandbox.globalThis = sandbox;
  const wrapped = `(async () => {\n${record.code}\n;return (typeof run === 'function') ? await run(args, ctx) : '插件未定义 run(args, ctx) 函数';})()`;
  let promise;
  try {
    const script = new vm.Script(wrapped, { filename: `${record.key}.js` });
    promise = script.runInNewContext(sandbox, { timeout: LOCAL_SYNC_TIMEOUT_MS });
  } catch (e) {
    throw new Error(`插件执行失败：${e.message}`);
  }
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error('插件执行超时（25s）')), LOCAL_TOTAL_TIMEOUT_MS))
  ]).then((v) => truncate(resultText(v)));
}

/** 调用远程技能（HTTP） */
async function runRemote(record, args) {
  const timeoutMs = Math.min(REMOTE_MAX_TIMEOUT_MS, Math.max(1000, Number(record.timeoutMs) || 15000));
  const headers = { 'Content-Type': 'application/json', ...(record.headers || {}) };
  if (record.authType === 'bearer' && record.authToken) headers.Authorization = `Bearer ${record.authToken}`;
  if (record.authType === 'header' && record.authHeader && record.authToken) headers[record.authHeader] = record.authToken;

  const input = { ...(args || {}) };
  let resp;
  try {
    if ((record.method || 'POST').toUpperCase() === 'GET') {
      const u = new URL(record.endpoint);
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined || v === null || v === '') continue;
        u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      resp = await fetch(u.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    } else {
      resp = await fetch(record.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs)
      });
    }
  } catch (e) {
    const msg = /timeout|abort/i.test(e.message || '') ? `请求超时（${timeoutMs}ms）` : (e.message || '网络错误');
    throw new Error(`远程技能调用失败：${msg}`);
  }

  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* 非 JSON 原样返回 */ }
  if (!resp.ok) {
    throw new Error(`远程技能返回 ${resp.status}：${truncate(text).slice(0, 300)}`);
  }
  const picked = parsed === null ? text : (record.resultPath ? pickPath(parsed, record.resultPath) : parsed);
  return truncate(resultText(picked));
}

/** 执行插件（对话 function calling / 后台测试共用） */
async function execute(key, args) {
  const builtin = PLUGINS[key];
  const installed = findInstalled(key);
  if (!installed || installed.enabled === false) {
    if (!builtin) throw new Error('插件不存在');
    throw new Error('插件未启用');
  }
  if (builtin) return String(await builtin.execute(args || {}));
  if (installed.type === 'local') return runLocal(installed, args);
  if (installed.type === 'remote') return runRemote(installed, args);
  throw new Error('未知插件类型');
}

/* ================= 列表 / 安装状态管理 ================= */

/** 自定义插件对外元信息（不含代码与 Token） */
function publicMeta(p) {
  return {
    key: p.key,
    type: p.type,
    name: p.name,
    emoji: p.emoji || '🧩',
    description: p.description || '',
    params: p.params,
    endpoint: p.endpoint || '',
    method: p.method || 'POST',
    resultPath: p.resultPath || '',
    timeoutMs: p.timeoutMs || 15000,
    installed: true,
    enabled: p.enabled !== false,
    updatedAt: p.updatedAt || p.installedAt || ''
  };
}

/** 全部插件（内置 + 自定义，含安装状态） */
function listAll() {
  const installed = new Map(data().plugins.map((p) => [p.key, p]));
  const builtins = Object.values(PLUGINS).map((p) => {
    const ins = installed.get(p.key);
    return {
      key: p.key,
      type: 'builtin',
      name: p.name,
      emoji: p.emoji,
      description: p.description,
      params: p.params,
      installed: !!ins,
      enabled: ins ? (ins.enabled !== false) : false
    };
  });
  const customs = data().plugins.filter(isCustom).map(publicMeta);
  return [...builtins, ...customs];
}

/** 已启用插件（供智能体绑定 / function calling 使用） */
function listEnabled() {
  const all = listAll().filter((p) => p.enabled);
  return all.map((p) => ({
    key: p.key,
    name: p.name,
    emoji: p.emoji,
    description: p.description,
    params: p.params
  }));
}

/** 取插件详情（编辑用；含代码 / 远程配置，仅管理端调用） */
function getDetail(key) {
  if (PLUGINS[key]) {
    const ins = findInstalled(key);
    return {
      key,
      type: 'builtin',
      name: PLUGINS[key].name,
      emoji: PLUGINS[key].emoji,
      description: PLUGINS[key].description,
      params: PLUGINS[key].params,
      installed: !!ins,
      enabled: ins ? ins.enabled !== false : false,
      readonly: true
    };
  }
  const p = findInstalled(key);
  if (!isCustom(p)) return null;
  return { ...publicMeta(p), code: p.code || '', headers: p.headers || {}, authType: p.authType || 'none', authHeader: p.authHeader || '', hasToken: !!p.authToken };
}

function install(key) {
  if (!PLUGINS[key] && !isCustom(findInstalled(key))) return { ok: false, error: '插件不存在' };
  const d = data();
  if (!d.plugins.some((p) => p.key === key)) {
    d.plugins.push({ key, enabled: true, installedAt: nowIso() });
    db.save();
  }
  return { ok: true, data: listAll() };
}

function uninstall(key) {
  const d = data();
  const idx = d.plugins.findIndex((p) => p.key === key);
  if (idx < 0) return { ok: false, error: '插件未安装' };
  d.plugins.splice(idx, 1);
  db.save();
  return { ok: true, data: listAll() };
}

function setEnabled(key, enabled) {
  const d = data();
  const p = d.plugins.find((x) => x.key === key);
  if (!p) return { ok: false, error: '插件未安装' };
  p.enabled = enabled !== false;
  db.save();
  return { ok: true, data: listAll() };
}

/** 后台测试调用（不影响智能体绑定） */
async function test(key, args) {
  const installed = findInstalled(key);
  if (!installed) return { ok: false, error: '插件未安装或已删除' };
  const started = Date.now();
  try {
    const result = await execute(key, args || {});
    return { ok: true, result, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.message, latencyMs: Date.now() - started };
  }
}

/**
 * 导出插件定义（function calling tools 格式）
 * - 传 keys：按标识取定义（内置或自定义，不校验安装状态，由调用方决定是否可执行）
 * - 不传：返回全部已启用的插件
 */
function toolDefs(keys) {
  const set = keys && keys.length ? new Set(keys) : null;
  const source = set ? listAll() : listEnabled();
  return source
    .filter((p) => !set || set.has(p.key))
    .map((p) => ({
      type: 'function',
      function: {
        name: p.key,
        description: p.description,
        parameters: p.params
      }
    }));
}

module.exports = {
  listAll,
  listEnabled,
  getDetail,
  saveCustom,
  install,
  uninstall,
  setEnabled,
  execute,
  test,
  toolDefs,
  PLUGINS,
  MAX_CODE_BYTES
};
