'use strict';

/**
 * 认证模块（零依赖，仅用 node:crypto）
 *
 * 安全设计：
 *   - 密码不存明文：scrypt(随机盐) 哈希后存储（员工账号存 users[].passwordHash，
 *     访客密码存 settings.workbenchPasswordHash），比对用 timingSafeEqual；
 *   - 会话不存服务端状态：HMAC-SHA256 签名 cookie；
 *       · 员工会话 team_token = v2.<userId>.<过期时间>.<签名>
 *         签名内容 = "<userId>|<过期时间>|<passwordUpdatedAt>"
 *         → 某人改密后只有他的会话失效（passwordUpdatedAt 变化导致签名不匹配）；
 *         → 角色/状态不签入令牌，每次请求从实时用户记录读取，改角色/停用即时生效；
 *       · 访客会话 wb_token = v1.<过期时间>.<签名>（与旧版后台会话同格式）；
 *   - 旧版后台会话（admin_token = v1.<过期时间>.<签名>）保留只读兼容：
 *     迁移日起 7 天（settings.legacyV1CompatUntil）内仍视为 owner 身份，到期自然失效；
 *   - 登录失败限流：同一 IP 连续 5 次错误锁定 60 秒（员工登录另按用户名计数，见 userService）；
 *   - 初始密码来源：.env 的 ADMIN_PASSWORD > 首次启动随机生成（仅控制台打印一次）。
 */

const crypto = require('crypto');
const db = require('./db');
const env = require('./env');

const COOKIE_NAME = 'admin_token';       // 旧版后台会话（v1，兼容期后废弃）
const TEAM_COOKIE_NAME = 'team_token';   // 员工会话（v2）
const TTL_HOURS = parseInt(env.getEnv('ADMIN_SESSION_TTL_HOURS', '12'), 10) || 12;
const MAX_LOGIN_FAILS = 5;
const LOCK_SEC = 60;

/** 生成 scrypt 哈希：格式 scrypt$1$<saltHex>$<hashHex> */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 常量时间比较校验密码 */
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== '1') return false;
  const salt = Buffer.from(parts[2], 'hex');
  const expect = Buffer.from(parts[3], 'hex');
  if (salt.length === 0 || expect.length === 0) return false;
  const actual = crypto.scryptSync(String(password), salt, expect.length);
  return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
}

/**
 * 启动初始化：确保 sessionSecret 与 adminPasswordHash 存在。
 * 首次启动（无哈希）时：优先用环境变量 ADMIN_PASSWORD，否则随机生成并打印到控制台。
 * 注意：adminPasswordHash 现由 userService.bootstrapMigrate() 迁移为 owner 员工账号，
 *       此处仍负责生成/兜底，保证迁移永远有源可搬。
 */
