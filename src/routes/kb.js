'use strict';

const express = require('express');
const kbService = require('../kbService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 知识库管理（/api/admin/kb，owner/admin 专用；挂载时已过 requireTeamUser）。
 * 使用端（工作台对话注入）走 GET /api/kb（仅登录员工，只读元信息）。
 */

// 列表（元信息，不含分段正文）
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: kbService.list() });
}));

// 新建
router.post('/', asyncHandler(async (req, res) => {
  const r = kbService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.KB_CREATE, `kb:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 详情（含文件列表）
router.get('/:id', asyncHandler(async (req, res) => {
  const kb = kbService.get(req.params.id);
  if (!kb) return res.status(404).json({ ok: false, error: '知识库不存在' });
  res.json({ ok: true, data: kb });
}));

// 段落管理列表（分页 + 按文件过滤 + 关键词过滤）
// GET /:id/chunks?limit=20&offset=0&fileId=&q=
router.get('/:id/chunks', asyncHandler(async (req, res) => {
  const r = kbService.listChunks(req.params.id, {
    limit: req.query.limit,
    offset: req.query.offset,
    fileId: req.query.fileId,
    q: req.query.q
  });
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r });
}));

// 编辑分段正文
router.put('/:id/chunks/:chunkId', asyncHandler(async (req, res) => {
  const r = kbService.updateChunk(req.params.id, req.params.chunkId, (req.body || {}).text);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r.data });
}));

// 改名 / 备注
router.put('/:id', asyncHandler(async (req, res) => {
  const r = kbService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r.data });
}));

// 删除知识库（连同全部分段）
router.delete('/:id', asyncHandler(async (req, res) => {
  const r = kbService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '知识库不存在' });
  auditService.log(req.user, auditService.ACTIONS.KB_DELETE, `kb:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 导入文件（三种方式：mode = text 直接分段 / qa QA拆分 / data 精准数据导入）
router.post('/:id/files', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = kbService.addFile(req.params.id, body.name, body.text, {
    chunkSize: body.chunkSize,
    overlap: body.overlap,
    mode: body.mode
  });
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  const modeLabel = { text: '直接分段', qa: 'QA拆分', data: '精准数据' }[r.data.mode] || r.data.mode;
  auditService.log(req.user, auditService.ACTIONS.KB_IMPORT, `kb:${r.data.file.name}`, `${modeLabel} +${r.data.chunkCount} 段`, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 删除文件（连同其分段）
router.delete('/:id/files/:fileId', asyncHandler(async (req, res) => {
  const r = kbService.removeFile(req.params.id, req.params.fileId);
  if (!r.ok) return res.status(404).json({ ok: false, error: '文件不存在' });
  auditService.log(req.user, auditService.ACTIONS.KB_DELETE_FILE, `kb:${r.data.file}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 删除单个分段
router.delete('/:id/chunks/:chunkId', asyncHandler(async (req, res) => {
  const r = kbService.removeChunk(req.params.id, req.params.chunkId);
  if (!r.ok) return res.status(404).json({ ok: false, error: '分段不存在' });
  res.json({ ok: true, data: r.data });
}));

// 检索测试（与对话注入同一套检索逻辑）
router.post('/:id/search', asyncHandler(async (req, res) => {
  const r = kbService.search(req.params.id, (req.body || {}).query, (req.body || {}).topK);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r });
}));

/* ================= 成员级授权（私有库协作） ================= */

// 授权成员：POST /:id/members { userId, canEdit }（userId 由前端从成员列表选择）
router.post('/:id/members', asyncHandler(async (req, res) => {
  const userId = (req.body || {}).userId;
  const canEdit = !!(req.body || {}).canEdit;
  if (!userId) return res.status(400).json({ ok: false, error: '请选择要授权的成员' });
  const user = require('../userService').getById(userId);
  if (!user) return res.status(404).json({ ok: false, error: '成员不存在' });
  const r = kbService.addMember(req.params.id, { id: user.id, username: user.username, displayName: user.displayName, role: user.role }, canEdit);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.KB_UPDATE, `kb:${req.params.id}`, `授权成员 ${user.displayName || user.username}`, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 移除成员：DELETE /:id/members/:userId
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const r = kbService.removeMember(req.params.id, req.params.userId);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: '成员不存在' });
  auditService.log(req.user, auditService.ACTIONS.KB_UPDATE, `kb:${req.params.id}`, '移除成员', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 更新成员编辑权限：PUT /:id/members/:userId { canEdit }
router.put('/:id/members/:userId', asyncHandler(async (req, res) => {
  const r = kbService.updateMemberEdit(req.params.id, req.params.userId, !!(req.body || {}).canEdit);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: '成员不存在' });
  res.json({ ok: true, data: r.data });
}));

// 一键导入预置知识库（产品手册 / FAQ / 公司制度，幂等：只补缺失的 presetKey）
router.post('/seed', asyncHandler(async (req, res) => {
  const r = kbService.seedPresets(req.user);
  auditService.log(req.user, auditService.ACTIONS.KB_IMPORT, 'kb:预置知识库', `导入 ${r.added} 个 / ${r.chunks} 段`, auditService.ipOf(req));
  res.json({ ok: true, data: r });
}));

module.exports = router;
