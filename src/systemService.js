'use strict';

/**
 * 系统信息 / 模块状态 / 诊断修复 / 端口管理（后台「系统信息」页的数据源）
 *
 * 设计要点：
 * - snapshot()  一次性汇总运行环境、资源占用、业务规模与 Token 统计（页面一次请求即可渲染）
 * - modules()   各功能模块的「状态 + 详情」，用于模块功能状态表
 * - diagnose()  只读体检，返回逐项结论（ok / warn / error），不修改任何数据
 * - repair()    一键修复：只做「幂等且安全」的自我修复（补目录 / 重算计数 / 清理无引用文件 /
 *               修剪悬空引用与非法时间戳），绝不删除用户业务数据
 * - 端口：读 .env / 探测可用性 / 原子写入（真正的重启由路由层在响应落地后执行）
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const pkg = require('../package.json');
const db = require('./db');
const configService = require('./configService');
const kbService = require('./kbService');
const workflowService = require('./workflowService');
const agentService = require('./agentService');
const pluginService = require('./pluginService');
const mcpService = require('./mcpService');
const storageService = require('./storageService');
const ttsService = require('./ttsService');
const logService = require('./logService');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const MIN_NODE_MAJOR = 18;

/* ============================ 资源采样 ============================ */

function sampleCpu() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0);
    idle += t.idle || 0;
  }
  return { idle, total };
}

let lastCpuSample = sampleCpu();
// 后台低频采样：首次调用也能得到有意义的瞬时占用（unref 不阻塞进程退出）
const cpuTimer = setInterval(() => { lastCpuSample = sampleCpu(); }, 3000);
if (cpuTimer.unref) cpuTimer.unref();

/** 自上次采样以来的 CPU 平均占用率（0~100） */
function cpuUsagePct() {
  const cur = sampleCpu();
  const dTotal = cur.total - lastCpuSample.total;
  const dIdle = cur.idle - lastCpuSample.idle;
  lastCpuSample = cur;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}

function fileSizeSafe(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

function dirSizeSafe(dir) {
  let total = 0;
  let count = 0;
  const walk = (d) => {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
      const abs = path.join(d, it.name);
      if (it.isDirectory()) walk(abs);
      else {
        const st = (() => { try { return fs.statSync(abs); } catch (_) { return null; } })();
        if (st) { total += st.size; count++; }
      }
    }
  };
  walk(dir);
  return { bytes: total, count };
}

/* ============================ Token 统计 ============================ */

function tokenStats(days = 14) {
  const data = db.load();
  // 「清零」只重置统计基准时间，不删除任何运行日志（日志仍可在「运行日志」页查看）
  const sinceRaw = (data.settings && data.settings.tokenStatsResetAt) || '';
  const since = Number.isFinite(Date.parse(sinceRaw)) ? Date.parse(sinceRaw) : 0;
  const logs = data.logs || [];
  const byDay = new Map();
  const byModel = new Map();
  let input = 0;
  let output = 0;
  let total = 0;
  let calls = 0;

  for (const l of logs) {
    const t = Number(l.totalTokens) || 0;
    if (!t) continue; // 流式请求未回传 usage，不计入（与运行日志口径一致）
    if (since && (Date.parse(l.time) || 0) < since) continue; // 清零前的不再计入
    calls++;
    const pi = Number(l.promptTokens) || 0;
    const po = Number(l.completionTokens) || 0;
    input += pi;
    output += po;
    total += t;

    const date = String(l.time || '').slice(0, 10) || '-';
    const d = byDay.get(date) || { date, total: 0, input: 0, output: 0, calls: 0 };
    d.total += t; d.input += pi; d.output += po; d.calls++;
    byDay.set(date, d);

    const model = l.model || l.configName || '未标注模型';
    const m = byModel.get(model) || { model, total: 0, calls: 0 };
    m.total += t; m.calls++;
    byModel.set(model, m);
  }

  return {
    input,
    output,
    total,
    calls,
    since: sinceRaw || '',
    days: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, days),
    models: [...byModel.values()].sort((a, b) => b.total - a.total).slice(0, 10)
  };
}

