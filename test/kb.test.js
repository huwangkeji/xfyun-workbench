'use strict';

/**
 * 知识库 MVP 用例（node:test，零依赖）
 * 运行：npm test（node --test test/ 会执行本目录全部测试文件）
 * 数据隔离：通过 XFYUN_DATA_DIR 指向临时目录，绝不碰 data/db.json。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-kb-test-' + process.pid;

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
    kb: require('../src/kbService'),
    configService: require('../src/configService'),
    xfyun: require('../src/xfyun')
  };
}

test('知识库：创建 / 改名 / 同名校验 / 删除', () => {
  const { kb } = fresh();
  const actor = { id: 'u1', username: 'owner', displayName: 'Owner' };

  const r1 = kb.create({ name: '产品手册' }, actor);
  assert.ok(r1.ok);
  assert.equal(r1.data.chunkCount, 0);

  assert.ok(kb.create({ name: '产品手册' }, actor).ok === false, '同名应拒绝');
  assert.ok(kb.create({ name: '' }, actor).ok === false, '空名应拒绝');

  const r2 = kb.update(r1.data.id, { name: '产品手册 V2', remark: '备注' });
  assert.ok(r2.ok);
  assert.equal(r2.data.name, '产品手册 V2');

  const r3 = kb.remove(r1.data.id);
  assert.ok(r3.ok);
  assert.equal(kb.list().length, 0);
});

test('知识库：导入分段（段落聚合 / 超长硬切 / overlap）', () => {
  const { kb } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1' }).data.id;

  // 三个段落，每段 21 字 × 5 = 105 字符 → 默认 500 字符块应聚合为一个 chunk
  const para = '这是一段测试文本，用于验证知识库分段逻辑。'.repeat(5);
  const text1 = [para, para, para].join('\n\n');
  const r1 = kb.addFile(kbId, 'a.txt', text1);
  assert.ok(r1.ok, '导入应成功: ' + JSON.stringify(r1.errors || ''));
  assert.equal(r1.data.chunkCount, 1, '三段 ~100 字符合进一个 500 字符块');

  // 超长单段（3000 字符）→ 硬切成多块
  const long = '长'.repeat(3000);
  const r2 = kb.addFile(kbId, 'b.txt', long);
  assert.ok(r2.ok);
  assert.ok(r2.data.chunkCount >= 6, `3000 字符至少切 6 块，实际 ${r2.data.chunkCount}`);

  // 文件列表与容量
  const detail = kb.get(kbId);
  assert.equal(detail.files.length, 2);
  assert.equal(detail.chunkCount, r1.data.chunkCount + r2.data.chunkCount);

  // 空内容 / 超大内容拒绝
  assert.ok(kb.addFile(kbId, 'c.txt', '   ').ok === false);
  assert.ok(kb.addFile(kbId, 'd.txt', 'x'.repeat(2 * 1024 * 1024 + 1)).ok === false);

  // 删除文件 → 分段随之删除
  const del = kb.removeFile(kbId, r2.data.file ? r2.data.file.id : detail.files[1].id);
  assert.ok(del.ok);
  assert.equal(kb.get(kbId).chunkCount, r1.data.chunkCount);
});

test('知识库：检索打分（命中排序 / 无命中返回空）', () => {
  const { kb } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1' }).data.id;

  kb.addFile(kbId, 'faq.txt', [
    '退货政策：自签收之日起 7 天内可无理由退货，需保持商品完好。',
    '发货时效：工作日下午 3 点前下单当天发货，节假日顺延。',
    '发票说明：支持电子发票，下单时备注抬头即可。'
  ].join('\n\n'));

  const r1 = kb.search(kbId, '退货政策是什么？');
  assert.ok(r1.ok);
  assert.ok(r1.chunks.length >= 1);
  assert.ok(r1.chunks[0].text.includes('退货'), '最高分分段应含「退货」');

  const r2 = kb.search(kbId, '完全无关的量子纠缠内容');
  assert.ok(r2.ok, '无命中也应 ok');
  assert.equal(r2.chunks.length, 0, '无命中返回空数组');

  // TopK 限制
  const big = Array.from({ length: 30 }, (_, i) => `第 ${i} 条：退换货相关说明 ${i}`).join('\n\n');
  kb.addFile(kbId, 'big.txt', big);
  const r3 = kb.search(kbId, '退换货', 3);
  assert.ok(r3.chunks.length <= 3, 'TopK 应生效');
});

test('对话注入：apiStyle=openai 使用 /v1 端点并过滤讯飞私有参数', () => {
  const { xfyun, configService } = fresh();

  // URL 拼接规则
  assert.equal(xfyun.chatUrl({ apiStyle: 'xfyun', baseUrl: 'https://maas-api.xf-yun.com' }), 'https://maas-api.xf-yun.com/v2/chat/completions');
  assert.equal(xfyun.chatUrl({ apiStyle: 'openai', baseUrl: 'https://api.openai.com' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(xfyun.chatUrl({ apiStyle: 'openai', baseUrl: 'https://api.openai.com/v1' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(xfyun.chatUrl({ apiStyle: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(xfyun.chatUrl({ apiStyle: 'openai', baseUrl: 'https://x.com/v1/chat/completions' }), 'https://x.com/v1/chat/completions');

  // 请求体：openai 风格 → max_tokens；不携带 enable_thinking / reasoning_effort / web_search 工具
  const cfgOpen = configService.validateConfig({
    name: '兼容', apiStyle: 'openai', baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test-12345678', model: 'deepseek-chat',
    maxTokens: 512, enableThinking: true, webSearch: true
  }).cfg;
  const body = xfyun.buildChatBody(cfgOpen, [{ role: 'user', content: 'hi' }], { enable_thinking: true, reasoning_effort: 'max' });
  assert.equal(body.max_tokens, 512);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.enable_thinking, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.tools, undefined);
  assert.equal(body.model, 'deepseek-chat');

  // 请求体：xfyun 风格保持原有行为
  const cfgXf = configService.validateConfig({
    name: '讯飞', apiKey: 'ak-test-12345678', model: 'xopglm53', maxTokens: 512, enableThinking: true
  }).cfg;
  assert.equal(cfgXf.apiStyle, 'xfyun', '缺省 apiStyle 应回落 xfyun');
  const bodyXf = xfyun.buildChatBody(cfgXf, [{ role: 'user', content: 'hi' }], {});
  assert.equal(bodyXf.max_completion_tokens, 512);
  assert.equal(bodyXf.enable_thinking, true, '配置 true 时应下发 enable_thinking');
  assert.equal(bodyXf.max_tokens, undefined);

  // 旧配置（无 apiStyle 字段）normalize 后补默认值
  const legacy = configService.normalizeConfig({ name: '旧', apiKey: 'ak-x', model: 'm' });
  assert.equal(legacy.apiStyle, 'xfyun');
});

test('预置知识库：幂等导入 / 内容检索命中', () => {
  const { kb } = fresh();
  const s1 = kb.seedPresets(null);
  assert.ok(s1.added > 0, '首次导入应有新增');
  assert.ok(s1.chunks > 0, '应产生预置分段');
  const s2 = kb.seedPresets(null);
  assert.equal(s2.added, 0, '重复导入应为 0 新增');
  assert.equal(kb.list().length, s1.total, '总数 = 预置库数');

  // 预置内容可被检索命中（功能完整性测试的数据基础）
  const faq = kb.list().find((k) => k.presetKey === 'preset.faq');
  assert.ok(faq, '应存在 FAQ 预置库');
  const r = kb.search(faq.id, '退货政策是什么');
  assert.ok(r.ok && r.chunks.length >= 1, 'FAQ 预置内容应命中');
  assert.ok(r.chunks[0].text.includes('退货'));
  assert.equal(kb.stats().kbCount, s1.total);
});

/* ================= V3.7：QA 拆分 / 精准数据 / 段落管理 / 权限 ================= */

