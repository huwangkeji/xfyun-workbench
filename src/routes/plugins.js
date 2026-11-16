'use strict';

const express = require('express');
const pluginService = require('../pluginService');
const auditService = require('../auditService');

/**
 * 插件市场：
 *   /api/admin/plugins        —— owner/admin 安装/卸载/启用（挂载时已过 requireRole）
 *   /api/plugins              —— 登录员工只读列表（供智能体绑定）
 */

// ==================== 管理端（owner/admin） ====================
const adminRouter = express.Router();

// 全部插件（含安装状态）
adminRouter.get('/', (req, res) => {
  res.json({ ok: true, data: pluginService.listAll() });
});

// 新建 / 保存自定义插件（本地代码插件 或 远程技能）
adminRouter.post('/save', (req, res) => {
  const body = req.body || {};
  const r = pluginService.saveCustom(body);
  if (!r.ok) return res.status(400).json({ ok: false, error: (r.errors || []).join('；'), errors: r.errors || [] });
  auditService.log(
    req.user,
    auditService.ACTIONS.PLUGIN_INSTALL,
    `plugin:${r.data.key}`,
    `${body.existing ? '更新' : '上传'}${r.data.type === 'remote' ? '远程技能' : '自定义插件'}「${r.data.name}」`,
    auditService.ipOf(req)
  );
  res.json({ ok: true, data: r.data });
});

// 插件详情（编辑用，含自定义代码 / 远程配置）
adminRouter.get('/:key', (req, res) => {
  const d = pluginService.getDetail(req.params.key);
  if (!d) return res.status(404).json({ ok: false, error: '插件不存在' });
  res.json({ ok: true, data: d });
});

// 测试调用（后台调试，不影响智能体绑定）
adminRouter.post('/:key/test', async (req, res) => {
  const args = (req.body || {}).args || {};
  const r = await pluginService.test(req.params.key, args);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error, latencyMs: r.latencyMs });
  res.json({ ok: true, data: r });
});

// 安装插件
adminRouter.post('/:key/install', (req, res) => {
  const r = pluginService.install(req.params.key);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  auditService.log(req.user, auditService.ACTIONS.PLUGIN_INSTALL, `plugin:${req.params.key}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
});

// 卸载插件
adminRouter.delete('/:key', (req, res) => {
  const r = pluginService.uninstall(req.params.key);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  auditService.log(req.user, auditService.ACTIONS.PLUGIN_UNINSTALL, `plugin:${req.params.key}`, '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
});

// 启用/停用插件
adminRouter.put('/:key', (req, res) => {
  const enabled = (req.body || {}).enabled !== false;
  const r = pluginService.setEnabled(req.params.key, enabled);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  res.json({ ok: true, data: r.data });
});

// ==================== 员工端（登录即可） ====================
const router = express.Router();

// 只读列表（含安装状态，供智能体绑定）
router.get('/', (req, res) => {
  res.json({ ok: true, data: pluginService.listAll() });
});

module.exports = { adminRouter, router };
