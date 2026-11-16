'use strict';

const express = require('express');
const workflowService = require('../workflowService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 工作流成员端（/api/workflows，登录员工）：
 *   运行 + 自建画布 CRUD（员工可创建/编辑/删除本人画布，权限与智能体/知识库一致；
 *   viewer 只读不可运行/不可写；owner/admin 不受限）。
 */

// 只读成员（viewer）禁止写操作
function denyViewer(req, res, next) {
  if (req.user && req.user.role === 'viewer') {
    return res.status(403).json({ ok: false, error: '只读成员（viewer）不能创建工作流' });
  }
  next();
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: workflowService.listForActor(req.user) });
}));

// 画布下拉数据（知识库 / 模型配置）
router.get('/options', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: {
      kbs: workflowService.listKbOptions(),
      configs: workflowService.listConfigOptions()
    }
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const wf = workflowService.get(req.params.id);
  if (!wf) return res.status(404).json({ ok: false, error: '工作流不存在' });
  res.json({ ok: true, data: wf });
}));

// 新建画布（登录员工即可；创建后 ownerId 归属本人）
router.post('/', denyViewer, asyncHandler(async (req, res) => {
  const r = workflowService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_CREATE, `workflow:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 保存画布（仅本人创建的，或 owner/admin）
router.put('/:id', denyViewer, asyncHandler(async (req, res) => {
  const own = workflowService.ownedWorkflow(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '工作流不存在' : '只能编辑本人创建的工作流' });
  const r = workflowService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_UPDATE, `workflow:${r.data.name}`, '画布保存', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 删除画布（仅本人创建的，或 owner/admin）
router.delete('/:id', denyViewer, asyncHandler(async (req, res) => {
  const own = workflowService.ownedWorkflow(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '工作流不存在' : '只能删除本人创建的工作流' });
  const r = workflowService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '工作流不存在' });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_DELETE, `workflow:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 测试运行（viewer 不可运行）
router.post('/:id/run', asyncHandler(async (req, res) => {
  if (req.user && req.user.role === 'viewer') {
    return res.status(403).json({ ok: false, error: '只读成员（viewer）不能运行工作流' });
  }
  const r = await workflowService.run(req.params.id, (req.body || {}).query);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error, steps: r.steps, latencyMs: r.latencyMs });
  res.json({ ok: true, data: r });
}));

module.exports = router;
