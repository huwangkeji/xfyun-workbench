'use strict';

/**
 * 文件存储管理（V3.8）
 *
 * 统一管理 public/uploads/ 下的三类文件，并与业务数据交叉关联：
 *   1. 知识库文件   —— 上传导入时落盘的原始文件（kb.files 记录的 storageUrl）
 *   2. 对话附件     —— 前端对话上传的文档 / 音视频 / 压缩包（消息 content 里的 file_url）
 *   3. 对话图片     —— 粘贴 / 拖拽上传的视觉图片（消息 content 里的 image_url）
 *   4. 员工头像     —— 个人中心上传（users[].avatarUrl，位于 uploads/avatars/）
 *
 * 设计约定：
 *   - 不做独立元数据表，而是「扫描磁盘文件 + 反查引用」，单一事实来源是磁盘；
 *     这样即使旧数据没有 storageUrl 字段也能被正确归类（靠文件前缀 img_/file_/avatar_）。
 *   - 删除带引用检查：被知识库 / 对话 / 头像引用的文件默认拒绝，需 force=true 才能强删。
 *   - 所有路径解析都做 path.basename / 白名单校验，杜绝路径穿越。
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOAD_ROOT = process.env.XFYUN_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');

/* ================= 磁盘扫描 ================= */

/** 递归列出 uploads 下所有文件（跳过目录），返回 { rel, abs, size, mtimeMs, ext, prefix }[] */
function scanDisk() {
  const out = [];
  if (!fs.existsSync(UPLOAD_ROOT)) return out;
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, relPath); continue; }
      let stat;
      try { stat = fs.statSync(abs); } catch (_) { continue; }
      out.push({
        rel: relPath.replace(/\\/g, '/'),
        abs,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ext: (path.extname(e.name) || '').slice(1).toLowerCase(),
        prefix: (e.name.match(/^(img_|file_|avatar_)/) || [])[1] || ''
      });
    }
  };
  walk(UPLOAD_ROOT, '');
  return out;
}

/** 磁盘文件对应可访问的 URL */
function diskUrl(rel) {
  return `/uploads/${rel}`;
}

/* ================= 业务引用反查 ================= */

/** 收集全部引用：url -> { kinds:Set, refs:[{type,label}] } */
function collectRefs() {
  const d = db.load();
  const map = new Map(); // url -> { kinds:Set, refs:[] }
  const note = (url, type, label) => {
    if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    let rec = map.get(url);
    if (!rec) { rec = { kinds: new Set(), refs: [] }; map.set(url, rec); }
    rec.kinds.add(type);
    if (rec.refs.length < 20) rec.refs.push({ type, label });
  };

  // 1) 知识库文件（kb.files[].storageUrl / 兼容旧数据按 name 无 URL 则跳过）
  for (const kb of d.kbs || []) {
    for (const f of kb.files || []) {
      note(f.storageUrl, 'kb', `知识库「${kb.name}」· ${f.name || '未命名'}`);
    }
  }

  // 2) 对话消息里的图片 / 附件
  const convScan = (msgs, convTitle) => {
    for (const m of msgs || []) {
      const content = m.content;
      if (typeof content === 'string') continue;
      if (!Array.isArray(content)) continue;
      for (const p of content) {
        if (!p || typeof p !== 'object') continue;
        if (p.type === 'file_url' && p.file_url && p.file_url.url) {
          note(p.file_url.url, 'attachment', `会话「${convTitle}」附件 ${p.file_url.name || ''}`);
        } else if (p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') {
          note(p.image_url.url, 'image', `会话「${convTitle}」图片`);
        }
      }
    }
  };
  for (const c of d.conversations || []) {
    const title = (c.title || '').slice(0, 30) || c.id;
    convScan(c.messages, title);
  }

  // 3) 员工头像
  for (const u of d.users || []) {
    if (u.avatarUrl) note(u.avatarUrl, 'avatar', `用户「${u.displayName || u.username}」头像`);
  }

  return map;
}

/* ================= 分类 ================= */

/** 根据前缀 / 引用 / 目录，给一个磁盘文件打类别 */
function classify(rel, refs) {
  const prefix = (path.basename(rel).match(/^(img_|file_|avatar_)/) || [])[1] || '';
  const url = diskUrl(rel);
  const kinds = refs && refs.get(url) ? Array.from(refs.get(url).kinds) : [];
  if (prefix === 'avatar_' || rel.startsWith('avatars/')) return 'avatar';
  if (kinds.includes('kb')) return 'kb';
  if (prefix === 'img_') return 'image';
  if (kinds.includes('image')) return 'image';
  if (prefix === 'file_') return 'attachment';
  if (kinds.includes('attachment')) return 'attachment';
  return 'orphan'; // 无引用、无法靠前缀归类的文件
}

