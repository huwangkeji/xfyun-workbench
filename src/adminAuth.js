'use strict';

/**
 * 后台管理密码认证（零依赖，仅用 node:crypto）
 *
 * 安全设计：
 *   - 密码不存明文：scrypt(随机盐) 哈希后存 data/db.json 的 settings.adminPasswordHash；
 *   - 会话不存服务端状态：HMAC-SHA256 签名 cookie（admin_token=v1.<过期时间>.<签名>），
 *     签名密钥 settings.sessionSecret 首次启动随机生成并持久化（重启不踢登录）；
 *   - 初始密码来源优先级：.env 的 ADMIN_PASSWORD > 首次启动随机生成（仅控制台打印一次）；
 *   - 修改密码后轮换 sessionSecret，全部会话失效需重新登录；
 *   - 登录失败限流：同一 IP 连续 5 次错误锁定 60 秒；
 *   - 忘记密码：设置环境变量 ADMIN_PASSWORD_RESET=1 重启即可用 ADMIN_PASSWORD（或新的随机密码）重置。
 */

const crypto = require('crypto');
const db = require('./db');
const env = require('./env');

const COOKIE_NAME = 'admin_token';
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
      console.log('[admin] 已使用环境变量 ADMIN_PASSWORD 作为后台管理密码');
    } else {
      console.log('');
      console.log('====================================================');
      console.log(' 后台管理初始密码（仅本次显示，登录后请立即修改）：');
      console.log(`   ${pwd}`);
      console.log(' 也可以在 .env 中设置 ADMIN_PASSWORD 固定初始密码；');
      console.log(' 忘记密码可设 ADMIN_PASSWORD_RESET=1 重启重置。');
      console.log('====================================================');
    }
  } else {
    db.save(); // 至少持久化可能新生成的 sessionSecret
  }
}

/** 签发会话 cookie（HttpOnly，JS 读不到）。name 区分后台/工作台两种会话 */
function issueCookie(res, name = COOKIE_NAME) {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const secret = db.load().settings.sessionSecret;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  const token = `v1.${exp}.${sig}`;
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${TTL_HOURS * 3600}`);
}

/** 清除会话 cookie */
function clearCookie(res, name = COOKIE_NAME) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** 从请求头中读取指定cookie 的会话令牌 */
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

/** 校验请求携带的指定会话 cookie 是否有效（HMAC 签名 + 未过期） */
function hasValidToken(req, name = COOKIE_NAME) {
  const m = /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(tokenFromReq(req, name));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const secret = db.load().settings.sessionSecret;
  if (!secret) return false;
  const expect = crypto.createHmac('sha256', secret).update(String(exp)).digest('base64url');
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 页面守卫：未登录跳登录页 */
function requireAdminPage(req, res, next) {
  if (hasValidToken(req)) return next();
  return res.redirect('/admin/login');
}

/** API 守卫：未登录返回 401 JSON */
function requireAdminApi(req, res, next) {
  if (hasValidToken(req)) return next();
  return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: '未登录或会话已过期，请重新登录后台管理' });
}

/* ---------- 登录失败限流（内存计数，重启清零） ---------- */
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

/**
 * 登录：校验密码并下发会话 cookie
 * @returns {{ok:boolean, error?:string}}
 */
function login(req, res, password) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (isLocked(ip)) {
    return { ok: false, error: `密码错误次数过多，请 ${LOCK_SEC} 秒后再试` };
  }
  const data = db.load();
  if (!verifyPassword(password, data.settings.adminPasswordHash)) {
    registerFail(ip);
    return { ok: false, error: '密码错误' };
  }
  clearFails(ip);
  issueCookie(res);
  return { ok: true };
}

/** 修改密码：校验旧密码 → 写入新哈希 → 轮换会话密钥（全部会话失效） */
function changePassword(currentPassword, newPassword) {
  const data = db.load();
  if (!verifyPassword(currentPassword, data.settings.adminPasswordHash)) {
    return { ok: false, error: '当前密码不正确' };
  }
  if (typeof newPassword !== 'string' || newPassword.length < 4) {
    return { ok: false, error: '新密码至少 4 位' };
  }
  data.settings.adminPasswordHash = hashPassword(newPassword);
  data.settings.adminPasswordUpdatedAt = new Date().toISOString();
  data.settings.adminPasswordIsInitial = false;
  // 轮换会话密钥：旧 cookie 全部失效，安全起见要求重新登录
  data.settings.sessionSecret = crypto.randomBytes(32).toString('hex');
  db.save();
  return { ok: true };
}

/** 登录页展示用的状态（无需登录）：是否已设密码、是否仍是初始密码 */
function setupStatus() {
  const data = db.load();
  return {
    hasPassword: !!data.settings.adminPasswordHash,
    isInitial: !!data.settings.adminPasswordIsInitial
  };
}

/* ================= 工作台（游客）密码保护 =================
 * 由后台「工作台访问控制」开关驱动：
 *   - 关闭（默认）：工作台与全部业务 API 开放访问；
 *   - 开启：游客必须输入访客密码才能使用工作台；
 *           后台登录态（admin_token）默认放行——Owner 无需重复输入。
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
 *   功能开启 → 需要有效的 wb_token，或后台登录态（admin_token）。
 */
function hasWorkbenchAccess(req) {
  if (!isWorkbenchAuthEnabled()) return true;
  return hasValidToken(req, WB_COOKIE_NAME) || hasValidToken(req, COOKIE_NAME);
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
  login,
  changePassword,
  setupStatus,
  hasValidToken,
  requireAdminPage,
  requireAdminApi,
  clearCookie,
  COOKIE_NAME,
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
