'use strict';

/**
 * 画布工作流（对标 FastGPT / Dify 式编排）
 *
 * 数据形状（db.json 顶层 workflows 数组）：
 *   { id, name, desc, ownerId, ownerName, createdAt, updatedAt,
 *     nodes: [{ id, type, x, y, cfg }],
 *     edges: [{ from, to }] }
 *
 * 节点类型：
 *   entry    用户问题（入口，每图 1 个）   输出：用户问题
 *   kb       知识库搜索                  输入：上游文本 → 输出：引用内容（检索分段）
 *   ai       AI 对话                     输入：问题 + 引用内容 → 输出：AI 回复
 *   reply    指定回复                    输入：任意 → 输出：固定文本
 *   transform 文本加工                   输入：上游文本 → 输出：模板加工结果
 *   judge    判断器                      输入：上游文本 → 输出：yes/no 分支
 *   —— v2 新增（对齐「高级编排/模块」脑图） ——
 *   complete 问题补全                    输入：问题 → AI 改写为语义完整的问题 → 输出：补全后问题
 *   classify 问题分类                    输入：文本 → AI 从给定类目中选一个 → 输出：类目文本
 *   extract  文本内容提取                输入：文本 → AI 按字段提取 → 输出：JSON 文本
 *   http     HTTP 模块                  输入：任意（可 {{input}} 引用） → 输出：响应正文文本
 *
 * 执行引擎：从入口节点沿边做拓扑执行，每个节点产出 output 供下游引用；
 * 最终输出 = 最后执行的 AI/reply 等产出文本的节点结果。
 */

const db = require('./db');
const kbService = require('./kbService');
const configService = require('./configService');
const xfyun = require('./xfyun');

const NODE_TYPES = ['entry', 'kb', 'ai', 'reply', 'transform', 'judge', 'complete', 'classify', 'extract', 'http'];
const MAX_NODES = 30;
const MAX_RUN_STEPS = 50;
const HTTP_TIMEOUT_MAX = 30;   // HTTP 模块超时上限（秒）
const HTTP_BODY_MAX = 8000;   // HTTP 响应截断长度

/** 判断器输出口标识（画布连线 fromPort 与执行分支匹配用） */
const JUDGE_PORTS = ['yes', 'no'];

/** 各节点的分支输出口（fromPort 语义），用于「多分支」节点：
 *  - judge 判断器：yes（命中关键词）/ no（未命中）
 *  - kb 知识库搜索：hit（检索命中）/ miss（结果为空）
 *  - extract 内容提取：full（字段完整）/ partial（字段缺失）
 * 其余节点为单输出 'out'。
 */
const BRANCH_PORTS = {
  judge: ['yes', 'no'],
  kb: ['hit', 'miss'],
  extract: ['full', 'partial']
};

/** 分支端口标签（前端展示 + 调试输出） */
const PORT_LABELS = {
  judge: { yes: '✓ 命中', no: '✗ 未命中' },
  kb: { hit: '✓ 命中', miss: '○ 结果为空' },
  extract: { full: '✓ 完整提取', partial: '○ 字段缺失' }
};

function nowIso() {
  return new Date().toISOString();
}

function data() {
  const d = db.load();
  if (!Array.isArray(d.workflows)) d.workflows = [];
  return d;
}

function findWf(id) {
  return data().workflows.find((w) => w.id === id) || null;
}

function meta(w) {
  return {
    id: w.id,
    name: w.name,
    desc: w.desc || '',
    nodeCount: (w.nodes || []).length,
    edgeCount: (w.edges || []).length,
    ownerId: w.ownerId || '',
    ownerName: w.ownerName || '',
    variables: Array.isArray(w.variables) ? w.variables : [],
    createdAt: w.createdAt,
    updatedAt: w.updatedAt
  };
}

function list() {
  return data().workflows.map(meta);
}

/** 员工端可选列表：本人创建的 + 管理员编排的（ownerId 为空或属主/管理员）全部可见 */
function listForActor(actor) {
  const d = data().workflows;
  if (!actor || ['owner', 'admin'].includes(actor.role)) return d.map(meta);
  return d
    .filter((w) => !w.ownerId || w.ownerId === actor.id)
    .map(meta);
}

