'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 工作台游客密码保护接口（/api/workbench）——永远免登录，否则无法完成登录。
 * 功能开关由后台「工作台访问控制」维护（settings.workbenchAuthEnabled）。
 */

// 状态：功能是否开启、当前请求是否已放行（登录页据此跳转）
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    data: {
      enabled: adminAuth.isWorkbenchAuthEnabled(),
      authenticated: adminAuth.hasWorkbenchAccess(req)
    }
  });
});

// 访客登录：{ password } → 种 wb_token cookie
router.post('/login', asyncHandler(async (req, res) => {
  const password = (req.body || {}).password;
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ ok: false, error: '请输入密码' });
  }
  const r = adminAuth.loginWorkbench(req, res, password);
  if (!r.ok) {
    return res.status(401).json({ ok: false, error: r.error });
  }
  res.json({ ok: true });
}));

// 访客退出登录
router.post('/logout', (req, res) => {
  adminAuth.clearWorkbenchCookie(res);
  res.json({ ok: true });
});

module.exports = router;
