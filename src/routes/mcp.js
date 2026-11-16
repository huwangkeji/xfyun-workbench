'use strict';

const express = require('express');
const mcpService = require('../mcpService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');

/**
 * MCP（Model Context Protocol）服务管理：
 *   /api/admin/mcp           —— owner/admin 读写（挂载时已过 requireRole）
 *   /api/mcp                 —— 登录员工只读列表（供智能体绑定工具）
 *   /api/mcp/:id/test        —— 登录员工可测试连接（发现工具）
 */

// ==================== 管理端（owner/admin） ====================
const adminRouter = express.Router();

// 列表
adminRouter.get('/', (req, res) => {
  res.json({ ok: true, data: mcpService.list() });
});

// 单个详情（脱敏）
adminRouter.get('/:id', (req, res) => {
  const m = mcpService.get(req.params.id);
  if (!m) return res.status(404).json({ ok: false, error: 'MCP 服务不存在' });
  res.json({ ok: true, data: m });
});

// 新增
adminRouter.post('/', (req, res) => {
  const r = mcpService.create(req.body || {}, req.user);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.MCP_CREATE, `mcp:${r.data.id}`, r.data.name, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
});

// 修改
adminRouter.put('/:id', (req, res) => {
  const r = mcpService.update(req.params.id, req.body || {}, req.user);
  if (!r.ok) return r.notFound
    ? res.status(404).json({ ok: false, error: 'MCP 服务不存在' })
    : res.status(400).json({ ok: false, error: (r.errors || []).join('；') });
  auditService.log(req.user, auditService.ACTIONS.MCP_UPDATE, `mcp:${r.data.id}`, r.data.name, auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
});

// 删除
adminRouter.delete('/:id', (req, res) => {
  const r = mcpService.remove(req.params.id);
  if (!r.ok) return res.status(404).json({ ok: false, error: 'MCP 服务不存在' });
  auditService.log(req.user, auditService.ACTIONS.MCP_DELETE, `mcp:${r.data.id}`, r.data.name, auditService.ipOf(req));
  res.json({ ok: true });
});

// 测试连接（发现工具）
adminRouter.post('/:id/test', asyncHandler(async (req, res) => {
  const r = await mcpService.test(req.params.id);
  auditService.log(req.user, auditService.ACTIONS.MCP_TEST, `mcp:${req.params.id}`, r.ok ? `发现 ${r.data.count} 个工具` : `失败：${r.error}`, auditService.ipOf(req));
  res.json(r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
}));

// ==================== 员工端（登录即可） ====================
const router = express.Router();

// 只读列表（脱敏，供智能体绑定）
router.get('/', (req, res) => {
  res.json({ ok: true, data: mcpService.list() });
});

// 发现某 MCP 的工具列表（供绑定勾选）
router.get('/:id/tools', asyncHandler(async (req, res) => {
  const r = await mcpService.listTools(req.params.id);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true, data: r.data });
}));

module.exports = { adminRouter, router };
