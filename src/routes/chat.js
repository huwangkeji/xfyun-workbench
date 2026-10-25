'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const xfyun = require('../xfyun');
const configService = require('../configService');
const scheduler = require('../scheduler');
const logService = require('../logService');
const imageUtil = require('../imageUtil');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

/** 粘贴上传图片的落盘根目录（与 src/routes/upload.js 一致） */
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

/**
 * 把消息中的 /uploads/ 图片 URL 换成 base64 data URI 后再发给上游。
 * 上游（星火 MaaS）无法访问我们本机的 localhost 地址，实测外部 http URL 直接 400(code=10005)，
 * 因此历史消息里存 URL（db.json 不膨胀），发请求时按需内联。
 * @returns {{messages:Array, inlinedCount:number}}
 */
function inlineUploadImages(messages) {
  let inlinedCount = 0;
  const out = (messages || []).map((m) => {
    if (!m || !Array.isArray(m.content)) return m;
    const parts = [];
    for (const part of m.content) {
      const url = part && part.type === 'image_url' && part.image_url && typeof part.image_url.url === 'string'
        ? part.image_url.url
        : null;
      if (url && url.startsWith('/uploads/')) {
        const rel = url.replace(/^\/uploads\//, '');
        const file = path.normalize(path.join(UPLOAD_ROOT, rel));
        // 防目录穿越：解析后必须仍在 UPLOAD_ROOT 内
        if (file.startsWith(UPLOAD_ROOT + path.sep)) {
          try {
            const buf = fs.readFileSync(file);
            const ext = path.extname(file).slice(1).toLowerCase();
            const mime = imageUtil.EXT_MIME[ext];
            if (mime) {
              parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } });
              inlinedCount++;
              continue;
            }
          } catch (_) { /* 文件丢失：跳过该图，其余部分照常发送 */ }
        }
        continue; // 非法路径/读取失败/未知扩展名：丢弃该图片部分
      }
      if (part) parts.push(part);
    }
    return parts.length ? { ...m, content: parts } : { ...m, content: [] };
  });
  return { messages: out, inlinedCount };
}

/** 日志脱敏：data URI 图片替换为占位摘要，避免日志体积爆炸 */
function redactForLog(messages) {
  return (messages || []).map((m) => {
    if (!m || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) => {
        if (p && p.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:')) {
          return { type: 'image_url', image_url: { url: `[图片 base64 约 ${Math.round(p.image_url.url.length * 0.75 / 1024)}KB]` } };
        }
        return p;
      })
    };
  });
}

// 请求体校验：messages 至少 1 条
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'messages 必须是非空数组';
  for (const m of messages) {
    if (!m || typeof m.role !== 'string' || !m.content) {
      return '每条消息必须包含 role 和 content';
    }
  }
  return null;
}

// 按配置注入系统提示（已有 system 消息则不重复注入）
// customSystemPrompt：前台「系统提示」输入框的值（字符串）——显式提供时覆盖配置默认；
//   空串表示用户清空（不注入）；undefined 表示前台未传，回退配置值。
function withSystemPrompt(messages, cfg, customSystemPrompt) {
  const list = messages.slice();
  if (list.some((m) => m.role === 'system')) return list;
  const sp = customSystemPrompt !== undefined && customSystemPrompt !== null
    ? String(customSystemPrompt)
    : (cfg && cfg.systemPrompt);
  if (sp) list.unshift({ role: 'system', content: sp });
  return list;
}

