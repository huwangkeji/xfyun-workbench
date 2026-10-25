'use strict';

const fs = require('fs');
const path = require('path');

// 数据目录：默认项目下 data/；可用 XFYUN_DATA_DIR 覆盖（测试隔离 / 自定义部署位置）
const DATA_DIR = process.env.XFYUN_DATA_DIR
  ? path.resolve(process.env.XFYUN_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  configs: [],
  logs: [],
  conversations: [],
  // —— 团队账号体系（P0 新增，P1 起由后台「成员管理」维护）——
  users: [],        // 员工账号：{ id, username, displayName, role, passwordHash, status, ... }
  auditLogs: [],    // 操作留痕（P1 启用，环形缓冲保留最近若干条）
  // —— 对话分享（快照 + token）：{ id, token, convId, title, createdAt, expiresAt, createdBy, snapshot } ——
  shares: [],
  settings: {
    autoSwitch: true,
    cooldownSec: 30
  }
};

let cache = null;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    // 初始化也走原子写，避免首启中断留下半截文件
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
  }
}

function load() {
  if (cache) return cache;
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    cache = { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch (e) {
    cache = { ...DEFAULT_DB };
  }
  if (!Array.isArray(cache.configs)) cache.configs = [];
  if (!Array.isArray(cache.logs)) cache.logs = [];
  if (!Array.isArray(cache.conversations)) cache.conversations = [];
  if (!Array.isArray(cache.users)) cache.users = [];
  if (!Array.isArray(cache.auditLogs)) cache.auditLogs = [];
  if (!Array.isArray(cache.shares)) cache.shares = [];
  return cache;
}

/**
 * 持久化：原子写（先写 .tmp 再 rename）。
 * 规避进程在写盘中途被杀导致 db.json 损坏/丢半截的问题；
 * rename 在同目录内是原子操作（Windows/POSIX 均覆盖目标）。
 */
function save() {
  ensureFile();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function getNextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { load, save, getNextId, DB_FILE, DATA_DIR };