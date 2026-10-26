'use strict';

const express = require('express');
const adminAuth = require('../adminAuth');
const userService = require('../userService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/**
 * 员工认证 API（/api/auth）
 * 免登录白名单（由 server.js 挂载层控制）：/login、/logout、/setup-status、/register
 * 其余接口（/me、/password）均由 requireTeamUser 守护。
 */

// 登录页状态：是否已有账号、owner 是否仍是初始密码、是否开放自助注册
router.get('/setup-status', (req, res) => {
  const owner = userService.getByUsername('owner');
  const configService = require('../configService');
  res.json({
    ok: true,
    data: {
      hasUsers: userService.list().length > 0,
      ownerMustChangePassword: !!(owner && owner.mustChangePassword),
      selfRegisterEnabled: !!configService.getSettings().allowSelfRegister
    }
  });
});

// 员工登录：{ username, password } → 种 HttpOnly team_token
router.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = userService.login(req, { username: body.username, password: body.password });
  if (!r.ok) {
    // 留痕：被尝试的用户名（不记录密码）
    auditService.log(
      { id: null, username: String(body.username || '').trim().toLowerCase(), displayName: String(body.username || '').trim().toLowerCase() },
      auditService.ACTIONS.LOGIN_FAIL, `auth:${String(body.username || '').trim().toLowerCase()}`, r.error, auditService.ipOf(req)
    );
    return res.status(401).json({ ok: false, error: r.error, locked: !!r.locked });
  }
  adminAuth.issueTeamCookie(res, userService.getById(r.user.id));
  auditService.log(r.user, auditService.ACTIONS.LOGIN_OK, `auth:${r.user.username}`, `角色 ${r.user.role}`, auditService.ipOf(req));
  res.json({
    ok: true,
    data: {
      user: r.user,
      mustChangePassword: !!r.user.mustChangePassword
    }
  });
}));

// 退出登录（同时清理员工会话与兼容期内的旧后台会话）
// 注意：本路由在免登录白名单中（过期会话也要能退出），故自行解析身份用于留痕
router.post('/logout', (req, res) => {
  const user = adminAuth.resolveTeamUser(req);
  if (user) {
    auditService.log(user, auditService.ACTIONS.LOGOUT, `auth:${user.username}`, '', auditService.ipOf(req));
  }
  // 三种会话 cookie 一次性全部清除（team_token / admin_token / wb_token），
  // 少任何一个都会出现「退了等于没退」—— historically clearTeamCookie+clearCookie
  // 因 setHeader 覆盖语义只剩后者生效（见 adminAuth.appendCookie 注释）。
  adminAuth.clearAllAuthCookies(res);
  res.json({ ok: true });
});

// 当前会话信息（前端探活 / 展示身份）
router.get('/me', (req, res) => {
  res.json({ ok: true, data: { authenticated: true, user: req.user } });
});

// 我的登录相关记录（个人中心用；任何登录员工可看自己的，无需管理员角色）
router.get('/my-logins', (req, res) => {
  res.json({ ok: true, data: auditService.recentForActor(req.user.id, 30) });
});

// 我的数据概览（个人中心用；logService.overview 已按角色收敛，member 只看自己的）
router.get('/my-overview', (req, res) => {
  const logService = require('../logService');
  res.json({ ok: true, data: logService.overview(req.user, { days: 7 }) });
});

// 开放自助注册（P3，默认关闭；注册角色固定为 member，注册后自动登录）
router.post('/register', asyncHandler(async (req, res) => {
  const configService = require('../configService');
  if (!configService.getSettings().allowSelfRegister) {
    return res.status(403).json({ ok: false, error: '本站未开放自助注册，请联系管理员创建账号' });
  }
  const body = req.body || {};
  const r = userService.create({
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    role: 'member'
  });
  if (!r.ok) {
    return res.status(400).json({ ok: false, errors: r.errors, error: (r.errors || []).join('；') });
  }
  auditService.log(r.data, auditService.ACTIONS.REGISTER, `auth:${r.data.username}`, '自助注册', auditService.ipOf(req));
  adminAuth.issueTeamCookie(res, userService.getById(r.data.id));
  res.status(201).json({ ok: true, data: { user: r.data, mustChangePassword: false } });
}));

// 自助修改密码：{ currentPassword, newPassword }
// 成功后清除会话，要求用新密码重新登录（令牌签名绑定 passwordUpdatedAt，旧会话同样失效）
router.put('/password', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = userService.changePassword(req.user.id, body.currentPassword, body.newPassword);
  if (!r.ok) {
    return res.status(400).json({ ok: false, error: r.error });
  }
  adminAuth.clearAllAuthCookies(res);
  auditService.log(req.user, auditService.ACTIONS.PASSWORD_CHANGE, `auth:${req.user.username}`, '自助改密，会话已失效', auditService.ipOf(req));
  res.json({ ok: true, message: '密码已修改，请使用新密码重新登录' });
}));

module.exports = router;
