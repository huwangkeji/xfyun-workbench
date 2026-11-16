'use strict';

/**
 * 应用（智能体）对外分享服务 —— 对齐脑图「对外分享」分支
 *
 * 与会话快照分享（shareService）不同：应用分享 = 一个"可对话的外链"。
 * 访客打开 /a/:token 直接与应用对话（角色设定/模型/知识库由应用配置决定）。
 *
 * 分享记录（db.json 顶层 appShares 数组）：
 *   { id, token, agentId, agentName, qpm, expiresAt, passwordHash, createdBy, createdAt, hits }
 *
 * 能力项：
 *   - 创建链接：token = crypto.randomBytes(16).base64url，链接本身即凭证；
 *   - QPM：每分钟请求数限流（进程内滑动窗口计数，单实例语义，重启清零）；
 *   - 过期时间：读时校验 expiresAt（null=永久）；
 *   - 身份验证：可选访问密码（sha256 存储比对，访客每次请求携带明文，无服务端会话）。
 */

const crypto = require('crypto');
const db = require('./db');

const MAX_SHARES = 500;
const QPM_MAX = 600;         // 单链接每分钟请求数上限
const HISTORY_MAX = 12;      // 单次对话最多携带的历史条数
const MSG_CHAR_MAX = 4000;  // 单条消息字符上限

/** 进程内 QPM 滑动窗口：token → 时间戳数组（ms） */
const rateBuckets = new Map();

function nowIso() {
  return new Date().toISOString();
}

function data() {
  const d = db.load();
  if (!Array.isArray(d.appShares)) d.appShares = [];
  return d;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function findShare(token) {
  return data().appShares.find((s) => s.token === token) || null;
}

/** 列表视图（不含密码哈希） */
function meta(s) {
  return {
    id: s.id,
    token: s.token,
    agentId: s.agentId,
    agentName: s.agentName,
    qpm: s.qpm || 0,
    expiresAt: s.expiresAt || null,
    hasPassword: !!s.passwordHash,
    createdBy: s.createdBy || '',
    createdAt: s.createdAt,
    hits: s.hits || 0
  };
}

function listByAgent(agentId) {
  return data().appShares
    .filter((s) => s.agentId === agentId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map(meta);
}

/**
 * 创建分享
 * @param {object} agent 已通过可见性校验的智能体记录
 * @param {{qpm?:number, expiresInDays?:number, password?:string}} opts
 */
function create(agent, opts = {}, actor) {
  const d = data();
  if (d.appShares.length >= MAX_SHARES) return { ok: false, errors: [`分享链接总数已达上限（${MAX_SHARES} 个）`] };
  // 仅公共应用可对外分享（私有应用对公网暴露等于权限旁路）
  if (agent.visibility === 'private') return { ok: false, errors: ['私有应用不能对外分享，请先在应用设置中改为公共'] };

  const qpm = Number(opts.qpm) > 0 ? Math.min(QPM_MAX, Math.floor(Number(opts.qpm))) : 0; // 0=不限流
  const days = Number(opts.expiresInDays);
  const expiresAt = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86400000).toISOString()
    : null;
  const password = typeof opts.password === 'string' ? opts.password.trim() : '';
  if (password && password.length > 64) return { ok: false, errors: ['访问密码最长 64 字符'] };

  const rec = {
    id: db.getNextId('ash'),
    token: crypto.randomBytes(16).toString('base64url'),
    agentId: agent.id,
    agentName: agent.name,
    qpm,
    expiresAt,
    passwordHash: password ? sha256(password) : '',
    createdBy: actor ? (actor.displayName || actor.username) : '',
    createdAt: nowIso(),
    hits: 0
  };
  d.appShares.push(rec);
  db.save();
  return { ok: true, data: meta(rec) };
}

/** 撤销分享（按 agentId + token，防止跨应用误删） */
function revoke(agentId, token) {
  const d = data();
  const idx = d.appShares.findIndex((s) => s.agentId === agentId && s.token === token);
  if (idx < 0) return false;
  d.appShares.splice(idx, 1);
  db.save();
  rateBuckets.delete(token);
  return true;
}

/** 删除应用时级联清理其全部分享 */
function revokeByAgent(agentId) {
  const d = data();
  const before = d.appShares.length;
  d.appShares = d.appShares.filter((s) => s.agentId !== agentId);
  const removed = before - d.appShares.length;
  if (removed) db.save();
  return removed;
}

/**
 * 按 token 解析分享（读时校验过期）
 * @returns {expired:'gone'} | 记录 | null
 */
function resolve(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(t)) return null;
  const rec = findShare(t);
  if (!rec) return null;
  if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) return { gone: true };
  return rec;
}

/** QPM 滑动窗口检查：通过则记账并返回 null，超限返回重试秒数 */
function checkRate(rec) {
  if (!rec.qpm) return null; // 0 = 不限流
  const now = Date.now();
  let bucket = rateBuckets.get(rec.token);
  if (!bucket) {
    bucket = [];
    rateBuckets.set(rec.token, bucket);
  }
  // 清理窗口外记录
  while (bucket.length && now - bucket[0] >= 60000) bucket.shift();
  if (bucket.length >= rec.qpm) {
    return Math.ceil((60000 - (now - bucket[0])) / 1000);
  }
  bucket.push(now);
  return null;
}

function hit(rec) {
  const d = data();
  const cur = d.appShares.find((s) => s.token === rec.token);
  if (cur) {
    cur.hits = (cur.hits || 0) + 1;
    db.save();
  }
}

/** 访问密码校验（未设置密码的分享恒通过） */
function verifyPassword(rec, provided) {
  if (!rec.passwordHash) return true;
  const p = typeof provided === 'string' ? provided : '';
  if (!p) return false;
  return sha256(p) === rec.passwordHash;
}

/** 对话载荷规整：截取最近 N 条、限长（防外链被打爆式滥用） */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return { error: 'messages 必须是非空数组' };
  for (const m of messages) {
    if (!m || typeof m.role !== 'string' || !m.content) return { error: '每条消息必须包含 role 和 content' };
    if (typeof m.content === 'string' && m.content.length > MSG_CHAR_MAX) return { error: `单条消息最长 ${MSG_CHAR_MAX} 字符` };
  }
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-HISTORY_MAX);
  if (!recent.some((m) => m.role === 'user')) return { error: 'messages 缺少用户消息' };
  return { messages: recent };
}

module.exports = { create, revoke, revokeByAgent, listByAgent, resolve, checkRate, hit, verifyPassword, sanitizeMessages, meta, QPM_MAX, HISTORY_MAX };
