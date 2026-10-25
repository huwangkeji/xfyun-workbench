'use strict';

/**
 * 星火 MaaS 开源模型 API 调用封装
 * 官方文档：
 *   1.1 API 接入        https://maas.xfyun.cn/doc/guide/1、快速开始/1.1 API接入.html
 *   3.2.1 文本对话      https://maas.xfyun.cn/doc/guide/3、API 接口/3.2 开源模型API/3.2.1 文本对话.html
 *
 * 文档关键约定（与本文件实现一一对应）：
 *   - 端点：POST {baseUrl}/v2/chat/completions（默认 https://maas-api.cn-huabei-1.xf-yun.com）
 *   - 鉴权：请求头 Authorization: Bearer <APIKEY> + Content-Type: application/json
 *   - API Key 从控制台「API调用 / APIKEY管理」获取（形如 ak-xxxx），经 src/env.js 从
 *     环境变量 / .env 读取，禁止硬编码
 *   - 参数：model/messages 必填；temperature[0,1]默认0.7；top_p[0,1]；
 *     presence_penalty/frequency_penalty[-2,2]默认0；max_completion_tokens（max_tokens 已废弃）；
 *     enable_thinking 默认 false；reasoning_effort 取值 high/max（low/medium→high、xhigh→max 为兼容映射）；
 *     stream 默认 false，true 时走 SSE：data: {chunk} … data: [DONE]
 *   - 响应：code===0 为成功；choices[].message.{content,reasoning_content,tool_calls}；
 *     finish_reason ∈ stop/length/tool_calls；usage 含 *_details 明细
 */

const env = require('./env');

/** 官方默认接入地址（公共端点，非密钥；可用环境变量 XFYUN_BASE_URL 覆盖） */
const DEFAULT_BASE_URL = 'https://maas-api.cn-huabei-1.xf-yun.com';

/** 单次请求超时（毫秒），可用 XFYUN_TIMEOUT_MS 覆盖 */
function timeoutMs() {
  const n = parseInt(env.getEnv('XFYUN_TIMEOUT_MS', '120000'), 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}

/**
 * 网络错误 / 5xx 的重试次数，可用 XFYUN_MAX_RETRIES 覆盖（默认 1 次）。
 * 仅对「连接失败/超时」和「HTTP 5xx」重试；4xx（鉴权失败、参数错误）重试无意义，直接返回。
 */
function maxRetries() {
  const n = parseInt(env.getEnv('XFYUN_MAX_RETRIES', '1'), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3) : 1;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带重试的 fetch：网络异常与 5xx 按指数退避重试，4xx 原样返回交由上层构造错误信息。
 * @returns {Promise<Response>} 首个非 5xx 的响应
 */
async function fetchWithRetry(url, options, retries = maxRetries()) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status >= 500 && attempt < retries) {
        await resp.text().catch(() => {}); // 释放连接
        lastErr = new Error(`上游服务故障 HTTP ${resp.status}`);
        await sleep(500 * (attempt + 1));
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('请求失败');
}

/**
 * 配置字段 → 请求体字段映射（对齐官方文档 §1.1 请求参数）
 * 请求体用 snake_case，配置存 camelCase。
 */
const PARAM_MAP = [
  { body: 'max_completion_tokens', cfg: 'maxTokens' },
  { body: 'temperature', cfg: 'temperature' },
  { body: 'top_p', cfg: 'topP' },
  { body: 'presence_penalty', cfg: 'presencePenalty' },
  { body: 'frequency_penalty', cfg: 'frequencyPenalty' },
  { body: 'enable_thinking', cfg: 'enableThinking' },
  { body: 'reasoning_effort', cfg: 'reasoningEffort' },
  { body: 'user', cfg: 'user' },
  { body: 'stream', cfg: 'stream' }
];

/**
 * 组装 chat/completions 请求体（流式与非流式共用，避免两处逻辑漂移）
 *
 * extra 与配置的优先级：extra 显式提供的值优先（含 false——前台"关闭深度思考"
 * 必须能显式压过配置里的 true，否则上游收不到该字段会用默认值）。
 * 配置值沿用旧规则：false 视为"未设置"不传，交由上游默认。
 */
function buildChatBody(cfg, messages, extra = {}) {
  const body = {
    model: cfg.model,
    messages
  };

  for (const { body: bodyKey, cfg: cfgKey } of PARAM_MAP) {
    const fromExtra = extra[bodyKey] !== undefined;
    const val = fromExtra ? extra[bodyKey] : cfg[cfgKey];
    if (val === null || val === undefined || val === '') continue;
    // boolean false：仅 extra 显式提供时才下发（关闭开关）；配置里的 false 不传
    if (val === false && !fromExtra) continue;
    body[bodyKey] = val;
  }

  // 内置网络搜索工具（文档 §tools.type=web_search，tools[].web_search.enable）
  // extra.webSearch 显式传入时覆盖配置默认值（前台「联网搜索」开关按次请求控制）
  const webSearch = extra.webSearch !== undefined ? extra.webSearch : cfg.webSearch;
  if (webSearch) {
    body.tools = [{ type: 'web_search', web_search: { enable: true } }];
  }

  return body;
}

/**
 * 非流式对话：调用 v2/chat/completions
 * @param {object} cfg 完整配置（含 apiKey，已由 configService normalize）
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} extra 覆盖默认参数（可选）
 * @returns {{ok:boolean, status:number, data:object|null, error:string|null, isAuth?:boolean, latencyMs:number}}
 */
async function chatCompletions(cfg, messages, extra = {}) {
  const base = cfg.baseUrl || DEFAULT_BASE_URL;
  const url = `${base}/v2/chat/completions`;
  const body = buildChatBody(cfg, messages, extra);

  const startedAt = Date.now();
  let resp;
  try {
    resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs())
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `网络请求失败: ${e.message}`, latencyMs: Date.now() - startedAt };
  }

  return finalizeChatResponse(resp, startedAt);
}