/**
 * 对话代理：POST /api/chat
 * body: { configId?, messages, temperature?, topP?, maxTokens?, stream? }
 *   - stream=true 时以 SSE（text/event-stream）原样转发上游，data: {chunk} … data: [DONE]；
 *     仅「显式指定 configId」时支持（调度器 failover 与流式语义互斥）。
 */
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  // 操作者身份（P2：日志按角色可见；未登录访客为 null，仅管理员可见其记录）
  const actor = req.user || null;
  // 权限矩阵：viewer 为只读角色，不开放对话（工作台界面也会禁用发送）
  if (actor && actor.role === 'viewer') {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: '只读成员（viewer）不能发起对话，如需使用请联系管理员调整角色' });
  }
  const msgErr = validateMessages(body.messages);
  if (msgErr) {
    return res.status(400).json({ ok: false, error: msgErr });
  }

  // 组装请求参数（工作台可覆盖配置默认值）
  const extra = {
    temperature: body.temperature,
    top_p: body.topP,
    max_completion_tokens: body.maxTokens,
    // 前台参数工具栏：深度思考开关 / 思考强度（显式 boolean 与字符串优先，未传回退配置）
    enable_thinking: typeof body.enableThinking === 'boolean' ? body.enableThinking : undefined,
    reasoning_effort: body.reasoningEffort === 'high' || body.reasoningEffort === 'max' ? body.reasoningEffort : undefined,
    // 联网搜索：前端开关按次显式传入 boolean；未传（undefined）时回退配置默认值
    webSearch: typeof body.webSearch === 'boolean' ? body.webSearch : undefined,
    // stream 只由请求体显式开启：配置里的 stream 字段不参与决定，
    // 避免后台误开流式后浏览器 UI（不消费 SSE）拿到 event-stream 而无法解析。
    stream: false
  };
  // 前台「系统提示」输入框：字符串则覆盖配置默认（空串=不注入），undefined 则用配置值
  const customSystemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined;

  // 系统提示注入由各配置的 systemPrompt 决定；为统一处理，先取原始消息
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice() : [];

  // 图片内联：消息里的 /uploads/ 图片 URL 转 base64 data URI 后再发给上游
  // （上游无法访问本机 localhost；db.json 里仍存 URL，避免历史记录体积膨胀）
  const { messages: upstreamMessages, inlinedCount } = inlineUploadImages(rawMessages);

  // 判定期望的候选配置（供日志/调度使用）
  const explicitCfg = body.configId ? configService.getFull(body.configId) : null;
  const wantStream = body.stream === true;

  /* ---------- 流式（SSE）分支：仅显式配置 ---------- */
  if (explicitCfg && wantStream) {
    const messages = withSystemPrompt(upstreamMessages, explicitCfg, customSystemPrompt);
    const streamResult = await xfyun.chatCompletionsStream(explicitCfg, messages, { ...extra, stream: true });

    const streamEntry = {
      id: logService.buildId(),
      time: new Date().toISOString(),
      actorId: actor ? actor.id : null,
      actorName: actor ? actor.displayName : '',
      configId: explicitCfg.id,
      configName: explicitCfg.name,
      model: explicitCfg.model,
      status: 'ok',
      stream: true,
      latencyMs: streamResult.latencyMs || 0,
      request: {
        messages,
        temperature: extra.temperature ?? explicitCfg.temperature ?? null,
        topP: extra.top_p ?? explicitCfg.topP ?? null,
        maxTokens: extra.max_completion_tokens ?? explicitCfg.maxTokens ?? null,
        systemPrompt: explicitCfg.systemPrompt || '',
        webSearch: !!explicitCfg.webSearch
      }
    };

    if (!streamResult.ok) {
      streamEntry.status = 'error';
      streamEntry.error = streamResult.error;
      streamEntry.httpStatus = streamResult.status;
      logService.add(streamEntry);
      return res.status(502).json({
        ok: false,
        error: `配置「${explicitCfg.name}」(${explicitCfg.model}) 流式请求失败：${streamResult.error}`,
        latencyMs: streamEntry.latencyMs
      });
    }

    // 官方 SSE 格式：每个 chunk 为 `data: {json}\n\n`，以 `data: [DONE]` 结束；原样透传不解析
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=UTF-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no' // 声明关闭代理缓冲，保证 chunk 实时到达客户端
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const upstream = streamResult.data; // fetch Response，body 为 web ReadableStream
    Readable.fromWeb(upstream.body).pipe(res);
    // 客户端断开时取消上游请求，避免连接泄漏
    res.on('close', () => {
      try { upstream.body.cancel(); } catch (_) { /* 已结束则忽略 */ }
    });

    // 流式的 usage 在末尾 chunk 才返回，此处只记流水（配置/耗时），token 统计从略
    logService.add(streamEntry);
    return;
  }

  let callResult;
  let usedCfg = explicitCfg;

  if (explicitCfg) {
    // 显式指定配置：直接使用该配置（不走调度器）
    const messages = withSystemPrompt(upstreamMessages, explicitCfg, customSystemPrompt);
    callResult = await xfyun.chatCompletions(explicitCfg, messages, extra);
    callResult.usedConfig = explicitCfg;
    callResult.attempts = [{ id: explicitCfg.id, name: explicitCfg.name, model: explicitCfg.model, ok: callResult.ok, status: callResult.status }];
  } else {
    // 未指定：走调度器自动切换（当前配置 token 耗尽等失败时自动换下一个）
    // 注意：调度路径恒为非流式（failover 与 SSE 语义互斥），wantStream 在此被忽略
    // 系统提示用前台覆盖值，否则用当前激活配置的值
    const schedMessages = withSystemPrompt(upstreamMessages, configService.getActive(), customSystemPrompt);
    callResult = await scheduler.attemptChat(schedMessages, extra);
    usedCfg = callResult.usedConfig || null;
    // 记录日志需要的配置对象：优先用实际生效的，否则用第一个启用配置
    if (!usedCfg) {
      const first = configService.list().find((c) => c.enabled !== false);
      usedCfg = first
        ? { id: first._id, name: first.name, model: first.model }
        : { id: '', name: '', model: '' };
    }
  }

  const ok = callResult.ok;
  // 结果体归一化：调度器路径返回 {ok, result, ...}（result 即 xfyun 返回体）；
  // 显式配置路径 callResult 本身就是 xfyun.chatCompletions 的返回体 {ok, status, data, latencyMs, ...}，
  // 没有 .result 字段，早年直接取 callResult.result 会恒为 null，成功路径 extractResult(result.data) 必崩。
  const result = callResult.result || (callResult.status !== undefined ? callResult : null);
  const cfg = usedCfg;

  // 注入系统提示到日志/最终消息（用于展示）；日志用脱敏版（base64 图片换成摘要）
  let messages = redactForLog(upstreamMessages);
  if (cfg && cfg.systemPrompt && !messages.some((m) => m.role === 'system')) {
    // 调度路径的场景：上面已按激活配置注入，这里仅补齐展示
    messages.unshift({ role: 'system', content: cfg.systemPrompt });
  } else if (customSystemPrompt && !messages.some((m) => m.role === 'system')) {
    messages.unshift({ role: 'system', content: customSystemPrompt });
  }
  // 本次请求实际生效的参数（前端显式值优先，否则取配置默认）
  const effectiveWebSearch = extra.webSearch !== undefined ? extra.webSearch : !!(cfg && cfg.webSearch);
  const effectiveThinking = extra.enable_thinking !== undefined ? extra.enable_thinking : !!(cfg && cfg.enableThinking);
  const effectiveEffort = extra.reasoning_effort || (cfg && cfg.reasoningEffort) || null;

  // 记录日志
  const entry = {
    id: logService.buildId(),
    time: new Date().toISOString(),
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.displayName : '',
    configId: cfg ? cfg.id : null,
    configName: cfg ? cfg.name : '',
    model: cfg ? cfg.model : '',
    status: ok ? 'ok' : 'error',
    latencyMs: result ? (result.latencyMs || 0) : (callResult.attempts && callResult.attempts[0] ? callResult.attempts[0].latencyMs : 0),
    request: {
      messages,
      temperature: extra.temperature ?? (cfg && cfg.temperature) ?? null,
      topP: extra.top_p ?? (cfg && cfg.topP) ?? null,
      maxTokens: extra.max_completion_tokens ?? (cfg && cfg.maxTokens) ?? null,
      presencePenalty: (cfg && cfg.presencePenalty) ?? 0,
      frequencyPenalty: (cfg && cfg.frequencyPenalty) ?? 0,
      systemPrompt: (cfg && cfg.systemPrompt) || '',
      webSearch: effectiveWebSearch,
      enableThinking: effectiveThinking,
      reasoningEffort: effectiveEffort,
      imagesInlined: inlinedCount
    }
  };
  if (callResult.attempts && callResult.attempts.length > 1) {
    entry.request.autoSwitchAttempts = callResult.attempts.map((a) => ({ name: a.name, ok: a.ok, status: a.status }));
  }

  if (ok) {
    const parsed = xfyun.extractResult(result.data);
    entry.response = parsed;
    entry.promptTokens = parsed.usage.prompt_tokens;
    entry.completionTokens = parsed.usage.completion_tokens;
    entry.totalTokens = parsed.usage.total_tokens;
    logService.add(entry);
    return res.json({
      ok: true,
      latencyMs: entry.latencyMs,
      result: parsed,
      switched: (callResult.attempts && callResult.attempts.length > 1) ? true : false,
      attempts: callResult.attempts,
      config: { id: cfg ? cfg.id : null, name: cfg ? cfg.name : '', model: cfg ? cfg.model : '' }
    });
  }

  entry.error = callResult.error;
  entry.httpStatus = callResult.errorStatus;
  entry.response = result ? result.data : null;
  logService.add(entry);

  // 显式指定配置时出错，带上配置名便于定位
  if (explicitCfg) {
    return res.status(502).json({
      ok: false,
      error: `配置「${explicitCfg.name}」(${explicitCfg.model}) 请求失败：${callResult.error}`,
      latencyMs: entry.latencyMs,
      attempts: callResult.attempts
    });
  }
  res.status(502).json({
    ok: false,
    error: callResult.error,
    errorStatus: callResult.errorStatus,
    latencyMs: entry.latencyMs,
    attempts: callResult.attempts,
    errors: callResult.errors
  });
}));

module.exports = router;