/** 判断操作者是否可编辑/删除该工作流（本人创建的，或 owner/admin；无属主的历史工作流仅 owner/admin） */
function ownedWorkflow(id, actor) {
  const w = findWf(id);
  if (!w) return { ok: false, notFound: true };
  if (actor && ['owner', 'admin'].includes(actor.role)) return { ok: true };
  if (!w.ownerId) return { ok: false, notFound: true }; // 无属主的历史工作流，员工不可改
  if (w.ownerId !== actor.id) return { ok: false, forbidden: true };
  return { ok: true };
}

function get(id) {
  const w = findWf(id);
  if (!w) return null;
  return { ...meta(w), nodes: w.nodes || [], edges: w.edges || [] };
}

/** 校验变量定义（开始节点输入变量，对齐 Coze 风格「参数变量」） */
const VAR_TYPES = ['text', 'paragraph', 'select'];
const MAX_VARS = 30;
function validateVariables(raw) {
  const errors = [];
  const variables = [];
  if (raw === undefined || raw === null) return { errors: [], variables: [] };
  if (!Array.isArray(raw)) { errors.push('变量必须是数组'); return { errors, variables }; }
  if (raw.length > MAX_VARS) errors.push(`变量最多 ${MAX_VARS} 个`);
  const seen = new Set();
  for (const v of raw) {
    if (!v || typeof v !== 'object') { errors.push('变量格式错误'); continue; }
    const key = String(v.key || '').trim();
    const name = String(v.name || '').trim() || key;
    const type = VAR_TYPES.includes(v.type) ? v.type : 'text';
    if (!key) { errors.push('变量 key 不能为空'); continue; }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(key)) { errors.push(`变量 key 非法：${key}（仅字母/数字/下划线，字母或下划线开头）`); continue; }
    if (seen.has(key)) { errors.push(`变量 key 重复：${key}`); continue; }
    seen.add(key);
    variables.push({
      key,
      name: name.slice(0, 30),
      type,
      required: v.required === true,
      maxLength: Number.isFinite(v.maxLength) && v.maxLength > 0 ? Math.min(v.maxLength, 10000) : 0,
      options: type === 'select' && Array.isArray(v.options) ? v.options.map((o) => String(o)).slice(0, 50) : []
    });
  }
  return { errors, variables };
}

/** 图结构校验：节点类型合法、entry 唯一、边端点存在、无环（Kahn） */
function validateGraph(nodes, edges) {
  const errors = [];
  if (!Array.isArray(nodes) || nodes.length === 0) errors.push('工作流至少需要一个节点');
  if (nodes.length > MAX_NODES) errors.push(`节点数超上限（${MAX_NODES}）`);
  if (errors.length) return { errors };

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) errors.push('存在重复的节点 ID');
  const entries = nodes.filter((n) => n.type === 'entry');
  if (entries.length !== 1) errors.push('必须且只能有一个「用户问题」入口节点');
  for (const n of nodes) {
    if (!NODE_TYPES.includes(n.type)) errors.push(`未知节点类型：${n.type}`);
  }
  for (const e of edges || []) {
    if (!ids.has(e.from) || !ids.has(e.to)) errors.push('存在指向不存在节点的连线');
    if (e.from === e.to) errors.push('不允许自环连线');
  }
  if (errors.length) return { errors };

  // 无环检查（Kahn 拓扑）
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const outMap = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges || []) {
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    outMap.get(e.from).push(e.to);
  }
  let queue = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  let seen = 0;
  while (queue.length) {
    const cur = queue.shift();
    seen++;
    for (const nxt of outMap.get(cur)) {
      const v = (indeg.get(nxt) || 0) - 1;
      indeg.set(nxt, v);
      if (v === 0) queue.push(nxt);
    }
  }
  if (seen !== nodes.length) errors.push('工作流存在循环连线，无法执行');
  return { errors };
}

