'use strict';

require('./src/env'); // 必须最先加载：读取 .env / 进程环境变量（API Key 等敏感配置入口）

const path = require('path');
const express = require('express');
const adminAuth = require('./src/adminAuth');
const userService = require('./src/userService');

adminAuth.bootstrap(); // 初始化管理密码哈希（首次启动随机生成并打印到控制台）/ 会话密钥
userService.bootstrapMigrate(); // 旧密码迁移为 owner 员工账号 / 历史数据打标 / v1 兼容窗口
require('./src/configService').checkEncryptionState(); // API Key 加密自检（设置了 DB_ENCRYPT_KEY 才相关）

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

// —— 员工认证（/api/auth）：登录/退出/登录页状态/开放注册永远免登录，其余需员工会话 ——
app.use('/api/auth', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/setup-status' || req.path === '/register') return next();
  return adminAuth.requireTeamUser(req, res, next);
}, require('./src/routes/auth'));

// —— 工作台密码保护总闸（功能开启时生效）——
// 除 /api/admin（后台自己的登录体系）、/api/workbench（登录接口）、/api/auth（员工登录体系）、
// /api/health、/api/share/<token>（分享公开读：token 即能力凭证）外，
// 所有 /api/* 业务接口都要求访客已通过工作台密码验证（员工登录态同样放行）。
// /uploads/*（粘贴上传的图片）一并守卫：未登录既拿不到页面，也不应能直链图片。
app.use((req, res, next) => {
  if (!adminAuth.isWorkbenchAuthEnabled()) return next();
  const p = req.path || '';
  if (p === '/api/health' || p.startsWith('/api/admin') || p.startsWith('/api/workbench') || p.startsWith('/api/auth')) return next();
  if (/^\/api\/share\/[A-Za-z0-9_-]{8,64}$/.test(p)) return next(); // 分享快照公开读（创建/撤销仍受守卫）
  if (p.startsWith('/api/')) return adminAuth.requireWorkbenchApi(req, res, next);
  if (p.startsWith('/uploads/')) return adminAuth.requireWorkbenchApi(req, res, next);
  return next();
});

// —— 后台管理（/api/admin）：除 /logout 外全部需员工登录态 ——
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/logout') return next();
  return adminAuth.requireTeamUser(req, res, next);
});
app.use('/api/admin', require('./src/routes/admin'));

// —— 成员管理 / 审计日志（/api/admin/users、/api/admin/audit-logs）：仅 owner/admin ——
// 注意：须置于 /api/admin 挂载之后——请求先过 requireTeamUser，再落到此处按角色收紧
app.use('/api/admin/users', adminAuth.requireRole('owner', 'admin'), require('./src/routes/admin-users'));
app.use('/api/admin/audit-logs', adminAuth.requireRole('owner', 'admin'), require('./src/routes/audit'));

// 软身份解析：携带有效员工会话 → 注入 req.user（供数据归属/日志留痕/角色过滤）；
// 无员工会话 → 放过（访客流量，由工作台密码总闸负责准入）。
// 适用于对话/会话/上传/图片等「员工与访客混流」的业务路由。
function attachTeamUser(req, res, next) {
  try {
    const user = adminAuth.resolveTeamUser(req) || adminAuth.resolveLegacyOwner(req);
    if (user) req.user = userService.sanitize(user);
  } catch (_) { /* 身份解析失败按访客处理，不阻断业务 */ }
  return next();
}

// 配置接口：GET 供工作台读取（保持开放），写操作需员工登录且为 owner/admin
// 网络探测同属运维写能力。注意守卫链：requireRole 依赖 req.user，必须先过 requireTeamUser。
function requireAdminWrite(req, res, next) {
  if (req.method === 'GET') return next();
  return adminAuth.requireTeamUser(req, res, () => adminAuth.requireRole('owner', 'admin')(req, res, next));
}
app.use('/api/configs', requireAdminWrite, require('./src/routes/config'));
app.use('/api/chat', attachTeamUser, require('./src/routes/chat'));
// 图片上传（粘贴/拖拽）：base64 JSON 上报，落盘 public/uploads
app.use('/api/upload', attachTeamUser, require('./src/routes/upload'));
// 运行日志：登录即可（member 仅见自己的记录，P2 起按角色过滤）
app.use('/api/logs', adminAuth.requireTeamUser, require('./src/routes/logs'));
// 网络探测为运维能力：仅 owner/admin
app.use('/api/network', requireAdminWrite, require('./src/routes/network'));
app.use('/api/conversations', attachTeamUser, require('./src/routes/conversations'));
app.use('/api/image', attachTeamUser, require('./src/routes/image'));
// 对话分享：公开读（GET /api/share/:token，守卫已豁免）；管理端点挂在 /api/conversations/:id/...
app.use('/api/share', require('./src/routes/share'));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'xfyun-workbench', time: new Date().toISOString() }));

// 员工登录页（/team-login 与 /admin/login 双入口，已登录则分别跳工作台/后台）。
// 注意：必须早于下方静态托管，否则会被 express.static 直接吐出而绕过守卫。
app.get('/team-login', (req, res) => {
  if (adminAuth.resolveTeamUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'team-login.html'));
});
app.get('/admin/login', (req, res) => {
  if (adminAuth.resolveTeamUser(req)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'team-login.html'));
});
// 后台页面仅 owner/admin 可进入（member/viewer 从工作台/员工中心使用；数据隔离见 P2）
function adminPageGuard(req, res, next) {
  if (!['owner', 'admin'].includes(req.user.role)) return res.redirect('/');
  return next();
}
app.get('/admin', adminAuth.requireTeamPage, adminPageGuard, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', adminAuth.requireTeamPage, adminPageGuard, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 员工中心（/me）：任何登录员工可进入（基本信息 / 我的数据 / 登录记录 / 改密）
app.get('/me', adminAuth.requireTeamPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'me.html')));

// 门户首页（/home）：公开介绍页 + 员工登录/注册入口（不含敏感数据，无需守卫）
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));

// 工作台登录页（访客密码保护开启时使用；已放行/功能关闭则直接进工作台）
app.get('/login', (req, res) => {
  if (adminAuth.hasWorkbenchAccess(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 对话分享页（公开只读，token 即凭证；刻意不走工作台密码守卫，否则"分享出去"无意义）。
// 必须早于下方静态托管注册，且路径带 token 参数（非法 token 由前端调公开接口后展示错误态）。
app.get(/^\/s\/([A-Za-z0-9_-]{8,64})$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
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
  console.log(`  员工登录:  http://127.0.0.1:${PORT}/team-login`);
  console.log(`  后台管理:  http://127.0.0.1:${PORT}/admin （需员工账号登录，初始账号见上方启动日志）`);
});