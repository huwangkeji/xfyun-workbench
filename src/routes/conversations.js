'use strict';

const express = require('express');
const conversationService = require('../conversationService');
const router = express.Router();

// 会话列表（元信息，不含消息）
router.get('/', (req, res) => {
  res.json({ ok: true, data: conversationService.listMeta() });
});

// 新建会话
router.post('/', (req, res) => {
  const conv = conversationService.create((req.body || {}).title);
  res.status(201).json({ ok: true, data: conv });
});

// 单个会话（含消息）
router.get('/:id', (req, res) => {
  const conv = conversationService.getFull(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 重命名
router.put('/:id', (req, res) => {
  const conv = conversationService.updateTitle(req.params.id, (req.body || {}).title);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 删除会话
router.delete('/:id', (req, res) => {
  const ok = conversationService.remove(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true });
});

// 追加消息
router.post('/:id/messages', (req, res) => {
  const body = req.body || {};
  const conv = conversationService.appendMessages(req.params.id, body.messages, body.configId || null);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

// 清空会话消息
router.delete('/:id/messages', (req, res) => {
  const conv = conversationService.clearMessages(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: conv });
});

module.exports = router;