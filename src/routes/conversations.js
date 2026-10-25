'use strict';

const express = require('express');
const conversationService = require('../conversationService');
const shareService = require('../shareService');
const router = express.Router();

/**
 * 会话 API（/api/conversations）
 *
 * 数据可见范围（P2，按角色隔离）：
 *   - owner/admin：全部会话；
 *   - member/viewer：仅 ownerId 为自己的会话；
 *   - 访客（未登录）：仅访客桶（ownerId 为空的会话）。
 * 分享 / 评价端点同样先过范围校验，再调 shareService（内部用 getFullAny）。
 */

// 会话列表（元信息，不含消息）
router.get('/', (req, res) => {
  res.json({ ok: true, data: conversationService.listMeta(req.user || null) });
});

// 新建会话（登录员工自动打归属标）
router.post('/', (req, res) => {
  const conv = conversationService.create((req.body || {}).title, req.user ? req.user.id : null);
  res.status(201).json({ ok: true, data: conv });
});

// 单个会话（含消息）
router.get('/:id', (req, res) => {
  const conv = conversationService.getFull(req.params.id, req.user || null);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 重命名
router.put('/:id', (req, res) => {
  const conv = conversationService.updateTitle(req.params.id, (req.body || {}).title, req.user || null);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 删除会话
router.delete('/:id', (req, res) => {
  const ok = conversationService.remove(req.params.id, req.user || null);
  if (!ok) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true });
});

// 追加消息（登录员工首次发言将访客会话收编为自己的）
router.post('/:id/messages', (req, res) => {
  const body = req.body || {};
  const conv = conversationService.appendMessages(req.params.id, body.messages, body.configId || null, req.user ? req.user.id : null);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 清空会话消息
router.delete('/:id/messages', (req, res) => {
  const conv = conversationService.clearMessages(req.params.id, req.user || null);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

/* ================= 消息评价（点赞 / 差评） =================
 * PUT /:id/messages/:mid/feedback { value: 'up' | 'down' | null }
 * 互斥选择、再点同一按钮取消（value=null）由前端控制后传入。
 */
router.put('/:id/messages/:mid/feedback', (req, res) => {
  const raw = (req.body || {}).value;
  const value = raw === 'up' || raw === 'down' ? raw : null;
  const m = conversationService.setFeedback(req.params.id, req.params.mid, value, req.user || null);
  if (!m) return res.status(404).json({ ok: false, error: '消息不存在' });
  res.json({ ok: true, data: { id: m.id, feedback: m.feedback } });
});

/* ================= 对话分享（快照 + token） ================= */

// 创建分享：POST /:id/share { expiresInDays: 7|30|90|0（0=永久，默认30） }
router.post('/:id/share', (req, res) => {
  // 先过角色范围：范围外的会话对当前用户视同不存在
  if (!conversationService.getFull(req.params.id, req.user || null)) {
    return res.status(404).json({ ok: false, error: '会话不存在' });
  }
  const rec = shareService.create(req.params.id, {
    expiresInDays: (req.body || {}).expiresInDays,
    createdBy: (req.user && req.user.username) || 'guest'
  });
  if (!rec) return res.status(404).json({ ok: false, error: '会话不存在' });
  if (rec.error === 'empty') return res.status(400).json({ ok: false, error: '当前对话没有可分享的消息' });
  res.status(201).json({
    ok: true,
    data: {
      token: rec.token,
      url: `/s/${rec.token}`,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt || null,
      messageCount: rec.snapshot.messageCount
    }
  });
});

// 分享列表：GET /:id/shares（不含快照正文）
router.get('/:id/shares', (req, res) => {
  if (!conversationService.getFull(req.params.id, req.user || null)) {
    return res.status(404).json({ ok: false, error: '会话不存在' });
  }
  res.json({ ok: true, data: shareService.listByConv(req.params.id) });
});

// 撤销分享：DELETE /:id/shares/:token
router.delete('/:id/shares/:token', (req, res) => {
  if (!conversationService.getFull(req.params.id, req.user || null)) {
    return res.status(404).json({ ok: false, error: '会话不存在' });
  }
  const ok = shareService.revoke(req.params.id, req.params.token);
  if (!ok) return res.status(404).json({ ok: false, error: '分享不存在' });
  res.json({ ok: true });
});

module.exports = router;
