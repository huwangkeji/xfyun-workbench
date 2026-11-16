'use strict';

const express = require('express');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const asyncHandler = require('../asyncHandler');
const systemService = require('../systemService');
const auditService = require('../auditService');

const router = express.Router();

/**
 * 系统信息与运维（/api/admin/system-info，owner/admin）：
 *   GET  /                 运行环境 / 资源占用 / 业务规模 / Token 统计（页面一次请求渲染）
 *   GET  /modules          模块功能状态（状态 + 详情）
 *   POST /diagnose         系统体检（只读，不改数据）
 *   POST /repair           一键修复（幂等安全修复：补目录 / 重算计数 / 清理无引用 / 修剪日志）
 *   POST /tokens/clear     清零 Token 统计（只重置基准时间，不删日志）
 *   GET  /port             当前监听端口 + .env 中的 PORT
 *   POST /port/check       端口可用性探测
 *   POST /port             写入 .env 并自动重启服务
 */

function currentPort(req) {
  const p = req.socket && req.socket.localPort;
  return Number(p) || Number(process.env.PORT) || 4000;
}

router.get('/', asyncHandler(async (req, res) => {
  const snap = systemService.snapshot(currentPort(req));
  snap.modules = systemService.modules(snap);
  res.json({ ok: true, data: snap });
}));

router.get('/modules', asyncHandler(async (req, res) => {
  const snap = systemService.snapshot(currentPort(req));
  res.json({ ok: true, data: systemService.modules(snap) });
}));

router.post('/diagnose', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: systemService.diagnose() });
}));

router.post('/repair', asyncHandler(async (req, res) => {
  const r = systemService.repair();
  auditService.log(
    req.user,
    auditService.ACTIONS.SYSTEM_REPAIR,
    'system:repair',
    r.changedTotal ? `修复 ${r.changedTotal} 处：${r.fixed.map((f) => f.title).join('、')}` : '未发现需要修复的问题',
    auditService.ipOf(req)
  );
  res.json({ ok: true, data: r });
}));

router.post('/tokens/clear', asyncHandler(async (req, res) => {
  const r = systemService.clearTokenStats();
  auditService.log(
    req.user,
    auditService.ACTIONS.SYSTEM_TOKEN_CLEAR,
    'system:tokens',
    `统计基准重置为 ${r.since.slice(0, 19).replace('T', ' ')}（运行日志保留）`,
    auditService.ipOf(req)
  );
  res.json({ ok: true, data: { since: r.since, tokens: systemService.snapshot(currentPort(req)).tokens } });
}));

router.get('/port', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: {
      port: currentPort(req),
      envPort: systemService.getEnvPort(),
      host: os.hostname(),
      envFile: '.env',
      node: process.version
    }
  });
}));

router.post('/port/check', asyncHandler(async (req, res) => {
  const v = systemService.validatePort((req.body || {}).port);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const r = await systemService.checkPortAvailable(v.port);
  const isCurrent = v.port === currentPort(req);
  res.json({
    ok: true,
    data: {
      port: v.port,
      available: isCurrent ? false : r.available,
      isCurrent,
      reason: isCurrent ? '该端口正是当前服务使用的端口' : r.reason
    }
  });
}));

/** 响应落地后再重启：先关监听（释放端口），再以新 PORT 拉起子进程 */
function restartWithPort(req, port) {
  const socketServer = req.socket && req.socket.server;
  const root = path.join(__dirname, '..', '..');
  const entry = path.join(root, 'server.js');
  process.env.PORT = String(port);
  let started = false;
  const launch = () => {
    if (started) return;
    started = true;
    try {
      const child = spawn(process.execPath, [entry], {
        cwd: root,
        env: { ...process.env, PORT: String(port) },
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (e) {
      console.error('[system] 重启失败：', e.message);
    }
    setTimeout(() => process.exit(0), 300);
  };
  setTimeout(() => {
    if (socketServer && typeof socketServer.close === 'function') {
      try { if (socketServer.closeAllConnections) socketServer.closeAllConnections(); } catch (_) { /* 忽略 */ }
      socketServer.close(() => launch());
      setTimeout(launch, 3000); // close 回调兜底
    } else {
      launch();
    }
  }, 700);
}

router.post('/port', asyncHandler(async (req, res) => {
  const v = systemService.validatePort((req.body || {}).port);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  const from = currentPort(req);
  if (v.port === from && systemService.getEnvPort() === v.port) {
    return res.status(400).json({ ok: false, error: '新端口与当前端口相同，无需重启' });
  }
  // 选的就是当前监听端口（.env 里记的是别的值）：只补写 .env，无需重启
  if (v.port === from) {
    systemService.writeEnvPort(v.port);
    return res.json({ ok: true, data: { from, port: v.port, restarting: false, url: '' } });
  }
  const probe = await systemService.checkPortAvailable(v.port);
  if (!probe.available) {
    return res.status(400).json({ ok: false, error: `端口 ${v.port} 不可用：${probe.reason}` });
  }
  systemService.writeEnvPort(v.port);
  auditService.log(
    req.user,
    auditService.ACTIONS.SYSTEM_PORT,
    `system:port:${v.port}`,
    `${from} → ${v.port}（写入 .env 并重启）`,
    auditService.ipOf(req)
  );
  res.json({
    ok: true,
    data: { from, port: v.port, restarting: true, url: `http://${req.hostname || '127.0.0.1'}:${v.port}` }
  });
  restartWithPort(req, v.port);
}));

module.exports = router;
