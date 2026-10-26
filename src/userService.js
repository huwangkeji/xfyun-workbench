'use strict';

/**
 * 员工账号服务（P0 账号体系地基）
 *
 * 职责：
 *   - 账号 CRUD：用户名/昵称/角色/状态；密码 scrypt 哈希（复用 adminAuth）；
 *   - 登录校验：用户名 + 密码、状态检查、IP 与用户名双维度限流、统一错误文案；
 *   - 自助改密：改密后只失效本人会话（令牌签名绑定 passwordUpdatedAt）；
 *   - bootstrapMigrate：把旧版「唯一后台密码」平滑迁移为 owner 员工账号，
 *     历史会话/日志打上 ownerId，旧 admin_token 保留 7 天只读兼容。
 *
 * 依赖方向：本模块 → adminAuth（哈希/限流工具）；adminAuth 仅在请求期
 * 延迟 require 本模块（见 adminAuth.loadUserService），无加载期环。
 */

const crypto = require('crypto');
const db = require('./db');
const adminAuth = require('./adminAuth');

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const ROLE_LABELS = { owner: '超级管理员', admin: '管理员', member: '成员', viewer: '只读成员' };
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DISPLAY_NAME_MAX = 30;

// 用户名维度限流：同账号连续失败 5 次锁 5 分钟（防单账号被撞库）
const MAX_USER_FAILS = 5;
const USER_LOCK_SEC = 300;
const userFailMap = new Map(); // username -> { count, until(ms) }

/* ================= 查询 ================= */

/** 脱敏：任何出口都不带 passwordHash */
function sanitize(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: !!user.mustChangePassword,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    note: user.note || ''
  };
}

function list() {
  return db.load().users.map(sanitize);
}

function getById(id) {
  return db.load().users.find((u) => u.id === id) || null;
}

/** 用户名大小写不敏感（存储统一小写） */
function getByUsername(username) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return null;
  return db.load().users.find((u) => u.username === uname) || null;
}

function countOwners() {
  return db.load().users.filter((u) => u.role === 'owner' && u.status === 'active').length;
}

/* ================= 校验 ================= */

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '密码至少 8 位';
  if (pw.length > 72) return '密码最长 72 位';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密码需同时包含字母和数字';
  return null;
}

function validateUsername(username) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return '请输入用户名';
  if (!USERNAME_RE.test(uname)) return '用户名须为 3-20 位小写字母/数字/下划线';
  if (getByUsername(uname)) return '用户名已被占用';
  return null;
}

function validateRole(role) {
  return ROLES.includes(role) ? null : `角色须为 ${ROLES.join(' / ')}`;
}

/* ================= 账号维护 ================= */

/**
 * 创建账号（P0 由 scripts/create-user.js 调用；P1 起由后台「成员管理」API 调用）
 * @param {{username, displayName, password, role?, note?}} input
 * @param {object|null} actor 操作者（脱敏用户），用于约束与留痕
 */
function create(input, actor = null) {
  const username = String((input && input.username) || '').trim().toLowerCase();
  const displayName = String((input && input.displayName) || '').trim();
  const role = (input && input.role) || 'member';
  const password = input && input.password;
  const note = typeof (input && input.note) === 'string' ? input.note.slice(0, 500) : '';

  const errors = [];
  const uErr = validateUsername(username);
  if (uErr) errors.push(uErr);
  if (!displayName) errors.push('请输入昵称');
  if (displayName.length > DISPLAY_NAME_MAX) errors.push(`昵称最长 ${DISPLAY_NAME_MAX} 个字符`);
  const rErr = validateRole(role);
  if (rErr) errors.push(rErr);
  const pErr = validatePassword(password);
  if (pErr) errors.push(pErr);
  if (role === 'owner' && countOwners() > 0) errors.push('超级管理员（owner）只能有一个');
  // 仅 owner/admin 可创建账号（CLI 场景 actor 为 null，放行）
  if (actor && !['owner', 'admin'].includes(actor.role)) errors.push('权限不足：仅管理员可创建账号');
  if (errors.length) return { ok: false, errors };

  const now = new Date().toISOString();
  const user = {
    id: db.getNextId('usr'),
    username,
    displayName,
    role,
    passwordHash: adminAuth.hashPassword(password),
    status: 'active',
    mustChangePassword: !!((input && input.mustChangePassword)),
    passwordUpdatedAt: now,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    note
  };
  db.load().users.push(user);
  db.save();
  return { ok: true, data: sanitize(user) };
}

/**
 * 更新账号：昵称 / 角色 / 启停 / 重置密码
 * 安全约束：不能停用自己、不能自改角色、不能动最后一个 owner、不能删除唯一 owner。
 */