test('QA 拆分导入：问答对成段 / 无标记块兜底 / 坏数据拒绝', () => {
  const { kb } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1' }).data.id;

  const qaText = [
    '问：退货政策是什么？\n答：自签收之日起 7 天内可无理由退货，需保持商品完好。',
    'Q: 发货时效？\nA: 工作日下午 3 点前下单当天发货。',
    '未标记的问题行\n这里直接是答案' // 无标记块：首行当问题、其余当答案
  ].join('\n\n');

  const r = kb.addFile(kbId, 'faq.txt', qaText, { mode: 'qa' });
  assert.ok(r.ok, 'QA 导入应成功: ' + JSON.stringify(r.errors || ''));
  assert.equal(r.data.chunkCount, 3, '三个问答块 → 三个分段');
  assert.equal(r.data.mode, 'qa');

  const detail = kb.get(kbId);
  assert.equal(detail.files[0].mode, 'qa', '文件应记录导入方式');

  // 第一段：问/答字段齐备
  const chunks = kb.listChunks(kbId, { limit: 10 });
  assert.equal(chunks.items[0].type, 'qa');
  assert.ok(chunks.items[0].q.includes('退货政策'));
  assert.ok(chunks.items[0].a.includes('7 天内'));
  // 无标记块兜底
  assert.ok(chunks.items[2].q.includes('未标记的问题'), '无标记块首行应作问题');
  assert.ok(chunks.items[2].a.includes('直接是答案'), '无标记块其余行应作答案');

  // 检索命中 QA 段
  const sr = kb.search(kbId, '退货政策');
  assert.ok(sr.chunks.length >= 1);
  assert.ok(sr.chunks[0].text.includes('问：'));

  // 坏数据：纯散行（无结构）也应按「问题=前50字」兜底成功，仅空内容拒绝
  assert.ok(kb.addFile(kbId, 'b.txt', '  ', { mode: 'qa' }).ok === false, '空内容应拒绝');
});

