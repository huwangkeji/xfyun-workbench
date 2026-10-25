'use strict';

const db = require('./db');

/**
 * 消息内容 → 纯文本（兼容多模态数组 content）
 * 字符串原样返回；数组取所有 text 部分拼接（图片部分忽略，仅用于检索/预览）
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

/** owner/admin 可见全部；member/viewer 仅自己的；访客（未登录）仅访客桶（ownerId 为空） */
function canSeeAll(viewer) {
  return !!(viewer && ['owner', 'admin'].includes(viewer.role));
}

function visibleConvs(viewer) {
  const all = db.load().conversations;
  if (canSeeAll(viewer)) return all;
  if (viewer) return all.filter((c) => c.ownerId === viewer.id);
  return all.filter((c) => !c.ownerId);
}

/** 旧消息懒迁移补 id（评价/分享依赖消息 id；一次性，缺什么补什么） */
function migrateIds(conv) {
  if (!conv || !Array.isArray(conv.messages)) return conv;
  let changed = false;
  for (const m of conv.messages) {
    if (m && !m.id) {
      m.id = db.getNextId('msg');
      changed = true;
    }
  }
  if (changed) db.save();
  return conv;
}

function listMeta(viewer = null) {
  return visibleConvs(viewer)
    .map((c) => ({
      id: c.id,
      title: c.title || '新对话',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      configured: !!c.configId,
      configId: c.configId || null,
      count: (c.messages && c.messages.length) || 0,
      ownerId: c.ownerId || null,
      // 记忆管理：管理员备注（仅后台可见，用于记录运营备忘）
      note: c.note || '',
      noteUpdatedAt: c.noteUpdatedAt || null
    }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/**
 * 取会话（按角色范围）
 * 范围外返回 null（不泄露存在性）；顺手完成旧消息 id 懒迁移。
 */
function getFull(id, viewer = null) {
  const conv = db.load().conversations.find((c) => c.id === id) || null;
  if (!conv) return null;
  if (canSeeAll(viewer)) return migrateIds(conv);
  if (viewer) return conv.ownerId === viewer.id ? migrateIds(conv) : null;
  return conv.ownerId ? null : migrateIds(conv); // 访客只能拿访客桶
}

/** 内部使用（无范围约束）：分享快照、管理员备注、消息追加等可信路径 */
function getFullAny(id) {
  const conv = db.load().conversations.find((c) => c.id === id) || null;
  return conv ? migrateIds(conv) : null;
}

function create(title, ownerId = null) {
  const data = db.load();
  const now = new Date().toISOString();
  const conv = {
    id: db.getNextId('conv'),
    title: (typeof title === 'string' && title.trim()) ? title.trim() : '新对话',
    createdAt: now,
    updatedAt: now,
    ownerId: ownerId || null,
    configId: null,
    messages: []
  };
  data.conversations.push(conv);
  db.save();
  return conv;
}

function updateTitle(id, title, viewer = null) {
  const conv = getFull(id, viewer);
  if (!conv) return null;
  if (typeof title === 'string' && title.trim()) conv.title = title.trim();
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

function remove(id, viewer = null) {
  const conv = getFull(id, viewer);
  if (!conv) return false;
  const data = db.load();
  const idx = data.conversations.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  data.conversations.splice(idx, 1);
  db.save();
  return true;
}

/**
 * 追加消息，返回更新后的会话
 * @param {string} id 会话 id
 * @param {Array<{role:string, content:string|Array}>} msgs 要追加的消息（含时间）
 *   content 支持多模态数组（粘贴图片时）：[{type:'text',text},{type:'image_url',image_url:{url:'/uploads/...'}}]
 *   数组里只存 /uploads 相对 URL（不存 base64），避免 db.json 体积膨胀
 * @param {string|null} configId 当前使用的配置
 * @param {string|null} ownerId 归属员工（登录员工的首条消息将访客会话收编为自己的）
 */
function appendMessages(id, msgs, configId, ownerId = null) {
  const conv = getFullAny(id);
  if (!conv) return null;
  if (!Array.isArray(conv.messages)) conv.messages = [];
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      if (!m || typeof m.role !== 'string') continue;
      const isText = typeof m.content === 'string' && m.content !== '';
      const isParts = Array.isArray(m.content) && m.content.length > 0;
      if (!isText && !isParts) continue;
      // 持久化前剥离 data URI（前端上传后消息体里只保留 /uploads URL）
      const content = Array.isArray(m.content)
        ? m.content
            .filter((p) => p && !(p.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:')))
            .map((p) => p)
        : m.content;
      if (Array.isArray(content) && content.length === 0) continue;
      conv.messages.push({ id: db.getNextId('msg'), role: m.role, content, time: m.time || new Date().toISOString(), feedback: null });
    }
  }
  if (configId) conv.configId = configId;
  // 归属打标：员工首次在访客会话里发言 → 收编为该员工的会话
  if (ownerId && !conv.ownerId) conv.ownerId = ownerId;
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

function clearMessages(id, viewer = null) {
  const conv = getFull(id, viewer);
  if (!conv) return null;
  conv.messages = [];
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

/**
 * 更新会话的管理员备注（记忆管理用，仅后台可见）
 * @param {string} id 会话 id
 * @param {string} note 备注内容（限 2000 字）
 */
function updateNote(id, note) {
  const conv = getFullAny(id);
  if (!conv) return null;
  conv.note = typeof note === 'string' ? note.slice(0, 2000) : '';
  conv.noteUpdatedAt = new Date().toISOString();
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

/**
 * 消息评价（点赞 / 差评）：{ value: 'up' | 'down' | null }
 * 互斥更新、再点同一按钮取消（null）由前端控制后传入；
 * 不更新 conv.updatedAt（避免评价动作把会话顶到侧栏最上）。
 * @returns 更新后的消息；不存在返回 null
 */
function setFeedback(id, mid, value, viewer = null) {
  const conv = getFull(id, viewer);
  if (!conv) return null;
  const msg = (conv.messages || []).find((m) => m.id === mid);
  if (!msg) return null;
  const v = value === 'up' || value === 'down' ? value : null;
  msg.feedback = v ? { value: v, at: new Date().toISOString() } : null;
  db.save();
  return msg;
}

/**
 * 记忆管理：分页检索会话记录（支持关键字匹配标题/备注/消息内容），并给出汇总统计
 * @param {{keyword?, ownerId?, limit?, offset?}} query
 *        ownerId：按成员筛选（管理员在记忆管理页按人过滤）
 * @param {object|null} viewer 当前用户；非 owner/admin 时强制只看自己的
 */
function searchMemory(query = {}, viewer = null) {
  const kw = String(query.keyword || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

  let convs = visibleConvs(viewer).slice();
  // 管理员按成员筛选
  if (canSeeAll(viewer) && query.ownerId) {
    convs = convs.filter((c) => (c.ownerId || '') === query.ownerId);
  }
  if (kw) {
    convs = convs.filter((c) =>
      (c.title || '').toLowerCase().includes(kw)
      || (c.note || '').toLowerCase().includes(kw)
      || (c.messages || []).some((m) => contentToText(m.content).toLowerCase().includes(kw))
    );
  }
  convs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  // 统计与列表同范围（按当前可见集 + 筛选条件）
  const scoped = visibleConvs(viewer);
  const stats = {
    totalConversations: convs.length,
    totalMessages: convs.reduce((s, c) => s + ((c.messages && c.messages.length) || 0), 0),
    totalUserMessages: convs.reduce((s, c) => s + ((c.messages || []).filter((m) => m.role === 'user').length), 0),
    totalAssistantMessages: convs.reduce((s, c) => s + ((c.messages || []).filter((m) => m.role === 'assistant').length), 0),
    notedConversations: convs.filter((c) => c.note).length,
    firstCreatedAt: convs.length ? convs.reduce((min, c) => (!min || c.createdAt < min ? c.createdAt : min), '') : null,
    lastUpdatedAt: convs.length ? convs.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), '') : null,
    scope: canSeeAll(viewer) ? 'all' : 'self',
    unscopedTotal: scoped.length
  };

  const items = convs.slice(offset, offset + limit).map((c) => {
    const msgs = c.messages || [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    return {
      id: c.id,
      title: c.title || '新对话',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      configId: c.configId || null,
      ownerId: c.ownerId || null,
      count: msgs.length,
      note: c.note || '',
      noteUpdatedAt: c.noteUpdatedAt || null,
      preview: last ? `${last.role === 'user' ? '我' : 'AI'}：${contentToText(last.content).slice(0, 60)}` : ''
    };
  });

  return { total: convs.length, limit, offset, items, stats };
}

module.exports = {
  listMeta, getFull, getFullAny, create, updateTitle, remove,
  appendMessages, clearMessages, updateNote, setFeedback, searchMemory, contentToText
};
