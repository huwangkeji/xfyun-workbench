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
const kbService = require('../kbService');
const asyncHandler = require('../asyncHandler');
const agentService = require('../agentService');
const agentTools = require('../agentTools');
const router = express.Router();

/** 粘贴上传图片的落盘根目录（与 src/routes/upload.js 一致） */
const UPLOAD_ROOT = process.env.XFYUN_UPLOAD_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');

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

// 按配置注入系统提示（已有 system 消息则不重复注入；kb:true 的知识库消息不算数，
// 否则知识注入会顶掉配置里的系统提示）
// customSystemPrompt：前台「系统提示」输入框的值（字符串）——显式提供时覆盖配置默认；
//   空串表示用户清空（不注入）；undefined 表示前台未传，回退配置值。
function withSystemPrompt(messages, cfg, customSystemPrompt) {
  const list = messages.slice();
  if (list.some((m) => m.role === 'system' && !m.kb)) return list;
  const sp = customSystemPrompt !== undefined && customSystemPrompt !== null
    ? String(customSystemPrompt)
    : (cfg && cfg.systemPrompt);
  if (sp) list.unshift({ role: 'system', content: sp });
  return list;
}

/* ---------- 知识库检索注入 ----------
 * 前台传 kbId（且为登录员工）时，按最后一问检索知识库，取 TopK 分段拼成
 * 知识块 system 消息（kb:true 标记）插入消息最前。块排在配置系统提示之后生效：
 * withSystemPrompt 会把配置系统提示 unshift 到 index 0，知识块自然退居其后。
 */
function extractQueryText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      const texts = m.content
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text);
      if (texts.length) return texts.join('\n');
    }
  }
  return '';
}

function formatKbBlock(r) {
  const lines = r.chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n---\n');
  return [
    `以下内容来自知识库「${r.kbName}」的检索结果（共 ${r.chunks.length} 段），回答时优先依据这些资料；`,
    '资料中没有的信息请如实说明，不要编造。引用时可用 [序号] 标注来源分段。',
    '========================================',
    lines
  ].join('\n');
}

/**
 * 按请求体注入知识库上下文（有检索命中时返回 true）
 * @param {{topK?:number, minScore?:number}} kbOpts 应用级检索选项（引用上限/最低相关度）
 * @returns {{injected:boolean, kbName:string, chunks:number, error:string|null}}
 */
function injectKnowledge(upstreamMessages, kbId, actor, kbOpts) {
  if (!kbId || typeof kbId !== 'string') return { injected: false, kbName: '', chunks: 0, error: null };
  if (!actor) {
    return { injected: false, kbName: '', chunks: 0, error: '知识库功能仅对登录员工开放' };
  }
  // 私有库权限：仅创建者与 owner/admin 可在对话中注入
  const kbMeta = kbService.get(kbId);
  if (!kbMeta) return { injected: false, kbName: '', chunks: 0, error: '关联的知识库不存在或已被删除' };
  if (!kbService.canUse({ id: kbMeta.id, visibility: kbMeta.visibility, ownerId: kbMeta.ownerId }, actor)) {
    return { injected: false, kbName: kbMeta.name, chunks: 0, error: '该知识库为私有库，仅创建者与管理员可使用' };
  }
  const query = extractQueryText(upstreamMessages);
  if (!query || !query.trim()) return { injected: false, kbName: '', chunks: 0, error: null };
  const o = kbOpts || {};
  const r = kbService.search(kbId, query, o.topK, o.minScore);
  if (!r.ok) {
    return { injected: false, kbName: '', chunks: 0, error: r.notFound ? '关联的知识库不存在或已被删除' : (r.errors || []).join('；') };
  }
  if (!r.chunks.length) return { injected: false, kbName: r.kbName, chunks: 0, error: null };
  upstreamMessages.unshift({ role: 'system', content: formatKbBlock(r), kb: true });
  return { injected: true, kbName: r.kbName, chunks: r.chunks.length, error: null };
}

/** 应用参数变量：把用户填写的变量值拼成一段补充信息（追加在角色设定之后） */
function applyAgentVariables(systemPrompt, variables, values) {
  if (!Array.isArray(variables) || !variables.length) return systemPrompt;
  const v = values && typeof values === 'object' ? values : {};
  const lines = [];
  for (const def of variables) {
    const val = v[def.key];
    if (val === undefined || val === null || String(val).trim() === '') continue;
    lines.push(`- ${def.label || def.key}：${String(val).trim().slice(0, 2000)}`);
  }
  if (!lines.length) return systemPrompt;
  const block = `\n\n【用户填写的参数】\n${lines.join('\n')}`;
  return systemPrompt ? systemPrompt + block : `【用户填写的参数】\n${lines.join('\n')}`;
}

/* ---------- 工具调用（MCP / 插件 function calling） ----------
 * 智能体绑定了插件或 MCP 工具时，把工具定义下发给模型；模型返回 tool_calls 时
 * 逐个执行并把结果以 role:tool 消息回传，循环直到模型给出最终答复或达到轮数上限。
 */
