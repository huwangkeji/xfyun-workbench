'use strict';

const express = require('express');
const configService = require('../configService');
const xfyun = require('../xfyun');
const logService = require('../logService');
const auditService = require('../auditService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

// 配置 Token 可用性测试：对指定配置发最小对话请求
// 验证 API Key / model 是否可用，返回耗时与 token 用量，并记录一条日志
router.post('/:id/test', asyncHandler(async (req, res) => {
  const cfg = configService.getFull(req.params.id);
  if (!cfg) return res.status(404).json({ ok: false, error: '配置不存在' });
  auditService.log(req.user, auditService.ACTIONS.CONFIG_TEST, `config:${cfg.name}`, cfg.model, auditService.ipOf(req));

  const startedAt = Date.now();
  const result = await xfyun.chatCompletions(
    cfg,
    [{ role: 'user', content: 'ping' }],
    { temperature: 0, stream: false }
  );

  const entry = {
    id: logService.buildId(),
    time: new Date().toISOString(),
    actorId: req.user ? req.user.id : null,
    actorName: req.user ? req.user.displayName : '',
    configId: cfg.id,
    configName: cfg.name,
    model: cfg.model,
    status: result.ok ? 'ok' : 'error',
    latencyMs: result.latencyMs || Date.now() - startedAt,
    type: 'test',
    request: { messages: [{ role: 'user', content: 'ping' }], purpose: 'Token可用性测试' }
  };

  if (result.ok) {
    const parsed = xfyun.extractResult(result.data);
    entry.response = parsed;
    entry.promptTokens = parsed.usage.prompt_tokens;
    entry.completionTokens = parsed.usage.completion_tokens;
    entry.totalTokens = parsed.usage.total_tokens;
    logService.add(entry);
    return res.json({
      ok: true,
      test: 'success',
      latencyMs: entry.latencyMs,
      reply: parsed.content,
      usage: parsed.usage,
      model_id: parsed.model_id,
      config: { id: cfg.id, name: cfg.name, model: cfg.model }
    });
  }

  entry.error = result.error;
  entry.httpStatus = result.status;
  logService.add(entry);
  res.status(502).json({
    ok: false,
    test: 'failed',
    latencyMs: entry.latencyMs,
    error: result.error,
    httpStatus: result.status
  });
}));

// 全局调度设置
// 需放在 /:id 系列路由之前，避免被当作配置 id 匹配
router.get('/settings', (req, res) => {
  res.json({ ok: true, data: configService.getSettings() });
});

router.put('/settings', (req, res) => {
  const before = configService.getSettings();
  const result = configService.updateSettings(req.body || {});
  if (result.ok) {
    const changes = [];
    if (before.autoSwitch !== result.data.autoSwitch) changes.push(`自动切换 ${result.data.autoSwitch ? '开' : '关'}`);
    if (before.cooldownSec !== result.data.cooldownSec) changes.push(`冷却 ${before.cooldownSec}s → ${result.data.cooldownSec}s`);
    if (before.workbenchAuthEnabled !== result.data.workbenchAuthEnabled) changes.push(`访客密码保护 ${result.data.workbenchAuthEnabled ? '开' : '关'}`);
    if (result.data.allowSelfRegister !== undefined && before.allowSelfRegister !== result.data.allowSelfRegister) changes.push(`开放注册 ${result.data.allowSelfRegister ? '开' : '关'}`);
    auditService.log(req.user, auditService.ACTIONS.CONFIG_SETTINGS, 'settings', changes.join('；') || '无变化', auditService.ipOf(req));
  }
  res.json(result);
});

// 配置列表（apiKey 脱敏）
router.get('/', (req, res) => {
  res.json({ ok: true, data: configService.list() });
});

// 新增配置
router.post('/', (req, res) => {
  const result = configService.create(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ ok: false, errors: result.errors });
  }
  auditService.log(req.user, auditService.ACTIONS.CONFIG_CREATE, `config:${result.data.name}`, result.data.model, auditService.ipOf(req));
  res.status(201).json({ ok: true, data: result.data });
});

// 单个配置
router.get('/:id', (req, res) => {
  const cfg = configService.get(req.params.id);
  if (!cfg) return res.status(404).json({ ok: false, error: '配置不存在' });
  res.json({ ok: true, data: cfg });
});

// 环境变量配置（.env 合成）在后台只读，改它要改环境变量
function envManagedGuard(result, res) {
  if (result && result.envManaged) {
    res.status(400).json({ ok: false, error: '该配置来自环境变量（.env / XFYUN_API_KEY），请修改环境变量并重启服务，后台不可编辑' });
    return true;
  }
  return false;
}

// 编辑配置
router.put('/:id', (req, res) => {
  const result = configService.update(req.params.id, req.body || {});
  if (envManagedGuard(result, res)) return;
  if (result.notFound) return res.status(404).json({ ok: false, error: '配置不存在' });
  if (!result.ok) return res.status(400).json({ ok: false, errors: result.errors });
  auditService.log(req.user, auditService.ACTIONS.CONFIG_UPDATE, `config:${result.data.name}`, result.data.model, auditService.ipOf(req));
  res.json({ ok: true, data: result.data });
});

// 删除配置
router.delete('/:id', (req, res) => {
  const before = configService.get(req.params.id);
  const result = configService.remove(req.params.id);
  if (envManagedGuard(result, res)) return;
  if (result.notFound) return res.status(404).json({ ok: false, error: '配置不存在' });
  auditService.log(req.user, auditService.ACTIONS.CONFIG_DELETE, `config:${before ? before.name : req.params.id}`, before ? before.model : '', auditService.ipOf(req));
  res.json({ ok: true });
});

// 设为激活配置
router.post('/:id/activate', (req, res) => {
  const result = configService.activate(req.params.id);
  if (envManagedGuard(result, res)) return;
  if (result.notFound) return res.status(404).json({ ok: false, error: '配置不存在' });
  auditService.log(req.user, auditService.ACTIONS.CONFIG_ACTIVATE, `config:${result.data.name}`, result.data.model, auditService.ipOf(req));
  res.json({ ok: true, data: result.data });
});

module.exports = router;