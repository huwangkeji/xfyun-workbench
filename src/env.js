'use strict';

/**
 * 零依赖环境变量读取模块。
 *
 * 安全约定（对应讯飞 MaaS 文档「API Key：点击 API调用 / APIKEY管理 获取」）：
 *   API Key 等敏感信息一律通过本模块从「进程环境变量」或「项目根目录 .env 文件」读取，
 *   禁止在代码中硬编码；.env 已加入 .gitignore，不会随仓库分发。
 *
 * 读取优先级：进程环境变量 > .env 文件 > 调用方传入的默认值。
 * .env 中已存在的同名进程环境变量不会被覆盖（方便用系统环境变量临时覆盖）。
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function loadEnvFile(file = ENV_FILE) {
  if (!fs.existsSync(file)) return;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (_) {
    return; // 读不到就静默跳过，不影响进程环境变量方式
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue; // 注释/空行
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去掉成对引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// 模块加载时即读取 .env，保证后续 require 本模块的地方都能拿到
loadEnvFile();

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

module.exports = { loadEnvFile, getEnv, ENV_FILE };