/**
 * 流式对话（SSE）：返回上游 Response（body 为 ReadableStream），由路由层原样转发。
 * 官方流式格式：每个 chunk 为 `data: {json}\n\n`，以 `data: [DONE]` 结束。
 * 注意：错误在上游阶段（非 2xx）以普通 HTTP 响应返回，调用方需按非流式错误处理。
 * @returns {{ok:boolean, status:number, data:Response|null, error:string|null, latencyMs:number}}
 */
async function chatCompletionsStream(cfg, messages, extra = {}) {
  const base = cfg.baseUrl || DEFAULT_BASE_URL;
  const url = `${base}/v2/chat/completions`;
  const body = buildChatBody(cfg, messages, { ...extra, stream: true });

  const startedAt = Date.now();
  let resp;
  try {
    resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs())
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `网络请求失败: ${e.message}`, latencyMs: Date.now() - startedAt };
  }

  if (!resp.ok) {
    // 流式建立失败：错误信息按非流式同样解析，便于路由层统一返回 502 JSON
    const err = await readError(resp);
    return { ok: false, status: resp.status, data: null, error: err, latencyMs: Date.now() - startedAt };
  }

  // 校验上游确实按 SSE 返回，避免把 HTML 错误页当流透传
  const ct = resp.headers.get('content-type') || '';
  if (!/text\/event-stream/i.test(ct)) {
    const err = await readError(resp);
    return { ok: false, status: resp.status, data: null, error: `上游未返回 SSE 流（Content-Type: ${ct || '未知'}）：${err}`, latencyMs: Date.now() - startedAt };
  }

  return { ok: true, status: resp.status, data: resp, error: null, latencyMs: Date.now() - startedAt };
}

