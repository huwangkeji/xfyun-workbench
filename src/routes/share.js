'use strict';

const express = require('express');
const shareService = require('../shareService');
const router = express.Router();

/**
 * 分享公开读接口（/api/share）——刻意豁免工作台密码守卫（见 server.js 守卫豁免）：
 * 分享链接本身就是能力凭证（22 位不可猜测 token），否则"分享出去"无意义。
 * 创建/列表/撤销走 /api/conversations/:id/...，仍受现有守卫保护。
 */

// 按 token 读快照：GET /api/share/:token
router.get('/:token', (req, res) => {
  const rec = shareService.getByToken(req.params.token);
  if (!rec) {
    return res.status(404).json({ ok: false, error: '链接不存在或已被撤销' });
  }
  if (rec.expired) {
    return res.status(410).json({ ok: false, code: 'SHARE_EXPIRED', error: '链接已过期' });
  }
  res.json({
    ok: true,
    data: {
      title: rec.snapshot.title,
      sharedAt: rec.snapshot.sharedAt,
      messageCount: rec.snapshot.messageCount,
      messages: rec.snapshot.messages
    }
  });
});

module.exports = router;