function update(id, patch = {}, actor = null) {
  const data = db.load();
  const user = data.users.find((u) => u.id === id);
  if (!user) return { ok: false, notFound: true, errors: ['账号不存在'] };

  const errors = [];
  const next = { ...user };
  const now = new Date().toISOString();

  if (patch.displayName !== undefined) {
    const name = String(patch.displayName || '').trim();
    if (!name) errors.push('昵称不能为空');
    else if (name.length > DISPLAY_NAME_MAX) errors.push(`昵称最长 ${DISPLAY_NAME_MAX} 个字符`);
    else next.displayName = name;
  }

  if (patch.role !== undefined && patch.role !== user.role) {
    const rErr = validateRole(patch.role);
    if (rErr) errors.push(rErr);
    else if (actor && actor.id === user.id) errors.push('不能修改自己的角色');
    else if (user.role === 'owner' && patch.role !== 'owner' && countOwners() <= 1) errors.push('不能取消唯一的超级管理员');
    else if (patch.role === 'owner' && countOwners() > 0) errors.push('超级管理员（owner）只能有一个');
    else next.role = patch.role;
  }

  if (patch.status !== undefined && patch.status !== user.status) {
    if (!['active', 'disabled'].includes(patch.status)) {
      errors.push('状态须为 active / disabled');
    } else if (patch.status === 'disabled') {
      if (actor && actor.id === user.id) errors.push('不能停用自己');
      else if (user.role === 'owner' && countOwners() <= 1) errors.push('不能停用唯一的超级管理员');
      else {
        next.status = 'disabled';
        // 停用即时失效：同时 bump passwordUpdatedAt，旧令牌签名立即不匹配
        next.passwordUpdatedAt = now;
      }
    } else {
      next.status = 'active';
    }
  }

  if (patch.note !== undefined) {
    next.note = typeof patch.note === 'string' ? patch.note.slice(0, 500) : '';
  }

  // 管理员重置密码：随机临时密码 + 首次登录强制改密
  if (patch.resetPassword) {
    const temp = crypto.randomBytes(9).toString('base64url'); // ~12 位随机密码
    next.passwordHash = adminAuth.hashPassword(temp);
    next.passwordUpdatedAt = now;
    next.mustChangePassword = true;
    next._tempPassword = temp; // 仅本次返回给操作者，不落库
  }

  // 直接指定新密码（密码重置脚本 / 运维场景）：同样 bump passwordUpdatedAt
  // （旧 team_token 签名绑定该字段，改密即失效全部旧会话），默认下次登录强制改密
  if (patch.password !== undefined) {
    const pErr = validatePassword(patch.password);
    if (pErr) errors.push(pErr);
    else {
      next.passwordHash = adminAuth.hashPassword(patch.password);
      next.passwordUpdatedAt = now;
      next.mustChangePassword = patch.mustChangePassword === undefined ? true : !!patch.mustChangePassword;
      next._setPassword = patch.password; // 仅本次返回，不落库
    }
  }

  if (errors.length) return { ok: false, errors };

  next.updatedAt = now;
  const tempPassword = next._tempPassword;
  const setPassword = next._setPassword;
  delete next._tempPassword;
  delete next._setPassword;
  data.users[data.users.indexOf(user)] = next;
  db.save();
  return { ok: true, data: sanitize(next), tempPassword, setPassword };
}

/** 停用 / 启用（update 的薄封装，语义更直白） */
function setStatus(id, status, actor = null) {
  return update(id, { status }, actor);
}

/* ================= 登录 / 改密 ================= */

function isUserLocked(username) {
  const rec = userFailMap.get(username);
  if (!rec || !rec.until) return false;
  if (rec.until > Date.now()) return true;
  userFailMap.delete(username);
  return false;
}

function registerUserFail(username) {
  const rec = userFailMap.get(username) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_USER_FAILS) {
    rec.until = Date.now() + USER_LOCK_SEC * 1000;
    rec.count = 0;
  }
  userFailMap.set(username, rec);
}

function clearUserFails(username) {
  userFailMap.delete(username);
}

/** 用户名锁定剩余秒数（未锁定返回 0） */
function userLockRemainSec(username) {
  const rec = userFailMap.get(username);
  if (!rec || !rec.until || rec.until <= Date.now()) return 0;
  return Math.ceil((rec.until - Date.now()) / 1000);
}

/**
 * 员工登录校验（不发 cookie，由路由层签发）
 * @returns {{ok:true, user:object}|{ok:false, error:string, locked?:boolean}}
 */
