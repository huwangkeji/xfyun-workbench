'use strict';

/**
 * 账号体系核心用例（node:test，零依赖）
 * 运行：npm test
 * 数据隔离：通过 XFYUN_DATA_DIR 指向临时目录，绝不碰 data/db.json。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-test-' + process.pid;

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('node:path');

const DATA_DIR = process.env.XFYUN_DATA_DIR;

beforeEach(() => {
  // 每个用例前重置数据文件与模块缓存，保证互相独立
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
});

function freshModules() {
  return {
    db: require('../src/db'),
    adminAuth: require('../src/adminAuth'),
    userService: require('../src/userService'),
    conversationService: require('../src/conversationService'),
    auditService: require('../src/auditService'),
    configService: require('../src/configService')
  };
}

function fakeReq(ip = '127.0.0.1') {
  return { ip, socket: { remoteAddress: ip }, headers: {} };
}

test('迁移：旧后台密码 → owner 账号，历史数据打标，v1 兼容窗口', () => {
  const { db: d, adminAuth: a, userService: u } = freshModules();
  // 造一个「旧版」库：有 adminPasswordHash、有未打标会话
  const legacyHash = a.hashPassword('legacy-pass-1');
  d.load().settings.adminPasswordHash = legacyHash;
  d.load().conversations.push({ id: 'conv_old', title: '旧会话', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messages: [] });
  d.save();

  const r = u.bootstrapMigrate();
  assert.ok(r.ownerId, '应返回 ownerId');
  const owner = u.getByUsername('owner');
  assert.ok(owner, 'owner 账号应存在');
  assert.equal(owner.role, 'owner');
  assert.equal(owner.passwordHash, legacyHash, '哈希原样沿用（用户无需改密）');
  const conv = d.load().conversations[0];
  assert.equal(conv.ownerId, owner.id, '历史会话应打上 ownerId');
  assert.ok(d.load().settings.legacyV1CompatUntil, 'v1 兼容窗口应设置');

  // 幂等：再跑一次不重复建号
  u.bootstrapMigrate();
  assert.equal(d.load().users.filter((x) => x.username === 'owner').length, 1);
});

test('创建账号：字段校验与唯一性', () => {
  const { userService: u } = freshModules();
  u.bootstrapMigrate();
  const ok = u.create({ username: 'zhangsan', displayName: '张三', password: 'Pass1234', role: 'member' });
  assert.ok(ok.ok);
  assert.equal(ok.data.role, 'member');
  // 返回脱敏（无哈希），哈希只存在于内部记录
  assert.equal(ok.data.passwordHash, undefined, '返回必须脱敏');
  const stored = u.getByUsername('zhangsan');
  assert.equal(stored.passwordHash.startsWith('scrypt$1$'), true, '密码必须哈希存储');
  assert.equal(stored.passwordHash.includes('Pass1234'), false, '不得出现明文');

  assert.equal(u.create({ username: 'zhangsan', displayName: 'x', password: 'Pass1234' }).ok, false, '用户名唯一');
  assert.equal(u.create({ username: 'ab', displayName: 'x', password: 'Pass1234' }).ok, false, '用户名过短');
  assert.equal(u.create({ username: 'ZHANGSAN', displayName: 'x', password: 'Pass1234' }).ok, false, '用户名大小写不敏感唯一');
  assert.equal(u.create({ username: 'lisi', displayName: 'x', password: 'short1' }).ok, false, '密码过短');
  assert.equal(u.create({ username: 'lisi', displayName: 'x', password: 'allletters' }).ok, false, '密码缺数字');
  assert.equal(u.create({ username: 'lisi', displayName: 'x', password: '12345678' }).ok, false, '密码缺字母');
  assert.equal(u.create({ username: 'lisi', displayName: 'x', password: 'Pass1234', role: 'owner' }).ok, false, 'owner 唯一');
});

test('登录：成功 / 失败文案 / 停用拒绝 / 双维度限流', () => {
  const { userService: u } = freshModules();
  u.bootstrapMigrate();
  u.create({ username: 'zhangsan', displayName: '张三', password: 'Pass1234', role: 'member' });

  // 成功
  let r = u.login(fakeReq(), { username: 'zhangsan', password: 'Pass1234' });
  assert.ok(r.ok);
  assert.equal(r.user.username, 'zhangsan');
  assert.equal(r.user.passwordHash, undefined, '登录返回必须脱敏');

  // 错误密码与不存在用户：统一文案
  r = u.login(fakeReq(), { username: 'zhangsan', password: 'wrong123' });
  assert.equal(r.error, '用户名或密码错误');
  r = u.login(fakeReq(), { username: 'ghost', password: 'whatever1' });
  assert.equal(r.error, '用户名或密码错误', '不暴露用户名是否存在');

  // 停用拒绝
  const target = u.getByUsername('zhangsan');
  u.setStatus(target.id, 'disabled');
  r = u.login(fakeReq(), { username: 'zhangsan', password: 'Pass1234' });
  assert.equal(r.error, '账号已停用，请联系管理员');

  // 用户名维度限流：换 IP 也锁（换用户名计数从零开始）
  u.setStatus(target.id, 'active');
  for (let i = 0; i < 5; i++) u.login(fakeReq('10.0.0.9'), { username: 'zhangsan', password: 'wrong123' });
  r = u.login(fakeReq('10.0.0.10'), { username: 'zhangsan', password: 'Pass1234' });
  assert.equal(r.ok, false);
  assert.match(r.error, /失败次数过多/);
});

test('会话令牌：v2 只绑本人，改密/停用即时失效，篡改拒绝', () => {
  const { db: d, adminAuth: a, userService: u } = freshModules();
  a.bootstrap();
  u.bootstrapMigrate();
  u.create({ username: 'zhangsan', displayName: '张三', password: 'Pass1234', role: 'member' });
  u.create({ username: 'lisi', displayName: '李四', password: 'Lisi1234', role: 'admin' });
  const zs = u.getByUsername('zhangsan');
  const ls = u.getByUsername('lisi');

  const res = { setHeader(name, value) { this.cookie = value; } };
  a.issueTeamCookie(res, zs);
  const req = { headers: { cookie: res.cookie.split(';')[0] } };

  assert.ok(a.resolveTeamUser(req), '有效令牌应解析出用户');
  assert.equal(a.resolveTeamUser(req).id, zs.id);

  // 改密 → 旧令牌签名失效（只影响本人）
  u.changePassword(zs.id, 'Pass1234', 'Newpass123');
  assert.equal(a.resolveTeamUser(req), null, '改密后旧令牌应失效');

  // 李四的令牌不受影响
  const res2 = { setHeader(name, value) { this.cookie = value; } };
  a.issueTeamCookie(res2, ls);
  const req2 = { headers: { cookie: res2.cookie.split(';')[0] } };
  assert.ok(a.resolveTeamUser(req2), '他人会话不受影响');

  // 停用 → 令牌即时失效
  u.setStatus(ls.id, 'disabled');
  assert.equal(a.resolveTeamUser(req2), null, '停用后令牌应即时失效');

  // 篡改签名 / 过期
  const forged = { headers: { cookie: `team_token=${encodeURIComponent('v2.' + zs.id + '.99999999999999.forgedsig')}` } };
  assert.equal(a.resolveTeamUser(forged), null, '伪造签名应拒绝');
  const expired = { headers: { cookie: `team_token=${encodeURIComponent('v2.' + zs.id + '.1000000000000.abc')}` } };
  assert.equal(a.resolveTeamUser(expired), null, '过期令牌应拒绝');
});

test('数据可见范围：member 只看自己，admin 看全部，访客只看访客桶', () => {
  const { userService: u, conversationService: c } = freshModules();
  u.bootstrapMigrate();
  const owner = u.getByUsername('owner');
  u.create({ username: 'zhangsan', displayName: '张三', password: 'Pass1234', role: 'member' });
  const zs = u.getByUsername('zhangsan');

  c.create('owner 的会话', owner.id);
  c.create('张三的会话', zs.id);
  c.create('访客会话', null);

  const zsView = { id: zs.id, role: 'member' };
  const adminView = { id: owner.id, role: 'owner' };

  assert.deepEqual(c.listMeta(zsView).map((x) => x.title), ['张三的会话']);
  assert.equal(c.listMeta(adminView).length, 3);
  assert.deepEqual(c.listMeta(null).map((x) => x.title), ['访客会话']);

  // 范围外读取视同不存在
  const ownerConv = c.listMeta(adminView).find((x) => x.title === 'owner 的会话');
  assert.equal(c.getFull(ownerConv.id, zsView), null);
  assert.equal(c.setFeedback(ownerConv.id, 'msg_x', 'up', zsView), null, '范围外不可评价');

  // 员工在访客会话发言 → 收编为自己的会话
  const guestConv = c.listMeta(null)[0];
  c.appendMessages(guestConv.id, [{ role: 'user', content: 'hi' }], null, zs.id);
  assert.equal(c.getFull(guestConv.id, zsView) !== null, true, '收编后成员应可见');
});

test('消息 id 与评价：生成 / 互斥 / 取消 / 不顶置会话', () => {
  const { userService: u, conversationService: c } = freshModules();
  u.bootstrapMigrate();
  const owner = u.getByUsername('owner');
  const ownerView = { id: owner.id, role: 'owner' };
  const conv = c.create('测试', owner.id);
  const updated = c.appendMessages(conv.id, [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }], null, owner.id);
  assert.ok(updated.messages.every((m) => m.id), '消息应有 id');

  // 基准取「追加消息之后」：评价动作本身不应再顶置会话
  const before = c.getFullAny(conv.id).updatedAt;
  const mid = updated.messages[0].id;
  c.setFeedback(conv.id, mid, 'up', ownerView);
  let msg = c.getFullAny(conv.id).messages.find((m) => m.id === mid);
  assert.equal(msg.feedback.value, 'up');
  c.setFeedback(conv.id, mid, 'down', ownerView);
  msg = c.getFullAny(conv.id).messages.find((m) => m.id === mid);
  assert.equal(msg.feedback.value, 'down', '互斥改判');
  c.setFeedback(conv.id, mid, null, ownerView);
  msg = c.getFullAny(conv.id).messages.find((m) => m.id === mid);
  assert.equal(msg.feedback, null, '取消评价');
  assert.equal(c.getFullAny(conv.id).updatedAt, before, '评价不应更新会话时间');
});

test('审计日志：写入 / 筛选 / 环形缓冲上限', () => {
  const { db: d, auditService: audit } = freshModules();
  audit.log({ id: 'usr_1', username: 'zhangsan', displayName: '张三' }, audit.ACTIONS.LOGIN_OK, 'auth:zhangsan', '', '127.0.0.1');
  audit.log({ id: 'usr_1', username: 'zhangsan', displayName: '张三' }, audit.ACTIONS.LOGIN_FAIL, 'auth:zhangsan', '用户名或密码错误', '127.0.0.1');
  audit.log(null, audit.ACTIONS.CONFIG_DELETE, 'config:星火', '', '127.0.0.1');

  assert.equal(d.load().auditLogs.length, 3);
  const all = audit.list({});
  assert.equal(all.total, 3);
  assert.equal(all.items[0].action, 'config.delete', '最新在前');
  assert.equal(audit.list({ actorId: 'usr_1' }).total, 2);
  assert.equal(audit.list({ action: 'auth.login_fail' }).total, 1);
  assert.equal(audit.list({ actionPrefix: 'auth.' }).total, 2);
  assert.equal(audit.list({ keyword: '星火' }).total, 1);
  assert.equal(audit.recentForActor('usr_1').length, 2);

  // 环形缓冲：超过上限保留最新
  for (let i = 0; i < audit.MAX_AUDIT + 10; i++) {
    audit.log({ id: 'usr_1' }, audit.ACTIONS.LOGIN_OK, `auth:${i}`, '', '');
  }
  assert.equal(d.load().auditLogs.length, audit.MAX_AUDIT);
  assert.equal(audit.list({}).items[0].target, `auth:${audit.MAX_AUDIT + 9}`, '保留最新');
});

test('API Key 加密：有密钥时落库加密、读取解密；无密钥时原样', () => {
  const { configService: cs } = freshModules();
  // 无密钥：明文兼容
  let r = cs.create({ name: 'c1', apiKey: 'ak-plainkey12345', model: 'spark-x' });
  assert.ok(r.ok);
  assert.equal(cs.getFull(r.data.id).apiKey, 'ak-plainkey12345');
  assert.equal(r.data.apiKey.endsWith('2345'), true, '返回仍脱敏');

  // 有密钥：落库即加密，读取解密还原
  process.env.DB_ENCRYPT_KEY = 'test-passphrase';
  r = cs.create({ name: 'c2', apiKey: 'ak-secret99999', model: 'spark-x' });
  assert.ok(r.ok);
  const stored = require('../src/db').load().configs.find((c) => c.id === r.data.id);
  assert.equal(stored.apiKey.startsWith('enc:v1:'), true, '落库应为密文');
  assert.equal(cs.getFull(r.data.id).apiKey, 'ak-secret99999', '读取应解密');

  // 编辑时留空 Key → 保留原密文，不重复加密
  const upd = cs.update(r.data.id, { name: 'c2b' });
  assert.ok(upd.ok);
  const stored2 = require('../src/db').load().configs.find((c) => c.id === r.data.id);
  assert.equal(stored2.apiKey, stored.apiKey, '不应重复加密');
  assert.equal(cs.getFull(r.data.id).apiKey, 'ak-secret99999');

  // 丢失密钥 → 解密为空（上游将报鉴权失败，不会泄露明文）
  delete process.env.DB_ENCRYPT_KEY;
  assert.equal(cs.getFull(r.data.id).apiKey, '');
  process.env.DB_ENCRYPT_KEY = 'test-passphrase';
});

test('db 原子写：临时文件不残留，内容完整', () => {
  const { db: d } = freshModules();
  d.load().configs.push({ id: 'cfg_t', name: 't' });
  d.save();
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'db.json.tmp')), false, '不应残留 .tmp');
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf-8'));
  assert.equal(raw.configs[0].id, 'cfg_t');
});
