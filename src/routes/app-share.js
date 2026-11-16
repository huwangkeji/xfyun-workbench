'use strict';

/**
 * 应用对外分享（公开路由，/api/app-share）：token 即链接凭证
 *   GET  /api/app-share/:token        分享状态 + 应用公开信息（名称/开场白/预设问题/参数变量）
 *   POST /api/app-share/:token/chat   与应用对话（QPM 限流 + 可选密码 + 应用配置生效）
 *
 * 安全边界：
 *   - 永不外泄 systemPrompt / configId / kbId（应用内部配置）；
 *   - 系统提示由本路由在服务端注入，访客无法篡改角色设定；
 *   - 知识库检索按应用配置注入（分享 = 应用主人主动公开的边界）；
 *   - 历史最多 12 条、单条 4000 字，防滥用。
 */

const express = require('express');
const appShareService = require('../appShareService');
const agentService = require('../agentService');
const configService = require('../configService');
const scheduler = require('../scheduler');
const xfyun = require('../xfyun');
const logService = require('../logService');
const kbService = require('../kbService');
const asyncHandler = require('../asyncHandler');
const router = express.Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
const HISTORY_FOR_LOG = 6; // 日志仅留最近几条，防 db.json 膨胀

/** 应用公开信息（不含任何角色设定与内部配置） */
function publicAgentView(agent) {
  return {
    name: agent.name,
    emoji: agent.emoji || '🤖',
    desc: agent.desc || '',
    welcome: agent.welcome || '',
    suggests: Array.isArray(agent.suggests) ? agent.suggests : [],
    variables: Array.isArray(agent.variables) ? agent.variables : []
  };
}

/** 分享对话与工作台 /api/chat 同源的参数组装（无流式、无工作台覆盖） */
function buildExtra(agent) {
  return {
    temperature: typeof agent.temperature === 'number' ? agent.temperature : undefined,
    max_completion_tokens: Number.isFinite(agent.maxTokens) ? agent.maxTokens : undefined,
    stream: false
  };
}

/** 知识库检索注入（分享页允许访客：应用主人绑定知识库 = 主动公开） */
function injectKb(messages, agent) {
  if (!agent.kbId) return null;
  let query = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') { query = messages[i].content; break; }
  }
  if (!query.trim()) return null;
  const r = kbService.search(agent.kbId, query, Number.isFinite(agent.kbMaxRefs) ? agent.kbMaxRefs : 5, agent.kbMinScore || 0);
  if (!r.ok || !r.chunks.length) return null;
  const lines = r.chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n---\n');
  const block = [
    `以下内容来自知识库「${r.kbName}」的检索结果（共 ${r.chunks.length} 段），回答时优先依据这些资料；`,
    '资料中没有的信息请如实说明，不要编造。引用时可用 [序号] 标注来源分段。',
    '========================================',
    lines
  ].join('\n');
  messages.unshift({ role: 'system', content: block, kb: true });
  return { kbName: r.kbName, chunks: r.chunks.length };
}

/* ---------- GET 分享状态 ---------- */
router.get('/:token', asyncHandler(async (req, res) => {
  const token = req.params.token || '';
  if (!TOKEN_RE.test(token)) return res.status(404).json({ ok: false, error: '分享链接不存在' });
  const rec = appShareService.resolve(token);
  if (!rec || rec.gone) return res.status(410).json({ ok: false, error: '分享链接不存在或已过期' });

  const agent = agentService.getForActor(rec.agentId, null);
  if (!agent) return res.status(410).json({ ok: false, error: '应用已下线（被删除或转为私有）' });

  res.json({
    ok: true,
    data: {
      needPassword: !!rec.passwordHash,
      qpm: rec.qpm || 0,
      expiresAt: rec.expiresAt || null,
      agent: publicAgentView(agent)
    }
  });
}));

