'use strict';

const express = require('express');
const ttsService = require('../ttsService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');

/**
 * 语音合成（TTS）：
 *   /api/admin/tts           —— owner/admin 读写配置（挂载时已过 requireRole）
 *   /api/tts/synthesize      —— 登录员工合成语音（朗读按钮）
 *   /api/tts/config          —— 登录员工只读配置（音色列表，供前端下拉选择）
 */

// ==================== 管理端配置（owner/admin） ====================
const adminRouter = express.Router();

// 读取 TTS 配置（apiKey 脱敏，不返回明文）
adminRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: ttsService.getConfig() });
}));

// 保存 TTS 配置
adminRouter.put('/', asyncHandler(async (req, res) => {
  const r = ttsService.updateConfig(req.body || {});
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.CONFIG_SETTINGS, 'tts', r.data.enabled ? '语音合成已启用' : '语音合成配置已保存', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// ==================== 员工端（登录即可） ====================
const router = express.Router();

// 只读配置（音色列表 + 是否启用；不含 apiKey 明文）
router.get('/config', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: ttsService.getConfig() });
}));

// 合成语音：返回音频二进制（前端 <audio> 直接播放）
router.post('/synthesize', asyncHandler(async (req, res) => {
  const { text, voice } = req.body || {};
  const r = await ttsService.synthesize(text, voice);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  res.set('Content-Type', r.contentType);
  res.set('Content-Length', r.buffer.length);
  res.set('Cache-Control', 'no-store');
  res.send(r.buffer);
}));

module.exports = { adminRouter, router };