test('精准数据导入：CSV 行成段 / 索引键精确命中加权 / 引号转义', () => {
  const { kb } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1' }).data.id;

  const csv = [
    '工号,姓名,部门',
    '1001,张三,技术部',
    '1002,李四,"市场部,华东"',
    '1003,王五,财务部'
  ].join('\n');

  const r = kb.addFile(kbId, '员工表.csv', csv, { mode: 'data' });
  assert.ok(r.ok, '精准数据导入应成功: ' + JSON.stringify(r.errors || ''));
  assert.equal(r.data.chunkCount, 3, '三行数据 → 三条记录');
  assert.equal(r.data.mode, 'data');

  const chunks = kb.listChunks(kbId, { limit: 10 });
  assert.equal(chunks.items[0].type, 'data');
  assert.equal(chunks.items[0].key, '1001', '首列应为索引键');
  assert.ok(chunks.items[0].text.includes('姓名：张三'), '字段：值 渲染');
  assert.ok(chunks.items[1].text.includes('市场部,华东'), '带引号逗号的单元格应完整解析');

  // 精确命中：查询 = 索引键 → 高分 + exact 标记 + 排第一
  const sr = kb.search(kbId, '1002');
  assert.ok(sr.chunks.length >= 1, '索引键精确命中应有结果');
  assert.equal(sr.chunks[0].text.includes('李四'), true);
  assert.ok(sr.chunks[0].score >= 1000, `精确命中应拿到高额加权，实际 ${sr.chunks[0].score}`);
  assert.equal(sr.chunks[0].exact, true, '精确命中应带 exact 标记');

  // 关键词命中（非精确）：正常打分、无 exact 标记
  const sr2 = kb.search(kbId, '张三在哪个部门');
  assert.ok(sr2.chunks.length >= 1);
  assert.ok(sr2.chunks[0].score < 1000, '关键词命中不应拿精确加权');
  assert.ok(!sr2.chunks[0].exact);
});

test('段落管理：分页 / 筛选 / 编辑 / 单删', () => {
  const { kb } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1' }).data.id;
  // 精准数据导入：每行一条记录（天然成段，便于精确断言段数）
  kb.addFile(kbId, 'a.csv', ['编号,水果,备注', '001,苹果,蔷薇科', '002,香蕉,富含钾', '003,橙子,维C丰富'].join('\n'), { mode: 'data' });
  kb.addFile(kbId, 'b.csv', ['编号,水果,备注', '004,葡萄,可酿酒', '005,西瓜,夏季水果'].join('\n'), { mode: 'data' });

  // 全量分页
  const all = kb.listChunks(kbId, { limit: 2, offset: 0 });
  assert.equal(all.total, 5);
  assert.equal(all.items.length, 2);
  const page2 = kb.listChunks(kbId, { limit: 2, offset: 2 });
  assert.equal(page2.items.length, 2);
  const page3 = kb.listChunks(kbId, { limit: 2, offset: 4 });
  assert.equal(page3.items.length, 1);

  // 按文件过滤
  const fileB = kb.get(kbId).files[1];
  const onlyB = kb.listChunks(kbId, { fileId: fileB.id });
  assert.equal(onlyB.total, 2);
  assert.ok(onlyB.items.every((c) => c.fileId === fileB.id));

  // 关键词过滤
  const kw = kb.listChunks(kbId, { q: '维C' });
  assert.equal(kw.total, 1);
  assert.ok(kw.items[0].text.includes('橙子'));

  // 编辑分段
  const target = all.items[0];
  const up = kb.updateChunk(kbId, target.id, '编号：001\n水果：苹果\n备注：蔷薇科水果，品种繁多。');
  assert.ok(up.ok);
  assert.ok(kb.listChunks(kbId, { q: '品种繁多' }).total === 1, '编辑后新内容可检索到');
  assert.equal(kb.updateChunk(kbId, target.id, '   ').ok === false, true, '清空内容应拒绝');

  // 单删分段 + 文件分段删光后文件记录移除
  const bChunks = kb.listChunks(kbId, { fileId: fileB.id }).items;
  for (const c of bChunks) {
    assert.ok(kb.removeChunk(kbId, c.id).ok);
  }
  const detail = kb.get(kbId);
  assert.equal(detail.files.length, 1, 'b.csv 分段删光后文件记录应移除');
  assert.equal(detail.chunkCount, 3);
});

