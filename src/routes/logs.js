'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const auditService = require('../auditService');
const logService = require('../logService');
const router = express.Router();

// 日志列表（分页 + 多维筛选；member/viewer 仅见自己的记录，见 P2 logService）
router.get('/', (req, res) => {
  res.json({ ok: true, data: logService.list(req.query, req.user) });
});

// 单条日志（同样受角色范围约束）
router.get('/:id', (req, res) => {
  const log = logService.get(req.params.id, req.user);
  if (!log) return res.status(404).json({ ok: false, error: '日志不存在' });
  res.json({ ok: true, data: log });
});

// 清空日志（仅 owner/admin，留痕）
router.delete('/', adminAuth.requireRole('owner', 'admin'), (req, res) => {
  const total = logService.count();
  logService.clear();
  auditService.log(req.user, auditService.ACTIONS.LOG_CLEAR, 'logs', `清除 ${total} 条`, auditService.ipOf(req));
  res.json({ ok: true, data: { cleared: true } });
});

module.exports = router;
