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

function listMeta() {
  return db.load().conversations
    .map((c) => ({
      id: c.id,
      title: c.title || '新对话',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      configured: !!c.configId,
      configId: c.configId || null,
      count: (c.messages && c.messages.length) || 0,
      // 记忆管理：管理员备注（仅后台可见，用于记录运营备忘）
      note: c.note || '',
      noteUpdatedAt: c.noteUpdatedAt || null
    }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function getFull(id) {
  return db.load().conversations.find((c) => c.id === id) || null;
}

function create(title) {
  const data = db.load();
  const now = new Date().toISOString();
  const conv = {
    id: db.getNextId('conv'),
    title: (typeof title === 'string' && title.trim()) ? title.trim() : '新对话',
    createdAt: now,
    updatedAt: now,
    configId: null,
    messages: []
  };
  data.conversations.push(conv);
  db.save();
  return conv;
}

function updateTitle(id, title) {
  const conv = getFull(id);
  if (!conv) return null;
  if (typeof title === 'string' && title.trim()) conv.title = title.trim();
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

function remove(id) {
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
 */
function appendMessages(id, msgs, configId) {
  const conv = getFull(id);
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
      conv.messages.push({ role: m.role, content, time: m.time || new Date().toISOString() });
    }
  }
  if (configId) conv.configId = configId;
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

function clearMessages(id) {
  const conv = getFull(id);
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
  const conv = getFull(id);
  if (!conv) return null;
  conv.note = typeof note === 'string' ? note.slice(0, 2000) : '';
  conv.noteUpdatedAt = new Date().toISOString();
  conv.updatedAt = new Date().toISOString();
  db.save();
  return conv;
}

/**
 * 记忆管理：分页检索会话记录（支持关键字匹配标题/备注/消息内容），并给出汇总统计
 * @param {{keyword?:string, limit?:number, offset?:number}} query
 */
function searchMemory(query = {}) {
  const kw = String(query.keyword || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

  let convs = db.load().conversations.slice();
  if (kw) {
    convs = convs.filter((c) =>
      (c.title || '').toLowerCase().includes(kw)
      || (c.note || '').toLowerCase().includes(kw)
      || (c.messages || []).some((m) => contentToText(m.content).toLowerCase().includes(kw))
    );
  }
  convs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const all = db.load().conversations;
  const stats = {
    totalConversations: all.length,
    totalMessages: all.reduce((s, c) => s + ((c.messages && c.messages.length) || 0), 0),
    totalUserMessages: all.reduce((s, c) => s + ((c.messages || []).filter((m) => m.role === 'user').length), 0),
    totalAssistantMessages: all.reduce((s, c) => s + ((c.messages || []).filter((m) => m.role === 'assistant').length), 0),
    notedConversations: all.filter((c) => c.note).length,
    firstCreatedAt: all.length ? all.reduce((min, c) => (!min || c.createdAt < min ? c.createdAt : min), '') : null,
    lastUpdatedAt: all.length ? all.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), '') : null
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
      count: msgs.length,
      note: c.note || '',
      noteUpdatedAt: c.noteUpdatedAt || null,
      preview: last ? `${last.role === 'user' ? '我' : 'AI'}：${contentToText(last.content).slice(0, 60)}` : ''
    };
  });

  return { total: convs.length, limit, offset, items, stats };
}

module.exports = { listMeta, getFull, create, updateTitle, remove, appendMessages, clearMessages, updateNote, searchMemory, contentToText };