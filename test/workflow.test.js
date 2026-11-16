'use strict';

/**
 * 画布工作流用例：图校验 / CRUD / 拓扑执行（reply + kb 链路无需真实上游）。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-wf-test-' + process.pid;

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
    wf: require('../src/workflowService'),
    kb: require('../src/kbService'),
    configService: require('../src/configService')
  };
}

const owner = { id: 'u1', username: 'owner', displayName: 'Owner', role: 'owner' };

function sampleGraph() {
  return {
    nodes: [
      { id: 'n1', type: 'entry', x: 100, y: 100, cfg: {} },
      { id: 'n2', type: 'reply', x: 300, y: 100, cfg: { text: '这是固定回复：您好！' } }
    ],
    edges: [{ from: 'n1', to: 'n2' }]
  };
}

test('工作流：图校验（entry 唯一 / 环检测 / 类型校验）', () => {
  const { wf } = fresh();

  // 无入口
  const g1 = { nodes: [{ id: 'a', type: 'reply', x: 0, y: 0, cfg: { text: 'x' } }], edges: [] };
  assert.ok(wf.create({ name: 'W1', ...g1 }, owner).ok === false, '缺少入口应拒绝');

  // 双入口
  const g2 = {
    nodes: [{ id: 'a', type: 'entry', x: 0, y: 0, cfg: {} }, { id: 'b', type: 'entry', x: 9, y: 9, cfg: {} }],
    edges: []
  };
  assert.ok(wf.create({ name: 'W2', ...g2 }, owner).ok === false, '双入口应拒绝');

  // 环
  const g3 = {
    nodes: [
      { id: 'a', type: 'entry', x: 0, y: 0, cfg: {} },
      { id: 'b', type: 'reply', x: 9, y: 9, cfg: { text: 'x' } }
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  };
  assert.ok(wf.create({ name: 'W3', ...g3 }, owner).ok === false, '环应拒绝');

  // reply 未填内容
  const g4 = {
    nodes: [{ id: 'a', type: 'entry', x: 0, y: 0, cfg: {} }, { id: 'b', type: 'reply', x: 9, y: 9, cfg: { text: '' } }],
    edges: [{ from: 'a', to: 'b' }]
  };
  assert.ok(wf.create({ name: 'W4', ...g4 }, owner).ok === false, 'reply 空内容应拒绝');

  // 合法图
  const ok = wf.create({ name: 'W5', ...sampleGraph() }, owner);
  assert.ok(ok.ok, '合法图应通过: ' + JSON.stringify(ok.errors || ''));
  assert.equal(ok.data.nodeCount, 2);
});

test('工作流：执行 reply 链路与 kb 引用链路', async () => {
  const { wf, kb } = fresh();

  // 先造一个知识库
  const kbId = kb.create({ name: 'KB' }, owner).data.id;
  kb.addFile(kbId, 'faq.txt', '会员权益：年度会员享受 95 折优惠。\n\n发货时效：下午 3 点前下单当天发货。');

  // entry → kb → reply（reply 输出固定文本，链路经过 kb 节点验证拓扑执行）
  const g = {
    nodes: [
      { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
      { id: 'k', type: 'kb', x: 100, y: 0, cfg: { kbId, topK: 3 } },
      { id: 'r', type: 'reply', x: 200, y: 0, cfg: { text: '根据资料回复：会员 95 折。' } }
    ],
    edges: [{ from: 'e', to: 'k' }, { from: 'k', to: 'r' }]
  };
  const created = wf.create({ name: '客服流', ...g }, owner);
  assert.ok(created.ok, '创建应成功: ' + JSON.stringify(created.errors || ''));

  const run1 = await wf.run(created.data.id, '会员有什么优惠？');
  assert.ok(run1.ok, '执行应成功: ' + (run1.error || ''));
  assert.equal(run1.output, '根据资料回复：会员 95 折。');
  assert.equal(run1.steps.length, 3, '应按拓扑执行 3 步');
  assert.equal(run1.steps[1].type, 'kb');
  assert.ok(run1.steps[1].summary.includes('命中'), 'kb 步骤应报告命中');

  // 未命中的问题：kb 步骤显示未命中，流程仍走完
  const run2 = await wf.run(created.data.id, '量子纠缠是什么');
  assert.ok(run2.ok);
  assert.ok(run2.steps[1].summary.includes('未命中'));

  // 更新画布：改成只有 entry（缺 AI/reply 输出节点 → 输出为空也允许，但校验仍通过）
  const upd = wf.update(created.data.id, {
    nodes: [{ id: 'e', type: 'entry', x: 0, y: 0, cfg: {} }],
    edges: []
  });
  assert.ok(upd.ok);
  const run3 = await wf.run(created.data.id, 'hi');
  assert.ok(run3.ok);
  assert.equal(run3.output, '');
});

test('品牌设置：siteName / footerText 读写与默认回落', () => {
  const { configService } = fresh();
  assert.equal(configService.getSettings().siteName, '同聪星火', '默认站点名');
  configService.updateSettings({ siteName: '氢境智脑', footerText: '© 2026 氢境科技' });
  const s = configService.getSettings();
  assert.equal(s.siteName, '氢境智脑');
  assert.equal(s.footerText, '© 2026 氢境科技');

  // 清空站点名回落默认
  configService.updateSettings({ siteName: '   ' });
  assert.equal(configService.getSettings().siteName, '同聪星火');
});

test('配置能力类型：capabilities 白名单过滤 / ttiEnabled 联动', () => {
  const { configService } = fresh();
  const r = configService.validateConfig({
    name: '多模态', apiKey: 'sk-test-12345678', model: 'm',
    capabilities: ['chat', 'vision', 't2v', 'hack', 'tti']
  });
  assert.equal(r.errors.length, 0, '不应报错');
  assert.deepEqual(r.cfg.capabilities.sort(), ['chat', 't2v', 'vision'], '非法项应被过滤（tti 由 ttiEnabled 联动）');

  // ttiEnabled 开启时 getFull 注入 tti 能力
  const created = configService.create({
    name: '带图配置', apiKey: 'ak-test-12345678', model: 'xopglm53',
    capabilities: ['chat', 'vision'], ttiEnabled: true, ttiModel: 'img-v1'
  }, null);
  assert.ok(created.ok);
  const full = configService.getFull(created.data.id);
  assert.ok(full.capabilities.includes('tti'), 'ttiEnabled 应注入 tti 能力');
  assert.ok(full.capabilities.includes('vision'));
});

test('工作流：文本加工与判断器条件分支', async () => {
  const { wf } = fresh();
  const g = {
    nodes: [
      { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
      { id: 't', type: 'transform', x: 50, y: 0, cfg: { template: '[加工] {{input}}' } },
      { id: 'j', type: 'judge', x: 100, y: 0, cfg: { keywords: '价格,优惠' } },
      { id: 'y', type: 'reply', x: 150, y: 0, cfg: { text: '命中价格分支' } },
      { id: 'n', type: 'reply', x: 150, y: 80, cfg: { text: '未命中分支' } }
    ],
    edges: [
      { from: 'e', to: 't' },
      { from: 't', to: 'j' },
      { from: 'j', to: 'y', fromPort: 'yes' },
      { from: 'j', to: 'n', fromPort: 'no' }
    ]
  };
  const c = wf.create({ name: '分支流', ...g }, owner);
  assert.ok(c.ok, '创建成功: ' + JSON.stringify(c.errors || ''));

  const runYes = await wf.run(c.data.id, '这个有优惠吗？');
  assert.ok(runYes.ok, 'yes 分支执行: ' + (runYes.error || ''));
  assert.equal(runYes.output, '命中价格分支');
  assert.ok(runYes.steps.some((s) => s.type === 'judge' && s.branch === 'yes'), 'judge 步骤应记录 yes 分支');

  const runNo = await wf.run(c.data.id, '今天天气如何？');
  assert.ok(runNo.ok);
  assert.equal(runNo.output, '未命中分支');

  const bad = {
    name: 'bad',
    nodes: g.nodes.map((n) => (n.type === 'judge' ? { ...n, cfg: { keywords: '' } } : n)),
    edges: g.edges
  };
  assert.ok(wf.create(bad, owner).ok === false, 'judge 空关键词应拒绝');
});

test('工作流：分支死边级联——多输入节点经活分支仍执行', async () => {
  const { wf } = fresh();
  // rY 有两条入边：judge-yes 与 rN→rY；judge 未命中 yes 时该边死亡，
  // 但 entry→rN→rY 的活链路仍应让 rY 执行（旧实现会因入边凑不齐而卡死丢失输出）
  const g = {
    nodes: [
      { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
      { id: 'j', type: 'judge', x: 50, y: 0, cfg: { keywords: '价格,优惠' } },
      { id: 'y', type: 'reply', x: 100, y: 0, cfg: { text: '固定回复Y' } },
      { id: 'n', type: 'reply', x: 100, y: 80, cfg: { text: '固定回复N' } }
    ],
    edges: [
      { from: 'e', to: 'j' },
      { from: 'j', to: 'y', fromPort: 'yes' },
      { from: 'e', to: 'n' },
      { from: 'n', to: 'y' }
    ]
  };
  const c = wf.create({ name: '级联流', ...g }, owner);
  assert.ok(c.ok, '创建成功: ' + JSON.stringify(c.errors || ''));

  // 无关键词：judge 走 no，rN 执行，rN→rY 激活；j-yes 边死亡后 rY 仍执行
  const runNo = await wf.run(c.data.id, '今天天气如何？');
  assert.ok(runNo.ok, '执行成功: ' + (runNo.error || ''));
  assert.equal(runNo.output, '固定回复Y', '死边级联后 rY 应经 rN 活链路执行');
  assert.ok(runNo.steps.some((s) => s.type === 'reply' && s.summary === '固定回复N'), 'rN 应已执行');

  // 有关键词：j-yes 激活 rY
  const runYes = await wf.run(c.data.id, '有什么优惠');
  assert.ok(runYes.ok);
  assert.equal(runYes.output, '固定回复Y');
});

test('工作流：知识库搜索多分支（命中 hit / 结果为空 miss）', async () => {
  const { wf, kb } = fresh();

  const kbId = kb.create({ name: 'KB' }, owner).data.id;
  kb.addFile(kbId, 'faq.txt', '会员权益：年度会员享受 95 折优惠。');

  const g = {
    nodes: [
      { id: 'e', type: 'entry', x: 0, y: 0, cfg: {} },
      { id: 'k', type: 'kb', x: 100, y: 0, cfg: { kbId, topK: 3 } },
      { id: 'hit', type: 'reply', x: 200, y: 0, cfg: { text: '命中资料回复' } },
      { id: 'miss', type: 'reply', x: 200, y: 80, cfg: { text: '未命中，走兜底' } }
    ],
    edges: [
      { from: 'e', to: 'k' },
      { from: 'k', to: 'hit', fromPort: 'hit' },
      { from: 'k', to: 'miss', fromPort: 'miss' }
    ]
  };
  const c = wf.create({ name: '知识库分支', ...g }, owner);
  assert.ok(c.ok, '创建成功: ' + JSON.stringify(c.errors || ''));

  // 命中：走 hit 分支
  const runHit = await wf.run(c.data.id, '会员有什么优惠');
  assert.ok(runHit.ok, '执行成功: ' + (runHit.error || ''));
  assert.equal(runHit.output, '命中资料回复');
  assert.ok(runHit.steps.some((s) => s.type === 'kb' && s.branch === 'hit'), 'kb 步骤应记录 hit 分支');

  // 未命中：走 miss 分支
  const runMiss = await wf.run(c.data.id, '量子纠缠是什么');
  assert.ok(runMiss.ok);
  assert.equal(runMiss.output, '未命中，走兜底');
  assert.ok(runMiss.steps.some((s) => s.type === 'kb' && s.branch === 'miss'), 'kb 步骤应记录 miss 分支');
});