test('知识库权限：private 库成员不可用 / 创建者与管理员可用 / 列表过滤', () => {
  const { kb } = fresh();
  const owner = { id: 'u1', username: 'owner', role: 'owner' };
  const creator = { id: 'u2', username: 'zhang', role: 'member' };
  const other = { id: 'u3', username: 'li', role: 'member' };
  const admin = { id: 'u4', username: 'wang', role: 'admin' };

  // 默认全员库
  const pub = kb.create({ name: '公共库' }, creator).data;
  assert.equal(pub.visibility, 'all');
  assert.ok(kb.canUse({ visibility: 'all', ownerId: creator.id }, other), '全员库成员可用');
  assert.ok(!kb.canUse({ visibility: 'all', ownerId: creator.id }, null), '访客（未登录）不可用');

  // 私有库
  const priv = kb.create({ name: '私有库', visibility: 'private' }, creator).data;
  assert.equal(priv.visibility, 'private');
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id }, creator), '创建者可用');
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id }, admin), '管理员可用');
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id }, owner), 'owner 可用');
  assert.ok(!kb.canUse({ visibility: 'private', ownerId: creator.id }, other), '其他成员不可用');

  // 使用端列表过滤
  const visibleForOther = kb.listForUser(other).map((k) => k.name);
  assert.ok(visibleForOther.includes('公共库'));
  assert.ok(!visibleForOther.includes('私有库'), '私有库不应出现在他人列表');
  const visibleForCreator = kb.listForUser(creator).map((k) => k.name);
  assert.ok(visibleForCreator.includes('私有库'), '创建者应看到自己的私有库');

  // 权限切换
  const upd = kb.update(priv.id, { visibility: 'all' });
  assert.ok(upd.ok);
  assert.equal(upd.data.visibility, 'all');
  assert.ok(kb.canUse({ visibility: 'all', ownerId: creator.id }, other), '切回全员后成员可用');
});

test('知识库：员工自建属主校验（ownedKb）', () => {
  const { kb } = fresh();
  const member = { id: 'u2', username: 'zhang', role: 'member' };
  const other = { id: 'u3', username: 'li', role: 'member' };
  const admin = { id: 'u4', username: 'wang', role: 'admin' };

  const r = kb.create({ name: '我的知识库', visibility: 'private' }, member);
  assert.ok(r.ok);

  // 本人可管理
  assert.equal(kb.ownedKb(r.data.id, member).ok, true);
  // 其他员工不可管理
  assert.equal(kb.ownedKb(r.data.id, other).ok, false);
  assert.equal(kb.ownedKb(r.data.id, other).forbidden, true);
  // 管理员可管理
  assert.equal(kb.ownedKb(r.data.id, admin).ok, true);
  // 不存在 → notFound
  assert.equal(kb.ownedKb('nope', member).ok, false);
  assert.equal(kb.ownedKb('nope', member).notFound, true);
});

