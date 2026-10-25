'use strict';

const express = require('express');
const configService = require('../configService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

const PING_TIMEOUT_MS = 8000;

/**
 * 对云中心 baseUrl 发起一次轻量探测，测量网络往返延时（ms）。
 * 只测网络连通性，不校验鉴权：即使返回 4xx/401 也算"可达"。
 * @returns {{reachable:boolean, latencyMs:number, httpStatus:number, reason:string}}
 */
async function probe(baseUrl, timeoutMs = PING_TIMEOUT_MS) {
  const url = `${baseUrl}/v2/chat/completions`;
  const startedAt = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: '__connectivity_probe__' }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow'
    });
    return {
      reachable: true,
      latencyMs: Date.now() - startedAt,
      httpStatus: resp.status,
      reason: ''
    };
  } catch (e) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      httpStatus: 0,
      reason: classifyNetworkError(e)
    };
  }
}

function classifyNetworkError(e) {
  const msg = (e && e.message) || String(e);
  if (/timed? ?out/i.test(msg)) return '连接超时（timeout）';
  if (/ECONNREFUSED/i.test(msg)) return '连接被拒绝（ECONNREFUSED）';
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return 'DNS 解析失败/域名不可达';
  if (/certificate|SSL|TLS/i.test(msg)) return 'TLS/证书错误';
  if (/fetch failed|ECONNRESET|socket/i.test(msg)) return '网络连接失败';
  return (msg || '未知网络错误').slice(0, 80);
}

// 单配置探测：GET /api/network/ping?configId=<id> ；缺省用激活配置
router.get('/ping', asyncHandler(async (req, res) => {
  const id = req.query.configId;
  const cfg = id ? configService.getFull(id) : configService.getActive();
  if (!cfg) {
    return res.status(400).json({ ok: false, error: '未找到可探测的配置，请先在「API 配置」中添加' });
  }
  const r = await probe(cfg.baseUrl);
  res.json({
    ok: true,
    data: {
      configId: cfg.id,
      name: cfg.name,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      reachable: r.reachable,
      latencyMs: r.latencyMs,
      httpStatus: r.httpStatus,
      reason: r.reason,
      probedAt: new Date().toISOString()
    }
  });
}));

// 全配置自动探测：GET /api/network/ping-all
router.get('/ping-all', asyncHandler(async (req, res) => {
  const list = configService.list();
  if (!list.length) {
    return res.json({ ok: true, data: [], message: '暂无配置' });
  }
  const results = await Promise.all(
    list.map(async (c) => {
      const r = await probe(c.baseUrl);
      return {
        configId: c._id,
        name: c.name,
        model: c.model,
        baseUrl: c.baseUrl,
        active: !!c.active,
        reachable: r.reachable,
        latencyMs: r.latencyMs,
        httpStatus: r.httpStatus,
        reason: r.reason,
        probedAt: new Date().toISOString()
      };
    })
  );
  res.json({ ok: true, data: results });
}));

module.exports = router;