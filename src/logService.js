'use strict';

const db = require('./db');

const MAX_LOGS = 5000; // 内存中的日志条数上限，超出后丢弃最旧

function buildId() {
  return db.getNextId('log');
}

function add(entry) {
  const data = db.load();
  data.logs.unshift(entry);
  if (data.logs.length > MAX_LOGS) {
    data.logs.length = MAX_LOGS;
  }
  db.save();
  return entry;
}

/**
 * 角色范围：member/viewer 只能看 actorId 为自己的记录；
 * owner/admin 看全部。访客（无 viewer）产生的记录仅管理员可见。
 */
function scope(logs, viewer) {
  if (viewer && (viewer.role === 'member' || viewer.role === 'viewer')) {
    return logs.filter((l) => l.actorId && l.actorId === viewer.id);
  }
  return logs;
}

/** 当天 00:00 的时间戳 */
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 日志列表（分页 + 多维筛选 + 排序）
 * @param {object} query status/keyword/model/configId/dateFrom/dateTo/sort/dir/limit/offset
 * @param {object|null} viewer 当前用户（member/viewer 自动收敛到自己的记录）
 */
function list(query = {}, viewer = null) {
  const {
    status, keyword, model, configId, dateFrom, dateTo, sort, dir
  } = query;

  let logs = scope(db.load().logs, viewer);

  if (status) logs = logs.filter((l) => l.status === status);
  if (model) logs = logs.filter((l) => l.model === model);
  if (configId) logs = logs.filter((l) => l.configId === configId);
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
      logs = logs.filter((l) => {
        const reqText = JSON.stringify(l.request || {}).toLowerCase();
        const resText = typeof l.response === 'string' ? l.response.toLowerCase() : JSON.stringify(l.response || {}).toLowerCase();
        const errText = String(l.error || '').toLowerCase();
        return reqText.includes(kw) || resText.includes(kw) || errText.includes(kw)
          || (l.configName || '').toLowerCase().includes(kw);
      });
    }
  }

  // 排序（默认时间倒序）
  const sortKey = ['time', 'latencyMs', 'totalTokens'].includes(sort) ? sort : 'time';
  const asc = dir === 'asc';
  logs = logs.slice().sort((a, b) => {
    let va;
    let vb;
    if (sortKey === 'time') { va = Date.parse(a.time) || 0; vb = Date.parse(b.time) || 0; }
    else { va = Number(a[sortKey]) || 0; vb = Number(b[sortKey]) || 0; }
    return asc ? va - vb : vb - va;
  });

  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return {
    total: logs.length,
    limit,
    offset,
    items: logs.slice(offset, offset + limit)
  };
}

function get(id, viewer = null) {
  const log = db.load().logs.find((l) => l.id === id) || null;
  if (!log) return null;
  // 角色范围外 → 视同不存在（不泄露存在性）
  if (viewer && (viewer.role === 'member' || viewer.role === 'viewer')) {
    if (!log.actorId || log.actorId !== viewer.id) return null;
  }
  return log;
}

function count(viewer = null) {
  return scope(db.load().logs, viewer).length;
}

function clear() {
  db.load().logs = [];
  db.save();
  return { cleared: true };
}

/**
 * 数据概览指标（P2）：今日请求数 / 成功率 / token 消耗 / 平均耗时 / 活跃成员 / 失败数
 * @param {object|null} viewer member/viewer 只统计自己的
 * @param {{days?:number}} opts 统计窗口（默认今天）
 */
function overview(viewer = null, opts = {}) {
  const days = Math.min(Math.max(parseInt(opts.days, 10) || 1, 1), 90);
  const from = todayStart() - (days - 1) * 86400 * 1000;
  const logs = scope(db.load().logs, viewer).filter((l) => (Date.parse(l.time) || 0) >= from);

  const total = logs.length;
  const okCount = logs.filter((l) => l.status === 'ok').length;
  const tokens = logs.reduce((s, l) => s + (Number(l.totalTokens) || 0), 0);
  const latencySum = logs.reduce((s, l) => s + (Number(l.latencyMs) || 0), 0);
  const actors = new Set(logs.map((l) => l.actorId).filter(Boolean));

  return {
    days,
    totalRequests: total,
    okRequests: okCount,
    errorRequests: total - okCount,
    successRate: total ? Math.round((okCount / total) * 1000) / 10 : null,
    totalTokens: tokens,
    avgLatencyMs: total ? Math.round(latencySum / total) : null,
    activeActors: actors.size,
    firstAt: total ? logs.reduce((min, l) => (!min || l.time < min ? l.time : min), '') : null,
    lastAt: total ? logs.reduce((max, l) => (l.time > max ? l.time : max), '') : null
  };
}

module.exports = { buildId, add, list, get, clear, count, overview, scope, MAX_LOGS };
