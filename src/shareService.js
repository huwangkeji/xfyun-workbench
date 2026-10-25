'use strict';

/**
 * 对话分享服务（src/shareService.js）
 *
 * 设计要点：
 *   - 分享 = 不可变快照：创建时把消息拷贝进 shares[].snapshot，
 *     源会话后续增删改不影响已发出的链接（"分享出去"的语义）；
 *   - token = crypto.randomBytes(16).base64url（22 位，不可猜测），链接本身即能力凭证；
 *   - 过期：读时校验 expiresAt（null=永久），默认 30 天，可 7/30/90/永久；
 *   - 图片内联：消息里的 /uploads 相对 URL 在读文件后转为 data URI（总量 ≤2MB），
 *     使分享页在公开访问（无工作台 cookie）时也能显示图片；超限则保留原 URL（可接受降级）；
 *   - 目录穿越防护：仅用 path.basename 拼 uploads 路径；
 *   - 存储：db.json 顶层 shares 集合（db.js 已加 DEFAULT_DB.shares）。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const conversationService = require('./conversationService');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 快照内联 base64 图片总量上限（约对应 1.4MB 原始字节）
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** 该会话的活跃分享列表（不含快照正文，避免列表响应膨胀） */
function listByConv(convId) {
  return db.load().shares
    .filter((s) => s.convId === convId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((s) => ({
      token: s.token,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt || null,
      messageCount: (s.snapshot && s.snapshot.messageCount) || 0
    }));
}

/**
 * 按 token 取分享（读时校验过期）
 * @returns 记录对象；{ expired:true } 表示已过期；null 表示不存在
 */
function getByToken(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(t)) return null;
  const rec = db.load().shares.find((s) => s.token === t);
  if (!rec) return null;
  if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) return { expired: true };
  return rec;
}

/** 把消息里的 /uploads 图片转为 data URI（限量内联，失败/超限保留原 URL） */
function snapshotMessages(msgs) {
  let budget = MAX_INLINE_BYTES;
  const out = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.map((p) => {
        if (p && p.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('/uploads/')) {
          const file = path.join(UPLOAD_DIR, path.basename(p.image_url.url)); // basename 防目录穿越
          try {
            const buf = fs.readFileSync(file);
            const cost = Math.ceil(buf.length * 4 / 3);
            if (cost <= budget) {
              budget -= cost;
              const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] || 'image/png';
              return { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } };
            }
          } catch (_) { /* 文件不存在/读取失败 → 保留原 URL */ }
        }
        return p;
      });
    }
    out.push({ role: m.role, content, time: m.time || null });
  }
  return out;
}

/**
 * 创建分享（快照）
 * @param {string} convId 会话 id
 * @param {{expiresInDays?: number|string, createdBy?: string}} opts expiresInDays：7/30/90 或 0/never=永久（默认 30）
 * @returns 分享记录；{ error:'empty' } 表示无消息可分享；null 表示会话不存在
 */
function create(convId, opts = {}) {
  const conv = conversationService.getFullAny(convId); // 内部可信路径：跳过角色范围（调用方已校验）
  if (!conv) return null;
  const msgs = (conv.messages || []).filter((m) =>
    m.role !== 'system'
    && (typeof m.content === 'string' ? m.content.trim() !== '' : Array.isArray(m.content) && m.content.length > 0));
  if (!msgs.length) return { error: 'empty' };

  const days = Number(opts.expiresInDays);
  const expiresAt = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86400000).toISOString()
    : null;
  const now = new Date().toISOString();

  const rec = {
    id: db.getNextId('shr'),
    token: crypto.randomBytes(16).toString('base64url'),
    convId,
    title: conv.title || '新对话',
    createdAt: now,
    expiresAt,
    createdBy: opts.createdBy || 'guest',
    snapshot: {
      title: conv.title || '新对话',
      sharedAt: now,
      messageCount: msgs.length,
      messages: snapshotMessages(msgs)
    }
  };
  const data = db.load();
  if (!Array.isArray(data.shares)) data.shares = [];
  data.shares.push(rec);
  db.save();
  return rec;
}

/** 撤销分享（按 convId + token 删除，返回是否成功） */
function revoke(convId, token) {
  const data = db.load();
  const idx = (data.shares || []).findIndex((s) => s.convId === convId && s.token === token);
  if (idx < 0) return false;
  data.shares.splice(idx, 1);
  db.save();
  return true;
}

module.exports = { listByConv, getByToken, create, revoke };
