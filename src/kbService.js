'use strict';

/**
 * 知识库 MVP（零依赖关键词检索）
 *
 * 数据形状（db.json 顶层 kbs 数组）：
 *   { id, name, remark, ownerId, ownerName, visibility, createdAt, updatedAt,
 *     files: [{ id, name, mode, size, chunkCount, uploadedAt }],
 *     chunks: [{ id, fileId, type, text, q, a, key }] }
 *
 * 设计约定：
 *   - 分段（三种导入方式，file.mode / chunk.type 对应）：
 *       text 直接分段：按空行分段落 → 按 chunkSize 聚合，相邻段带 overlap；
 *       qa   QA 拆分：按空行分块，块内「问：/Q:」与「答：/A:」配对，每对一个分段（不做长度切分）；
 *       data 精准数据导入：CSV（首行表头），每行一条记录（字段：值 逐行渲染），
 *            首列为索引键 key；检索时查询与 key 精确命中给高额加权（精准命中优先于关键词）。
 *   - 检索：查询分词（拉丁词/数字整词 + 中文 bigram）→ 词频打分（含 IDF 折减）→ TopK；
 *     精准数据分段额外做 key 精确/包含匹配加权。
 *   - 权限：visibility 'all'（默认，全员可检索）/'private'（仅创建者与 owner/admin）；
 *     管理端（owner/admin）维护；使用端（对话注入）仅登录员工，访客不可用，防知识外泄。
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const configService = require('./configService');

// 知识库源文件落盘根目录（供「文件存储管理」统一展示 / 清理；与对话附件同目录，走 file_ 前缀）
const KB_UPLOAD_ROOT = process.env.XFYUN_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');

const MAX_KBS = 50;
const MAX_FILE_CHARS = 2 * 1024 * 1024; // 2MB 文本
const MAX_CHUNKS_PER_KB = 2000;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;
const TOP_K_DEFAULT = 5;
const TOP_K_MAX = 20;

function nowIso() {
  return new Date().toISOString();
}

function data() {
  const d = db.load();
  if (!Array.isArray(d.kbs)) d.kbs = [];
  return d;
}

function findKb(id) {
  return data().kbs.find((k) => k.id === id) || null;
}

/** 知识库元信息（不含 chunks 正文，列表/详情通用） */
function kbMeta(kb) {
  return {
    id: kb.id,
    presetKey: kb.presetKey || '',
    name: kb.name,
    remark: kb.remark || '',
    ownerId: kb.ownerId || '',
    ownerName: kb.ownerName || '',
    visibility: kb.visibility === 'private' ? 'private' : 'all',
    modelId: kb.modelId || '',
    memberCount: (kb.members || []).length,
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
    fileCount: (kb.files || []).length,
    chunkCount: (kb.chunks || []).length,
    chars: (kb.chunks || []).reduce((s, c) => s + (c.text ? c.text.length : 0), 0)
  };
}

function list() {
  return data().kbs.map(kbMeta);
}

function get(id) {
  const kb = findKb(id);
  if (!kb) return null;
  return { ...kbMeta(kb), files: kb.files || [], members: kb.members || [], cfg: kbCfg(kb) };
}

/** 每库检索/分段配置（配置页维护；导入与检索按此默认执行） */
function kbCfg(kb) {
  const c = kb && kb.cfg ? kb.cfg : {};
  return {
    chunkSize: Math.min(2000, Math.max(100, parseInt(c.chunkSize, 10) || DEFAULT_CHUNK_SIZE)),
    overlap: Math.min(999, Math.max(0, parseInt(c.overlap, 10) || DEFAULT_OVERLAP)),
    topK: Math.min(TOP_K_MAX, Math.max(1, parseInt(c.topK, 10) || TOP_K_DEFAULT))
  };
}

