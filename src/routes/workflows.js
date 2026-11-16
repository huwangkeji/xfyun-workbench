'use strict';

const express = require('express');
const workflowService = require('../workflowService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 画布工作流（/api/admin/workflows，owner/admin）：
 * CRUD + 画布保存（nodes/edges 整体提交）+ 测试运行（服务端拓扑执行）。
 */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: workflowService.list() });
}));

router.get('/options', asyncHandler(async (req, res) => {
  // 画布节点配置用的下拉数据：知识库 / 模型配置
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

router.post('/', asyncHandler(async (req, res) => {
  const r = workflowService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_CREATE, `workflow:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const r = workflowService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_UPDATE, `workflow:${r.data.name}`, '画布保存', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const r = workflowService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '工作流不存在' });
  auditService.log(req.user, auditService.ACTIONS.WORKFLOW_DELETE, `workflow:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 测试运行（调试预览）
router.post('/:id/run', asyncHandler(async (req, res) => {
  const r = await workflowService.run(req.params.id, (req.body || {}).query);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error, steps: r.steps, latencyMs: r.latencyMs });
  res.json({ ok: true, data: r });
}));

module.exports = router;
