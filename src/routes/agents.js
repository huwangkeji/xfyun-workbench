'use strict';

const express = require('express');
const agentService = require('../agentService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 工作台智能体接口（/api/agents，登录员工）：
 *   GET     列表（public 全员可见 + 本人创建的 private；仅元信息与角色设定）
 *   POST    新建（登录员工即可创建；可见性 public/private 自选）
 *   PUT     编辑（仅本人创建的智能体，或 owner/admin）
 *   DELETE  删除（仅本人创建的智能体，或 owner/admin）
 * 员工创建的智能体记录 ownerId/ownerName，private 仅本人与管理员可见（与后台一致）。
 */

router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: agentService.listForActor(req.user) });
}));

// 新建智能体（登录员工即可；创建方式与后台一致）
router.post('/', asyncHandler(async (req, res) => {
  const r = agentService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.AGENT_CREATE, `agent:${r.data.name}`, r.data.visibility, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 编辑智能体（仅本人创建的，或 owner/admin）
router.put('/:id', asyncHandler(async (req, res) => {
  const own = agentService.ownedAgent(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '智能体不存在' : '只能编辑本人创建的智能体' });
  const r = agentService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.AGENT_UPDATE, `agent:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 删除智能体（仅本人创建的，或 owner/admin）
router.delete('/:id', asyncHandler(async (req, res) => {
  const own = agentService.ownedAgent(req.params.id, req.user);
  if (!own.ok) return res.status(own.notFound ? 404 : 403).json({ ok: false, error: own.notFound ? '智能体不存在' : '只能删除本人创建的智能体' });
  const r = agentService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '智能体不存在' });
  auditService.log(req.user, auditService.ACTIONS.AGENT_DELETE, `agent:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

module.exports = router;
