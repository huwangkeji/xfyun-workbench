'use strict';

/**
 * 应用对外分享（appShareService）+ 应用配置（agent v2 字段）+ 工作流新节点校验 用例
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-appshare-test-' + process.pid;

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
  return {
    agent: require('../src/agentService'),
    share: require('../src/appShareService'),
    kb: require('../src/kbService'),
    wf: require('../src/workflowService')
  };
}

const owner = { id: 'u1', username: 'owner', displayName: 'Owner', role: 'owner' };

function mkAgent(svc, extra) {
  const r = svc.agent.create(Object.assign({
    name: '客服机器人', emoji: '🛎️', desc: '对外客服',
    systemPrompt: '你是客服', visibility: 'public'
  }, extra || {}), owner);
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

test('应用配置：模型/温度/回复上限/知识库关联/参数变量 存取闭环', () => {
  const s = fresh();
  const a = mkAgent(s, {
    configId: 'cfg1', temperature: 0.3, maxTokens: 2048,
    kbId: '', kbMinScore: 1.5, kbMaxRefs: 8,
    variables: [
      { key: 'city', label: '城市', type: 'select', options: ['北京', '上海'], required: true },
      { key: 'note', label: '备注', type: 'paragraph', required: false }
    ]
  });
  assert.equal(a.configId, 'cfg1');
  assert.equal(a.temperature, 0.3);
  assert.equal(a.maxTokens, 2048);
  assert.equal(a.kbMinScore, 1.5);
  assert.equal(a.kbMaxRefs, 8);
  assert.equal(a.variables.length, 2);
  assert.deepEqual(a.variables[0].options, ['北京', '上海']);

  // 部分更新：只改温度，其他字段保留
  const u = s.agent.update(a.id, { temperature: 0.9 });
  assert.ok(u.ok);
  assert.equal(u.data.temperature, 0.9);
  assert.equal(u.data.configId, 'cfg1');
  assert.equal(u.data.variables.length, 2);
});

test('应用配置：参数变量校验（重复 key / 非法标识 / 下拉缺选项）', () => {
  const s = fresh();
  const bad = s.agent.create({
    name: '坏配置', systemPrompt: 'x',
    variables: [
      { key: 'dup', label: 'A', type: 'text' },
      { key: 'dup', label: 'B', type: 'text' },
      { key: '非法 key!', label: 'C', type: 'text' },
      { key: 'sel', label: '下拉', type: 'select', options: [] }
    ]
  }, owner);
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes('重复')));
  assert.ok(bad.errors.some((e) => e.includes('不合法')));
  assert.ok(bad.errors.some((e) => e.includes('下拉')));
});

test('对外分享：创建 / 密码校验 / QPM 限流 / 过期 / 撤销', () => {
  const s = fresh();
  const pub = mkAgent(s, {});
  const priv = mkAgent(s, { name: '私有应用', visibility: 'private' });

  // 私有应用不可分享
  const denied = s.share.create(s.agent.getForActor(priv.id, owner), {}, owner);
  assert.ok(!denied.ok);

  // 创建：QPM=2 + 密码 + 7 天过期
  const r = s.share.create(s.agent.getForActor(pub.id, owner), { qpm: 2, expiresInDays: 7, password: 'abc123' }, owner);
  assert.ok(r.ok);
  assert.ok(r.data.hasPassword);
  assert.equal(r.data.qpm, 2);
  assert.ok(r.data.expiresAt);

  // 密码错误 → 拒绝；正确 → 通过
  const rec = s.share.resolve(r.data.token);
  assert.ok(!s.share.verifyPassword(rec, 'wrong'));
  assert.ok(s.share.verifyPassword(rec, 'abc123'));

  // QPM：第 3 次/分钟被限
  assert.equal(s.share.checkRate(rec), null);
  assert.equal(s.share.checkRate(rec), null);
  const retry = s.share.checkRate(rec);
  assert.ok(retry && retry >= 1);

  // 列表 + 撤销
  assert.equal(s.share.listByAgent(pub.id).length, 1);
  assert.ok(s.share.revoke(pub.id, r.data.token));
  assert.equal(s.share.resolve(r.data.token), null);
});

test('对外分享：过期链接 resolve 返回 gone', () => {
  const s = fresh();
  const a = mkAgent(s, {});
  const r = s.share.create(s.agent.getForActor(a.id, owner), { expiresInDays: 7 }, owner);
  assert.ok(r.ok);
  // 直接把过期时间改到过去（避免毫秒级时序抖动）
  const db = require('../src/db');
  const d = db.load();
  d.appShares[0].expiresAt = '2000-01-01T00:00:00.000Z';
  db.save();
  const rec = s.share.resolve(r.data.token);
  assert.ok(rec && rec.gone === true);
});

test('对外分享：消息规整（截取最近 12 条 / 限长）', () => {
  const s = fresh();
  const msgs = [];
  for (let i = 0; i < 20; i++) msgs.push({ role: 'user', content: 'q' + i });
  const r1 = s.share.sanitizeMessages(msgs);
  assert.ok(!r1.error);
  assert.equal(r1.messages.length, 12);
  assert.equal(r1.messages[0].content, 'q8');
  const r2 = s.share.sanitizeMessages([{ role: 'user', content: 'x'.repeat(4001) }]);
  assert.ok(r2.error);
});

test('对外分享：删除应用级联撤销分享', () => {
  const s = fresh();
  const a = mkAgent(s, {});
  const r = s.share.create(s.agent.getForActor(a.id, owner), {}, owner);
  assert.ok(r.ok);
  const del = s.agent.remove(a.id);
  assert.ok(del.ok);
  assert.equal(s.share.resolve(r.data.token), null);
});

test('工作流新节点：问题补全/分类/提取/HTTP 配置校验', () => {
  const s = fresh();
  // 分类节点缺类目 → 创建被拒；补上类目 → 通过
  const bad = s.wf.create({ name: 'wf1', nodes: [
    { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
    { id: 'c1', type: 'classify', x: 100, y: 0, cfg: { configId: 'x' } },
    { id: 'c2', type: 'classify', x: 200, y: 0, cfg: { configId: 'x', categories: '售前,售后' } }
  ], edges: [] }, owner);
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes('类目')));

  // extract 缺字段 → 拒
  const bad2 = s.wf.create({ name: 'wf2', nodes: [
    { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
    { id: 'x1', type: 'extract', x: 100, y: 0, cfg: { configId: 'x', fields: '姓名,电话' } }
  ], edges: [] }, owner);
  assert.ok(bad2.ok);

  // http 非法 URL → 拒；合法 URL → 过
  const bad3 = s.wf.create({ name: 'wf3', nodes: [
    { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
    { id: 'h1', type: 'http', x: 100, y: 0, cfg: { url: 'ftp://bad' } }
  ], edges: [] }, owner);
  assert.ok(!bad3.ok);
  const ok3 = s.wf.create({ name: 'wf4', nodes: [
    { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
    { id: 'h1', type: 'http', x: 100, y: 0, cfg: { method: 'GET', url: 'https://example.com/api', timeoutSec: 5 } }
  ], edges: [] }, owner);
  assert.ok(ok3.ok, JSON.stringify(ok3));
});
