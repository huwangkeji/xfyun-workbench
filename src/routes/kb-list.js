'use strict';

const express = require('express');
const kbService = require('../kbService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 工作台知识库接口（/api/kb，登录员工；访客不可见，防知识外泄）。
 * 权限：visibility=all 全员可见；private 仅创建者与 owner/admin 可见。
 * 员工可创建自己的知识库（创建方式与后台一致：名称/备注/可见性），
 * 并能维护（导入文件/编辑/删除）本人创建的知识库；他人/官方预置库只读。
 *
 * 只读：
 *   GET /            元信息列表（按当前用户权限过滤，卡片网格用）
 *   GET /:id         单库元信息（权限内可见）
 *   POST /:id/search 检索测试（与对话注入同一套算法；只读，viewer 可用）
 * 员工可写（本人创建的库）：
 *   POST /           新建知识库
 *   PUT /:id         改名 / 备注 / 可见性
 *   DELETE /:id      删除知识库
 *   POST /:id/files  导入文件（text/qa/data 三种方式）
 */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: kbService.listForUser(req.user) });
}));

// 团队成员列表（脱敏，供员工自建知识库授权成员时选择；登录员工即可）
// 注意：须置于 GET /:id 之前，避免 /members-list 被 :id 捕获
router.get('/members-list', asyncHandler(async (req, res) => {
  const userService = require('../userService');
  res.json({ ok: true, data: userService.list() });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const kb = kbService.get(req.params.id);
  if (!kb) return res.status(404).json({ ok: false, error: '知识库不存在' });
  if (!kbService.canUse({ id: kb.id, visibility: kb.visibility, ownerId: kb.ownerId }, req.user)) {
    return res.status(403).json({ ok: false, error: '该知识库为私有库，仅创建者与管理员可用' });
  }
  res.json({ ok: true, data: kb });
}));

router.post('/:id/search', asyncHandler(async (req, res) => {
  const kb = kbService.get(req.params.id);
  if (!kb) return res.status(404).json({ ok: false, error: '知识库不存在' });
  if (!kbService.canUse({ id: kb.id, visibility: kb.visibility, ownerId: kb.ownerId }, req.user)) {
    return res.status(403).json({ ok: false, error: '该知识库为私有库，仅创建者与管理员可用' });
  }
  const r = kbService.search(req.params.id, (req.body || {}).query, (req.body || {}).topK);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r });
}));

/* ================= 员工可写（本人创建的知识库） ================= */

// 新建知识库（登录员工即可；创建方式与后台一致）
router.post('/', asyncHandler(async (req, res) => {
  const r = kbService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.KB_CREATE, `kb:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 编辑知识库（改名/备注/可见性；仅本人创建的，或 owner/admin）
router.put('/:id', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能编辑本人创建的知识库' });
  const r = kbService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r.data });
}));

// 删除知识库（仅本人创建的，或 owner/admin）
router.delete('/:id', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能删除本人创建的知识库' });
  const r = kbService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '知识库不存在' });
  auditService.log(req.user, auditService.ACTIONS.KB_DELETE, `kb:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 导入文件（三种方式：mode = text 直接分段 / qa QA拆分 / data 精准数据导入；仅本人创建的，或 owner/admin）
router.post('/:id/files', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能向本人创建的知识库导入文件' });
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

/* ================= 员工自建库完整管理（文件列表 / 段落 / 成员授权） =================
 * 仅本人创建的知识库（或 owner/admin）可操作，他人/官方预置库只读。
 */

// 段落管理列表（分页 + 按文件过滤 + 关键词过滤；可见即可读）
router.get('/:id/chunks', asyncHandler(async (req, res) => {
  const kb = kbService.get(req.params.id);
  if (!kb) return res.status(404).json({ ok: false, error: '知识库不存在' });
  if (!kbService.canUse({ id: kb.id, visibility: kb.visibility, ownerId: kb.ownerId }, req.user)) {
    return res.status(403).json({ ok: false, error: '该知识库为私有库，仅创建者与管理员可用' });
  }
  const r = kbService.listChunks(req.params.id, {
    limit: req.query.limit,
    offset: req.query.offset,
    fileId: req.query.fileId,
    q: req.query.q
  });
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r });
}));

// 编辑分段正文（本人创建或 owner/admin）
router.put('/:id/chunks/:chunkId', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能编辑本人创建的知识库' });
  const r = kbService.updateChunk(req.params.id, req.params.chunkId, (req.body || {}).text);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  res.json({ ok: true, data: r.data });
}));

// 删除文件（连同其分段）
router.delete('/:id/files/:fileId', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能删除本人创建的知识库文件' });
  const r = kbService.removeFile(req.params.id, req.params.fileId);
  if (!r.ok) return res.status(404).json({ ok: false, error: '文件不存在' });
  res.json({ ok: true, data: r.data });
}));

// 删除单个分段
router.delete('/:id/chunks/:chunkId', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能删除本人创建的知识库分段' });
  const r = kbService.removeChunk(req.params.id, req.params.chunkId);
  if (!r.ok) return res.status(404).json({ ok: false, error: '分段不存在' });
  res.json({ ok: true, data: r.data });
}));

// 授权成员：POST /:id/members { userId, canEdit }
router.post('/:id/members', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能管理本人创建的知识库成员' });
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
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能管理本人创建的知识库成员' });
  const r = kbService.removeMember(req.params.id, req.params.userId);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: '成员不存在' });
  res.json({ ok: true, data: r.data });
}));

// 更新成员编辑权限：PUT /:id/members/:userId { canEdit }
router.put('/:id/members/:userId', asyncHandler(async (req, res) => {
  const own = kbService.ownedKb(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '知识库不存在' : '只能管理本人创建的知识库成员' });
  const r = kbService.updateMemberEdit(req.params.id, req.params.userId, !!(req.body || {}).canEdit);
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: '成员不存在' });
  res.json({ ok: true, data: r.data });
}));

module.exports = router;