const KIND_LABELS = {
  kb: '知识库文件',
  attachment: '对话附件',
  image: '对话图片',
  avatar: '员工头像',
  orphan: '未引用文件'
};

/* ================= 分组（网盘目录）与业务实体 =================
 * 分组维度 = 业务归属（网盘式分组查看）：
 *   kb        知识库    —— 每个知识库是一个"目录"，下挂其源文件
 *   conversation 对话记录 —— 每个会话是一个"目录"，下挂其附件/图片
 *   agent     智能体    —— 智能体本身（emoji，无落盘图片），展示实体列表
 *   avatar    员工头像
 *   orphan    未引用文件
 */

const GROUPS = [
  { key: 'all', label: '全部文件', icon: '🗂️', desc: '服务器上的全部存储文件' },
  { key: 'kb', label: '知识库', icon: '📚', desc: '各知识库导入的源文件' },
  { key: 'conversation', label: '对话记录', icon: '💬', desc: '各对话上传的附件与图片' },
  { key: 'agent', label: '智能体', icon: '🤖', desc: '智能体应用及其关联信息' },
  { key: 'avatar', label: '员工头像', icon: '👤', desc: '员工个人头像' },
  { key: 'orphan', label: '未引用文件', icon: '❓', desc: '无任何业务引用的散落文件' }
];

/**
 * 构建「业务实体 → 文件」索引 + 实体清单。
 * @returns {{ kbEntities:[], convEntities:[], agentEntities:[] }}
 */
function buildEntities() {
  const d = db.load();
  const files = scanDisk();
  const byUrl = new Map(files.map((f) => [diskUrl(f.rel), f]));

  // 知识库实体：每个知识库 + 其源文件
  const kbEntities = (d.kbs || []).map((kb) => {
    const kbFiles = (kb.files || []).map((f) => {
      const disk = f.storageUrl ? byUrl.get(f.storageUrl) : null;
      return {
        fileId: f.id,
        name: f.name || '未命名',
        mode: f.mode || 'text',
        chunkCount: f.chunkCount || 0,
        size: disk ? disk.size : (f.size || 0),
        storageUrl: f.storageUrl || '',
        rel: disk ? disk.rel : '',
        onDisk: !!disk,
        mtimeMs: disk ? disk.mtimeMs : 0
      };
    });
    const bytes = kbFiles.reduce((s, f) => s + (f.size || 0), 0);
    return {
      id: kb.id,
      name: kb.name,
      remark: kb.remark || '',
      visibility: kb.visibility || 'all',
      ownerName: kb.ownerName || '',
      chunkCount: (kb.chunks || []).length,
      fileCount: kbFiles.length,
      bytes,
      files: kbFiles
    };
  });

  // 会话实体：每个会话 + 其附件/图片
  const convEntities = [];
  for (const c of d.conversations || []) {
    const cFiles = [];
    const seen = new Set();
    for (const m of c.messages || []) {
      const content = m.content;
      if (!Array.isArray(content)) continue;
      for (const p of content) {
        if (!p || typeof p !== 'object') continue;
        let url = '';
        let kind = 'attachment';
        let name = '';
        if (p.type === 'file_url' && p.file_url && p.file_url.url) { url = p.file_url.url; name = p.file_url.name || ''; kind = 'attachment'; }
        else if (p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') { url = p.image_url.url; kind = 'image'; name = ''; }
        if (!url) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        const disk = byUrl.get(url);
        cFiles.push({
          url,
          rel: disk ? disk.rel : '',
          name: name || (disk ? path.basename(disk.rel) : path.basename(url)),
          kind,
          size: disk ? disk.size : 0,
          onDisk: !!disk,
          mtimeMs: disk ? disk.mtimeMs : 0
        });
      }
    }
    if (!cFiles.length && (c.messages || []).length === 0) {
      // 无消息且无文件的空会话仍展示（便于管理）
    }
    convEntities.push({
      id: c.id,
      title: (c.title || '新对话').slice(0, 50),
      ownerId: c.ownerId || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: (c.messages || []).length,
      fileCount: cFiles.length,
      bytes: cFiles.reduce((s, f) => s + (f.size || 0), 0),
      files: cFiles
    });
  }
  // 会话按更新时间倒序
  convEntities.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  // 智能体实体（emoji 头像，无落盘文件；仅实体清单）
  const agentEntities = (d.agents || []).map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji || '🤖',
    desc: a.desc || '',
    visibility: a.visibility || 'public',
    ownerName: a.ownerName || '',
    createdAt: a.createdAt,
    files: []
  }));

  // 头像实体（每个用户）
  const avatarEntities = (d.users || []).filter((u) => u.avatarUrl).map((u) => {
    const disk = byUrl.get(u.avatarUrl);
    return {
      id: u.id,
      name: u.displayName || u.username,
      username: u.username,
      role: u.role,
      avatarUrl: u.avatarUrl,
      rel: disk ? disk.rel : '',
      size: disk ? disk.size : 0,
      onDisk: !!disk,
      mtimeMs: disk ? disk.mtimeMs : 0
    };
  });

  return { kbEntities, convEntities, agentEntities, avatarEntities, byUrl, files };
}