function create(body, actor) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, errors: ['知识库名称不能为空'] };
  if (name.length > 50) return { ok: false, errors: ['名称最长 50 字符'] };
  const d = data();
  if (d.kbs.length >= MAX_KBS) return { ok: false, errors: [`知识库数量已达上限（${MAX_KBS} 个），请先删除不用的知识库`] };
  if (d.kbs.some((k) => k.name === name)) return { ok: false, errors: ['已存在同名知识库'] };
  const kb = {
    id: db.getNextId('kb'),
    name,
    remark: typeof body.remark === 'string' ? body.remark.trim().slice(0, 200) : '',
    ownerId: actor ? actor.id : '',
    ownerName: actor ? (actor.displayName || actor.username) : '',
    visibility: body.visibility === 'private' ? 'private' : 'all',
    modelId: typeof body.modelId === 'string' ? body.modelId.trim().slice(0, 64) : '',
    members: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    files: [],
    chunks: []
  };
  d.kbs.push(kb);
  db.save();
  return { ok: true, data: kbMeta(kb) };
}

function remove(id) {
  const d = data();
  const idx = d.kbs.findIndex((k) => k.id === id);
  if (idx < 0) return { ok: false, notFound: true };
  const [removed] = d.kbs.splice(idx, 1);
  db.save();
  return { ok: true, data: { id: removed.id, name: removed.name } };
}

/**
 * 员工端属主校验：非管理员只能改/删「本人创建」的知识库。
 * owner/admin 不受限；普通员工仅能维护本人（ownerId === actor.id）创建的知识库，
 * 避免误删他人/官方预置库。
 * @returns {ok:boolean, kb?, forbidden?:boolean, notFound?:boolean}
 */
function ownedKb(id, actor) {
  const kb = findKb(id);
  if (!kb) return { ok: false, notFound: true };
  if (!actor) return { ok: false, forbidden: true };
  if (actor.role === 'owner' || actor.role === 'admin') return { ok: true, kb };
  if (kb.ownerId === actor.id) return { ok: true, kb };
  return { ok: false, forbidden: true };
}

/* ================= 成员级授权（私有库协作） =================
 * 成员列表：[{ userId, userName, canEdit, addedAt }]
 * 仅私有库需要成员授权（public/all 库全员可用，成员管理无意义但仍可维护）。
 * 创建者（owner）不可从成员列表移除，其编辑权限恒为 true（与参考图一致）。
 */

/** 授权成员：把某个员工加入知识库（返回成员列表） */
function addMember(kbId, member, canEdit = false) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  if (!member || !member.id) return { ok: false, errors: ['成员信息不完整'] };
  const userId = member.id;
  // 创建者本人无需加入（恒有权限）
  if (kb.ownerId === userId) return { ok: true, data: kb.members || [], skipped: true };
  kb.members = kb.members || [];
  if (!kb.members.some((m) => m.userId === userId)) {
    kb.members.push({
      userId,
      userName: member.displayName || member.username || userId,
      role: member.role || 'member',
      canEdit: canEdit === true,
      addedAt: nowIso()
    });
  }
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: kb.members };
}

/** 移除成员 */
function removeMember(kbId, userId) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  kb.members = (kb.members || []).filter((m) => m.userId !== userId);
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: kb.members };
}

/** 更新成员编辑权限 */
function updateMemberEdit(kbId, userId, canEdit) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const m = (kb.members || []).find((x) => x.userId === userId);
  if (!m) return { ok: false, notFound: true };
  m.canEdit = canEdit === true;
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: kb.members };
}

function update(id, body) {
  const kb = findKb(id);
  if (!kb) return { ok: false, notFound: true };
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return { ok: false, errors: ['名称不能为空'] };
    if (data().kbs.some((k) => k.id !== id && k.name === name)) return { ok: false, errors: ['已存在同名知识库'] };
    kb.name = name.slice(0, 50);
  }
  if (body.remark !== undefined) kb.remark = String(body.remark).trim().slice(0, 200);
  // 权限：all = 全员可检索；private = 仅创建者与授权成员
  if (body.visibility !== undefined) {
    kb.visibility = body.visibility === 'private' ? 'private' : 'all';
  }
  // 问答生成模型（绑定模型配置；空 = 跟随全局调度）
  if (body.modelId !== undefined) {
    kb.modelId = String(body.modelId || '').trim().slice(0, 64);
  }
  // 检索/分段配置
  if (body.cfg !== undefined && typeof body.cfg === 'object' && body.cfg) {
    kb.cfg = kbCfg({ cfg: body.cfg });
  }
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: kbMeta(kb) };
}

