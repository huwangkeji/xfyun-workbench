'use strict';

require('./src/env'); // 必须最先加载：读取 .env / 进程环境变量（API Key 等敏感配置入口）

const path = require('path');
const express = require('express');
const adminAuth = require('./src/adminAuth');

adminAuth.bootstrap(); // 初始化后台管理密码（首次启动随机生成并打印到控制台）/ 会话密钥

const app = express();
const PORT = process.env.PORT || 4000;

// 进程级兜底：未捕获异常/未处理拒绝只记日志，不允许再把进程打挂。
// （Node>=15 默认 unhandledRejection 即杀进程；曾有 async 路由 TypeError 直接杀掉服务，
//  导致前端所有请求报 Failed to fetch。真正原因已由 asyncHandler 修复，这里只是最后防线。）
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// 请求体上限：图片以 base64 data URL 经 JSON 上报（单张≤8MB×最多9张≈96MB），故放大到 100mb
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

// 强制文本类响应带 charset=UTF-8，避免浏览器把中文按错误编码解码出现乱码。
// 注意：图片等二进制类型不加 charset（如 image/png; charset=UTF-8 虽无害但不规范）。
app.use((req, res, next) => {
  const origSet = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    if (typeof name === 'string' && /^content-type$/i.test(name)) {
      value = String(value);
      const isTextual = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded))/i.test(value);
      if (isTextual && !/charset/i.test(value)) value = `${value}; charset=UTF-8`;
    }
    return origSet(name, value);
  };
  next();
});

// API 路由
// —— 工作台游客密码保护（/api/workbench）：登录/退出/状态永远免登录 ——
app.use('/api/workbench', require('./src/routes/workbench'));

// —— 工作台密码保护总闸（功能开启时生效）——
// 除 /api/admin（后台自己的登录体系）、/api/workbench（登录接口）、/api/health 外，
// 所有 /api/* 业务接口都要求访客已通过工作台密码验证（后台登录态同样放行）。
// /uploads/*（粘贴上传的图片）一并守卫：未登录既拿不到页面，也不应能直链图片。
app.use((req, res, next) => {
  if (!adminAuth.isWorkbenchAuthEnabled()) return next();
  const p = req.path || '';
  if (p === '/api/health' || p.startsWith('/api/admin') || p.startsWith('/api/workbench')) return next();
  if (p.startsWith('/api/')) return adminAuth.requireWorkbenchApi(req, res, next);
  if (p.startsWith('/uploads/')) return adminAuth.requireWorkbenchApi(req, res, next);
  return next();
});

// —— 后台管理（/api/admin）：登录/退出/登录页状态除外，其余全部需登录态 ——
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/setup-status') return next();
  return adminAuth.requireAdminApi(req, res, next);
});
app.use('/api/admin', require('./src/routes/admin'));

// 配置接口：GET 供工作台读取（保持开放），写操作仅后台登录态可用
app.use('/api/configs', (req, res, next) => {
  if (req.method === 'GET') return next();
  return adminAuth.requireAdminApi(req, res, next);
}, require('./src/routes/config'));
app.use('/api/chat', require('./src/routes/chat'));
// 图片上传（粘贴/拖拽）：base64 JSON 上报，落盘 public/uploads
app.use('/api/upload', require('./src/routes/upload'));
// 运行日志 / 网络探测仅后台使用，全部需登录
app.use('/api/logs', adminAuth.requireAdminApi, require('./src/routes/logs'));
app.use('/api/network', adminAuth.requireAdminApi, require('./src/routes/network'));
app.use('/api/conversations', require('./src/routes/conversations'));
app.use('/api/image', require('./src/routes/image'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'xfyun-workbench', time: new Date().toISOString() }));

// 后台管理页面（需登录；未登录跳登录页）。注意：必须早于下方静态托管，
// 否则 /admin.html 会被 static 直接吐出而绕过鉴权。
app.get('/admin/login', (req, res) => {
  if (adminAuth.hasValidToken(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});
app.get('/admin', adminAuth.requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', adminAuth.requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 工作台登录页（访客密码保护开启时使用；已放行/功能关闭则直接进工作台）
app.get('/login', (req, res) => {
  if (adminAuth.hasWorkbenchAccess(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 工作台首页（带访客密码守卫）。必须早于下方静态托管——
// 否则 express.static 的默认 index 会直接吐出 index.html，绕过 requireWorkbenchPage。
app.get(/^\/(index\.html)?$/, adminAuth.requireWorkbenchPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// 静态前端
app.use(express.static(path.join(__dirname, 'public')));

// 统一错误处理
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: '请求体过大' });
  }
  console.error('[server error]', err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`xfyun-workbench 已启动: http://127.0.0.1:${PORT}`);
  console.log(`  工作台:    http://127.0.0.1:${PORT}/`);
  console.log(`  后台管理:  http://127.0.0.1:${PORT}/admin （需密码登录，初始密码见上方启动日志）`);
});