/** 读取上游错误响应并构造中文可读错误信息（含鉴权/限流专项提示） */
async function readError(resp) {
  let text = '';
  try { text = await resp.text(); } catch (_) {}
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }
  const detail = data && (data.message || data.error) ? JSON.stringify(data.message || data.error) : text;
  const isAuth = resp.status === 401 || resp.status === 403;
  if (isAuth) {
    return `API Key 无效或未授权（HTTP ${resp.status}）：请在讯飞 MaaS 控制台「API 调用 / APIKEY 管理」确认该 API Key，并检查「后台管理→API 配置」里对应配置的 Key 是否正确后重新保存。${detail ? `（${detail}）` : ''}`;
  }
  if (resp.status === 429) {
    // 官方未公布具体限流阈值，超限时按 429 处理并提示降频
    return `触发上游限流（HTTP 429）：请降低请求频率后重试。${detail ? `（${detail}）` : ''}`;
  }
  return `上游返回 HTTP ${resp.status}: ${detail || resp.statusText}`;
}

/** 非流式响应的统一收尾：解析 body、判定 HTTP 错误与业务错误码 */
async function finalizeChatResponse(resp, startedAt) {
  const latencyMs = Date.now() - startedAt;
  let text = '';
  try { text = await resp.text(); } catch (_) {}

  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }

  if (!resp.ok) {
    const err = await readError(resp);
    const isAuth = resp.status === 401 || resp.status === 403;
    return { ok: false, status: resp.status, data, error: err, isAuth, latencyMs };
  }

  // 业务错误码：文档约定 code !== 0 视为业务失败（如 10004 参数校验、10024 生成失败）
  if (data && typeof data.code === 'number' && data.code !== 0) {
    return { ok: false, status: resp.status, data, error: `业务错误 code=${data.code}: ${data.message || ''}`, latencyMs };
  }

  return { ok: true, status: resp.status, data, error: null, latencyMs };
}

/**
 * 图片生成（Text-to-Image, TTI）
 * 参考文档：https://maas.xfyun.cn/doc/guide/3、API 接口/3.2 开源模型API/3.2.3 图片生成.html
 * 接口语义与星火文生图一致：header / parameter.chat / payload.message。
 *
 * @param {object} cfg 完整配置（含 apiKey / ttiModel / tti 系列默认参数）
 * @param {object} params { prompt, negativePrompt, width, height, seed, steps, guidance, scheduler, uid }
 * @returns {{ok:boolean, status:number, data:object|null, error:string|null, latencyMs:number, base64?:string, isAuth?:boolean}}
 */
