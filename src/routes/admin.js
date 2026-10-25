'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const conversationService = require('../conversationService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 后台管理 API（/api/admin）——除 /login、/logout、/setup-status 外均由
 * server.js 挂载的 requireAdminApi 中间件统一守护，此处不再重复校验。
 */

// 登录页状态：是否已设置密码、是否仍是初始密码（无需登录，供登录页提示）
router.get('/setup-status', (req, res) => {
  res.json({ ok: true, data: adminAuth.setupStatus() });
});

// 当前会话校验（前端用于判断登录态）
router.get('/me', (req, res) => {
  res.json({ ok: true, data: { authenticated: true } });
});

// 登录：{ password } → 种 HttpOnly cookie
router.post('/login', asyncHandler(async (req, res) => {
  const password = (req.body || {}).password;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ ok: false, error: '请输入密码' });
  }
  const r = adminAuth.login(req, res, password);
  if (!r.ok) {
    return res.status(401).json({ ok: false, error: r.error });
  }
  res.json({ ok: true });
}));

// 退出登录
router.post('/logout', (req, res) => {
  adminAuth.clearCookie(res);
  res.json({ ok: true });
});

// 修改密码：{ currentPassword, newPassword }，成功后需重新登录
router.put('/password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const r = adminAuth.changePassword(currentPassword, newPassword);
  if (!r.ok) {
    return res.status(400).json({ ok: false, error: r.error });
  }
  res.json({ ok: true, message: '密码已修改，请重新登录' });
}));

/* ================= 记忆管理 · 会话记录 ================= */

// 列表 + 关键字搜索 + 统计：GET /api/admin/memory?keyword=&limit=&offset=
router.get('/memory', (req, res) => {
  const data = conversationService.searchMemory({
    keyword: req.query.keyword,
    limit: req.query.limit,
    offset: req.query.offset
  });
  res.json({ ok: true, data });
});

// 单条会话详情（含全部消息与备注）
router.get('/memory/:id', (req, res) => {
  const conv = conversationService.getFull(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  res.json({ ok: true, data: conv });
});

// 保存管理员备注：PUT /api/admin/memory/:id/note { note }
router.put('/memory/:id/note', (req, res) => {
  const conv = conversationService.updateNote(req.params.id, (req.body || {}).note);
  if (!conv) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  res.json({ ok: true, data: { id: conv.id, note: conv.note, noteUpdatedAt: conv.noteUpdatedAt } });
});

// 导出会话记录：GET /api/admin/memory/:id/export?format=json|md
router.get('/memory/:id/export', (req, res) => {
  const conv = conversationService.getFull(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  const format = req.query.format === 'md' ? 'md' : 'json';
  const safeTitle = (conv.title || 'conversation').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`会话_${safeTitle}_${conv.id}.json`)}"`);
    return res.send(JSON.stringify(conv, null, 2));
  }

  // Markdown 导出
  const lines = [
    `# ${conv.title || '新对话'}`,
    '',
    `- 会话 ID：${conv.id}`,
    `- 创建时间：${conv.createdAt || '-'}`,
    `- 更新时间：${conv.updatedAt || '-'}`,
    `- 使用配置：${conv.configId || '-'}`,
    `- 消息条数：${(conv.messages || []).length}`,
    `- 管理员备注：${conv.note || '（无）'}`,
    '',
    '## 对话记录',
    ''
  ];
  for (const m of conv.messages || []) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? '我' : 'AI';
    lines.push(`**[${who}]** ${m.time || ''}`);
    lines.push('');
    const text = conversationService.contentToText(m.content);
    if (text) lines.push(text);
    // 多模态消息：附上图片引用（相对路径，仅在应用内可访问）
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p && p.type === 'image_url' && typeof p.image_url?.url === 'string') {
          lines.push(`![图片](${p.image_url.url})`);
        }
      }
    }
    lines.push('');
  }
  res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`会话_${safeTitle}_${conv.id}.md`)}"`);
  res.send(lines.join('\n'));
});

// 删除会话记录
router.delete('/memory/:id', (req, res) => {
  const ok = conversationService.remove(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  res.json({ ok: true });
});

module.exports = router;