/** 清零 Token 统计：只记录基准时间，不动日志 */
function clearTokenStats() {
  const data = db.load();
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  const at = new Date().toISOString();
  data.settings.tokenStatsResetAt = at;
  db.save();
  return { since: at };
}

/* ============================ 端口 ============================ */

function readEnvText() {
  try { return fs.readFileSync(ENV_FILE, 'utf-8'); } catch (_) { return ''; }
}

function getEnvPort() {
  const text = readEnvText();
  const m = text.match(/^\s*PORT\s*=\s*(\d+)\s*$/mi);
  return m ? Number(m[1]) : null;
}

/** 原子写入 .env 的 PORT（保留其它配置行与注释，缺失则追加） */
function writeEnvPort(port) {
  const text = readEnvText();
  const lines = text ? text.split(/\r?\n/) : [];
  let replaced = false;
  const out = lines.map((line) => {
    if (/^\s*PORT\s*=/i.test(line)) { replaced = true; return `PORT=${port}`; }
    return line;
  });
  if (!replaced) {
    // 去掉末尾多余空行，再追加
    while (out.length && !out[out.length - 1].trim()) out.pop();
    out.push(`PORT=${port}`);
  }
  const body = out.join('\n') + '\n';
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, body, 'utf-8');
  fs.renameSync(tmp, ENV_FILE);
  return body;
}

function validatePort(raw) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: '端口必须是 1-65535 之间的整数' };
  }
  if (port < 1024) {
    return { ok: false, error: '端口小于 1024 需要系统管理员权限，建议使用 1024-65535' };
  }
  return { ok: true, port };
}

/** 探测某端口上是否已有服务在监听（Windows 下 bind 会因 SO_REUSEADDR 假成功，故先试连接） */
function probeConnect(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) { /* 忽略 */ }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
  });
}

/** 探测端口是否可用（先试连已有服务，再试监听全部网卡） */
async function checkPortAvailable(port, timeoutMs = 1500) {
  if (await probeConnect(port)) {
    return { available: false, reason: '端口已被占用（已有服务在监听）' };
  }
  return new Promise((resolve) => {
    const srv = net.createServer();
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { srv.close(); } catch (_) { /* 忽略 */ }
      resolve(r);
    };
    srv.once('error', (e) => {
      const code = (e && e.code) || '';
      const reason = code === 'EADDRINUSE' ? '端口已被占用'
        : code === 'EACCES' ? '权限不足，无法监听该端口'
          : `监听失败：${(e && e.message) || code}`;
      finish({ available: false, reason });
    });
    srv.once('listening', () => finish({ available: true, reason: '' }));
    try {
      srv.listen({ port, host: '0.0.0.0' });
    } catch (e) {
      finish({ available: false, reason: `监听失败：${(e && e.message) || ''}` });
    }
    setTimeout(() => finish({ available: false, reason: '探测超时' }), timeoutMs);
  });
}

/* ============================ 快照 ============================ */

function buildCounts() {
  const d = db.load();
  const kbs = d.kbs || [];
  const agents = d.agents || [];
  const workflows = d.workflows || [];
  const uploads = dirSizeSafe(storageService.UPLOAD_ROOT);
  return {
    members: (d.users || []).length,
    membersActive: (d.users || []).filter((u) => u.status !== 'disabled').length,
    configs: (d.configs || []).length,
    configsEnabled: (d.configs || []).filter((c) => c.enabled !== false).length,
    conversations: (d.conversations || []).length,
    messages: (d.conversations || []).reduce((s, c) => s + (Array.isArray(c.messages) ? c.messages.length : 0), 0),
    shares: (d.shares || []).length,
    knowledgeBases: kbs.length,
    kbFiles: kbs.reduce((s, k) => s + (k.files || []).length, 0),
    kbChunks: kbs.reduce((s, k) => s + (k.chunks || []).length, 0),
    agents: agents.length,
    agentsWithKb: agents.filter((a) => a.kbId).length,
    agentsWithWf: agents.filter((a) => a.wfId).length,
    workflows: workflows.length,
    workflowNodes: workflows.reduce((s, w) => s + (w.nodes || []).length, 0),
    plugins: (d.plugins || []).length,
    pluginsEnabled: (d.plugins || []).filter((p) => p.enabled).length,
    mcps: (d.mcps || []).length,
    logEntries: (d.logs || []).length,
    auditEntries: (d.auditLogs || []).length,
    uploadFiles: uploads.count,
    uploadBytes: uploads.bytes
  };
}