/** 权限判断：user 是否可「使用」（检索测试 / 对话注入）。管理员与 owner 恒可用 */
function canUse(kb, user) {
  if (!kb) return false;
  if (!user || !user.id) return false; // 使用端必须登录（访客不可用）
  if (user.role === 'owner' || user.role === 'admin') return true;
  if (kb.visibility === 'private') {
    // 私有库：创建者 + 授权成员可用
    if (kb.ownerId === user.id) return true;
    const members = kb.members || [];
    return members.some((m) => m.userId === user.id);
  }
  return true; // 'all'：登录员工全员可用
}

/** 使用端可见列表（登录员工；private 库仅创建者本人与管理员可见） */
function listForUser(user) {
  return data().kbs.filter((k) => canUse(k, user)).map(kbMeta);
}

/**
 * 文本分段：按空行切段落 → 聚合到 chunkSize（相邻段携带 overlap 尾部）→ 超长单段硬切。
 * @returns {string[]}
 */
function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP) {
  const size = Math.min(2000, Math.max(100, parseInt(chunkSize, 10) || DEFAULT_CHUNK_SIZE));
  const ov = Math.min(size - 1, Math.max(0, parseInt(overlap, 10) || 0));
  const paragraphs = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };

  for (const para of paragraphs) {
    // 超长单段：硬切（带 overlap）
    if (para.length > size) {
      flush();
      let i = 0;
      while (i < para.length) {
        out.push(para.slice(i, i + size));
        i += size - ov;
      }
      continue;
    }
    if (buf && (buf.length + para.length + 1) > size) {
      // 收尾时带上 buf 尾部 overlap，保证跨块语义连续
      const tail = ov > 0 ? buf.slice(-ov) : '';
      flush();
      buf = tail ? tail + '\n' + para : para;
      continue;
    }
    buf = buf ? buf + '\n' + para : para;
  }
  flush();
  return out;
}

/**
 * QA 拆分：按空行分块，块内「问：/Q:」→q、「答：/A:」→a 配对。
 * 无标记的块按「首行问题、其余答案」兜底；每对一个分段，不切长度（Q&A 天然成段）。
 * @returns {{q:string, a:string}[]}
 */
function parseQaPairs(text) {
  const blocks = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pairs = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const hasMarker = lines.some((l) => /^(?:问|Q|question)\s*[:：]/i.test(l) || /^(?:答|A|answer)\s*[:：]/i.test(l));
    if (!hasMarker) {
      // 无标记块：首行当问题、其余行当答案（常见于口语化 QA 语料）
      const q = lines[0] || '';
      const a = lines.slice(1).join('\n');
      if (q) pairs.push({ q, a: a || '（暂无答案）' });
      continue;
    }
    let q = '';
    let a = '';
    let inA = false;
    for (const line of lines) {
      let m;
      if ((m = /^(?:问|Q|question)\s*[:：]\s*(.*)$/i.exec(line))) {
        if (q && a) { pairs.push({ q, a }); q = ''; a = ''; }
        q = m[1].trim();
        inA = false;
      } else if ((m = /^(?:答|A|answer)\s*[:：]\s*(.*)$/i.exec(line))) {
        inA = true;
        a = a ? `${a}\n${m[1].trim()}` : m[1].trim();
      } else {
        // 未配对前出现的散行视为问题的补充；进入答案区后视为答案的一部分
        if (inA) a = a ? `${a}\n${line}` : line;
        else q = q ? `${q}\n${line}` : line;
      }
    }
    if (q || a) {
      if (!q) q = a.slice(0, 50); // 只有答案：截取前 50 字作问题占位，保证可检索
      if (!a) a = '（暂无答案）';
      pairs.push({ q, a });
    }
  }
  return pairs;
}

