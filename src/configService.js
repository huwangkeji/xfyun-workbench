'use strict';

const crypto = require('crypto');
const db = require('./db');
const env = require('./env');
const adminAuth = require('./adminAuth'); // 工作台访客密码的哈希存储（adminAuth 不依赖本模块，无循环引用）

const DEFAULT_NAME = '星火开源模型';

/* ================= API Key 静态加密（可选） =================
 * 设置环境变量 DB_ENCRYPT_KEY 后，写入 db.json 的 apiKey 以 AES-256-GCM 加密
 * （格式 enc:v1:<iv>.<tag>.<ct>，iv/tag/ct 均为 base64url）；
 * 不设置时行为与旧版完全一致（明文存储），保证零配置兼容。
 * 注意：密钥只来自环境变量，不落库；丢失密钥 = 无法解密已加密的 Key
 *       （启动时会打印警告，相关配置调用将失败并提示）。
 */
const ENC_PREFIX = 'enc:v1:';

function encryptionKey() {
  return env.getEnv('DB_ENCRYPT_KEY');
}

function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(String(passphrase)).digest(); // 32B
}

function encryptApiKey(plain) {
  const k = encryptionKey();
  if (!k || !plain || String(plain).startsWith(ENC_PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(k), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

function decryptApiKey(value) {
  if (!value || !String(value).startsWith(ENC_PREFIX)) return value;
  const k = encryptionKey();
  if (!k) return ''; // 无密钥：调用方按空 Key 处理（上游返回鉴权失败，提示明确）
  try {
    const parts = String(value).slice(ENC_PREFIX.length).split('.');
    if (parts.length !== 3) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(k), Buffer.from(parts[0], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

let warnedMissingKey = false;
/** 启动自检：库中存在加密 Key 但未提供 DB_ENCRYPT_KEY 时警告一次 */
function checkEncryptionState() {
  if (warnedMissingKey || encryptionKey()) return;
  const hasEnc = db.load().configs.some((c) => typeof c.apiKey === 'string' && c.apiKey.startsWith(ENC_PREFIX));
  if (hasEnc) {
    warnedMissingKey = true;
    console.warn('[config] 检测到已加密的 API Key，但未设置 DB_ENCRYPT_KEY——这些配置将无法调用上游，请在环境变量中提供同一把密钥。');
  }
}

/**
 * 环境变量隐式配置的固定 ID。
 * 当后台没有任何配置、但 .env/环境变量提供了 XFYUN_API_KEY 时，
 * 自动合成一条只读配置，实现「配好 Key 即用」，无需先进后台添加。
 */
const ENV_CONFIG_ID = '__env__';

/**
 * reasoning_effort 归一化（对齐官方文档）：
 * 合法值为 high / max；为兼容旧版与 SDK 习惯，low/medium 映射为 high，xhigh 映射为 max；
 * 其余非法值回落默认 high。
 */
function normalizeReasoningEffort(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'max' || s === 'xhigh') return 'max';
  if (s === 'high' || s === 'medium' || s === 'low') return 'high';
  return 'high';
}

// 返回给客户端的配置（API Key 脱敏；加密存储的先解密再掩码）
function sanitize(cfg) {
  if (!cfg) return cfg;
  return {
    ...cfg,
    apiKey: maskKey(decryptApiKey(cfg.apiKey))
  };
}

function maskKey(key) {
  if (!key || key.length < 8) return key ? '****' : '';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function validateConfig(body) {
  const errors = [];
  const cfg = {
    name: typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : DEFAULT_NAME,
    baseUrl: typeof body.baseUrl === 'string' && body.baseUrl.trim()
      ? body.baseUrl.trim().replace(/\/+$/, '')
      : 'https://maas-api.cn-huabei-1.xf-yun.com',
    apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : '',
    model: typeof body.model === 'string' ? body.model.trim() : '',
    temperature: clampNum(body.temperature, 0, 1, 0.7),
    topP: optNum(body.topP, 0, 1),
    maxTokens: optInt(body.maxTokens, 1, 262144),
    presencePenalty: clampNum(body.presencePenalty, -2, 2, 0),
    frequencyPenalty: clampNum(body.frequencyPenalty, -2, 2, 0),
    systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '',
    webSearch: !!body.webSearch,
    user: typeof body.user === 'string' ? body.user.trim() : '',
    enableThinking: !!body.enableThinking,
    // 文档取值域为 high/max（low/medium→high、xhigh→max 兼容映射），历史上误限制为 low/medium/high
    reasoningEffort: normalizeReasoningEffort(body.reasoningEffort),
    stream: !!body.stream,
    priority: optInt(body.priority, 0, 999, 100),
    enabled: body.enabled === undefined ? true : !!body.enabled,
    // ——— 图片生成（TTI）设置 ———
    ttiEnabled: !!body.ttiEnabled,
    ttiModel: typeof body.ttiModel === 'string' ? body.ttiModel.trim() : '',   // 图片模型 ModelID（domain）
    ttiBaseUrl: typeof body.ttiBaseUrl === 'string' ? body.ttiBaseUrl.trim().replace(/\/+$/, '') : '',
    ttiWidth: optInt(body.ttiWidth, 256, 1024) ?? 512,
    ttiHeight: optInt(body.ttiHeight, 256, 1024) ?? 512,
    ttiSeed: optInt(body.ttiSeed, 0, 2147483647),                              // 0=随机
    numInferenceSteps: optInt(body.numInferenceSteps, 1, 50) ?? 20,
    guidanceScale: optNum(body.guidanceScale, 0, 20) ?? 5,
    scheduler: body.scheduler || 'DPM++ 2M Karras',
    negativePrompt: typeof body.negativePrompt === 'string' ? body.negativePrompt.trim() : '',
    uid: typeof body.uid === 'string' ? body.uid.trim() : '',
    patchId: typeof body.patchId === 'string' ? body.patchId.trim() : '',
    remark: typeof body.remark === 'string' ? body.remark : ''
  };

  if (!cfg.apiKey) errors.push('API Key 不能为空');
  if (!cfg.model) errors.push('model 不能为空');
  if (!/^https?:\/\//.test(cfg.baseUrl)) errors.push('baseUrl 必须是 http(s):// 开头的地址');
  if (cfg.user && !/^[A-Za-z0-9_-]{1,512}$/.test(cfg.user)) {
    errors.push('user 建议仅使用字母/数字/中划线/下划线，最长 512 字符');
  }

  // 拦截明显是示例/占位符的 Key，避免后续调用出现模糊的 401
  if (cfg.apiKey && /placeholder|fake|ak-key|your-api|testkey|^ak-?xxx/i.test(cfg.apiKey)) {
    errors.push('API Key 看起来是示例值/占位符，请填入讯飞 MaaS 控制台「API 调用 / APIKEY 管理」生成的真实 Key');
  }

  return { cfg, errors };
}

// 空值统一视为「未填写」：null/undefined/'' 都不能走 Number()——
// Number(null)===0、Number('')===0，会被误当成合法值钳到下限（maxTokens 曾因此恒为 1，模型只能产出 1 token）
function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function clampNum(v, min, max, dflt) {
  if (isBlank(v)) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
function optNum(v, min, max) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
function optInt(v, min, max) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function list() {
  const configs = db.load().configs;
  // 后台无任何配置时，若 .env 提供了 Key，则展示一条环境变量配置（只读，不可在后台编辑）
  if (!configs.length) {
    const ec = envConfig();
    return ec ? [{ ...sanitize(ec), _id: ec.id }] : [];
  }
  return configs.map((c) => ({ ...sanitize(c), _id: c.id }));
}

/**
 * 从环境变量合成隐式配置（配好 XFYUN_API_KEY 即可用，无需先进后台添加）。
 * 变量名兼容讯飞文档示例中的 SPARK_API_PASSWORD，二者等价。
 */
function envConfig() {
  const apiKey = env.getEnv('XFYUN_API_KEY') || env.getEnv('SPARK_API_PASSWORD');
  if (!apiKey) return null;
  return normalizeConfig({
    id: ENV_CONFIG_ID,
    name: env.getEnv('XFYUN_CONFIG_NAME', '环境变量配置（.env）'),
    baseUrl: env.getEnv('XFYUN_BASE_URL') || undefined, // 缺省走官方默认地址
    apiKey,
    model: env.getEnv('XFYUN_MODEL') || '',
    active: false,
    enabled: true,
    createdAt: '',
    updatedAt: ''
  });
}

/**
 * 用环境变量补全配置中缺失的接入字段（db 值优先，env 兜底）：
 * 后台没填 baseUrl/model 时也能借助 .env 的值跑起来；Key 不会写回 db。
 */
function fillFromEnv(cfg) {
  if (!cfg) return cfg;
  const out = { ...cfg };
  if (!out.apiKey) out.apiKey = env.getEnv('XFYUN_API_KEY') || env.getEnv('SPARK_API_PASSWORD') || '';
  else out.apiKey = decryptApiKey(out.apiKey); // 加密存储的解密为明文再供调用
  if (!out.baseUrl) out.baseUrl = env.getEnv('XFYUN_BASE_URL') || out.baseUrl;
  if (!out.model) out.model = env.getEnv('XFYUN_MODEL') || out.model;
  return out;
}

// 旧配置平滑兼容：缺失的新增字段补默认值
const NEW_FIELD_DEFAULTS = {
  presencePenalty: 0,
  frequencyPenalty: 0,
  systemPrompt: '',
  webSearch: false,
  user: '',
  priority: 100,
  enabled: true,
  // 图片生成（TTI）默认值
  ttiEnabled: false,
  ttiModel: '',
  ttiBaseUrl: '',
  ttiWidth: 512,
  ttiHeight: 512,
  ttiSeed: null,
  numInferenceSteps: 20,
  guidanceScale: 5,
  scheduler: 'DPM++ 2M Karras',
  negativePrompt: '',
  uid: '',
  patchId: ''
};

function normalizeConfig(cfg) {
  if (!cfg) return cfg;
  return { ...NEW_FIELD_DEFAULTS, ...cfg };
}

function get(id) {
  if (id === ENV_CONFIG_ID) {
    const ec = envConfig();
    return ec ? { ...sanitize(ec), _id: ec.id } : null;
  }
  const cfg = db.load().configs.find((c) => c.id === id);
  return cfg ? { ...sanitize(fillFromEnv(normalizeConfig(cfg))), _id: cfg.id } : null;
}

// 内部获取完整配置（含 apiKey）
function getFull(id) {
  if (id === ENV_CONFIG_ID) return envConfig();
  const data = db.load();
  const cfg = data.configs.find((c) => c.id === id);
  if (cfg) return fillFromEnv(normalizeConfig(cfg));
  // 后台没有任何配置时，请求回落到环境变量配置（部署后配好 .env 即可直接调用）
  return data.configs.length ? null : envConfig();
}

function getActive() {
  const data = db.load();
  const cfg = data.configs.find((c) => c.active) || data.configs[0] || null;
  if (cfg) return fillFromEnv(normalizeConfig(cfg));
  return envConfig();
}

// 供调度器使用：返回完整配置（含 apiKey）列表，附带 id
function listForScheduling() {
  const configs = db.load().configs.map((c) => ({ ...fillFromEnv(normalizeConfig(c)), id: c.id }));
  if (!configs.length) {
    const ec = envConfig();
    if (ec) configs.push({ ...ec, id: ec.id });
  }
  return configs;
}

// 全局调度设置
function getSettings() {
  const data = db.load();
  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  return {
    autoSwitch: s.autoSwitch === undefined ? true : !!s.autoSwitch,
    cooldownSec: Number.isFinite(Number(s.cooldownSec)) && Number(s.cooldownSec) > 0
      ? Math.floor(Number(s.cooldownSec))
      : 30,
    // 工作台访客密码保护开关（后台「工作台访问控制」维护）
    workbenchAuthEnabled: !!s.workbenchAuthEnabled,
    // 开放自助注册（P3：默认关闭；开启后 /team-login 出现注册入口，注册角色固定为 member）
    allowSelfRegister: !!s.allowSelfRegister,
    // 前端面板是否显示模型名字（后台「界面显示设置」维护；关闭后只显示配置名称）
    showModelName: s.showModelName === undefined ? true : !!s.showModelName
  };
}

function updateSettings(body) {
  const current = getSettings();
  const next = { ...current };
  if (body.autoSwitch !== undefined) next.autoSwitch = !!body.autoSwitch;
  const sec = Number(body.cooldownSec);
  if (body.cooldownSec !== undefined && Number.isFinite(sec)) {
    next.cooldownSec = Math.min(3600, Math.max(1, Math.floor(sec)));
  }
  // —— 工作台访客密码 ——
  // 先处理密码：开启保护时可能本次随设置一起提交
  if (body.workbenchPassword !== undefined && body.workbenchPassword !== '') {
    const r = adminAuth.setWorkbenchPassword(body.workbenchPassword);
    if (!r.ok) return { ok: false, errors: [r.error] };
  }
  if (body.workbenchAuthEnabled !== undefined) {
    if (body.workbenchAuthEnabled && !adminAuth.hasWorkbenchPassword()) {
      return { ok: false, errors: ['开启密码保护前请先设置访客密码（至少 4 位）'] };
    }
    next.workbenchAuthEnabled = !!body.workbenchAuthEnabled;
  }
  // —— 开放自助注册（P3）——
  if (body.allowSelfRegister !== undefined) {
    next.allowSelfRegister = !!body.allowSelfRegister;
  }
  // —— 前端界面显示：模型名字开关（默认开；关闭后工作台只显示配置名称）——
  if (body.showModelName !== undefined) {
    next.showModelName = !!body.showModelName;
  }
  db.load().settings = { ...db.load().settings, ...next };
  db.save();
  return { ok: true, data: next };
}

function create(body) {
  const { cfg, errors } = validateConfig(body);
  if (errors.length) return { ok: false, errors };
  const data = db.load();
  cfg.id = db.getNextId('cfg');
  cfg.active = data.configs.length === 0; // 首个配置自动设为激活
  cfg.createdAt = new Date().toISOString();
  cfg.updatedAt = cfg.createdAt;
  cfg.apiKey = encryptApiKey(cfg.apiKey); // 设置 DB_ENCRYPT_KEY 时落库即加密
  data.configs.push(cfg);
  db.save();
  return { ok: true, data: sanitize(cfg) };
}

function update(id, body) {
  // 环境变量配置只在 .env 中维护，后台不可改
  if (id === ENV_CONFIG_ID) return { ok: false, notFound: true, envManaged: true };
  const data = db.load();
  const idx = data.configs.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, notFound: true };

  // 编辑时允许 apiKey 留空 = 保留原值
  const merged = { ...data.configs[idx], ...body };
  if (!body.apiKey) merged.apiKey = data.configs[idx].apiKey;

  const { cfg, errors } = validateConfig(merged);
  if (errors.length) return { ok: false, errors };

  cfg.id = id;
  cfg.active = data.configs[idx].active;
  cfg.createdAt = data.configs[idx].createdAt;
  cfg.updatedAt = new Date().toISOString();
  cfg.apiKey = encryptApiKey(cfg.apiKey); // 已是密文则原样保留（encryptApiKey 幂等）
  data.configs[idx] = cfg;
  db.save();
  return { ok: true, data: sanitize(cfg) };
}

function remove(id) {
  if (id === ENV_CONFIG_ID) return { ok: false, notFound: true, envManaged: true };
  const data = db.load();
  const idx = data.configs.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, notFound: true };
  const removed = data.configs.splice(idx, 1)[0];
  // 若删除了激活配置，把第一个设为激活
  if (removed.active && data.configs.length) data.configs[0].active = true;
  db.save();
  return { ok: true };
}

function activate(id) {
  if (id === ENV_CONFIG_ID) return { ok: false, notFound: true, envManaged: true };
  const data = db.load();
  const target = data.configs.find((c) => c.id === id);
  if (!target) return { ok: false, notFound: true };
  for (const c of data.configs) c.active = c.id === id;
  db.save();
  return { ok: true, data: sanitize(target) };
}

module.exports = {
  list,
  get,
  getFull,
  getActive,
  listForScheduling,
  getSettings,
  updateSettings,
  create,
  update,
  remove,
  activate,
  encryptApiKey,
  decryptApiKey,
  checkEncryptionState
};