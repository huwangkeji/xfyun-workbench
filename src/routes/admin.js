'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const auditService = require('../auditService');
const conversationService = require('../conversationService');
const logService = require('../logService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 后台管理 API（/api/admin）——除 /logout 外均由 server.js 挂载的
 * requireTeamUser 中间件统一守护，此处不再重复校验。
 * 员工登录/退出/改密已统一至 /api/auth（P0 账号体系）；
 * 成员管理/审计日志独立为 /api/admin/users、/api/admin/audit-logs（P1）。
 */

// 当前会话信息（前端用于判断登录态 / 展示身份）
router.get('/me', (req, res) => {
  res.json({ ok: true, data: { authenticated: true, user: req.user } });
});

// 退出登录（同时清理员工会话与兼容期内的旧后台会话）
router.post('/logout', (req, res) => {
  adminAuth.clearTeamCookie(res);
  adminAuth.clearCookie(res);
  res.json({ ok: true });
});

/* ================= 数据概览（P2 指标卡） ================= */
// GET /api/admin/overview?days=1 —— 今日请求数/成功率/token/平均耗时/活跃成员/失败数
router.get('/overview', adminAuth.requireRole('owner', 'admin'), (req, res) => {
  res.json({ ok: true, data: logService.overview(req.user, { days: req.query.days }) });
});

/* ================= 记忆管理 · 会话记录（仅 owner/admin） ================= */
router.use('/memory', adminAuth.requireRole('owner', 'admin'));

/* ================= 记忆管理 · 会话记录 ================= */

// 列表 + 关键字搜索 + 成员筛选 + 统计：GET /api/admin/memory?keyword=&ownerId=&limit=&offset=
router.get('/memory', (req, res) => {
  const data = conversationService.searchMemory({
    keyword: req.query.keyword,
    ownerId: req.query.ownerId,
    limit: req.query.limit,
    offset: req.query.offset
  }, req.user);
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
  auditService.log(req.user, auditService.ACTIONS.MEMORY_NOTE, `conversation:${conv.id}`, (conv.title || '').slice(0, 60), auditService.ipOf(req));
  res.json({ ok: true, data: { id: conv.id, note: conv.note, noteUpdatedAt: conv.noteUpdatedAt } });
});

// 导出会话记录：GET /api/admin/memory/:id/export?format=json|md
router.get('/memory/:id/export', (req, res) => {
  const conv = conversationService.getFull(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  auditService.log(req.user, auditService.ACTIONS.MEMORY_EXPORT, `conversation:${conv.id}`, `${req.query.format === 'md' ? 'Markdown' : 'JSON'} · ${(conv.title || '').slice(0, 40)}`, auditService.ipOf(req));
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
  const conv = conversationService.getFull(req.params.id);
  const ok = conversationService.remove(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '会话记录不存在' });
  auditService.log(req.user, auditService.ACTIONS.MEMORY_DELETE, `conversation:${req.params.id}`, conv ? (conv.title || '').slice(0, 60) : '', auditService.ipOf(req));
  res.json({ ok: true });
});

module.exports = router;
