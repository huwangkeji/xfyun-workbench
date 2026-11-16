'use strict';

const express = require('express');
const agentService = require('../agentService');
const appShareService = require('../appShareService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 智能体管理（/api/admin/agents，owner/admin）：全部智能体 CRUD + 预置模板导入
 * + 应用对外分享管理（创建链接 / QPM / 过期时间 / 访问密码 / 撤销）。
 */
router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: agentService.listAll() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const r = agentService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.AGENT_CREATE, `agent:${r.data.name}`, r.data.visibility, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const r = agentService.update(req.params.id, req.body || {});
  if (!r.ok) return res.status(r.notFound ? 404 : 400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.AGENT_UPDATE, `agent:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const r = agentService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: '智能体不存在' });
  auditService.log(req.user, auditService.ACTIONS.AGENT_DELETE, `agent:${r.data.name}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 一键导入「数字员工 / 提效工具」预置模板（幂等：只补缺失的 presetKey）
router.post('/seed', asyncHandler(async (req, res) => {
  const r = agentService.seedPresets(req.user);
  auditService.log(req.user, auditService.ACTIONS.AGENT_CREATE, 'agent:预置模板', `导入 ${r.added} 个`, auditService.ipOf(req));
  res.json({ ok: true, data: r });
}));

/* ================= 应用对外分享（owner/admin） ================= */

/** 分享链接列表 */
router.get('/:id/shares', asyncHandler(async (req, res) => {
  const agent = agentService.getForActor(req.params.id, req.user);
  if (!agent) return res.status(404).json({ ok: false, error: '智能体不存在' });
  res.json({ ok: true, data: appShareService.listByAgent(agent.id) });
}));

/** 创建分享链接：QPM 限流 / 过期时间 / 访问密码 */
router.post('/:id/shares', asyncHandler(async (req, res) => {
  const agent = agentService.getForActor(req.params.id, req.user);
  if (!agent) return res.status(404).json({ ok: false, error: '智能体不存在' });
  const r = appShareService.create(agent, req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.AGENT_UPDATE, `agent:${agent.name}`, `创建分享链接（QPM ${r.data.qpm || '不限'} / ${r.data.expiresAt ? '到期 ' + r.data.expiresAt.slice(0, 10) : '永久'}${r.data.hasPassword ? ' / 带密码' : ''}）`, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

/** 撤销分享链接 */
router.delete('/:id/shares/:token', asyncHandler(async (req, res) => {
  const agent = agentService.getForActor(req.params.id, req.user);
  if (!agent) return res.status(404).json({ ok: false, error: '智能体不存在' });
  const ok = appShareService.revoke(agent.id, req.params.token);
  if (!ok) return res.status(404).json({ ok: false, error: '分享链接不存在' });
  auditService.log(req.user, auditService.ACTIONS.AGENT_UPDATE, `agent:${agent.name}`, '撤销分享链接', auditService.ipOf(req));
  res.json({ ok: true, data: { token: req.params.token } });
}));

module.exports = router;