function validateCfgType(type, cfg) {
  const c = cfg || {};
  if (type === 'ai') {
    if (!c.configId) return 'AI 对话节点未选择对话模型配置';
    if (typeof c.systemPrompt !== 'string' || !c.systemPrompt.trim()) return 'AI 对话节点未填写系统提示词';
  }
  if (type === 'kb') {
    if (!c.kbId) return '知识库搜索节点未选择知识库';
  }
  if (type === 'reply') {
    if (typeof c.text !== 'string' || !c.text.trim()) return '指定回复节点未填写回复内容';
  }
  if (type === 'transform') {
    if (typeof c.template !== 'string' || !c.template.trim()) return '文本加工节点未填写加工模板（可用 {{input}} 引用上游文本）';
  }
  if (type === 'judge') {
    if (typeof c.keywords !== 'string' || !c.keywords.trim()) return '判断器节点未填写判断关键词（多个用逗号分隔）';
  }
  // —— v2 新节点 ——
  if (type === 'complete') {
    if (!c.configId) return '问题补全节点未选择模型配置';
  }
  if (type === 'classify') {
    if (!c.configId) return '问题分类节点未选择模型配置';
    const cats = splitLines(c.categories);
    if (!cats.length) return '问题分类节点未填写类目（每行一个）';
    if (cats.length > 20) return '类目最多 20 个';
  }
  if (type === 'extract') {
    if (!c.configId) return '文本内容提取节点未选择模型配置';
    const fields = splitLines(c.fields);
    if (!fields.length) return '文本内容提取节点未填写提取字段（每行一个）';
    if (fields.length > 15) return '提取字段最多 15 个';
  }
  if (type === 'http') {
    if (typeof c.url !== 'string' || !/^https?:\/\//i.test(c.url.trim())) return 'HTTP 节点 URL 必须以 http(s):// 开头';
    if (c.method && !['GET', 'POST', 'PUT', 'DELETE'].includes(String(c.method).toUpperCase())) return 'HTTP 节点方法仅支持 GET/POST/PUT/DELETE';
  }
  return null;
}

/** 多行/逗号分隔文本 → 去空数组 */
function splitLines(v) {
  return String(v || '').split(/[\n,，、;；]+/).map((s) => s.trim()).filter(Boolean);
}

function listKbOptions() {
  return kbService.list().map((k) => ({ id: k.id, name: k.name }));
}

function listConfigOptions() {
  return configService.list().map((c) => ({ id: c._id, name: c.name, model: c.model }));
}

function create(body, actor) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, errors: ['工作流名称不能为空'] };
  if (name.length > 50) return { ok: false, errors: ['名称最长 50 字符'] };
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  const { errors } = validateGraph(nodes, edges);
  if (errors.length) return { ok: false, errors };
  const varRes = validateVariables(body.variables);
  if (varRes.errors.length) return { ok: false, errors: varRes.errors };
  for (const n of nodes) {
    const cfgErr = validateCfgType(n.type, n.cfg);
    if (cfgErr) return { ok: false, errors: [cfgErr] };
  }
  const d = data();
  const wf = {
    id: db.getNextId('wf'),
    name: name.slice(0, 50),
    desc: typeof body.desc === 'string' ? body.desc.trim().slice(0, 200) : '',
    nodes,
    edges,
    variables: varRes.variables,
    ownerId: actor ? actor.id : '',
    ownerName: actor ? (actor.displayName || actor.username) : '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  d.workflows.push(wf);
  db.save();
  return { ok: true, data: meta(wf) };
}

function update(id, body) {
  const wf = findWf(id);
  if (!wf) return { ok: false, notFound: true };
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return { ok: false, errors: ['名称不能为空'] };
    wf.name = name.slice(0, 50);
  }
  if (body.desc !== undefined) wf.desc = String(body.desc).trim().slice(0, 200);
  if (body.nodes !== undefined || body.edges !== undefined) {
    const nodes = Array.isArray(body.nodes) ? body.nodes : (wf.nodes || []);
    const edges = Array.isArray(body.edges) ? body.edges : (wf.edges || []);
    const { errors } = validateGraph(nodes, edges);
    if (errors.length) return { ok: false, errors };
    wf.nodes = nodes;
    wf.edges = edges;
  }
  if (body.variables !== undefined) {
    const varRes = validateVariables(body.variables);
    if (varRes.errors.length) return { ok: false, errors: varRes.errors };
    wf.variables = varRes.variables;
  }
  wf.updatedAt = nowIso();
  db.save();
  return { ok: true, data: meta(wf) };
}

function remove(id) {
  const d = data();
  const idx = d.workflows.findIndex((w) => w.id === id);
  if (idx < 0) return { ok: false, notFound: true };
  const [removed] = d.workflows.splice(idx, 1);
  db.save();
  return { ok: true, data: { id: removed.id, name: removed.name } };
}

/* ================= 执行引擎 ================= */

/** 通用单轮模型调用（v2 新节点共用）：返回纯文本回答或抛 {message} */
async function callModel(configId, systemPrompt, userText, extra) {
  const fullCfg = configService.getFull(configId);
  if (!fullCfg) throw new Error('节点引用的模型配置不存在（可能已被删除）');
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: String(userText || '').slice(0, 8000) });
  const r = await xfyun.chatCompletions(fullCfg, messages, { stream: false, ...(extra || {}) });
  if (!r.ok) throw new Error(`模型请求失败（${fullCfg.name}）：${r.error}`);
  return { text: (xfyun.extractResult(r.data).content || '').trim(), cfgName: fullCfg.name, usage: xfyun.extractResult(r.data).usage };
}

