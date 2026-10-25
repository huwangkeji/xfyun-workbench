'use strict';

const express = require('express');
const logService = require('../logService');
const router = express.Router();

// 日志列表（分页，可按 status 过滤）
router.get('/', (req, res) => {
  res.json({ ok: true, data: logService.list(req.query) });
});

// 单条日志
router.get('/:id', (req, res) => {
  const log = logService.get(req.params.id);
  if (!log) return res.status(404).json({ ok: false, error: '日志不存在' });
  res.json({ ok: true, data: log });
});

// 清空日志
router.delete('/', (req, res) => {
  res.json({ ok: true, data: logService.clear() });
});

module.exports = router;