const MAX_TOOL_ROUNDS = 5;

/**
 * 带工具循环的单配置对话调用
 * @param {object} cfg 完整配置
 * @param {Array} messages 上游消息（system 注入后的完整消息数组）
 * @param {object} extra 参数覆盖（含 tools）
 * @param {Map} registry 工具名 -> 执行器注册表
 * @returns {Promise<object>} 归一化结果：{ ok, result, toolCalls }（result 即 xfyun 返回体）
 */
async function chatWithTools(cfg, messages, extra, registry) {
  let current = messages;
  const toolCallsLog = [];
  let lastResult = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const callResult = await xfyun.chatCompletions(cfg, current, extra);
    if (!callResult.ok) return { ok: false, result: callResult, toolCalls: toolCallsLog };

    // 归一化结果体（与下方主流程一致：显式配置路径 result 即 callResult 本身）
    const result = callResult.result || callResult;
    lastResult = callResult;
    const parsed = xfyun.extractResult(result.data);
    const toolCalls = parsed.tool_calls || [];

    // 无工具调用：模型已给出最终答复
    if (!toolCalls.length) return { ok: true, result: callResult, toolCalls: toolCallsLog };

    // 有工具调用：执行并把结果回传
    const assistantMsg = (result.data.choices && result.data.choices[0] && result.data.choices[0].message) || {};
    current = current.concat([assistantMsg]);

    for (const tc of toolCalls) {
      const fn = tc && tc.function;
      const name = fn && fn.name;
      const executor = registry.get(name);
      let output;
      if (!executor) {
        output = `错误：未找到工具 ${name}`;
      } else {
        try {
          output = await agentTools.executeTool(executor, fn.arguments);
        } catch (e) {
          output = `工具调用失败：${e.message}`;
        }
      }
      toolCallsLog.push({ name, args: fn && fn.arguments, ok: !!executor, output: String(output).slice(0, 2000) });
      current = current.concat([{ role: 'tool', tool_call_id: tc.id || name, content: String(output) }]);
    }
  }

  // 达到轮数上限：返回最后一次结果（可能仍是 tool_calls，交由下游按普通结果处理）
  return { ok: true, result: lastResult, toolCalls: toolCallsLog };
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

  /* ---------- 应用（智能体）配置解析 ----------
   * 请求带 agentId 时：校验可见性 → 应用其绑定模型/温度/回复上限/关联知识库，
   * 并把用户填写的参数变量拼进系统提示。所有应用默认值均可被请求显式参数覆盖。
   */
  let agent = null;
  if (body.agentId) {
    agent = agentService.getForActor(String(body.agentId), actor);
    if (!agent) return res.status(404).json({ ok: false, error: '应用不存在或不可用（私有应用仅属主与管理员可用）' });
    if (actor && actor.role === 'viewer') {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: '只读成员（viewer）不能发起对话，如需使用请联系管理员调整角色' });
    }
  }
  const agentCfg = agent ? {
    configId: agent.configId || '',
    temperature: typeof agent.temperature === 'number' ? agent.temperature : undefined,
    maxTokens: Number.isFinite(agent.maxTokens) ? agent.maxTokens : undefined,
    kbId: agent.kbId || '',
    kbMaxRefs: Number.isFinite(agent.kbMaxRefs) ? agent.kbMaxRefs : 5,
    kbMinScore: Number.isFinite(agent.kbMinScore) ? agent.kbMinScore : 0
  } : null;

  // 组装请求参数（应用绑定值 → 工作台显式覆盖 → 配置默认值，三层回退）
  const extra = {
    temperature: body.temperature !== undefined && body.temperature !== null ? body.temperature : (agentCfg && agentCfg.temperature),
    top_p: body.topP,
    max_completion_tokens: body.maxTokens !== undefined && body.maxTokens !== null ? body.maxTokens : (agentCfg && agentCfg.maxTokens),
    // 前台参数工具栏：深度思考开关 / 思考强度（显式 boolean 与字符串优先，未传回退配置）
    enable_thinking: typeof body.enableThinking === 'boolean' ? body.enableThinking : undefined,
    reasoning_effort: body.reasoningEffort === 'high' || body.reasoningEffort === 'max' ? body.reasoningEffort : undefined,
    // 联网搜索：前端开关按次显式传入 boolean；未传（undefined）时回退配置默认值
    webSearch: typeof body.webSearch === 'boolean' ? body.webSearch : undefined,
    // stream 只由请求体显式开启：配置里的 stream 字段不参与决定，
    // 避免后台误开流式后浏览器 UI（不消费 SSE）拿到 event-stream 而无法解析。
    stream: false
  };
  // 系统提示优先级：前台显式值 → 应用（智能体）角色设定 → 配置默认值；
  // 应用带参数变量时，把用户填写值拼成补充信息附加其后
  let baseSystemPrompt;
  if (typeof body.systemPrompt === 'string') baseSystemPrompt = body.systemPrompt;
  else if (agent) baseSystemPrompt = agent.systemPrompt || '';
  else baseSystemPrompt = undefined; // undefined = 回退配置默认
  if (agent && Array.isArray(agent.variables) && agent.variables.length) {
    const missing = agent.variables
      .filter((v) => v.required)
      .filter((v) => { const val = body.variables ? body.variables[v.key] : undefined; return val === undefined || String(val).trim() === ''; })
      .map((v) => v.label || v.key);
    if (missing.length) {
      return res.status(400).json({ ok: false, error: `请先填写必填参数：${missing.join('、')}` });
    }
    baseSystemPrompt = applyAgentVariables(baseSystemPrompt, agent.variables, body.variables);
  }
  const customSystemPrompt = baseSystemPrompt;

  // 系统提示注入由各配置的 systemPrompt 决定；为统一处理，先取原始消息
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice() : [];

  // 图片内联：消息里的 /uploads/ 图片 URL 转 base64 data URI 后再发给上游
  // （上游无法访问本机 localhost；db.json 里仍存 URL，避免历史记录体积膨胀）
  const { messages: upstreamMessages, inlinedCount } = inlineUploadImages(rawMessages);

  // 知识库检索注入：请求显式 kbId 优先；应用绑定的知识库兜底（带引用上限/最低相关度）
  const effectiveKbId = body.kbId || (agentCfg && agentCfg.kbId) || '';
  const kbResult = injectKnowledge(upstreamMessages, effectiveKbId, actor, agent ? { topK: agentCfg.kbMaxRefs, minScore: agentCfg.kbMinScore } : null);
  if (kbResult.error) {
    return res.status(400).json({ ok: false, error: kbResult.error });
  }

  // 判定期望的候选配置（供日志/调度使用）：请求显式选择优先，应用绑定次之
  const wantConfigId = body.configId || (agentCfg && agentCfg.configId) || '';
  const explicitCfg = wantConfigId ? configService.getFull(wantConfigId) : null;
  const wantStream = body.stream === true;

  // 工具能力：智能体绑定了插件/MCP 工具时构建 function calling 定义。
  // 工具循环仅支持非流式（与调度器/SSE 语义互斥），故 wantStream 时不启用工具。
  let toolRegistry = new Map();
  let agentToolCalls = [];
  if (agent && !wantStream && (Array.isArray(agent.plugins) && agent.plugins.length || Array.isArray(agent.mcpTools) && agent.mcpTools.length)) {
    const built = await agentTools.buildTools(agent);
    toolRegistry = built.registry;
    if (built.tools.length) extra.tools = built.tools;
  }
  const hasTools = toolRegistry.size > 0 && Array.isArray(extra.tools) && extra.tools.length > 0;

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
    // 知识库步骤事件：前端思考区展示「已检索知识库」（在透传上游 SSE 前发出，前端解析忽略未知事件）
    if (kbResult.injected) {
      res.write(`data: ${JSON.stringify({ kbStep: { name: kbResult.kbName, chunks: kbResult.chunks } })}\n\n`);
    }

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
    if (hasTools) {
      const toolRes = await chatWithTools(explicitCfg, messages, extra, toolRegistry);
      callResult = toolRes.result;
      agentToolCalls = toolRes.toolCalls;
      // chatWithTools 失败时 result 即 xfyun 返回体；成功时同样
      callResult.usedConfig = explicitCfg;
      callResult.attempts = [{ id: explicitCfg.id, name: explicitCfg.name, model: explicitCfg.model, ok: callResult.ok, status: callResult.status }];
    } else {
      callResult = await xfyun.chatCompletions(explicitCfg, messages, extra);
      callResult.usedConfig = explicitCfg;
      callResult.attempts = [{ id: explicitCfg.id, name: explicitCfg.name, model: explicitCfg.model, ok: callResult.ok, status: callResult.status }];
    }
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
    // 调度路径若绑定工具且首次成功返回 tool_calls，继续工具循环（复用首个成功配置）
    if (hasTools && callResult.ok && usedCfg && usedCfg.apiKey) {
      const parsed = xfyun.extractResult((callResult.result || callResult).data);
      if ((parsed.tool_calls || []).length) {
        const toolRes = await chatWithTools(usedCfg, schedMessages, extra, toolRegistry);
        callResult = toolRes.result;
        agentToolCalls = toolRes.toolCalls;
        callResult.usedConfig = usedCfg;
        callResult.attempts = [{ id: usedCfg.id, name: usedCfg.name, model: usedCfg.model, ok: callResult.ok, status: callResult.status }];
      }
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

  // 记录日志（agentId 归属：应用维度的对话日志，供后台按应用筛选）
  const entry = {
    id: logService.buildId(),
    time: new Date().toISOString(),
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.displayName : '',
    agentId: agent ? agent.id : null,
    agentName: agent ? agent.name : '',
    channel: agent ? 'app' : 'workbench',
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
      imagesInlined: inlinedCount,
      // 知识库注入信息（未启用为 null）
      knowledgeBase: kbResult.injected ? { name: kbResult.kbName, chunks: kbResult.chunks } : null,
      // 工具调用记录（MCP / 插件 function calling，未启用为空数组）
      toolCalls: agentToolCalls
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