/** HTTP 模块：执行外部 HTTP 调用，{{input}} 替换为上游文本 */
async function callHttp(cfg, upstreamText) {
  const method = String(cfg.method || 'GET').toUpperCase();
  const url = String(cfg.url || '').trim();
  const timeoutSec = Math.min(HTTP_TIMEOUT_MAX, Math.max(1, parseInt(cfg.timeoutSec, 10) || 10));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    const opt = { method, headers, signal: ctrl.signal };
    if (method !== 'GET') {
      opt.body = String(cfg.bodyTemplate || '').replace(/\{\{\s*input\s*\}\}/g, upstreamText || '');
    }
    const resp = await fetch(url, opt);
    const text = await resp.text();
    return { status: resp.status, text: text.slice(0, HTTP_BODY_MAX) };
  } finally {
    clearTimeout(timer);
  }
}

/** 引用内容格式化（与对话注入同风格） */
function formatRefs(chunks) {
  const lines = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n---\n');
  return [
    '以下是从知识库检索到的参考资料：',
    '========================================',
    lines
  ].join('\n');
}

/**
 * 执行工作流
 * @param {string} id 工作流 ID
 * @param {string} query 用户问题
 * @returns {{ok:boolean, output?:string, steps?:Array, error?:string, latencyMs:number}}
 */
