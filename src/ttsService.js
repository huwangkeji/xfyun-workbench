'use strict';

/**
 * TTS 语音合成服务（零依赖，OpenAI 兼容 /audio/speech 端点）
 *
 * 后端在「系统设置 · 语音合成」配置 TTS API（地址 / Key / 模型 / 音色列表），
 * 前端对话面板的 AI 回复消息提供「朗读」按钮，点击后：
 *   前端 → POST /api/tts/synthesize { text, voice }
 *        → 本服务调用外部 TTS（OpenAI 兼容） → 返回音频（mp3）二进制或 base64。
 *
 * 兼容供应商（OpenAI 格式）：小米 Mimo TTS、Fish Audio、openai-edge-tts、
 * Azure OpenAI、OpenAI 官方等，只要暴露 `/v1/audio/speech`（或 `/audio/speech`）即可。
 *
 * 数据形状（db.json 顶层 settings.tts）：
 *   {
 *     enabled: false,                 // 是否启用朗读（未配置时前端不显示朗读按钮）
 *     baseUrl: '',                    // API 基础地址（如 https://tokenpapa.ai/v1）
 *     apiKey: '',                     // API Key（AES-256-GCM 加密，复用 configService 加密）
 *     model: 'mimo-v2.5-tts',         // TTS 模型名
 *     voices: [                       // 音色列表（供前端选择）
 *       { id, name, voice }           // name=展示名，voice=上游音色标识（如 alloy）
 *     ]
 *   }
 */

const crypto = require('crypto');
const db = require('./db');
const env = require('./env');

const MAX_TEXT = 4000;          // 单次合成文本上限（字符）
const TIMEOUT_MS = 30000;       // 上游超时
const MAX_RETRIES = 1;          // 5xx 重试次数

/* —— API Key 加密（与 configService 同算法，独立实现避免耦合） —— */
const ENC_PREFIX = 'enc:v1:';
function encKey() { return env.getEnv('DB_ENCRYPT_KEY'); }
function deriveKey(p) { return crypto.createHash('sha256').update(String(p)).digest(); }
function encryptKey(plain) {
  const k = encKey();
  if (!k || !plain || String(plain).startsWith(ENC_PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(k), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${ENC_PREFIX}${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}
function decryptKey(value) {
  if (!value || !String(value).startsWith(ENC_PREFIX)) return value;
  const k = encKey();
  if (!k) return '';
  try {
    const p = String(value).slice(ENC_PREFIX.length).split('.');
    if (p.length !== 3) return '';
    const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(k), Buffer.from(p[0], 'base64url'));
    d.setAuthTag(Buffer.from(p[1], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(p[2], 'base64url')), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}

/** 读取 TTS 配置（apiKey 脱敏，不返回明文） */
function getConfig() {
  const s = db.load().settings || {};
  const t = (s.tts && typeof s.tts === 'object') ? s.tts : {};
  return {
    enabled: !!t.enabled,
    baseUrl: typeof t.baseUrl === 'string' ? t.baseUrl.trim() : '',
    hasKey: !!(typeof t.apiKey === 'string' && t.apiKey),
    model: typeof t.model === 'string' && t.model.trim() ? t.model.trim() : 'mimo-v2.5-tts',
    voices: Array.isArray(t.voices) ? t.voices : []
  };
}

/** 校验并更新 TTS 配置（apiKey 留空 = 不修改） */
function updateConfig(body) {
  const data = db.load();
  const cur = (data.settings.tts && typeof data.settings.tts === 'object') ? data.settings.tts : {};
  const next = { ...cur };

  if (body.enabled !== undefined) next.enabled = !!body.enabled;
  if (body.baseUrl !== undefined) next.baseUrl = String(body.baseUrl || '').trim().slice(0, 300);
  if (body.model !== undefined) next.model = String(body.model || '').trim().slice(0, 100) || 'mimo-v2.5-tts';
  // API Key：仅当传入非空时更新（避免每次保存把明文回填成已脱敏的空值）
  if (body.apiKey !== undefined && body.apiKey !== '') {
    next.apiKey = encryptKey(String(body.apiKey).trim());
  }
  // 音色列表：[{ name, voice }] → 服务端补齐 id
  if (body.voices !== undefined) {
    if (!Array.isArray(body.voices)) return { ok: false, errors: ['音色列表格式不正确'] };
    const voices = [];
    const seen = new Set();
    for (const v of body.voices.slice(0, 50)) {
      if (!v || typeof v !== 'object') continue;
      const name = String(v.name || '').trim().slice(0, 40);
      const voice = String(v.voice || '').trim().slice(0, 60);
      if (!name || !voice) continue; // 缺字段跳过
      if (seen.has(voice)) continue;  // 同 voice 去重
      seen.add(voice);
      voices.push({ id: v.id || db.getNextId('ttsv'), name, voice });
    }
    next.voices = voices;
  }

  data.settings.tts = next;
  db.save();
  return { ok: true, data: getConfig() };
}

/** 取上游端点：baseUrl 已含 /v1 时直接用，否则补 /audio/speech */
function speechUrl(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (/\/audio\/speech\/?$/.test(b)) return b;
  return `${b}/audio/speech`;
}

/**
 * 合成语音：调用 OpenAI 兼容 /audio/speech，返回音频二进制 Buffer。
 * @param {string} text  要朗读的文本
 * @param {string} voice 音色标识（对应配置 voices[].voice）
 * @returns {Promise<{ok:boolean, buffer?:Buffer, contentType?:string, error?:string}>}
 */
async function synthesize(text, voice) {
  const cfg = getConfig();
  if (!cfg.enabled) return { ok: false, error: '语音朗读功能未启用（请先在后台「语音合成」配置并开启）' };
  if (!cfg.baseUrl) return { ok: false, error: 'TTS API 地址未配置' };
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: '朗读内容为空' };
  if (body.length > MAX_TEXT) return { ok: false, error: `朗读内容过长（${body.length} 字），单次上限 ${MAX_TEXT} 字` };

  const rawKey = decryptKey((db.load().settings.tts || {}).apiKey);
  const v = String(voice || '').trim() || (cfg.voices[0] && cfg.voices[0].voice) || 'alloy';
  const url = speechUrl(cfg.baseUrl);
  if (!url) return { ok: false, error: 'TTS API 地址无效' };

  const payload = { model: cfg.model || 'mimo-v2.5-tts', input: body, voice: v };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(rawKey ? { Authorization: `Bearer ${rawKey}` } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    return { ok: false, error: `TTS 服务调用失败：${e && e.name === 'TimeoutError' ? '请求超时' : (e.message || '网络错误')}` };
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch (_) {}
    return { ok: false, error: `TTS 服务返回 HTTP ${resp.status}${detail ? '：' + detail : ''}` };
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) return { ok: false, error: 'TTS 服务返回空音频' };
  return { ok: true, buffer: buf, contentType: resp.headers.get('content-type') || 'audio/mpeg' };
}

module.exports = { getConfig, updateConfig, synthesize, speechUrl, encryptKey, decryptKey, MAX_TEXT };
