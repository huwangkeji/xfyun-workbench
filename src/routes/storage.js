'use strict';

const express = require('express');
const storageService = require('../storageService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 文件存储管理（/api/admin/storage，owner/admin 专用；挂载时已过 requireRole）
 * 统一管理 uploads/ 下的知识库源文件、对话附件、对话图片、员工头像。
 */

// 分组目录（网盘左侧导航：各分组计数 + 总量统计）
router.get('/groups', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: storageService.groups() });
}));

// 某分组下的实体/文件（?group=kb|conversation|agent|avatar|orphan|all）
router.get('/entities', asyncHandler(async (req, res) => {
  const group = String(req.query.group || 'all');
  const r = storageService.entities(group);
  res.json({ ok: true, data: r });
}));

// 列表 + 统计（?kind=kb|attachment|image|avatar|orphan&q=&limit=&offset=）
router.get('/', asyncHandler(async (req, res) => {
  const r = storageService.list({
    kind: req.query.kind,
    q: req.query.q,
    limit: req.query.limit,
    offset: req.query.offset
  });
  res.json({ ok: true, data: r });
}));

// 删除单个文件（默认拒绝删除仍被引用的文件；?force=1 强删）
router.delete('/:rel(*)', asyncHandler(async (req, res) => {
  const rel = req.params.rel;
  const force = req.query.force === '1' || req.query.force === 'true';
  const r = storageService.removeFile(rel, { force });
  if (!r.ok) {
    return res.status(r.referenced ? 409 : 400).json({ ok: false, error: r.error, referenced: !!r.referenced });
  }
  auditService.log(req.user, auditService.ACTIONS.STORAGE_DELETE, `storage:${rel}`, force ? '强制删除' : '', auditService.ipOf(req));
  res.json({ ok: true, data: r.data });
}));

// 清理孤儿文件（无任何引用且无法归类的文件）
router.post('/clean', asyncHandler(async (req, res) => {
  const r = storageService.cleanOrphans();
  auditService.log(req.user, auditService.ACTIONS.STORAGE_CLEAN, 'storage:orphans', `清理 ${r.removed} 个 / ${Math.round(r.freedBytes / 1024)}KB`, auditService.ipOf(req));
  res.json({ ok: true, data: r });
}));

module.exports = router;