function login(req, { username, password }) {
  const ip = (req && (req.ip || req.socket.remoteAddress)) || 'unknown';
  if (adminAuth.isLocked(ip)) {
    return { ok: false, error: `尝试次数过多，请 ${adminAuth.lockRemainSec(ip)} 秒后再试`, locked: true };
  }
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || typeof password !== 'string' || !password) {
    return { ok: false, error: '请输入用户名和密码' };
  }
  if (isUserLocked(uname)) {
    return { ok: false, error: `该账号失败次数过多，请 ${userLockRemainSec(uname)} 秒后再试`, locked: true };
  }

  const user = getByUsername(uname);
  // 统一文案：不暴露「用户名是否存在」
  if (!user || user.status !== 'active' || !adminAuth.verifyPassword(password, user.passwordHash)) {
    registerUserFail(uname);
    adminAuth.registerFail(ip);
    if (user && user.status !== 'active') {
      return { ok: false, error: '账号已停用，请联系管理员' };
    }
    return { ok: false, error: '用户名或密码错误' };
  }

  clearUserFails(uname);
  adminAuth.clearFails(ip);
  user.lastLoginAt = new Date().toISOString();
  db.save();
  return { ok: true, user: sanitize(user) };
}

/**
 * 自助改密：校验旧密码 → 写新哈希 → bump passwordUpdatedAt（只失效本人会话）
 */
function changePassword(userId, currentPassword, newPassword) {
  const data = db.load();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: '账号不存在' };
  if (!adminAuth.verifyPassword(currentPassword, user.passwordHash)) {
    return { ok: false, error: '当前密码不正确' };
  }
  const pErr = validatePassword(newPassword);
  if (pErr) return { ok: false, error: pErr };
  if (newPassword === currentPassword) return { ok: false, error: '新密码不能与当前密码相同' };

  user.passwordHash = adminAuth.hashPassword(newPassword);
  user.passwordUpdatedAt = new Date().toISOString();
  user.mustChangePassword = false;
  user.updatedAt = user.passwordUpdatedAt;
  db.save();
  return { ok: true };
}

/* ================= 启动迁移 ================= */

/**
 * bootstrapMigrate：旧版 → 员工账号体系的一次性平滑迁移（幂等，停服/不停服均可）
 *   1. users 为空且有旧 adminPasswordHash → 创建 owner 账号（哈希原样沿用，免改密烦恼）；
 *      adminPasswordIsInitial 为真时置 mustChangePassword（首次登录强制改密）；
 *   2. 历史 conversations 补 ownerId='<ownerId>'（旧数据全部归属 owner，P2 起按人隔离）；
 *   3. 记录 legacyV1CompatUntil = now + 7d：旧 admin_token 在窗口内仍视为 owner；
 *   4. 兜底：连旧哈希都没有（全新库）→ 创建 owner 并打印随机密码到控制台。
 */
function bootstrapMigrate() {
  const data = db.load();
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
  let changed = false;

  let owner = data.users.find((u) => u.username === 'owner');
  if (!owner) {
    const legacyHash = data.settings && data.settings.adminPasswordHash;
    const now = new Date().toISOString();
    if (legacyHash) {
      owner = {
        id: db.getNextId('usr'),
        username: 'owner',
        displayName: '超级管理员',
        role: 'owner',
        passwordHash: legacyHash,
        status: 'active',
        mustChangePassword: !!data.settings.adminPasswordIsInitial,
        passwordUpdatedAt: data.settings.adminPasswordUpdatedAt || now,
        lastLoginAt: null,
        createdAt: data.settings.adminPasswordUpdatedAt || now,
        updatedAt: now,
        note: '由旧版后台密码自动迁移'
      };
    } else {
      // 全新库兜底：随机密码，仅控制台打印一次
      const pwd = crypto.randomBytes(9).toString('base64url');
      owner = {
        id: db.getNextId('usr'),
        username: 'owner',
        displayName: '超级管理员',
        role: 'owner',
        passwordHash: adminAuth.hashPassword(pwd),
        status: 'active',
        mustChangePassword: true,
        passwordUpdatedAt: now,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
        note: '系统初始化创建'
      };
      console.log('');
      console.log('====================================================');
      console.log(' 已创建初始管理员账号：');
      console.log(`   用户名：owner    密码：${pwd}`);
      console.log(' 首次登录将要求修改密码；请勿泄露本密码。');
      console.log('====================================================');
    }
    data.users.push(owner);
    changed = true;
  }

  // 历史数据归属打标（缺省 owner；P2 起 member 只能看 ownerId 为自己的数据）
  for (const c of data.conversations) {
    if (!c.ownerId) { c.ownerId = owner.id; changed = true; }
  }

  // 旧版后台会话兼容窗口（7 天）
  if (!data.settings.legacyV1CompatUntil) {
    data.settings.legacyV1CompatUntil = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    changed = true;
  }

  if (changed) db.save();
  return { ownerId: owner.id };
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  sanitize,
  list,
  getById,
  getByUsername,
  countOwners,
  validatePassword,
  validateUsername,
  create,
  update,
  setStatus,
  login,
  changePassword,
  isUserLocked,
  userLockRemainSec,
  registerUserFail,
  clearUserFails,
  bootstrapMigrate
};