async function run(id, query) {
  const wf = findWf(id);
  if (!wf) return { ok: false, error: '工作流不存在', latencyMs: 0 };
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: '请输入测试问题', latencyMs: 0 };

  const nodes = wf.nodes || [];
  const edges = wf.edges || [];
  const entry = nodes.find((n) => n.type === 'entry');
  if (!entry) return { ok: false, error: '工作流缺少「用户问题」入口节点', latencyMs: 0 };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outEdges = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) outEdges.get(e.from).push(e);

  // 可达子图（沿所有边从入口传播）
  const reachable = new Set([entry.id]);
  const reachQueue = [entry.id];
  while (reachQueue.length) {
    const cur = reachQueue.shift();
    for (const e of outEdges.get(cur)) {
      if (!reachable.has(e.to)) {
        reachable.add(e.to);
        reachQueue.push(e.to);
      }
    }
  }

  // 入度（仅可达子图内的边）——分支激活计数用
  const inTotal = new Map([...reachable].map((nid) => [nid, 0]));
  for (const e of edges) {
    if (reachable.has(e.from) && reachable.has(e.to)) {
      inTotal.set(e.to, (inTotal.get(e.to) || 0) + 1);
    }
  }

  const outputs = new Map(); // nodeId → { kind, text }  kind: question/refs/answer/text/branch
  const steps = [];
  let lastText = '';
  const startedAt = Date.now();
  const executed = new Set();
  const deadNodes = new Set();   // 因分支未命中而确定不会执行的节点
  const inActivated = new Map([...reachable].map((nid) => [nid, 0]));
  const inDead = new Map([...reachable].map((nid) => [nid, 0]));
  const deadEdges = new Set();
  const queue = [entry.id];

  const edgeKey = (e) => `${e.from}>${e.fromPort || 'out'}>${e.to}`;

  /** 标记一条边为「死边」（分支未激活）：目标节点凑齐判定后若无可活输入，则级联死亡 */
  function markEdgeDead(e) {
    const k = edgeKey(e);
    if (deadEdges.has(k)) return;
    deadEdges.add(k);
    const t = e.to;
    if (executed.has(t) || deadNodes.has(t) || !reachable.has(t)) return;
    inDead.set(t, (inDead.get(t) || 0) + 1);
    trySettle(t);
  }

  /** 节点入边「已激活 + 已死」凑齐总数时结算：有激活输入 → 执行；全死 → 本节点死亡并级联 */
  function trySettle(t) {
    if (executed.has(t) || deadNodes.has(t)) return;
    const total = inTotal.get(t) || 0;
    const done = (inActivated.get(t) || 0) + (inDead.get(t) || 0);
    if (done < total) return;
    if ((inActivated.get(t) || 0) > 0) {
      queue.push(t);
    } else {
      deadNodes.add(t);
      for (const e2 of outEdges.get(t)) markEdgeDead(e2);
    }
  }

  while (queue.length && steps.length < MAX_RUN_STEPS) {
    const nodeId = queue.shift();
    if (executed.has(nodeId)) continue;
    executed.add(nodeId);
    const node = nodeById.get(nodeId);
    const cfg = node.cfg || {};

    // 汇集上游输入：refs 来自知识库节点；question 优先取上游 answer/text，缺省用入口问题
    let upstreamQuestion = q;
    let upstreamRefs = '';
    for (const e of edges) {
      if (e.to !== nodeId) continue;
      const out = outputs.get(e.from);
      if (!out) continue;
      if (out.kind === 'refs') upstreamRefs = out.text;
      else if (out.kind === 'answer' || out.kind === 'text' || out.kind === 'question') upstreamQuestion = out.text;
    }

    let branch = null; // 判断器的激活分支

    if (node.type === 'entry') {
      outputs.set(nodeId, { kind: 'question', text: q });
      steps.push({ type: 'entry', name: '用户问题', summary: q.slice(0, 80) });
    } else if (node.type === 'kb') {
      const r = kbService.search(cfg.kbId, upstreamQuestion);
      if (!r.ok) return { ok: false, error: `知识库检索失败：${(r.errors || []).join('；')}`, latencyMs: Date.now() - startedAt };
      const text = r.chunks.length ? formatRefs(r.chunks) : '';
      outputs.set(nodeId, { kind: 'refs', text });
      branch = r.chunks.length ? 'hit' : 'miss';  // 多分支：命中 / 结果为空
      steps.push({ type: 'kb', name: '知识库搜索', branch, summary: r.chunks.length ? `命中 ${r.chunks.length} 段（${r.kbName}）` : '未命中相关分段' });
    } else if (node.type === 'ai') {
      const fullCfg = configService.getFull(cfg.configId);
      if (!fullCfg) return { ok: false, error: 'AI 对话节点引用的模型配置不存在', latencyMs: Date.now() - startedAt };
      const messages = [];
      let sp = cfg.systemPrompt || '';
      if (upstreamRefs) sp += (sp ? '\n\n' : '') + upstreamRefs;
      if (sp) messages.push({ role: 'system', content: sp });
      messages.push({ role: 'user', content: upstreamQuestion });
      const r = await xfyun.chatCompletions(fullCfg, messages, { stream: false });
      if (!r.ok) {
        return { ok: false, error: `AI 对话失败（${fullCfg.name}）：${r.error}`, latencyMs: Date.now() - startedAt };
      }
      const parsed = xfyun.extractResult(r.data);
      const answer = parsed.content || '';
      outputs.set(nodeId, { kind: 'answer', text: answer });
      lastText = answer;
      steps.push({ type: 'ai', name: 'AI 对话', summary: `${fullCfg.name} · ${parsed.usage.total_tokens} tokens`, output: answer });
    } else if (node.type === 'reply') {
      outputs.set(nodeId, { kind: 'answer', text: cfg.text || '' });
      lastText = cfg.text || '';
      steps.push({ type: 'reply', name: '指定回复', summary: (cfg.text || '').slice(0, 80) });
    } else if (node.type === 'transform') {
      // 文本加工：模板变量 {{input}} 替换为上游文本（引用内容优先，其次问题/上游输出）
      const upstreamText = upstreamRefs || upstreamQuestion;
      const out = String(cfg.template || '').replace(/\{\{\s*input\s*\}\}/g, upstreamText);
      outputs.set(nodeId, { kind: 'text', text: out });
      lastText = out;
      steps.push({ type: 'transform', name: '文本加工', summary: out.slice(0, 80) });
    } else if (node.type === 'judge') {
      // 判断器：问题/上游文本是否包含任一关键词 → 走 yes / no 分支
      const keywords = String(cfg.keywords || '').split(/[,，、\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const text = (upstreamQuestion || '').toLowerCase();
      const matched = keywords.find((kw) => text.includes(kw));
      branch = matched ? 'yes' : 'no';
      outputs.set(nodeId, { kind: 'branch', text: branch });
      steps.push({ type: 'judge', name: '判断器', branch, summary: `命中「${matched || '无'}」→ 走 ${branch === 'yes' ? '✓ 是' : '✗ 否'} 分支` });
    } else if (node.type === 'complete') {
      // 问题补全：AI 把口语化/缺上下文的问题改写成语义完整的独立问题（下游 AI 对话用它作为输入）
      try {
        const r = await callModel(cfg.configId, cfg.systemPrompt || '你是问题改写助手。把用户输入的口语化问题补全为语义完整、信息充分、可直接独立回答的问题。只输出补全后的问题本身，不要回答它，也不要输出任何解释。', upstreamQuestion);
        outputs.set(nodeId, { kind: 'question', text: r.text });
        lastText = r.text;
        steps.push({ type: 'complete', name: '问题补全', summary: r.text.slice(0, 80), output: r.text });
      } catch (e) {
        return { ok: false, error: `问题补全失败：${e.message}`, latencyMs: Date.now() - startedAt };
      }
    } else if (node.type === 'classify') {
      // 问题分类：AI 从给定类目中选出最匹配的一个，输出类目文本（常接判断器/指定回复做分流）
      const cats = splitLines(cfg.categories);
      try {
        const r = await callModel(cfg.configId,
          `你是文本分类器。从下列类目中选择最匹配输入的一个，只输出类目名称本身，禁止输出其他任何内容：\n${cats.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
          upstreamQuestion, { temperature: 0.1 });
        outputs.set(nodeId, { kind: 'text', text: r.text });
        lastText = r.text;
        steps.push({ type: 'classify', name: '问题分类', summary: r.text.slice(0, 80), output: r.text });
      } catch (e) {
        return { ok: false, error: `问题分类失败：${e.message}`, latencyMs: Date.now() - startedAt };
      }
    } else if (node.type === 'extract') {
      // 文本内容提取：AI 按字段从输入中提取，输出 JSON 文本
      const fields = splitLines(cfg.fields);
      try {
        const r = await callModel(cfg.configId,
          `你是信息提取器。从输入文本中提取以下字段，只输出一个 JSON 对象（键为字段名，值为提取结果；提取不到的值为 null），禁止输出 JSON 以外的任何内容：\n${fields.map((f) => `- ${f}`).join('\n')}`,
          upstreamQuestion || upstreamRefs, { temperature: 0.1 });
        // 分支：所有字段均非 null → full；否则 partial（有字段缺失）
        let hasMissing = false;
        try {
          const obj = JSON.parse(r.text);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            hasMissing = fields.some((f) => obj[f] === null || obj[f] === undefined || obj[f] === '');
          }
        } catch (_) { hasMissing = true; }
        branch = hasMissing ? 'partial' : 'full';
        outputs.set(nodeId, { kind: 'text', text: r.text });
        lastText = r.text;
        steps.push({ type: 'extract', name: '内容提取', branch, summary: r.text.slice(0, 80), output: r.text });
      } catch (e) {
        return { ok: false, error: `内容提取失败：${e.message}`, latencyMs: Date.now() - startedAt };
      }
    } else if (node.type === 'http') {
      // HTTP 模块：调用外部接口，{{input}} 引用上游文本；输出响应正文
      try {
        const r = await callHttp(cfg, upstreamRefs || upstreamQuestion || '');
        outputs.set(nodeId, { kind: 'text', text: r.text });
        lastText = r.text;
        steps.push({ type: 'http', name: 'HTTP 模块', summary: `HTTP ${r.status} · ${String(r.text).length} 字符` });
      } catch (e) {
        const msg = e && e.name === 'AbortError' ? `请求超时（${Math.min(HTTP_TIMEOUT_MAX, Math.max(1, parseInt(cfg.timeoutSec, 10) || 10))}s）` : e.message;
        return { ok: false, error: `HTTP 模块调用失败：${msg}`, latencyMs: Date.now() - startedAt };
      }
    }

    // 激活出边：分支节点（判断器/知识库/提取）仅激活命中分支的边，未命中的边标记为死边（级联），其余节点激活全部出边
    const branchPorts = BRANCH_PORTS[node.type];
    for (const e of outEdges.get(nodeId)) {
      if (!reachable.has(e.to)) continue;
      if (branchPorts && branch !== null && (e.fromPort || branchPorts[0]) !== branch) {
        markEdgeDead(e);
        continue;
      }
      inActivated.set(e.to, (inActivated.get(e.to) || 0) + 1);
      trySettle(e.to);
    }
  }

  return { ok: true, output: lastText, steps, latencyMs: Date.now() - startedAt };
}

module.exports = { list, listForActor, ownedWorkflow, get, create, update, remove, run, validateGraph, listKbOptions, listConfigOptions, NODE_TYPES, JUDGE_PORTS, BRANCH_PORTS, PORT_LABELS };
