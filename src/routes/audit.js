'use strict';

const express = require('express');
const userService = require('../userService');
const auditService = require('../auditService');
const router = express.Router();

/**
 * 审计日志 API（/api/admin/audit-logs）
 * 由 server.js 挂载 requireRole('owner','admin')：仅管理员可查看。
 * actorId=me 查当前操作者；actionPrefix=auth 查登录相关（个人中心复用）。
 */

router.get('/', (req, res) => {
  const query = { ...req.query };
  if (query.actorId === 'me') query.actorId = req.user.id;
  res.json({ ok: true, data: auditService.list(query) });
});

module.exports = router;