function snapshot(port) {
  const counts = buildCounts();
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const settings = configService.getSettings();

  return {
    version: pkg.version || '',
    node: process.version,
    nodeMajor: Number(String(process.version).replace(/^v/, '').split('.')[0]) || 0,
    platform: os.platform(),
    arch: os.arch(),
    platformLabel: `${os.platform()} ${os.arch()}`,
    host: os.hostname(),
    osRelease: os.release(),
    cpuModel: (os.cpus()[0] || {}).model || '',
    cpuCores: (os.cpus() || []).length,
    cpuUsagePct: cpuUsagePct(),
    memory: {
      totalMB: Math.round(totalMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      usedPct: Math.round((usedMem / totalMem) * 100),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      processPct: Math.round((mem.rss / totalMem) * 100)
    },
    uptimeSec: Math.floor(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    port: Number(port) || process.env.PORT || 4000,
    envPort: getEnvPort(),
    dataDir: db.DATA_DIR,
    dbFile: path.basename(db.DB_FILE),
    dbSizeBytes: fileSizeSafe(db.DB_FILE),
    counts,
    tokens: tokenStats(14),
    settings: {
      autoSwitch: settings.autoSwitch,
      cooldownSec: settings.cooldownSec,
      workbenchAuthEnabled: settings.workbenchAuthEnabled,
      allowSelfRegister: settings.allowSelfRegister,
      announcementEnabled: !!(settings.announcement && settings.announcement.enabled)
    },
    now: new Date().toISOString()
  };
}

/* ============================ 模块状态 ============================ */

function bytesLabel(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function modules(snap) {
  const d = db.load();
  const s = configService.getSettings();
  const counts = snap.counts;
  const tts = (() => { try { return ttsService.getConfig() || {}; } catch (_) { return {}; } })();
  const mcpTools = (() => {
    try { return (d.mcps || []).reduce((s2, m) => s2 + ((m.tools || []).length), 0); } catch (_) { return 0; }
  })();

  const list = [
    {
      key: 'db',
      icon: '🗄️',
      name: '数据存储',
      level: 'ok',
      status: '正常',
      detail: `${bytesLabel(snap.dbSizeBytes)} · JSON 原子写入 · ${counts.members} 成员 / ${counts.conversations} 会话`
    },
    {
      key: 'model',
      icon: '🧠',
      name: 'AI 模型通道',
      level: counts.configsEnabled ? 'ok' : 'warn',
      status: counts.configsEnabled ? '正常' : '未配置',
      detail: counts.configsEnabled
        ? `${counts.configsEnabled}/${counts.configs} 个通道启用，${s.autoSwitch ? '自动调度 + 故障切换' : '固定首选'}，失败冷却 ${s.cooldownSec}s`
        : '尚未添加可用的模型配置，请到「API 配置」添加'
    },
    {
      key: 'kb',
      icon: '📚',
      name: '知识库检索',
      level: counts.knowledgeBases ? 'ok' : 'idle',
      status: counts.knowledgeBases ? '正常' : '未启用',
      detail: counts.knowledgeBases
        ? `${counts.knowledgeBases} 个库 · ${counts.kbFiles} 个文件 · ${counts.kbChunks} 个分段（bigram + IDF 关键词检索）`
        : '暂无知识库，可在「知识库」页创建并导入文档'
    },
    {
      key: 'workflow',
      icon: '🧩',
      name: '画布工作流',
      level: counts.workflows ? 'ok' : 'idle',
      status: counts.workflows ? '正常' : '未启用',
      detail: counts.workflows
        ? `${counts.workflows} 个工作流 · ${counts.workflowNodes} 个节点，服务端拓扑执行`
        : '暂无工作流，可在「工作流」页拖拽编排'
    },
    {
      key: 'agent',
      icon: '🤖',
      name: '智能体应用',
      level: counts.agents ? 'ok' : 'idle',
      status: counts.agents ? '正常' : '未启用',
      detail: counts.agents
        ? `${counts.agents} 个智能体（${counts.agentsWithKb} 个关联知识库 / ${counts.agentsWithWf} 个绑定工作流）`
        : '暂无智能体，可在「智能体」页导入预置模板'
    },
    {
      key: 'plugin',
      icon: '🔌',
      name: '插件工具',
      level: counts.pluginsEnabled ? 'ok' : 'idle',
      status: counts.pluginsEnabled ? '正常' : '未启用',
      detail: counts.plugins ? `已安装 ${counts.plugins} 个，启用 ${counts.pluginsEnabled} 个` : '插件市场暂未安装任何插件'
    },
    {
      key: 'mcp',
      icon: '🧷',
      name: 'MCP 服务',
      level: counts.mcps ? 'ok' : 'idle',
      status: counts.mcps ? '正常' : '未启用',
      detail: counts.mcps ? `${counts.mcps} 个服务，已发现 ${mcpTools} 个工具` : '未配置 MCP 服务'
    },
    {
      key: 'storage',
      icon: '📦',
      name: '文件存储',
      level: 'ok',
      status: '正常',
      detail: `${counts.uploadFiles} 个文件 · ${bytesLabel(counts.uploadBytes)}（知识库源文件 / 对话附件 / 头像）`
    },
    {
      key: 'tts',
      icon: '🔊',
      name: '语音合成',
      level: tts.enabled ? 'ok' : 'idle',
      status: tts.enabled ? '正常' : '未启用',
      detail: tts.enabled ? `已启用，模型 ${tts.model || '-'}，音色 ${(tts.voices || []).length || 1} 个` : '未配置 TTS 通道，可在「语音合成」添加'
    },
    {
      key: 'share',
      icon: '🔗',
      name: '会话与分享',
      level: 'ok',
      status: '正常',
      detail: `${counts.conversations} 个会话 · ${counts.messages} 条消息 · ${counts.shares} 个分享链接`
    },
    {
      key: 'security',
      icon: '🛡️',
      name: '登录与安全',
      level: 'ok',
      status: '正常',
      detail: `密码 scrypt 哈希 · 访客保护${s.workbenchAuthEnabled ? '已开启' : '关闭'} · 自助注册${s.allowSelfRegister ? '已开启' : '关闭'}`
    },
    {
      key: 'audit',
      icon: '🧾',
      name: '审计与日志',
      level: 'ok',
      status: '正常',
      detail: `审计 ${counts.auditEntries} 条 · 运行日志 ${counts.logEntries}/${logService.MAX_LOGS} 条（环形缓冲）`
    },
    {
      key: 'notice',
      icon: '📢',
      name: '通知公告',
      level: s.announcement && s.announcement.enabled ? 'ok' : 'idle',
      status: s.announcement && s.announcement.enabled ? '已开启' : '未启用',
      detail: s.announcement && s.announcement.enabled ? '公告已推送到工作台侧栏顶部' : '未配置公告内容'
    },
    {
      key: 'port',
      icon: '🌐',
      name: '服务端口',
      level: 'ok',
      status: '监听中',
      detail: `当前 ${snap.port} · .env ${snap.envPort || '未设置（默认 4000）'} · 监听 ${os.hostname()}`
    }
  ];
  return list;
}

/* ============================ 诊断 ============================ */

function checkDataFile() {
  const file = db.DB_FILE;
  if (!fs.existsSync(file)) {
    return { key: 'data-file', title: '数据文件', level: 'error', detail: '数据文件不存在（首次启动会自动创建）', fixable: true };
  }
  let size = 0;
  let parseOk = true;
  try {
    size = fs.statSync(file).size;
    JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) { parseOk = false; }
  if (!parseOk) {
    return { key: 'data-file', title: '数据文件', level: 'error', detail: '数据文件不是合法 JSON，可能已损坏（建议从备份恢复）', fixable: false };
  }
  if (size < 20) {
    return { key: 'data-file', title: '数据文件', level: 'warn', detail: '数据文件内容过小，疑似空库', fixable: false };
  }
  return { key: 'data-file', title: '数据文件', level: 'ok', detail: `${path.basename(file)} 可读，${bytesLabel(size)}`, fixable: false };
}

function checkDirs() {
  const problems = [];
  for (const [label, dir] of [['数据目录', db.DATA_DIR], ['上传目录', storageService.UPLOAD_ROOT]]) {
    try {
      if (!fs.existsSync(dir)) { problems.push(`${label}缺失`); continue; }
      const probe = path.join(dir, `.probe-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (_) { problems.push(`${label}不可写`); }
  }
  if (problems.length) {
    return { key: 'dirs', title: '目录读写', level: 'error', detail: problems.join('、'), fixable: true };
  }
  return { key: 'dirs', title: '目录读写', level: 'ok', detail: '数据目录与上传目录可正常读写', fixable: true };
}

function checkNode() {
  const major = Number(String(process.version).replace(/^v/, '').split('.')[0]) || 0;
  if (major < MIN_NODE_MAJOR) {
    return { key: 'node', title: '运行环境', level: 'error', detail: `Node.js ${process.version} 版本过低，请升级到 v${MIN_NODE_MAJOR}+`, fixable: false };
  }
  return { key: 'node', title: '运行环境', level: 'ok', detail: `Node.js ${process.version} · ${os.platform()} ${os.arch()} · ${(os.cpus() || []).length} 核`, fixable: false };
}

function checkModels() {
  const d = db.load();
  const cfgs = d.configs || [];
  if (!cfgs.length) {
    return { key: 'models', title: '模型通道', level: 'warn', detail: '尚未配置任何模型通道，对话功能不可用', fixable: false };
  }
  const noKey = cfgs.filter((c) => c.enabled !== false && !c.apiKey && !c.apiKeyEnc);
  const enabled = cfgs.filter((c) => c.enabled !== false);
  if (!enabled.length) {
    return { key: 'models', title: '模型通道', level: 'error', detail: `${cfgs.length} 个配置全部被停用`, fixable: false };
  }
  if (noKey.length) {
    return {
      key: 'models',
      title: '模型通道',
      level: 'warn',
      detail: `${noKey.length} 个启用中的配置缺少 API Key：${noKey.slice(0, 3).map((c) => c.name || c.id).join('、')}`,
      fixable: false
    };
  }
  return { key: 'models', title: '模型通道', level: 'ok', detail: `${enabled.length} 个通道启用，均含 API Key`, fixable: false };
}

function checkKb() {
  const kbs = db.load().kbs || [];
  let badFiles = 0;
  let emptyChunks = 0;
  let missingFile = 0;
  for (const kb of kbs) {
    const fileIds = new Set((kb.files || []).map((f) => f.id));
    for (const f of kb.files || []) {
      const real = (kb.chunks || []).filter((c) => c.fileId === f.id).length;
      if ((f.chunkCount || 0) !== real) badFiles++;
    }
    for (const c of kb.chunks || []) {
      if (!String(c.text || '').trim()) emptyChunks++;
      if (c.fileId && !fileIds.has(c.fileId)) missingFile++;
    }
  }
  if (!kbs.length) {
    return { key: 'kb', title: '知识库索引', level: 'idle', detail: '暂无知识库', fixable: false };
  }
  if (badFiles || emptyChunks || missingFile) {
    const parts = [];
    if (badFiles) parts.push(`${badFiles} 个文件分段计数不一致`);
    if (emptyChunks) parts.push(`${emptyChunks} 个空分段`);
    if (missingFile) parts.push(`${missingFile} 个分段指向已删除文件`);
    return { key: 'kb', title: '知识库索引', level: 'warn', detail: parts.join('、'), fixable: true };
  }
  return { key: 'kb', title: '知识库索引', level: 'ok', detail: `${kbs.length} 个知识库索引一致`, fixable: true };
}

function checkWorkflows() {
  const wfs = db.load().workflows || [];
  const broken = [];
  for (const w of wfs) {
    const nodes = w.nodes || [];
    const edges = w.edges || [];
    const ids = new Set(nodes.map((n) => n.id));
    const entryCount = nodes.filter((n) => n.type === 'entry').length;
    const dangling = edges.filter((e) => !ids.has(e.from) || !ids.has(e.to)).length;
    if (entryCount !== 1 || dangling) {
      broken.push(`${w.name}（入口 ${entryCount} 个${dangling ? `，悬空连线 ${dangling} 条` : ''}）`);
    }
  }
  if (!wfs.length) return { key: 'workflow', title: '工作流图', level: 'idle', detail: '暂无工作流', fixable: false };
  if (broken.length) {
    return { key: 'workflow', title: '工作流图', level: 'warn', detail: `${broken.length} 个工作流结构异常：${broken.slice(0, 3).join('；')}`, fixable: true };
  }
  return { key: 'workflow', title: '工作流图', level: 'ok', detail: `${wfs.length} 个工作流入口唯一、连线完整`, fixable: true };
}

function checkAgentLinks() {
  const d = db.load();
  const kbIds = new Set((d.kbs || []).map((k) => k.id));
  const wfIds = new Set((d.workflows || []).map((w) => w.id));
  const badKb = (d.agents || []).filter((a) => a.kbId && !kbIds.has(a.kbId));
  const badWf = (d.agents || []).filter((a) => a.wfId && !wfIds.has(a.wfId));
  const noWf = (d.agents || []).filter((a) => !a.wfId);
  if (badKb.length || badWf.length) {
    const parts = [];
    if (badKb.length) parts.push(`${badKb.length} 个智能体关联的知识库已不存在`);
    if (badWf.length) parts.push(`${badWf.length} 个智能体绑定的工作流已不存在`);
    return { key: 'agent-links', title: '智能体引用', level: 'warn', detail: parts.join('、'), fixable: true };
  }
  if (!(d.agents || []).length) return { key: 'agent-links', title: '智能体引用', level: 'idle', detail: '暂无智能体', fixable: false };
  if (noWf.length) {
    return { key: 'agent-links', title: '智能体引用', level: 'info', detail: `${noWf.length} 个智能体未绑定工作流（不影响对话）`, fixable: false };
  }
  return { key: 'agent-links', title: '智能体引用', level: 'ok', detail: '智能体引用的知识库 / 工作流均存在', fixable: true };
}

function checkOrphanUploads() {
  try {
    const r = storageService.list({ limit: 1 });
    const orphanStat = (r.stats && r.stats.byKind && r.stats.byKind.orphan) || { count: 0, bytes: 0 };
    const missing = (r.orphanRefs || []).length;
    if (orphanStat.count || missing) {
      const parts = [];
      if (orphanStat.count) parts.push(`${orphanStat.count} 个文件未被任何业务引用（${bytesLabel(orphanStat.bytes)}）`);
      if (missing) parts.push(`${missing} 条引用指向已丢失的文件`);
      // 不做自动删除：避免误删「已上传但尚未落库引用」的文件，交给「文件存储」页手动清理
      return {
        key: 'uploads',
        title: '上传目录',
        level: 'warn',
        detail: `${parts.join('、')}，可在「文件存储」页核对后清理`,
        fixable: false
      };
    }
    return {
      key: 'uploads',
      title: '上传目录',
      level: 'ok',
      detail: `${(r.stats && r.stats.totalFiles) || 0} 个文件均有业务引用`,
      fixable: false
    };
  } catch (e) {
    return { key: 'uploads', title: '上传目录', level: 'warn', detail: `扫描失败：${e.message}`, fixable: false };
  }
}

function checkLogs() {
  const logs = db.load().logs || [];
  const now = Date.now();
  const future = logs.filter((l) => (Date.parse(l.time) || 0) > now + 10 * 60 * 1000).length;
  const naive = logs.filter((l) => !Number.isFinite(Date.parse(l.time))).length;
  const near = logs.length > logService.MAX_LOGS * 0.95;
  if (future || naive) {
    return { key: 'logs', title: '运行日志', level: 'warn', detail: `${future + naive} 条日志时间戳异常（未来时间或不可解析）`, fixable: true };
  }
  if (near) {
    return { key: 'logs', title: '运行日志', level: 'info', detail: `日志已用 ${logs.length}/${logService.MAX_LOGS} 条，接近环形缓冲上限`, fixable: true };
  }
  return { key: 'logs', title: '运行日志', level: 'ok', detail: `${logs.length}/${logService.MAX_LOGS} 条，时间戳正常`, fixable: true };
}

function checkPort(snap) {
  if (snap.envPort && snap.envPort !== snap.port) {
    return {
      key: 'port',
      title: '服务端口',
      level: 'warn',
      detail: `.env 中的 PORT=${snap.envPort} 与当前监听端口 ${snap.port} 不一致，重启后会切换`,
      fixable: false
    };
  }
  const tail = snap.envPort ? `（与 .env 的 PORT=${snap.envPort} 一致）` : '（.env 未设置 PORT，使用启动参数）';
  return { key: 'port', title: '服务端口', level: 'ok', detail: `监听 ${snap.port}${tail}`, fixable: false };
}

function checkDisk(snap) {
  try {
    if (typeof fs.statfsSync !== 'function') {
      return { key: 'disk', title: '磁盘空间', level: 'info', detail: `数据文件 ${bytesLabel(snap.dbSizeBytes)}，未采集磁盘剩余空间`, fixable: false };
    }
    const st = fs.statfsSync(db.DATA_DIR);
    const total = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const usedPct = total ? Math.round((1 - free / total) * 100) : 0;
    const level = free < 200 * 1024 * 1024 ? 'error' : usedPct > 95 ? 'warn' : 'ok';
    return {
      key: 'disk',
      title: '磁盘空间',
      level,
      detail: `剩余 ${bytesLabel(free)} / 共 ${bytesLabel(total)}（已用 ${usedPct}%）`,
      fixable: false
    };
  } catch (_) {
    return { key: 'disk', title: '磁盘空间', level: 'info', detail: '当前平台不支持磁盘空间探测', fixable: false };
  }
}

function diagnose() {
  const snap = snapshot(getEnvPort());
  const checks = [
    checkDataFile(),
    checkDirs(),
    checkNode(),
    checkModels(),
    checkKb(),
    checkWorkflows(),
    checkAgentLinks(),
    checkOrphanUploads(),
    checkLogs(),
    checkPort(snap),
    checkDisk(snap)
  ];
  const summary = {
    ok: checks.filter((c) => c.level === 'ok').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    error: checks.filter((c) => c.level === 'error').length,
    info: checks.filter((c) => c.level === 'info' || c.level === 'idle').length,
    fixable: checks.filter((c) => c.fixable && c.level !== 'ok').length
  };
  const level = summary.error ? 'error' : summary.warn ? 'warn' : 'ok';
  return { checks, summary, level, at: new Date().toISOString() };
}

/* ============================ 一键修复 ============================ */

const FIXES = [
  {
    key: 'dirs',
    title: '补建目录',
    run() {
      const created = [];
      for (const dir of [db.DATA_DIR, storageService.UPLOAD_ROOT]) {
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created.push(path.basename(dir)); }
      }
      db.load(); // 触发数据文件初始化（不存在时按默认结构创建）
      return { changed: created.length, note: created.length ? `已创建 ${created.join('、')}` : '' };
    }
  },
  {
    key: 'kb',
    title: '重算知识库计数',
    run() {
      const d = db.load();
      let changed = 0;
      for (const kb of d.kbs || []) {
        for (const f of kb.files || []) {
          const real = (kb.chunks || []).filter((c) => c.fileId === f.id).length;
          if ((f.chunkCount || 0) !== real) { f.chunkCount = real; changed++; }
        }
      }
      if (changed) db.save();
      return { changed, note: changed ? `修正 ${changed} 个文件的分段计数` : '' };
    }
  },
  {
    key: 'workflow',
    title: '修复工作流图',
    run() {
      const d = db.load();
      let changed = 0;
      for (const w of d.workflows || []) {
        const nodes = Array.isArray(w.nodes) ? w.nodes : [];
        const edges = Array.isArray(w.edges) ? w.edges : [];
        const ids = new Set(nodes.map((n) => n.id));
        const keep = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
        if (keep.length !== edges.length) { w.edges = keep; changed += edges.length - keep.length; }
        const entryCount = nodes.filter((n) => n.type === 'entry').length;
        if (!entryCount) {
          const entryId = `nfix${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
          nodes.unshift({ id: entryId, type: 'entry', x: 120, y: 120, cfg: {} });
          const target = nodes.find((n) => n.type !== 'entry');
          if (target) w.edges = [...(w.edges || []), { from: entryId, to: target.id }];
          w.nodes = nodes;
          changed++;
        }
      }
      if (changed) db.save();
      return { changed, note: changed ? `修复 ${changed} 处（悬空连线 / 缺失入口）` : '' };
    }
  },
  {
    key: 'agent-links',
    title: '清理失效引用',
    run() {
      const d = db.load();
      const kbIds = new Set((d.kbs || []).map((k) => k.id));
      const wfIds = new Set((d.workflows || []).map((w) => w.id));
      let changed = 0;
      for (const a of d.agents || []) {
        if (a.kbId && !kbIds.has(a.kbId)) { a.kbId = ''; changed++; }
        if (a.wfId && !wfIds.has(a.wfId)) { a.wfId = ''; changed++; }
      }
      if (changed) db.save();
      return { changed, note: changed ? `清理 ${changed} 条失效引用` : '' };
    }
  },
  {
    key: 'logs',
    title: '修剪日志',
    run() {
      const d = db.load();
      const now = Date.now();
      const before = (d.logs || []).length;
      const clean = (d.logs || []).filter((l) => {
        const t = Date.parse(l.time);
        return Number.isFinite(t) && t <= now + 10 * 60 * 1000;
      });
      const trimmed = clean.slice(-logService.MAX_LOGS);
      const changed = before - trimmed.length;
      if (changed) { d.logs = trimmed; db.save(); }
      return { changed, note: changed ? `修剪 ${changed} 条异常/超量日志` : '' };
    }
  }
];

function repair() {
  const applied = [];
  for (const fix of FIXES) {
    try {
      const r = fix.run();
      if (r && r.changed) applied.push({ key: fix.key, title: fix.title, changed: r.changed, note: r.note || '' });
    } catch (e) {
      applied.push({ key: fix.key, title: fix.title, changed: 0, error: e.message });
    }
  }
  const result = diagnose();
  return {
    fixed: applied,
    changedTotal: applied.reduce((s, a) => s + (a.changed || 0), 0),
    errors: applied.filter((a) => a.error).map((a) => `${a.title}：${a.error}`),
    diagnose: result
  };
}

module.exports = {
  snapshot,
  modules,
  clearTokenStats,
  diagnose,
  repair,
  getEnvPort,
  writeEnvPort,
  validatePort,
  checkPortAvailable,
  bytesLabel,
  ENV_FILE
};