/** 单元格级 CSV 解析：支持引号包裹（"" 转义），容忍尾随逗号与空行 */
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 精准数据导入：CSV/制表符表格，首行为表头，每行一条记录。
 * 首列为索引键 key（检索时精确/包含命中加权）；行渲染为「字段：值」分段。
 * @returns {{headers:string[], rows:{{key:string, text:string}[]}}
 */
function parseDataTable(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };
  const delimiter = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  const headers = (delimiter === '\t' ? lines[0].split('\t') : parseCsvLine(lines[0])).map((h) => h.trim()).filter((h, i, arr) => h || i === 0);
  if (!headers.length) return { headers: [], rows: [] };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = delimiter === '\t' ? lines[i].split('\t') : parseCsvLine(lines[i]);
    // 行内所有单元格为空 → 跳过
    if (!cells.some((c) => c && c.trim())) continue;
    const key = (cells[0] || '').trim();
    const text = headers.map((h, idx) => {
      const v = (cells[idx] !== undefined ? cells[idx] : '').trim();
      return v ? `${h}：${v}` : '';
    }).filter(Boolean).join('\n');
    if (text) rows.push({ key, text });
  }
  return { headers, rows };
}

/** 知识库源文件落盘（best-effort）：写失败不阻断导入，storageUrl 留空则存储管理页按 name 反查不到 */
function persistKbSource(filename, text) {
  try {
    const ext = (filename.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || 'txt';
    const folder = new Date().toISOString().slice(0, 10);
    const dir = path.join(KB_UPLOAD_ROOT, folder);
    fs.mkdirSync(dir, { recursive: true });
    const diskName = `file_kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(dir, diskName), text, 'utf-8');
    return `/uploads/${folder}/${diskName}`;
  } catch (_) {
    return '';
  }
}

/** 文件导入：按 mode 解析为 chunks 并落库（text=直接分段 / qa=QA拆分 / data=精准数据） */
function addFile(kbId, filename, text, opts = {}) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const mode = ['qa', 'data'].includes(opts.mode) ? opts.mode : 'text';
  const body = typeof text === 'string' ? text : '';
  if (!body.trim()) return { ok: false, errors: ['文件内容为空'] };
  // 文件格式与大小校验（读后台「文件上传配置」的知识库文件限制）
  const ul = configService.getSettings().uploadLimits || {};
  const kbLimit = ul.kb || {};
  const allowExts = Array.isArray(kbLimit.exts) && kbLimit.exts.length ? kbLimit.exts : ['txt', 'md', 'markdown', 'log', 'csv', 'json'];
  const maxChars = Number.isFinite(Number(kbLimit.maxBytes)) && Number(kbLimit.maxBytes) > 0 ? Number(kbLimit.maxBytes) : MAX_FILE_CHARS;
  const ext = (String(filename || '').match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || 'txt';
  if (!allowExts.includes(ext)) {
    return { ok: false, errors: [`不支持的资料类型 .${ext}；当前允许：${allowExts.join(' / ')}`] };
  }
  if (body.length > maxChars) return { ok: false, errors: [`文件过大（${Math.round(body.length / 1024)}KB），单文件上限 ${Math.round(maxChars / 1024)}KB`] };

  let pieces = [];
  if (mode === 'qa') {
    const pairs = parseQaPairs(body);
    pieces = pairs.map((p) => ({ type: 'qa', q: p.q, a: p.a, text: `问：${p.q}\n答：${p.a}` }));
    if (!pieces.length) return { ok: false, errors: ['未能解析出任何问答对（需用空行分隔，块内以「问：/答：」标注）'] };
  } else if (mode === 'data') {
    const table = parseDataTable(body);
    pieces = table.rows.map((r) => ({ type: 'data', key: r.key, text: r.text }));
    if (!pieces.length) return { ok: false, errors: ['未能解析出任何数据行（需 CSV/制表符格式，首行为表头）'] };
    if (!table.headers.some((h) => h)) return { ok: false, errors: ['表头（首行）不能为空'] };
  } else {
    const cfg = kbCfg(kb);
    pieces = chunkText(body, opts.chunkSize ?? cfg.chunkSize, opts.overlap ?? cfg.overlap)
      .map((t) => ({ type: 'text', text: t }));
    if (!pieces.length) return { ok: false, errors: ['未能从文件中解析出任何段落'] };
  }

  if ((kb.chunks || []).length + pieces.length > MAX_CHUNKS_PER_KB) {
    return { ok: false, errors: [`超出知识库容量：单知识库最多 ${MAX_CHUNKS_PER_KB} 个分段（现有 ${(kb.chunks || []).length}，本次新增 ${pieces.length}）`] };
  }

  // 源文件落盘（供存储管理统一展示），失败不阻断
  const storageUrl = persistKbSource(String(filename || '未命名.txt'), body);

  const file = {
    id: db.getNextId('kbf'),
    name: String(filename || '未命名.txt').slice(0, 120),
    mode,
    size: body.length,
    chunkCount: pieces.length,
    storageUrl,
    uploadedAt: nowIso()
  };
  kb.files = kb.files || [];
  kb.chunks = kb.chunks || [];
  for (const piece of pieces) {
    const chunk = { id: db.getNextId('kbc'), fileId: file.id, type: piece.type, text: piece.text };
    if (piece.type === 'qa') { chunk.q = piece.q; chunk.a = piece.a; }
    if (piece.type === 'data') { chunk.key = piece.key; }
    kb.chunks.push(chunk);
  }
  kb.files.push(file);
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: { file, mode, chunkCount: pieces.length, totalChunks: kb.chunks.length } };
}

function removeFile(kbId, fileId) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const fIdx = (kb.files || []).findIndex((f) => f.id === fileId);
  if (fIdx < 0) return { ok: false, notFound: true };
  const [file] = kb.files.splice(fIdx, 1);
  kb.chunks = (kb.chunks || []).filter((c) => c.fileId !== fileId);
  // 同步删除落盘的源文件（best-effort，失败不阻断业务）
  if (file.storageUrl && typeof file.storageUrl === 'string') {
    try {
      const rel = file.storageUrl.replace(/^\/uploads\//, '');
      const abs = path.resolve(KB_UPLOAD_ROOT, rel);
      if (abs.startsWith(path.resolve(KB_UPLOAD_ROOT) + path.sep)) fs.unlinkSync(abs);
    } catch (_) { /* 忽略 */ }
  }
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: { file: file.name, remainingChunks: kb.chunks.length } };
}

function removeChunk(kbId, chunkId) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const idx = (kb.chunks || []).findIndex((c) => c.id === chunkId);
  if (idx < 0) return { ok: false, notFound: true };
  const [chunk] = kb.chunks.splice(idx, 1);
  // 对应文件计完了就更新文件的 chunkCount；文件所有分段删光则移除文件记录
  const file = (kb.files || []).find((f) => f.id === chunk.fileId);
  if (file) {
    file.chunkCount = kb.chunks.filter((c) => c.fileId === chunk.fileId).length;
    if (file.chunkCount === 0) kb.files = kb.files.filter((f) => f.id !== chunk.fileId);
  }
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: { remainingChunks: kb.chunks.length } };
}

/** 段落编辑：修正分段正文（QA 段同步刷新 q/a；数据段同步刷新 key） */
function updateChunk(kbId, chunkId, text) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const chunk = (kb.chunks || []).find((c) => c.id === chunkId);
  if (!chunk) return { ok: false, notFound: true };
  const body = String(text || '').trim();
  if (!body) return { ok: false, errors: ['分段内容不能为空'] };
  if (body.length > 4000) return { ok: false, errors: ['分段内容最长 4000 字符'] };
  chunk.text = body;
  if (chunk.type === 'qa') {
    // 尽量从正文中还原 问/答 结构；无法识别时整段作为答案
    const m = /^问[：:]\s*([\s\S]*?)\n答[：:]\s*([\s\S]*)$/.exec(body);
    chunk.q = m ? m[1].trim() : body.slice(0, 50);
    chunk.a = m ? m[2].trim() : body;
  } else if (chunk.type === 'data') {
    const km = /^[^\n：:]*[：:]\s*(.+)$/m.exec(body);
    chunk.key = km ? km[1].trim() : '';
  }
  kb.updatedAt = nowIso();
  db.save();
  return { ok: true, data: { id: chunk.id, fileId: chunk.fileId, type: chunk.type, text: chunk.text, length: chunk.text.length } };
}

/** 段落管理列表：分页 + 按文件过滤 + 关键词过滤（关键词命中高亮由前端处理） */
function listChunks(kbId, opts = {}) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  let chunks = kb.chunks || [];
  const fileId = opts.fileId ? String(opts.fileId) : '';
  if (fileId) chunks = chunks.filter((c) => String(c.fileId) === fileId);
  const kw = String(opts.q || '').trim().toLowerCase();
  if (kw) chunks = chunks.filter((c) => (c.text || '').toLowerCase().includes(kw));
  const total = chunks.length;
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 20));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const items = chunks.slice(offset, offset + limit).map((c) => ({
    id: c.id,
    fileId: c.fileId,
    type: c.type || 'text',
    q: c.q || '',
    a: c.a || '',
    key: c.key || '',
    text: c.text,
    length: (c.text || '').length
  }));
  return { ok: true, kbId: kb.id, total, limit, offset, items };
}

/**
 * 查询分词：拉丁/数字整词 + 中文 bigram（中文无空格分隔，二元组是零依赖的实用折中）
 * @returns {string[]}
 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const tokens = [];
  for (const m of s.matchAll(/[a-z0-9_]+/g)) tokens.push(m[0]);
  for (const m of s.matchAll(/[\u4e00-\u9fff]+/g)) {
    const seg = m[0];
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  }
  return tokens;
}

/**
 * 关键词检索：查询分词 → 逐 chunk 词频打分（IDF 折减常见词）→ TopK。
 * 每次检索现算词频（不落库分词结果，避免 db.json 膨胀）；
 * 2000 chunk × 500 字符规模下单次检索在百毫秒级，满足 MVP。
 */
function search(kbId, query, topK, minScore) {
  const kb = findKb(kbId);
  if (!kb) return { ok: false, notFound: true };
  const q = String(query || '').trim();
  if (!q) return { ok: false, errors: ['检索内容不能为空'] };
  const cfg = kbCfg(kb);
  const k = Math.min(TOP_K_MAX, Math.max(1, parseInt(topK, 10) || cfg.topK));
  // 最低相关度：应用级"引用质量门槛"——得分低于阈值的分段直接过滤（0 = 不过滤）
  const min = Number(minScore) > 0 ? Number(minScore) : 0;

  const chunks = kb.chunks || [];
  if (!chunks.length) return { ok: true, kbName: kb.name, chunks: [], totalChunks: 0 };

  const qTokens = tokenize(q);
  if (!qTokens.length) return { ok: true, kbName: kb.name, chunks: [], totalChunks: chunks.length };

  // 查询词频（去重计数：重复词只算一次权重，避免长查询刷分）
  const qFreq = new Map();
  for (const t of qTokens) qFreq.set(t, (qFreq.get(t) || 0) + 1);

  // 逐 chunk 分词 + 词频；同时统计包含每个查询词的 chunk 数（df）
  const N = chunks.length;
  const chunkFreqs = new Array(N);
  const df = new Map();
  for (let i = 0; i < N; i++) {
    const freq = new Map();
    for (const t of tokenize(chunks[i].text)) freq.set(t, (freq.get(t) || 0) + 1);
    chunkFreqs[i] = freq;
    for (const t of qFreq.keys()) {
      if (freq.has(t)) df.set(t, (df.get(t) || 0) + 1);
    }
  }

  // 打分：Σ tf × idf（IDF = log(1 + N/df)，罕见词权重高）
  // 精准数据（type=data，带索引键 key）：查询与 key 完全一致 → 高额加权；互相包含 → 部分加权。
  // 加权值取「正常打分理论峰值之上」（2000 段规模下 tf·idf 一般 < 100），保证精准命中恒排在关键词命中之前。
  const EXACT_BONUS = 1000;
  const CONTAIN_BONUS = 100;
  const scored = [];
  for (let i = 0; i < N; i++) {
    const freq = chunkFreqs[i];
    let score = 0;
    for (const [t] of qFreq) {
      const tf = freq.get(t);
      if (!tf) continue;
      const idf = Math.log(1 + N / (df.get(t) || 0));
      score += tf * idf;
    }
    let exact = false;
    const key = chunks[i].key || '';
    if (key && chunks[i].type === 'data') {
      if (q === key) { score += EXACT_BONUS; exact = true; }
      else if (q.length >= 2 && (q.includes(key) || key.includes(q))) score += CONTAIN_BONUS;
    }
    if (score > 0) scored.push({ i, score, exact });
  }
  scored.sort((a, b) => b.score - a.score);

  // 应用配置的最低相关度过滤（kbMinScore）：门槛过低的结果不注入对话
  const qualified = min > 0 ? scored.filter((s) => s.score >= min) : scored;

  return {
    ok: true,
    kbName: kb.name,
    totalChunks: N,
    chunks: qualified.slice(0, k).map(({ i, score, exact }) => ({
      id: chunks[i].id,
      fileId: chunks[i].fileId,
      type: chunks[i].type || 'text',
      exact: !!exact,
      score: Math.round(score * 100) / 100,
      text: chunks[i].text
    }))
  };
}

function stats() {
  const kbs = data().kbs;
  return {
    kbCount: kbs.length,
    fileCount: kbs.reduce((s, k) => s + (k.files || []).length, 0),
    chunkCount: kbs.reduce((s, k) => s + (k.chunks || []).length, 0)
  };
}

/* ================= 预置知识库（演示 / 功能测试用） =================
 * presetKey 幂等：只补缺失的 key，不覆盖已自定义的库。
 */

const KB_PRESETS = [
  {
    presetKey: 'preset.product',
    name: '产品手册',
    remark: '预置 · 产品功能与版本说明',
    files: [{
      name: '产品手册.txt',
      text: [
        '产品概述：同聪星火是面向团队的大模型对话工作台，基于讯飞星辰 MaaS 与 OpenAI 兼容接口，提供多模型接入、知识库检索增强、画布工作流与智能体能力，支持私有化部署，数据 100% 存储在本地。',
        '核心功能：① 多模型对话：多会话管理、流式输出、深度思考；② 多模态：支持粘贴/拖拽图片进行视觉理解，可上传文档与音视频附件；③ 知识库：文本自动分段 + 关键词检索，对话时注入相关资料；④ 智能体：预设角色（数字员工、提效工具）一键启用；⑤ 工作流：画布编排节点链路（用户问题 → 知识库搜索 → AI 对话）。',
        '版本与价格：免费版支持 10 人以内团队与 2 个 API 配置；专业版（¥299/月）支持 50 人、不限配置、知识库与工作流；企业版提供私有化部署、专属模型接入与 SLA 保障，价格面议。',
        'API 接入：支持讯飞 MaaS（/v2 端点）与 OpenAI 兼容接口（/v1、/v4 等），兼容 OpenAI、DeepSeek、Kimi、通义千问、智谱 GLM、Gemini 等主流平台。API Key 在后台「API 配置」中维护，支持 AES-256-GCM 加密存储。',
        '默认参数：单次请求超时 120 秒；网络错误与 5xx 自动重试 1 次；多配置调度冷却 30 秒；知识库检索单库最多 2000 个分段，单文件 ≤2MB 文本；附件上传单个 ≤20MB。'
      ].join('\n\n')
    }]
  },
  {
    presetKey: 'preset.faq',
    name: '常见问题 FAQ',
    remark: '预置 · 售前售后高频问题',
    files: [{
      name: 'FAQ.txt',
      text: [
        '问：退货政策是什么？\n答：自签收之日起 7 天内可无理由退货，需保持商品完好且包装齐全；定制类商品不支持无理由退货。退货运费由责任方承担。',
        '问：发货时效是多久？\n答：工作日下午 3 点前下单当天发货，3 点后次日上午发货；节假日顺延。偏远地区（新疆/西藏）物流时间额外增加 2-3 天。',
        '问：支持开发票吗？\n答：支持电子普通发票与增值税专用发票。下单时在备注填写发票抬头与税号，电子发票在发货后 24 小时内发送至预留邮箱。',
        '问：会员有什么优惠？\n答：年度会员享受全店 95 折优惠与专属客服通道；新客首单立减 30 元；大额采购（满 5 万元）可联系商务获取阶梯报价。',
        '问：忘记账号密码怎么办？\n答：登录页点击「忘记密码」，通过绑定的邮箱自助重置；未绑定邮箱请联系管理员在后台重置为临时密码。',
        '问：我的数据安全吗？\n答：全部数据本地加密存储，传输走 HTTPS；密码使用 scrypt 哈希，管理员也无法查看明文；支持随时导出与彻底删除。'
      ].join('\n\n')
    }]
  },
  {
    presetKey: 'preset.policy',
    name: '公司制度',
    remark: '预置 · 内部行政制度示例',
    files: [{
      name: '公司制度.txt',
      text: [
        '考勤制度：工作时间为 9:00-18:00（午休 12:00-13:30），弹性打卡 30 分钟；每月补卡不超过 3 次；连续迟到 3 次按旷工半日处理。',
        '报销制度：每月 25 日前在 OA 提交上月电子发票，金额 500 元以上需附审批单；差旅报销需提供行程单；报销款于次月 10 日前发放至工资卡。',
        '差旅制度：市内交通实报实销；出差住宿标准为一线城市 400 元/晚、其他城市 300 元/晚；高铁二等座/经济舱为默认标准，超标需提前审批。',
        '休假制度：入职满一年享 5 天年假，每两年递增 1 天（上限 10 天）；年假需提前 3 个工作日在 OA 申请；病假需提供医院证明；婚假产假按国家与地方规定执行。',
        '信息安全制度：工作电脑必须设置锁屏密码；客户数据严禁上传至外部网盘或个人设备；离职当日回收全部账号权限，数据移交由部门负责人确认。'
      ].join('\n\n')
    }]
  }
];

/** 幂等导入预置知识库：只补缺失的 presetKey；返回新增库数与分段数 */
function seedPresets(actor) {
  const d = data();
  const existing = new Set(d.kbs.map((k) => k.presetKey).filter(Boolean));
  const now = nowIso();
  let added = 0;
  let chunkCount = 0;
  for (const p of KB_PRESETS) {
    if (existing.has(p.presetKey)) continue;
    const kb = {
      id: db.getNextId('kb'),
      presetKey: p.presetKey,
      name: p.name,
      remark: p.remark,
      ownerId: actor ? actor.id : '',
      ownerName: actor ? (actor.displayName || actor.username) : '预置模板',
      createdAt: now,
      updatedAt: now,
      files: [],
      chunks: []
    };
    for (const f of p.files) {
      const pieces = chunkText(f.text);
      const file = {
        id: db.getNextId('kbf'),
        name: f.name,
        mode: 'text',
        size: f.text.length,
        chunkCount: pieces.length,
        storageUrl: persistKbSource(f.name, f.text),
        uploadedAt: now
      };
      kb.files.push(file);
      for (const piece of pieces) {
        kb.chunks.push({ id: db.getNextId('kbc'), fileId: file.id, type: 'text', text: piece });
      }
    }
    d.kbs.push(kb);
    added++;
    chunkCount += kb.chunks.length;
  }
  if (added) {
    // 标记已导入过预置数据：用户删光预置库后重启服务不会再次自动复活
    const d2 = db.load();
    d2.settings = d2.settings || {};
    d2.settings.presetsSeeded = true;
    db.save();
  }
  return { ok: true, added, chunks: chunkCount, total: KB_PRESETS.length };
}

module.exports = {
  list,
  listForUser,
  get,
  canUse,
  create,
  update,
  remove,
  ownedKb,
  addMember,
  removeMember,
  updateMemberEdit,
  addFile,
  removeFile,
  removeChunk,
  updateChunk,
  listChunks,
  search,
  stats,
  chunkText,
  parseQaPairs,
  parseDataTable,
  tokenize,
  kbCfg,
  seedPresets,
  MAX_KBS,
  MAX_FILE_CHARS,
  MAX_CHUNKS_PER_KB,
  DEFAULT_CHUNK_SIZE,
  TOP_K_DEFAULT
};
