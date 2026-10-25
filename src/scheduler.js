'use strict';

/**
 * 多 API 调度器
 * 按「默认配置优先 → 启用且未冷却 → priority 升序」逐个尝试调用；
 * 当前配置 token 耗尽 / 长时间失败 / 限流等返回失败时，自动冷却并切换到下一个可用配置。
 */

const xfyun = require('./xfyun');
const configService = require('./configService');

// 内存熔断/冷却状态：configId -> { failCount, until(ms) }
const cooldown = new Map();

function isCooling(id, cooldownSec) {
  const rec = cooldown.get(id);
  if (!rec) return false;
  if (rec.until <= Date.now()) {
    cooldown.delete(id);
    return false;
  }
  return true;
}

function markSuccess(id) {
  cooldown.delete(id);
}

function markFail(id, cooldownSec) {
  const rec = cooldown.get(id) || { failCount: 0, until: 0 };
  rec.failCount += 1;
  rec.until = Date.now() + cooldownSec * 1000;
  cooldown.set(id, rec);
}

// 冷却中的配置是否强制参与（仅有冷却配置可用时的兜底）
function sortFn(a, b) {
  if (!!a.active !== !!b.active) return a.active ? -1 : 1; // 默认配置优先
  const pa = a.priority == null ? 100 : a.priority;
  const pb = b.priority == null ? 100 : b.priority;
  if (pa !== pb) return pa - pb;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

// 生成本次请求的候选顺序：未冷却（按优先级）+ 冷却中（按优先级，兜底）
function pickOrder() {
  const list = configService.listForScheduling();
  const cooldownSec = configService.getSettings().cooldownSec;
  const candidates = list.filter((c) => c.enabled !== false);
  const fresh = candidates.filter((c) => !isCooling(c.id, cooldownSec)).sort(sortFn);
  const cooling = candidates.filter((c) => isCooling(c.id, cooldownSec)).sort(sortFn);
  return fresh.concat(cooling);
}

/**
 * 带自动切换的对话调用
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} extra xfyun.chatCompletions 的参数覆盖
 * @returns {Promise<{ok:boolean, result?:object, usedConfig?:object, error?:string, attempts:Array, errors:Array}>}
 */
async function attemptChat(messages, extra) {
  const settings = configService.getSettings();
  const cooldownSec = settings.cooldownSec;
  const order = pickOrder();

  const attempts = [];
  const errors = [];
  let last = null;

  if (!order.length) {
    return { ok: false, error: '未启用任何可用 API 配置，请先在「后台管理 → API 配置」中添加', attempts, errors };
  }

  for (const cfg of order) {
    const result = await xfyun.chatCompletions(cfg, messages, extra);
    attempts.push({ id: cfg.id, name: cfg.name, model: cfg.model, ok: result.ok, status: result.status });

    if (result.ok) {
      markSuccess(cfg.id);
      return { ok: true, result, usedConfig: cfg, attempts, errors };
    }

    last = result;
    errors.push({ id: cfg.id, name: cfg.name, model: cfg.model, error: result.error, status: result.status });
    // 自动切换：失败则冷却，尝试下一个
    if (settings.autoSwitch) {
      markFail(cfg.id, cooldownSec);
      continue;
    }
    break; // 关闭自动切换则失败即停
  }

  return {
    ok: false,
    error: last && last.error,
    errorStatus: last && last.status,
    isAuth: last && last.isAuth,
    usedConfig: null,
    attempts,
    errors
  };
}

module.exports = { attemptChat, pickOrder, markSuccess, markFail };