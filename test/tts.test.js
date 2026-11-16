'use strict';

/**
 * 语音合成（TTS）服务用例（node:test，零依赖）
 * 数据隔离：XFYUN_DATA_DIR 指向临时目录。
 * 覆盖：配置读写（脱敏 / 加密 / 音色去重）、端点拼接、文本校验。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-tts-test-' + process.pid;

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const DATA_DIR = process.env.XFYUN_DATA_DIR;

beforeEach(() => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
});

function fresh() {
  return { tts: require('../src/ttsService') };
}

test('TTS：配置读写 / apiKey 脱敏 / 音色去重', () => {
  const { tts } = fresh();

  // 默认未配置
  const c0 = tts.getConfig();
  assert.equal(c0.enabled, false);
  assert.equal(c0.hasKey, false);
  assert.equal(c0.voices.length, 0);

  // 保存配置（含音色列表，含重复 voice 应去重、缺字段跳过）
  const r = tts.updateConfig({
    enabled: true,
    baseUrl: 'https://tokenpapa.ai/v1',
    apiKey: 'sk-test-123',
    model: 'mimo-v2.5-tts',
    voices: [
      { name: '温柔女声', voice: 'alloy' },
      { name: '沉稳男声', voice: 'echo' },
      { name: '重复', voice: 'alloy' },          // 同 voice 去重
      { name: '', voice: 'x' },                  // 缺 name 跳过
      { name: 'y', voice: '' }                   // 缺 voice 跳过
    ]
  });
  assert.ok(r.ok);
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.baseUrl, 'https://tokenpapa.ai/v1');
  assert.equal(r.data.model, 'mimo-v2.5-tts');
  assert.equal(r.data.hasKey, true, '已配置 Key');
  assert.equal(r.data.voices.length, 2, '去重后仅 2 个音色');
  assert.deepEqual(r.data.voices.map((v) => v.voice), ['alloy', 'echo']);

  // 返回给前端的配置不含 apiKey 明文（只有 hasKey 布尔）
  assert.ok(!('apiKey' in r.data) || r.data.apiKey === undefined, '不返回 apiKey 字段');

  // 再次保存：apiKey 留空 = 不修改（hasKey 仍为 true）
  const r2 = tts.updateConfig({ enabled: false });
  assert.ok(r2.ok);
  assert.equal(r2.data.enabled, false);
  assert.equal(r2.data.hasKey, true, '留空 apiKey 不覆盖已有 Key');
});

test('TTS：端点拼接（speechUrl）', () => {
  const { tts } = fresh();
  // 含 /v1 → 拼接 /audio/speech
  assert.equal(tts.speechUrl('https://tokenpapa.ai/v1'), 'https://tokenpapa.ai/v1/audio/speech');
  // 已完整指向 audio/speech → 原样返回
  assert.equal(tts.speechUrl('https://x.com/v1/audio/speech'), 'https://x.com/v1/audio/speech');
  // 末尾斜杠 → 去掉
  assert.equal(tts.speechUrl('https://x.com/v1/'), 'https://x.com/v1/audio/speech');
  // 空地址 → 空
  assert.equal(tts.speechUrl(''), '');
});

test('TTS：合成前置校验（未启用 / 空地址 / 空文本 / 超长）', async () => {
  const { tts } = fresh();

  // 未启用 → 拒绝
  let r = await tts.synthesize('你好', 'alloy');
  assert.equal(r.ok, false);
  assert.match(r.error, /未启用/);

  // 启用但无地址 → 拒绝
  tts.updateConfig({ enabled: true, baseUrl: '' });
  r = await tts.synthesize('你好', 'alloy');
  assert.equal(r.ok, false);
  assert.match(r.error, /地址未配置/);

  // 空文本 → 拒绝
  tts.updateConfig({ enabled: true, baseUrl: 'https://x.com/v1' });
  r = await tts.synthesize('   ', 'alloy');
  assert.equal(r.ok, false);
  assert.match(r.error, /内容为空/);

  // 超长文本 → 拒绝（不真正发网络请求，先于 fetch 拦截）
  r = await tts.synthesize('长'.repeat(tts.MAX_TEXT + 1), 'alloy');
  assert.equal(r.ok, false);
  assert.match(r.error, /过长/);
});
