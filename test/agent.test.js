'use strict';

/**
 * 智能体 / 通知公告 / 成员部门 用例（node:test，零依赖）
 * 数据隔离：XFYUN_DATA_DIR 指向临时目录。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-agent-test-' + process.pid;

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
    configService: require('../src/configService'),
    userService: require('../src/userService')
  };
}

const owner = { id: 'u1', username: 'owner', displayName: 'Owner', role: 'owner' };
const member = { id: 'u2', username: 'zhangsan', displayName: '张三', role: 'member' };

test('智能体：创建校验 / 可见性过滤 / 更新删除', () => {
  const { agent } = fresh();

  const r1 = agent.create({ name: '售前顾问', emoji: '💼', desc: '数字员工', systemPrompt: '你是售前顾问', visibility: 'public' }, owner);
  assert.ok(r1.ok);
  const r2 = agent.create({ name: '我的私货', systemPrompt: 'x', visibility: 'private' }, member);
  assert.ok(r2.ok);

  // 校验：空名 / 空提示 / 同名
  assert.ok(agent.create({ name: '', systemPrompt: 'x' }, owner).ok === false);
  assert.ok(agent.create({ name: 'X', systemPrompt: '' }, owner).ok === false);
  assert.ok(agent.create({ name: '售前顾问', systemPrompt: 'x' }, owner).ok === false, '同名应拒绝');

  // 可见性：member 看到 public + 自己的 private；看不到别人的 private
  const r3 = agent.create({ name: '他人的私有', systemPrompt: 'x', visibility: 'private' }, owner);
  const forMember = agent.listForActor(member);
  assert.ok(forMember.some((a) => a.id === r1.data.id), '公共可见');
  assert.ok(forMember.some((a) => a.id === r2.data.id), '本人的私有可见');
  assert.ok(!forMember.some((a) => a.id === r3.data.id), '他人的私有不可见');

  // 更新 / 删除
  const r4 = agent.update(r1.data.id, { name: '售前顾问 V2', systemPrompt: '你是资深售前顾问' });
  assert.ok(r4.ok && r4.data.name === '售前顾问 V2');
  assert.ok(agent.remove(r2.data.id).ok);
  assert.equal(agent.listAll().length, 2);
});

test('智能体：开场白与预设问题字段', () => {
  const { agent } = fresh();
  const r = agent.create({
    name: '测试助手', systemPrompt: '你是测试助手', visibility: 'public',
    welcome: '您好，我是测试助手！',
    suggests: ['第一个问题', '第二个问题', '', '第三个问题', '超出第四个的被丢弃']
  }, owner);
  assert.ok(r.ok);
  assert.equal(r.data.welcome, '您好，我是测试助手！');
  assert.equal(r.data.suggests.length, 4, '空项过滤，最多保留 4 条');
  assert.deepEqual(r.data.suggests, ['第一个问题', '第二个问题', '第三个问题', '超出第四个的被丢弃']);

  // 更新开场白
  const r2 = agent.update(r.data.id, { welcome: '新开场白' });
  assert.ok(r2.ok);
  assert.equal(r2.data.welcome, '新开场白');
});

test('智能体：预置模板幂等导入', () => {
  const { agent } = fresh();
  const s1 = agent.seedPresets(owner);
  assert.ok(s1.added > 0, '首次导入应有新增');
  const s2 = agent.seedPresets(owner);
  assert.equal(s2.added, 0, '重复导入应为 0 新增');
  assert.equal(agent.listAll().length, s1.total, '总数 = 模板数');
  // 模板均为 public，成员可见
  assert.equal(agent.listForActor(member).length, s1.total);
});

test('智能体：图标字段（icon 图片 URL 优先，emoji 回退）', () => {
  const { agent } = fresh();

  // 纯 emoji：icon 回退为 emoji
  const r1 = agent.create({ name: '售前顾问', emoji: '💼', systemPrompt: 'x' }, owner);
  assert.ok(r1.ok);
  assert.equal(r1.data.icon, '💼', '无图片时 icon 应回退 emoji');
  assert.equal(r1.data.emoji, '💼');

  // 自定义图片 URL：icon 存图片地址，emoji 仍保留
  const r2 = agent.create({ name: '客服助手', emoji: '🛎️', icon: '/uploads/icons/img_abc.png', systemPrompt: 'x' }, owner);
  assert.ok(r2.ok);
  assert.equal(r2.data.icon, '/uploads/icons/img_abc.png', 'icon 应存图片 URL');
  assert.equal(r2.data.emoji, '🛎️', 'emoji 字段应保留原值');

  // http 开头的图片 URL 也识别为图片
  const r3 = agent.create({ name: '外部图标', icon: 'https://cdn.example.com/a.png', systemPrompt: 'x' }, owner);
  assert.equal(r3.data.icon, 'https://cdn.example.com/a.png');

  // 更新 icon
  const up = agent.update(r1.data.id, { icon: '/uploads/icons/img_xyz.png' });
  assert.ok(up.ok);
  assert.equal(up.data.icon, '/uploads/icons/img_xyz.png');

  // 空 icon → 回退 emoji
  const up2 = agent.update(r1.data.id, { icon: '' });
  assert.equal(up2.data.icon, '💼', '清空 icon 后应回退 emoji');
});

test('智能体：员工自建属主校验（ownedAgent）', () => {
  const { agent } = fresh();
  const r = agent.create({ name: '我的应用', systemPrompt: 'x', visibility: 'public' }, member);
  assert.ok(r.ok);

  // 本人可管理
  assert.equal(agent.ownedAgent(r.data.id, member).ok, true);
  // 其他员工不可管理
  const other = { id: 'u3', username: 'lisi', displayName: '李四', role: 'member' };
  assert.equal(agent.ownedAgent(r.data.id, other).ok, false);
  assert.equal(agent.ownedAgent(r.data.id, other).forbidden, true);
  // 管理员可管理
  const admin = { id: 'u4', username: 'admin', displayName: 'Admin', role: 'admin' };
  assert.equal(agent.ownedAgent(r.data.id, admin).ok, true);
  // 不存在 → notFound
  assert.equal(agent.ownedAgent('nope', member).ok, false);
  assert.equal(agent.ownedAgent('nope', member).notFound, true);
});

test('通知公告：settings 写读闭环', () => {
  const { configService } = fresh();
  assert.equal(configService.getSettings().announcement.enabled, false, '默认关闭');

  const r = configService.updateSettings({
    announcement: { enabled: true, text: '周三晚 22:00 系统维护' }
  });
  assert.ok(r.ok);
  const a = configService.getSettings().announcement;
  assert.equal(a.enabled, true);
  assert.equal(a.text, '周三晚 22:00 系统维护');
  assert.ok(a.updatedAt, '应有更新时间');

  // 关闭但保留文本
  configService.updateSettings({ announcement: { enabled: false, text: '周三晚 22:00 系统维护' } });
  assert.equal(configService.getSettings().announcement.enabled, false);
  assert.equal(configService.getSettings().announcement.text, '周三晚 22:00 系统维护');
});

test('成员部门：创建 / 更新 / 出口含 department', () => {
  const { userService } = fresh();
  const r1 = userService.create({ username: 'zhangsan', displayName: '张三', password: 'Pass1234', role: 'member', department: '市场部' });
  assert.ok(r1.ok);
  assert.equal(r1.data.department, '市场部');

  const r2 = userService.update(r1.data.id, { department: '研发部' });
  assert.ok(r2.ok);
  assert.equal(userService.getById(r1.data.id).department, '研发部');

  // 超长截断到 30 字符
  const r3 = userService.update(r1.data.id, { department: '部'.repeat(40) });
  assert.ok(r3.ok);
  assert.equal(userService.getById(r1.data.id).department.length, 30);
});