function bootstrap() {
  const data = db.load();
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  if (!data.settings.sessionSecret) {
    data.settings.sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  const reset = env.getEnv('ADMIN_PASSWORD_RESET') === '1' || env.getEnv('ADMIN_PASSWORD_RESET', '').toLowerCase() === 'true';
  if (!data.settings.adminPasswordHash || reset) {
    const fromEnv = env.getEnv('ADMIN_PASSWORD');
    const pwd = fromEnv || crypto.randomBytes(9).toString('base64url'); // ~12 位随机密码
    data.settings.adminPasswordHash = hashPassword(pwd);
    data.settings.adminPasswordUpdatedAt = new Date().toISOString();
    data.settings.adminPasswordIsInitial = true; // 首次/重置密码，提示用户尽快修改
    db.save();
    if (fromEnv) {
      console.log('[admin] 已使用环境变量 ADMIN_PASSWORD 作为初始管理密码');
    } else {
      console.log('');
      console.log('====================================================');
      console.log(' 初始管理密码（仅本次显示，登录后请立即修改）：');
      console.log(`   ${pwd}`);
      console.log(' 首次启动将自动迁移为 owner 员工账号；');
      console.log(' 之后可用 scripts/create-user.js 或后台「成员管理」新增员工。');
      console.log('====================================================');
    }
  } else {
    db.save(); // 至少持久化可能新生成的 sessionSecret
  }
}

/* ================= Cookie 基础 ================= */

function setCookie(res, name, token) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${TTL_HOURS * 3600}`);
}

/** 签发会话 cookie（HttpOnly，JS 读不到）。name 区分员工/访客两种会话 */
function issueCookie(res, name = COOKIE_NAME) {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const secret = db.load().settings.sessionSecret;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  setCookie(res, name, `v1.${exp}.${sig}`);
}

/** 清除会话 cookie */
function clearCookie(res, name = COOKIE_NAME) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** 从请求头中读取指定 cookie 的会话令牌 */
function tokenFromReq(req, name = COOKIE_NAME) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

/** 常量时间比较两个 base64url 串 */
function safeEqualB64(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ================= v1 会话（访客 wb_token / 旧版后台 admin_token） ================= */

/** 校验请求携带的 v1 会话 cookie 是否有效（HMAC 签名 + 未过期） */
function hasValidToken(req, name = COOKIE_NAME) {
  const m = /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(tokenFromReq(req, name));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const secret = db.load().settings.sessionSecret;
  if (!secret) return false;
  const expect = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  return safeEqualB64(m[2], expect);
}

/* ================= v2 员工会话（team_token） =================
 * 令牌格式：v2.<userId>.<exp>.<sig>
 *   sig = HMAC-SHA256(sessionSecret, "<userId>|<exp>|<passwordUpdatedAt>")
 * 校验必须查实时用户记录（取 passwordUpdatedAt 验签 + status 验活），
 * 因此改密（只踢本人）/ 停用（即时失效）/ 改角色（下次请求生效）全部天然支持。
 */

function loadUserService() {
  // 延迟 require：userService 顶部依赖本模块（哈希/限流工具），加载期 require 会成环
  return require('./userService');
}

/** 解析 v2 令牌并返回实时用户（无效/停用/过期返回 null） */
function resolveTeamUser(req) {
  const m = /^v2\.([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(tokenFromReq(req, TEAM_COOKIE_NAME));
  if (!m) return null;
  const exp = Number(m[2]);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const secret = db.load().settings.sessionSecret;
  if (!secret) return null;
  let user = null;
  try {
    user = loadUserService().getById(m[1]);
  } catch (_) {
    return null; // 用户表尚不可用（极端启动竞态）→ 视为未登录
  }
  if (!user || user.status !== 'active') return null;
  const expect = crypto.createHmac('sha256', secret)
    .update(`${user.id}|${m[2]}|${user.passwordUpdatedAt || ''}`)
    .digest('base64url');
  return safeEqualB64(m[3], expect) ? user : null;
}

/** 旧版后台会话（admin_token v1）在兼容窗口内映射为 owner 身份 */
function resolveLegacyOwner(req) {
  if (!hasValidToken(req, COOKIE_NAME)) return null;
  const data = db.load();
  const until = Date.parse(data.settings.legacyV1CompatUntil || 0);
  if (!until || until < Date.now()) return null;
  let owner = null;
  try {
    owner = loadUserService().getByUsername('owner');
  } catch (_) {
    return null;
  }
  return owner && owner.status === 'active' ? owner : null;
}

/** 员工会话签发（登录成功后调用） */
function issueTeamCookie(res, user) {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const secret = db.load().settings.sessionSecret;
  const sig = crypto.createHmac('sha256', secret)
    .update(`${user.id}|${exp}|${user.passwordUpdatedAt || ''}`)
    .digest('base64url');
  setCookie(res, TEAM_COOKIE_NAME, `v2.${user.id}.${exp}.${sig}`);
}

function clearTeamCookie(res) {
  clearCookie(res, TEAM_COOKIE_NAME);
}

/** API 守卫：未登录返回 401 JSON，并注入 req.user（脱敏用户对象） */
function requireTeamUser(req, res, next) {
  const user = resolveTeamUser(req) || resolveLegacyOwner(req);
  if (!user) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '未登录或会话已过期，请重新登录' });
  }
  req.user = loadUserService().sanitize(user);
  return next();
}

/** 角色守卫工厂：requireRole('owner','admin') → 中间件（须置于 requireTeamUser 之后） */
function requireRole(...roles) {
  const allowed = new Set(roles.flat());
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '未登录或会话已过期，请重新登录' });
    }
    if (!allowed.has(req.user.role)) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: '权限不足，需要管理员角色' });
    }
    return next();
  };
}

/** 页面守卫：未登录跳员工登录页（同时注入 req.user 供路由层做角色判断） */
function requireTeamPage(req, res, next) {
  const user = resolveTeamUser(req) || resolveLegacyOwner(req);
  if (!user) return res.redirect('/team-login');
  req.user = loadUserService().sanitize(user);
  return next();
}

/* ---------- 登录失败限流（IP 维度，内存计数，重启清零） ---------- */
const failMap = new Map(); // ip -> { count, until(ms) }

/**
 * 是否处于锁定期。
 * 记录两种状态：until=0 表示「正在计数但未锁定」（必须保留计数，不能删）；
 * until>0 表示锁定截止时间戳，过期后才清理。
 */
function isLocked(ip) {
  const rec = failMap.get(ip);
  if (!rec || !rec.until) return false;
  if (rec.until > Date.now()) return true;
  failMap.delete(ip); // 锁定已过期：清理，进入新的计数窗口
  return false;
}

function registerFail(ip) {
  const rec = failMap.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_LOGIN_FAILS) {
    rec.until = Date.now() + LOCK_SEC * 1000;
    rec.count = 0;
  }
  failMap.set(ip, rec);
}

function clearFails(ip) {
  failMap.delete(ip);
}

/* ================= 工作台（游客）密码保护 =================
 * 由后台「工作台访问控制」开关驱动：
 *   - 关闭（默认）：工作台与全部业务 API 开放访问；
 *   - 开启：游客必须输入访客密码才能使用工作台；
 *           员工登录态（team_token）同样放行——登录过的员工无需重复输入。
 * 密码同样 scrypt 哈希存储（settings.workbenchPasswordHash），
 * 登录失败与后台共用同一限流器（同 IP 5 次错误锁 60 秒）。
 */
const WB_COOKIE_NAME = 'wb_token';

function isWorkbenchAuthEnabled() {
  return !!db.load().settings.workbenchAuthEnabled;
}

/** 是否已设置访客密码 */
function hasWorkbenchPassword() {
  return !!db.load().settings.workbenchPasswordHash;
}

/** 设置/修改访客密码（至少 4 位） */
function setWorkbenchPassword(password) {
  if (typeof password !== 'string' || password.length < 4) {
    return { ok: false, error: '访客密码至少 4 位' };
  }
  const data = db.load();
  data.settings.workbenchPasswordHash = hashPassword(password);
  db.save();
  return { ok: true };
}

function verifyWorkbenchPassword(password) {
  return verifyPassword(password, db.load().settings.workbenchPasswordHash);
}

function issueWorkbenchCookie(res) {
  issueCookie(res, WB_COOKIE_NAME);
}

function clearWorkbenchCookie(res) {
  clearCookie(res, WB_COOKIE_NAME);
}

/**
 * 工作台访问判定：
 *   功能关闭 → 一律放行；
 *   功能开启 → 需要有效的 wb_token，或员工登录态（team_token），或兼容期内的旧后台会话。
 */
function hasWorkbenchAccess(req) {
  if (!isWorkbenchAuthEnabled()) return true;
  return hasValidToken(req, WB_COOKIE_NAME) || !!resolveTeamUser(req) || !!resolveLegacyOwner(req);
}

/** 页面守卫：开启且未放行 → 跳工作台登录页 */
function requireWorkbenchPage(req, res, next) {
  if (hasWorkbenchAccess(req)) return next();
  return res.redirect('/login');
}

/** API 守卫：开启且未放行 → 401 JSON（前端收到后跳登录页） */
function requireWorkbenchApi(req, res, next) {
  if (hasWorkbenchAccess(req)) return next();
  return res.status(401).json({ ok: false, code: 'WB_AUTH_REQUIRED', error: '工作台已开启密码保护，请先输入密码' });
}

/** 访客登录：校验密码并种 wb_token */
function loginWorkbench(req, res, password) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isLocked(ip)) {
    return { ok: false, error: `尝试次数过多，请 ${LOCK_SEC} 秒后再试` };
  }
  if (!isWorkbenchAuthEnabled()) {
    return { ok: false, error: '工作台密码保护未开启，可直接访问' };
  }
  if (!verifyWorkbenchPassword(password)) {
    registerFail(ip);
    return { ok: false, error: '密码错误' };
  }
  clearFails(ip);
  issueWorkbenchCookie(res);
  return { ok: true };
}

module.exports = {
  bootstrap,
  hashPassword,
  verifyPassword,
  issueTeamCookie,
  clearTeamCookie,
  resolveTeamUser,
  requireTeamUser,
  requireRole,
  requireTeamPage,
  hasValidToken,
  isLocked,
  registerFail,
  clearFails,
  clearCookie,
  COOKIE_NAME,
  TEAM_COOKIE_NAME,
  // —— 工作台游客密码保护 ——
  isWorkbenchAuthEnabled,
  hasWorkbenchPassword,
  setWorkbenchPassword,
  verifyWorkbenchPassword,
  hasWorkbenchAccess,
  requireWorkbenchPage,
  requireWorkbenchApi,
  loginWorkbench,
  issueWorkbenchCookie,
  clearWorkbenchCookie,
  WB_COOKIE_NAME
};
