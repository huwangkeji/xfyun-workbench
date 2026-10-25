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

function list(query = {}) {
  let logs = db.load().logs;
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const status = query.status; // 可按状态过滤 ok / error
  if (status) logs = logs.filter((l) => l.status === status);
  return {
    total: logs.length,
    limit,
    offset,
    items: logs.slice(offset, offset + limit)
  };
}

function get(id) {
  return db.load().logs.find((l) => l.id === id) || null;
}

function clear() {
  db.load().logs = [];
  db.save();
  return { cleared: true };
}

module.exports = { buildId, add, list, get, clear };