/* ---------- POST 分享对话 ---------- */
router.post('/:token/chat', asyncHandler(async (req, res) => {
  const token = req.params.token || '';
  const body = req.body || {};
  if (!TOKEN_RE.test(token)) return res.status(404).json({ ok: false, error: '分享链接不存在' });

  const rec = appShareService.resolve(token);
  if (!rec || rec.gone) return res.status(410).json({ ok: false, error: '分享链接不存在或已过期' });

  // 身份验证：设置了密码的分享必须携带正确密码
  if (!appShareService.verifyPassword(rec, body.key)) {
    return res.status(401).json({ ok: false, code: 'PASSWORD', error: rec.passwordHash ? '访问密码不正确' : '' });
  }

  // QPM 限流
  const retryAfter = appShareService.checkRate(rec);
  if (retryAfter !== null) {
    res.set('Retry-After', String(Math.max(1, retryAfter)));
    return res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: `请求过于频繁，请 ${retryAfter} 秒后再试` });
  }

  const agent = agentService.getForActor(rec.agentId, null);
  if (!agent) return res.status(410).json({ ok: false, error: '应用已下线（被删除或转为私有）' });

  const { error: msgErr, messages } = appShareService.sanitizeMessages(body.messages);
  if (msgErr) return res.status(400).json({ ok: false, error: msgErr });

  // 参数变量：必填校验 + 值注入（追加在角色设定后）
  let systemPrompt = agent.systemPrompt || '';
  if (Array.isArray(agent.variables) && agent.variables.length) {
    const missing = agent.variables
      .filter((v) => v.required)
      .filter((v) => { const val = body.variables ? body.variables[v.key] : undefined; return val === undefined || String(val).trim() === ''; })
      .map((v) => v.label || v.key);
    if (missing.length) return res.status(400).json({ ok: false, error: `请先填写必填参数：${missing.join('、')}` });
    const v = body.variables && typeof body.variables === 'object' ? body.variables : {};
    const lines = agent.variables
      .filter((def) => v[def.key] !== undefined && String(v[def.key]).trim() !== '')
      .map((def) => `- ${def.label || def.key}：${String(v[def.key]).trim().slice(0, 2000)}`);
    if (lines.length) systemPrompt += `\n\n【用户填写的参数】\n${lines.join('\n')}`;
  }

  const upstream = [{ role: 'system', content: systemPrompt }, ...messages];
  const kbInfo = injectKb(upstream, agent);

  // 模型路由：应用绑定配置优先；未绑定走全局调度（failover）
  const extra = buildExtra(agent);
  let callResult;
  let cfg;
  if (agent.configId) {
    const full = configService.getFull(agent.configId);
    if (!full) return res.status(503).json({ ok: false, error: '应用绑定的模型配置不存在，请联系管理员' });
    callResult = await xfyun.chatCompletions(full, upstream, extra);
    callResult.usedConfig = full;
    cfg = full;
  } else {
    callResult = await scheduler.attemptChat(upstream, extra);
    cfg = callResult.usedConfig || null;
  }
  if (!cfg) cfg = { id: '', name: '', model: '' };

  appShareService.hit(rec);

  const entry = {
    id: logService.buildId(),
    time: new Date().toISOString(),
    actorId: null,
    actorName: '分享访客',
    agentId: agent.id,
    agentName: agent.name,
    channel: 'app-share',
    shareToken: token,
    configId: cfg ? cfg.id : null,
    configName: cfg ? cfg.name : '',
    model: cfg ? cfg.model : '',
    status: callResult.ok ? 'ok' : 'error',
    latencyMs: callResult.latencyMs || 0,
    request: {
      messages: upstream.slice(-HISTORY_FOR_LOG),
      systemPrompt: '',
      knowledgeBase: kbInfo ? { name: kbInfo.kbName, chunks: kbInfo.chunks } : null
    }
  };
  const result = callResult.result || (callResult.status !== undefined ? callResult : null);

  if (callResult.ok) {
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
      config: { id: cfg.id, name: cfg.name, model: cfg.model }
    });
  }

  entry.error = callResult.error;
  entry.httpStatus = callResult.errorStatus;
  logService.add(entry);
  res.status(502).json({ ok: false, error: `模型请求失败：${callResult.error}`, latencyMs: entry.latencyMs });
}));

module.exports = router;