/**
 * 分组统计 + 各分组计数（网盘左侧目录角标）
 * @returns {{groups:[{key,label,icon,count}], stats}}
 */
function groups() {
  const { kbEntities, convEntities, agentEntities, avatarEntities, files } = buildEntities();
  const refs = collectRefs();

  // 孤儿计数：磁盘文件里无引用且无法归类
  let orphanCount = 0;
  for (const f of files) {
    if (classify(f.rel, refs) === 'orphan') orphanCount++;
  }
  // 未挂到任何实体的对话附件/图片（直接属于"对话记录"分组，但统计按文件类型）
  const totalFiles = files.length;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  const counts = {
    all: totalFiles,
    kb: kbEntities.reduce((s, e) => s + e.fileCount, 0),
    conversation: convEntities.reduce((s, e) => s + e.fileCount, 0),
    agent: agentEntities.length,
    avatar: avatarEntities.length,
    orphan: orphanCount
  };

  const g = GROUPS.map((g) => ({ ...g, count: counts[g.key] || 0 }));
  return {
    ok: true,
    groups: g,
    stats: { totalFiles, totalBytes, orphanCount }
  };
}

/* ================= 对外接口 ================= */

/**
 * 统计 + 列表（分页 / 按类别 / 关键词筛选）
 * @returns {{ok, stats, total, limit, offset, items}}
 */
function list(opts = {}) {
  const files = scanDisk();
  const refs = collectRefs();

  // 反查里引用到、但磁盘已不存在的 URL（说明已被外部删除，仅作提示）
  const orphanRefs = [];
  const diskUrls = new Set(files.map((f) => diskUrl(f.rel)));
  for (const [url, rec] of refs) {
    if (!diskUrls.has(url)) {
      orphanRefs.push({ url, label: rec.refs[0] ? rec.refs[0].label : '' });
    }
  }

  let items = files.map((f) => {
    const url = diskUrl(f.rel);
    const rec = refs.get(url);
    const kind = classify(f.rel, refs);
    const refsArr = rec ? rec.refs.slice(0, 5).map((r) => r.label) : [];
    return {
      rel: f.rel,
      url,
      name: path.basename(f.rel),
      size: f.size,
      ext: f.ext,
      mtimeMs: f.mtimeMs,
      kind,
      kindLabel: KIND_LABELS[kind] || kind,
      referenced: !!rec,
      refs: refsArr
    };
  });

  // 统计（分字节）
  const bytes = files.reduce((s, f) => s + f.size, 0);
  const byKind = {};
  for (const it of items) {
    const k = it.kind;
    byKind[k] = byKind[k] || { count: 0, bytes: 0 };
    byKind[k].count += 1;
    byKind[k].bytes += it.size;
  }
  const stats = {
    totalFiles: files.length,
    totalBytes: bytes,
    byKind,
    orphanRefCount: orphanRefs.length
  };

  // 筛选
  const kindFilter = typeof opts.kind === 'string' && opts.kind ? opts.kind : '';
  if (kindFilter) items = items.filter((it) => it.kind === kindFilter);
  const kw = String(opts.q || '').trim().toLowerCase();
  if (kw) items = items.filter((it) => it.name.toLowerCase().includes(kw) || it.url.toLowerCase().includes(kw));

  // 排序：时间倒序
  items = items.slice().sort((a, b) => b.mtimeMs - a.mtimeMs);

  const total = items.length;
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 50));
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

  return { ok: true, stats, orphanRefs, total, limit, offset, items: items.slice(offset, offset + limit) };
}

