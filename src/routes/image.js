'use strict';

const express = require('express');
const xfyun = require('../xfyun');
const configService = require('../configService');
const logService = require('../logService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

// 获取当前生效的配置（显式指定 configId 优先，否则用激活配置）
function resolveConfig(configId) {
  if (configId) return configService.getFull(configId);
  return configService.getActive();
}

/**
 * 图片生成（Text-to-Image）：POST /api/image/tti
 * body: { configId?, prompt, negativePrompt?, width?, height?, seed?, steps?, guidance?, scheduler? }
 * 未传的可选项均落入配置默认值；返回 base64 图片（不带 data: URI 前缀）。
 */
router.post('/tti', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const cfg = resolveConfig(body.configId);

  if (!cfg) {
    return res.status(400).json({
      ok: false,
      error: '尚未配置任何 API，请先在「后台管理 → API 配置」中添加'
    });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ ok: false, error: '请填写图片生成指令 prompt' });
  }
  if (prompt.length > 1024) {
    return res.status(400).json({ ok: false, error: 'prompt 不得超过 1024 个字符' });
  }
  if (!cfg.ttiModel && !cfg.model) {
    return res.status(400).json({ ok: false, error: '未配置图片模型（ttiModel / model）' });
  }

  const negativePrompt = typeof body.negativePrompt === 'string' ? body.negativePrompt.trim() : '';
  if (negativePrompt.length > 1024) {
    return res.status(400).json({ ok: false, error: 'negativePrompt 不得超过 1024 个字符' });
  }

  const params = {
    prompt,
    negativePrompt,
    width: body.width,
    height: body.height,
    seed: body.seed,
    steps: body.steps,
    guidance: body.guidance,
    scheduler: body.scheduler,
    uid: body.uid,
    patchId: body.patchId
  };

  const result = await xfyun.tti(cfg, params);

  // 记录日志
  const entry = {
    id: logService.buildId(),
    time: new Date().toISOString(),
    configId: cfg.id,
    configName: cfg.name,
    model: cfg.ttiModel || cfg.model,
    type: 'tti',
    status: result.ok ? 'ok' : 'error',
    latencyMs: result.latencyMs || 0,
    request: {
      purpose: '图片生成',
      prompt,
      negativePrompt,
      params: {
        width: body.width ?? cfg.ttiWidth ?? 512,
        height: body.height ?? cfg.ttiHeight ?? 512,
        seed: body.seed ?? cfg.ttiSeed ?? 0,
        steps: body.steps ?? cfg.numInferenceSteps ?? 20,
        guidance: body.guidance ?? cfg.guidanceScale ?? 5,
        scheduler: body.scheduler || cfg.scheduler || 'DPM++ 2M Karras'
      }
    }
  };
  logService.add(entry);

  if (!result.ok) {
    entry.error = result.error;
    entry.httpStatus = result.status;
    logService.add(entry);
    if (result.isAuth) {
      return res.status(502).json({
        ok: false,
        error: `配置「${cfg.name}」的图片生成鉴权失败：${result.error}`,
        latencyMs: entry.latencyMs
      });
    }
    return res.status(502).json({ ok: false, error: result.error, latencyMs: entry.latencyMs });
  }

  return res.json({
    ok: true,
    latencyMs: entry.latencyMs,
    image: `data:image/png;base64,${result.base64 || ''}`,
    size: result.base64 ? result.base64.length : 0,
    config: { id: cfg.id, name: cfg.name, model: cfg.ttiModel || cfg.model }
  });
}));

module.exports = router;