test('知识库：成员级授权（添加 / 编辑权限切换 / 移除 / canUse 扩展）', () => {
  const { kb } = fresh();
  const creator = { id: 'u2', username: 'zhang', displayName: '张三', role: 'member' };
  const m1 = { id: 'u5', username: 'li', displayName: '李四', role: 'member' };
  const m2 = { id: 'u6', username: 'wang', displayName: '王五', role: 'member' };
  const outsider = { id: 'u7', username: 'zhao', displayName: '赵六', role: 'member' };

  const priv = kb.create({ name: '私有协作库', visibility: 'private' }, creator).data;

  // 添加成员（默认只读）
  const add1 = kb.addMember(priv.id, { id: m1.id, username: m1.username, displayName: m1.displayName, role: m1.role }, false);
  assert.ok(add1.ok);
  assert.equal(add1.data.length, 1);
  assert.equal(add1.data[0].canEdit, false, '默认只读');
  assert.equal(add1.data[0].userName, '李四');

  // 重复添加不应重复（去重）
  const dup = kb.addMember(priv.id, { id: m1.id, username: m1.username, displayName: m1.displayName, role: m1.role }, true);
  assert.equal(dup.data.length, 1, '重复添加应去重');

  // 创建者本人不可加入成员列表
  const ownerAdd = kb.addMember(priv.id, { id: creator.id, username: creator.username, displayName: creator.displayName, role: creator.role }, true);
  assert.equal(ownerAdd.skipped, true, '创建者应跳过');

  // 添加第二个成员（可编辑）
  const add2 = kb.addMember(priv.id, { id: m2.id, username: m2.username, displayName: m2.displayName, role: m2.role }, true);
  assert.equal(add2.data.length, 2);

  // 详情带出 members + memberCount
  const detail = kb.get(priv.id);
  assert.equal(detail.members.length, 2);
  assert.equal(detail.memberCount, 2);

  // 切换编辑权限
  const upd = kb.updateMemberEdit(priv.id, m1.id, true);
  assert.ok(upd.ok);
  assert.equal(upd.data.find((m) => m.userId === m1.id).canEdit, true);

  // 不存在成员更新 → notFound
  assert.equal(kb.updateMemberEdit(priv.id, 'nope', true).notFound, true);

  // canUse：私有库成员可用（含只读成员）
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id, members: kb.get(priv.id).members }, m1), '授权成员（只读）可检索');
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id, members: kb.get(priv.id).members }, m2), '授权成员（可编辑）可检索');
  assert.ok(!kb.canUse({ visibility: 'private', ownerId: creator.id, members: kb.get(priv.id).members }, outsider), '未授权成员不可检索');
  assert.ok(kb.canUse({ visibility: 'private', ownerId: creator.id, members: kb.get(priv.id).members }, creator), '创建者恒可用');

  // 移除成员
  const rm = kb.removeMember(priv.id, m1.id);
  assert.ok(rm.ok);
  assert.equal(rm.data.length, 1);
  assert.ok(!kb.canUse({ visibility: 'private', ownerId: creator.id, members: rm.data }, m1), '移除后成员不可检索');
  assert.equal(kb.removeMember(priv.id, 'nope').data.length, 1, '移除不存在成员应幂等');
});

test('头像：上传落盘 / 元信息回带 avatarUrl / 清除', () => {
  // 头像落盘目录隔离到测试临时目录，避免污染真实 public/uploads
  process.env.XFYUN_AVATAR_DIR = DATA_DIR + '/avatars';
  const userService = require('../src/userService');
  const fs = require('fs');
  const path = require('path');

  // 构造合法 PNG（IHDR + IDAT + IEND，CRC 正确）
  const zlib = require('zlib');
  function makePng(w, h) {
    function chunk(type, data) {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const typeBuf = Buffer.from(type, 'ascii');
      const crcTable = [];
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
      let crc = 0xffffffff;
      for (const b of Buffer.concat([typeBuf, data])) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc);
      return Buffer.concat([len, typeBuf, data, crcBuf]);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
    const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]);
  }

  const user = userService.create({ username: 'avatarer', displayName: '头像测试', password: 'test12345', role: 'member' }).data;

  // 太小的图片应拒绝
  const small = makePng(10, 10).toString('base64');
  assert.ok(userService.setAvatar(user.id, `data:image/png;base64,${small}`).ok === false, '低于 50x50 应拒绝');

  // 合法图片应成功
  const png = makePng(64, 64).toString('base64');
  const r = userService.setAvatar(user.id, `data:image/png;base64,${png}`);
  assert.ok(r.ok, '头像上传应成功: ' + JSON.stringify(r));
  assert.ok(r.data.avatarUrl.startsWith('/uploads/avatars/'));
  const diskFile = path.join(DATA_DIR, 'avatars', path.basename(r.data.avatarUrl));
  assert.ok(fs.existsSync(diskFile), '头像文件应落盘到隔离目录');

  // 元信息回带 avatarUrl
  const me = userService.sanitize(userService.getById(user.id));
  assert.equal(me.avatarUrl, r.data.avatarUrl);

  // 清除头像
  const clear = userService.setAvatar(user.id, '');
  assert.ok(clear.ok);
  assert.equal(userService.sanitize(userService.getById(user.id)).avatarUrl, '');
});