/**
 * 某分组下的实体列表（网盘式：点分组 → 展示该业务的实体目录）
 * @param {string} group key: kb / conversation / agent / avatar / orphan / all
 */
function entities(group) {
  const { kbEntities, convEntities, agentEntities, avatarEntities, files } = buildEntities();
  const refs = collectRefs();

  if (group === 'kb') {
    return { group, groupLabel: '知识库', kind: 'entity', entities: kbEntities.map((e) => ({ ...e, type: 'kb' })) };
  }
  if (group === 'conversation') {
    return { group, groupLabel: '对话记录', kind: 'entity', entities: convEntities.map((e) => ({ ...e, type: 'conversation' })) };
  }
  if (group === 'agent') {
    return { group, groupLabel: '智能体', kind: 'entity', entities: agentEntities.map((e) => ({ ...e, type: 'agent' })) };
  }
  if (group === 'avatar') {
    return { group, groupLabel: '员工头像', kind: 'entity', entities: avatarEntities.map((e) => ({ ...e, type: 'avatar' })) };
  }
  if (group === 'orphan') {
    const items = files
      .filter((f) => classify(f.rel, refs) === 'orphan')
      .map((f) => ({
        rel: f.rel,
        url: diskUrl(f.rel),
        name: path.basename(f.rel),
        size: f.size,
        ext: f.ext,
        mtimeMs: f.mtimeMs,
        kind: 'orphan',
        kindLabel: KIND_LABELS.orphan,
        referenced: false,
        refs: []
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { group, groupLabel: '未引用文件', kind: 'file', items, total: items.length };
  }
  // all：混合平铺所有文件
  const items = files.map((f) => {
    const url = diskUrl(f.rel);
    const rec = refs.get(url);
    const kind = classify(f.rel, refs);
    return {
      rel: f.rel,
      url,
      name: path.basename(f.rel),
      size: f.size,
      ext: f.ext,
      mtimeMs: f.mtimeMs,
      kind,
      kindLabel: KIND_LABELS[kind] || kind,
      referenced: !!rec,
      refs: rec ? rec.refs.slice(0, 5).map((r) => r.label) : []
    };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { group: 'all', groupLabel: '全部文件', kind: 'file', items, total: items.length };
}

/** 绝对路径安全解析（防穿越） */
function resolveAbs(rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const relNorm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (relNorm.includes('..') || relNorm.includes('\0')) return null;
  const abs = path.resolve(UPLOAD_ROOT, relNorm);
  if (!abs.startsWith(path.resolve(UPLOAD_ROOT) + path.sep) && abs !== path.resolve(UPLOAD_ROOT)) return null;
  return abs;
}

/**
 * 删除单个文件（默认拒绝删除仍被引用的文件）
 * @returns {{ok, data}|{ok:false, error, referenced?}}
 */
function removeFile(rel, opts = {}) {
  const abs = resolveAbs(rel);
  if (!abs) return { ok: false, error: '文件路径非法' };
  if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在（可能已被删除）' };

  const refs = collectRefs();
  const url = diskUrl(rel.replace(/\\/g, '/'));
  const rec = refs.get(url);
  if (rec && !opts.force) {
    const labels = rec.refs.slice(0, 3).map((r) => r.label).join('、');
    return { ok: false, referenced: true, error: `该文件仍被引用（${labels}），删除可能破坏知识库或对话，请先解除引用或确认强制删除` };
  }

  try {
    fs.unlinkSync(abs);
  } catch (e) {
    return { ok: false, error: `删除失败（${e.message}）` };
  }
  return { ok: true, data: { rel, url, deleted: true } };
}

/** 清理孤儿文件：删除磁盘上无任何引用且非预置类的文件（img_/file_ 前缀才可能成孤儿，avatar/kb 不在此列） */
function cleanOrphans() {
  const refs = collectRefs();
  const files = scanDisk();
  let freedBytes = 0;
  let removed = 0;
  for (const f of files) {
    const kind = classify(f.rel, refs);
    if (kind !== 'orphan') continue;
    try { freedBytes += f.size; fs.unlinkSync(f.abs); removed++; } catch (_) { /* 忽略单文件失败 */ }
  }
  return { ok: true, removed, freedBytes };
}

module.exports = {
  UPLOAD_ROOT,
  KIND_LABELS,
  GROUPS,
  scanDisk,
  list,
  groups,
  entities,
  removeFile,
  cleanOrphans,
  resolveAbs,
  diskUrl
};
