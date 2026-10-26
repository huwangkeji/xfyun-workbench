'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const userService = require('../userService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 成员管理 API（/api/admin/users）
 * 由 server.js 挂载 requireRole('owner','admin')：仅管理员可访问。
 * 账号维护规则（service 层强制）：
 *   - 不能停用自己、不能自改角色、不能动唯一的 owner；
 *   - 仅 owner 可管理 owner/admin 级别的账号（本路由再加固一层）。
 */

/** 目标角色为 owner/admin 时，仅 owner 可操作 */
function assertManageable(actor, targetRole) {
  if (['owner', 'admin'].includes(targetRole) && actor.role !== 'owner') {
    return '仅超级管理员（owner）可管理 owner / admin 账号';
  }
  return null;
}

// 员工列表（脱敏，不含哈希）
router.get('/', (req, res) => {
  res.json({ ok: true, data: userService.list() });
});

// 新增账号：{ username, displayName, password, role? }
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const role = body.role || 'member';
  const deny = assertManageable(req.user, role);
  if (deny) return res.status(403).json({ ok: false, error: deny });

  const r = userService.create({
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    role,
    note: body.note
  }, req.user);
  if (!r.ok) {
    return res.status(400).json({ ok: false, errors: r.errors, error: (r.errors || []).join('；') });
  }
  auditService.log(req.user, auditService.ACTIONS.USER_CREATE, `user:${r.data.username}`, `角色 ${r.data.role}`, auditService.ipOf(req));
  res.status(201).json({ ok: true, data: r.data });
}));

// 编辑账号：{ displayName?, role?, status?, note?, resetPassword? }
router.put('/:id', asyncHandler(async (req, res) => {
  const target = userService.getById(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: '账号不存在' });

  const patch = req.body || {};
  // 自操作保护优先于角色守卫（给明确文案，避免被「仅 owner 可管理」误导）
  // 注意：password 与 resetPassword 一样列入保护——改自己的密码必须走 /api/auth/password
  // （需验证当前密码），否则成员管理接口就成了跳过旧密码校验的改密旁路。
  if (target.id === req.user.id && (patch.role !== undefined || patch.status !== undefined || patch.resetPassword || patch.password !== undefined)) {
    if (patch.resetPassword || patch.password !== undefined) {
      return res.status(400).json({ ok: false, error: '如需修改自己的密码，请使用右上角「修改密码」' });
    }
    return res.status(400).json({ ok: false, error: patch.role !== undefined ? '不能修改自己的角色' : '不能停用自己' });
  }
  // 改角色 / 停用启用 / 重置密码都属于「管理」，按目标当前角色+目标新角色双重校验
  const deny = assertManageable(req.user, target.role)
    || (patch.role !== undefined ? assertManageable(req.user, patch.role) : null);
  if (deny) return res.status(403).json({ ok: false, error: deny });

  const before = { role: target.role, status: target.status, displayName: target.displayName };
  const r = userService.update(req.params.id, patch, req.user);
  if (!r.ok) {
    return res.status(400).json({ ok: false, errors: r.errors, error: (r.errors || []).join('；') });
  }

  // 审计：按实际发生的变更记
  const changes = [];
  if (r.data.role !== before.role) changes.push(`角色 ${before.role} → ${r.data.role}`);
  if (r.data.status !== before.status) changes.push(`状态 ${before.status} → ${r.data.status}`);
  if (r.data.displayName !== before.displayName) changes.push('昵称变更');
  if (patch.resetPassword) changes.push('重置为临时密码（下次登录强制改密）');
  let action = auditService.ACTIONS.USER_UPDATE;
  if (patch.resetPassword) action = auditService.ACTIONS.USER_RESET_PWD;
  else if (r.data.status !== before.status) action = r.data.status === 'disabled' ? auditService.ACTIONS.USER_DISABLE : auditService.ACTIONS.USER_ENABLE;
  auditService.log(req.user, action, `user:${r.data.username}`, changes.join('；') || '资料更新', auditService.ipOf(req));

  res.json({ ok: true, data: r.data, tempPassword: r.tempPassword || null });
}));

// 软删除 = 停用（历史数据完整保留，随时可重新启用）
router.delete('/:id', asyncHandler(async (req, res) => {
  const target = userService.getById(req.params.id);
  if (!target) return res.status(404).json({ ok: false, error: '账号不存在' });
  const deny = assertManageable(req.user, target.role);
  if (deny) return res.status(403).json({ ok: false, error: deny });

  const r = userService.setStatus(req.params.id, 'disabled', req.user);
  if (!r.ok) {
    return res.status(400).json({ ok: false, errors: r.errors, error: (r.errors || []).join('；') });
  }
  auditService.log(req.user, auditService.ACTIONS.USER_DISABLE, `user:${r.data.username}`, '软删除（停用，数据保留）', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

module.exports = router;
