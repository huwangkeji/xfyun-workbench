'use strict';

/**
 * 操作留痕（审计日志，P1）
 *
 * 环形缓冲存 db.json 的 auditLogs（保留最近 MAX_AUDIT 条），
 * 记录「谁、何时、做了什么、对象是谁、从哪来」。
 * 写入点：登录成败/退出/改密/注册、账号增改停启/重置密码、
 *         配置增删改/激活/设置/测试、记忆备注/删除/导出、清空日志。
 */

const db = require('./db');

const MAX_AUDIT = 2000;

/** 动作白名单（同时作为前端展示的 key） */
const ACTIONS = {
  LOGIN_OK: 'auth.login_ok',
  LOGIN_FAIL: 'auth.login_fail',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGE: 'auth.password_change',
  REGISTER: 'auth.register',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DISABLE: 'user.disable',
  USER_ENABLE: 'user.enable',
  USER_RESET_PWD: 'user.reset_password',
  CONFIG_CREATE: 'config.create',
  CONFIG_UPDATE: 'config.update',
  CONFIG_DELETE: 'config.delete',
  CONFIG_ACTIVATE: 'config.activate',
  CONFIG_SETTINGS: 'config.settings',
  CONFIG_TEST: 'config.test',
  MEMORY_NOTE: 'memory.note',
  MEMORY_DELETE: 'memory.delete',
  MEMORY_EXPORT: 'memory.export',
  LOG_CLEAR: 'log.clear'
};

const ACTION_LABELS = {
  'auth.login_ok': '登录成功',
  'auth.login_fail': '登录失败',
  'auth.logout': '退出登录',
  'auth.password_change': '修改密码',
  'auth.register': '注册账号',
  'user.create': '创建账号',
  'user.update': '修改账号',
  'user.disable': '停用账号',
  'user.enable': '启用账号',
  'user.reset_password': '重置密码',
  'config.create': '新增配置',
  'config.update': '修改配置',
  'config.delete': '删除配置',
  'config.activate': '设置默认配置',
  'config.settings': '修改全局设置',
  'config.test': '测试配置连通性',
  'memory.note': '保存备注',
  'memory.delete': '删除会话记录',
  'memory.export': '导出会话记录',
  'log.clear': '清空运行日志'
};

/**
 * 写一条审计
 * @param {{id?:string|null, username?:string, displayName?:string}|null} actor 操作者（登录失败时为被尝试的用户名）
 * @param {string} action ACTIONS 中的值
 * @param {string} target 对象描述，如 "user:zhangsan" / "config:星火"
 * @param {string} detail 明细（变更要点）
 * @param {string} ip 来源 IP
 */
function log(actor, action, target = '', detail = '', ip = '') {
  const data = db.load();
  if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
  const entry = {
    id: db.getNextId('aud'),
    time: new Date().toISOString(),
    actorId: actor && actor.id ? actor.id : null,
    actorName: actor ? (actor.displayName || actor.username || '未知') : '系统',
    action,
    target: String(target || '').slice(0, 200),
    detail: String(detail || '').slice(0, 500),
    ip: String(ip || '').slice(0, 64)
  };
  data.auditLogs.unshift(entry);
  if (data.auditLogs.length > MAX_AUDIT) {
    data.auditLogs.length = MAX_AUDIT;
  }
  db.save();
  return entry;
}

function ipOf(req) {
  return (req && (req.ip || req.socket.remoteAddress)) || '';
}

/**
 * 审计列表（分页 + 筛选）
 * @param {{actorId?, action?, actionPrefix?, keyword?, dateFrom?, dateTo?, limit?, offset?}} query
 *        actorId 传 'me' 时由调用方先解析为真实 id（路由层处理）
 */
function list(query = {}) {
  let logs = db.load().auditLogs.slice();
  const {
    actorId, action, actionPrefix, keyword,
    dateFrom, dateTo
  } = query;

  if (actorId) logs = logs.filter((l) => l.actorId === actorId);
  if (action) logs = logs.filter((l) => l.action === action);
  if (actionPrefix) logs = logs.filter((l) => String(l.action).startsWith(actionPrefix));
  if (dateFrom) {
    const from = Date.parse(dateFrom);
    if (Number.isFinite(from)) logs = logs.filter((l) => Date.parse(l.time) >= from);
  }
  if (dateTo) {
    const to = Date.parse(dateTo);
    if (Number.isFinite(to)) logs = logs.filter((l) => Date.parse(l.time) <= to);
  }
  if (keyword) {
    const kw = String(keyword).trim().toLowerCase();
    if (kw) {
      logs = logs.filter((l) =>
        (l.actorName || '').toLowerCase().includes(kw)
        || (l.target || '').toLowerCase().includes(kw)
        || (l.detail || '').toLowerCase().includes(kw)
        || (ACTION_LABELS[l.action] || l.action).toLowerCase().includes(kw)
      );
    }
  }

  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { total: logs.length, limit, offset, items: logs.slice(offset, offset + limit) };
}

/** 某操作者的最近登录相关记录（个人中心用） */
function recentForActor(actorId, limit = 20) {
  return db.load().auditLogs
    .filter((l) => l.actorId === actorId && String(l.action).startsWith('auth.'))
    .slice(0, Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100));
}

module.exports = { ACTIONS, ACTION_LABELS, log, list, recentForActor, ipOf, MAX_AUDIT };
