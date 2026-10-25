'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  configs: [],
  logs: [],
  conversations: [],
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
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
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
  return cache;
}

function save() {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

function getNextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { load, save, getNextId, DB_FILE, DATA_DIR };