async function tti(cfg, params = {}) {
  const baseUrl = cfg.ttiBaseUrl || cfg.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/v2.1/tti`;

  const width = Math.min(1024, Math.max(256, parseInt(params.width ?? cfg.ttiWidth ?? 512, 10) || 512));
  const height = Math.min(1024, Math.max(256, parseInt(params.height ?? cfg.ttiHeight ?? 512, 10) || 512));

  // 上游 schema 要求：uid 非空，且 patch_id 字段必填（非全量训练模型需要传平台给出的 patch_id）
  const uid = params.uid || cfg.uid || 'workbench';
  const rawPatch = params.patchId !== undefined ? params.patchId : cfg.patchId;
  let patchId = [];
  if (rawPatch) {
    patchId = Array.isArray(rawPatch)
      ? rawPatch.map((s) => String(s).trim()).filter(Boolean)
      : String(rawPatch).split(',').map((s) => s.trim()).filter(Boolean);
  }

  const body = {
    header: {
      uid,
      patch_id: patchId
    },
    parameter: {
      chat: {
        domain: params.model || cfg.ttiModel || cfg.model,
        width,
        height,
        seed: params.seed !== undefined && params.seed !== null && params.seed !== ''
          ? parseInt(params.seed, 10)
          : (cfg.ttiSeed != null && cfg.ttiSeed !== '' ? parseInt(cfg.ttiSeed, 10) : 0), // 0=随机种子
        num_inference_steps: Math.min(50, Math.max(1, parseInt(params.steps ?? cfg.numInferenceSteps ?? 20, 10) || 20)),
        guidance_scale: Math.min(20, Math.max(0, parseFloat(params.guidance ?? cfg.guidanceScale ?? 5) || 5)),
        scheduler: params.scheduler || cfg.scheduler || 'DPM++ 2M Karras'
      }
    },
    payload: {
      message: {
        text: [{ role: 'user', content: params.prompt || '' }]
      }
    }
  };

  if (params.negativePrompt || cfg.negativePrompt) {
    body.payload.negative_prompts = { text: params.negativePrompt || cfg.negativePrompt };
  }

  const startedAt = Date.now();
  let resp;
  try {
    resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs())
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `网络请求失败: ${e.message}`, latencyMs: Date.now() - startedAt };
  }

  const latencyMs = Date.now() - startedAt;
  let text = '';
  try { text = await resp.text(); } catch (_) {}

  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }

  if (!resp.ok) {
    const detail = data && (data.header?.message || data.error || data.message)
      ? JSON.stringify(data.header?.message || data.error || data.message)
      : text;
    const isAuth = resp.status === 401 || resp.status === 403;
    const err = isAuth
      ? `API Key 无效或未授权（HTTP ${resp.status}）：请在讯飞 MaaS 控制台「API 调用 / APIKEY 管理」确认 Key，或检查图片模型的 Model ID（domain）是否正确。${detail ? `（${detail}）` : ''}`
      : (resp.status === 429
        ? `触发上游限流（HTTP 429）：请降低请求频率后重试。${detail ? `（${detail}）` : ''}`
        : `上游返回 HTTP ${resp.status}: ${detail || resp.statusText}`);
    return { ok: false, status: resp.status, data, error: err, isAuth, latencyMs };
  }

  // 业务错误码：header.code !== 0 视为业务失败
  if (data && data.header && typeof data.header.code === 'number' && data.header.code !== 0) {
    return { ok: false, status: resp.status, data, error: `业务错误 code=${data.header.code}: ${data.header.message || ''}`, latencyMs };
  }

  // 成功时从 payload.choices.text[0].content 抽取 base64 图片
  let base64 = '';
  const texts = data && data.payload && data.payload.choices
    ? (data.payload.choices.text || [])
    : [];
  if (Array.isArray(texts) && texts.length) {
    base64 = typeof texts[0].content === 'string' ? texts[0].content : '';
  }

  return { ok: true, status: resp.status, data, base64, error: null, latencyMs };
}

/**
 * 从非流式响应中抽取最终文本与 usage（对齐文档 §4.1 响应体字段）
 * 补齐：tool_calls（finish_reason=tool_calls 时 content 可能为空）、
 * usage 明细（cached_tokens / reasoning_tokens）。
 */
function extractResult(data) {
  let content = '';
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  if (choice && choice.message) {
    content = typeof choice.message.content === 'string' ? choice.message.content : '';
  }
  const usage = (data && data.usage) || {};
  const completionDetails = usage.completion_tokens_details || {};
  const promptDetails = usage.prompt_tokens_details || {};
  return {
    content,
    reasoning_content: (choice && (choice.message && choice.message.reasoning_content)) || '',
    // 工具调用：模型选择调用 function 时返回，arguments 为 JSON 字符串，执行前需调用方校验
    tool_calls: (choice && Array.isArray(choice.message && choice.message.tool_calls)) ? choice.message.tool_calls : [],
    finish_reason: (choice && choice.finish_reason) || null,
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      // 输入命中缓存的 token 数 / 思考模式产生的推理 token 数（文档 usage.*_details）
      cached_tokens: promptDetails.cached_tokens ?? 0,
      reasoning_tokens: completionDetails.reasoning_tokens ?? 0
    },
    id: (data && data.id) || '',
    object: (data && data.object) || '',
    created: (data && data.created) || 0,
    model_id: (data && data.model_id) || ''
  };
}

module.exports = { chatCompletions, chatCompletionsStream, tti, extractResult, buildChatBody, PARAM_MAP, DEFAULT_BASE_URL };
