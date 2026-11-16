'use strict';

/**
 * 文件存储管理用例（node:test，零依赖）
 * 数据隔离：XFYUN_DATA_DIR 指向临时目录，XFYUN_UPLOAD_DIR 指向独立临时目录，绝不碰真实 data/ 与 public/uploads。
 */

const os = require('os');
const path = require('path');
const base = os.tmpdir() + '/xfyun-storage-test-' + process.pid;
process.env.XFYUN_DATA_DIR = base + '/data';
process.env.XFYUN_UPLOAD_DIR = base + '/uploads';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

beforeEach(() => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base + '/data', { recursive: true });
  fs.mkdirSync(base + '/uploads', { recursive: true });
});

function fresh() {
  return {
    kb: require('../src/kbService'),
    storage: require('../src/storageService'),
    userService: require('../src/userService'),
    db: require('../src/db')
  };
}

/** 写入一个测试文件到 uploads 指定相对路径 */
function touchFile(rel, content = 'hello') {
  const abs = path.join(process.env.XFYUN_UPLOAD_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test('存储：磁盘扫描 + 前缀归类（img_/file_/avatar_/孤儿）', () => {
  const { storage } = fresh();
  touchFile('2026-11-15/img_abc.png', 'img');
  touchFile('2026-11-15/file_xyz.pdf', 'pdf');
  touchFile('avatars/avatar_u1.png', 'a');
  touchFile('2026-11-15/mystery.bin', 'x'); // 无前缀、无引用 → 孤儿

  const r = storage.list();
  assert.ok(r.ok);
  assert.equal(r.stats.totalFiles, 4);
  const kinds = r.items.reduce((m, it) => { m[it.kind] = (m[it.kind] || 0) + 1; return m; }, {});
  assert.equal(kinds.image, 1, 'img_ 前缀 → image');
  assert.equal(kinds.attachment, 1, 'file_ 前缀 → attachment');
  assert.equal(kinds.avatar, 1, 'avatars/ 目录 → avatar');
  assert.equal(kinds.orphan, 1, '无前缀无引用 → orphan');
});

test('存储：知识库源文件落盘并被识别为 kb 引用', () => {
  const { kb, storage } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1', role: 'owner' }).data.id;
  const r = kb.addFile(kbId, '手册.txt', '这是知识库源文件内容，用于测试落盘与引用关联。\n\n第二段内容。');
  assert.ok(r.ok);
  assert.ok(r.data.file.storageUrl, '导入应落盘并记录 storageUrl');
  assert.ok(r.data.file.storageUrl.startsWith('/uploads/'), 'storageUrl 应为 /uploads/ 路径');

  // 磁盘上确实存在
  const abs = path.join(process.env.XFYUN_UPLOAD_DIR, r.data.file.storageUrl.replace(/^\/uploads\//, ''));
  assert.ok(fs.existsSync(abs), '源文件应落盘');

  // 存储列表应识别为 kb 引用
  const list = storage.list();
  const item = list.items.find((it) => it.url === r.data.file.storageUrl);
  assert.ok(item, '应能在存储列表找到该文件');
  assert.equal(item.kind, 'kb', '应归类为知识库文件');
  assert.equal(item.referenced, true, '应标记为被引用');
  assert.ok(item.refs.some((x) => x.includes('KB')), '引用来源应含知识库名');

  // 删除知识库文件时同步清理源文件
  const fileId = r.data.file.id;
  const del = kb.removeFile(kbId, fileId);
  assert.ok(del.ok);
  assert.ok(!fs.existsSync(abs), '删除知识库文件应同步删除落盘源文件');
});

test('存储：删除被引用文件默认拒绝，force 强删成功', () => {
  const { kb, storage } = fresh();
  const kbId = kb.create({ name: 'KB' }, { id: 'u1', role: 'owner' }).data.id;
  const r = kb.addFile(kbId, 'a.txt', '内容内容');
  const rel = r.data.file.storageUrl.replace(/^\/uploads\//, '');

  // 被引用 → 拒绝
  const rm1 = storage.removeFile(rel);
  assert.equal(rm1.ok, false, '被引用文件应拒绝删除');
  assert.equal(rm1.referenced, true);

  // force 强删 → 成功
  const rm2 = storage.removeFile(rel, { force: true });
  assert.ok(rm2.ok, 'force 应能强删');
  const abs = path.join(process.env.XFYUN_UPLOAD_DIR, rel);
  assert.ok(!fs.existsSync(abs), '强删后磁盘文件应不存在');
});

test('存储：清理孤儿文件', () => {
  const { storage } = fresh();
  touchFile('2026-11-15/file_orphan1.txt', 'a');
  touchFile('2026-11-15/mystery.bin', 'b');
  touchFile('2026-11-15/img_real.png', 'c'); // img_ 前缀有归类，不算孤儿

  const r = storage.cleanOrphans();
  assert.ok(r.ok);
  assert.equal(r.removed, 1, '仅无前缀的 mystery.bin 是孤儿（file_ 前缀算附件，非孤儿）');
  assert.ok(!fs.existsSync(path.join(process.env.XFYUN_UPLOAD_DIR, '2026-11-15', 'mystery.bin')));
  assert.ok(fs.existsSync(path.join(process.env.XFYUN_UPLOAD_DIR, '2026-11-15', 'file_orphan1.txt')), 'file_ 前缀不应被清理');
});

test('存储：路径穿越防护', () => {
  const { storage } = fresh();
  const bad = storage.removeFile('../../etc/passwd');
  assert.equal(bad.ok, false, '穿越路径应拒绝');
  assert.equal(bad.error, '文件路径非法');
});

test('存储：网盘分组 groups 计数与 entities 实体关联', () => {
  const { kb, storage, db } = fresh();
  // 造数据：1 个知识库 + 源文件；1 个会话含附件
  const kbId = kb.create({ name: '产品库' }, { id: 'u1', role: 'owner' }).data.id;
  kb.addFile(kbId, '手册.txt', '知识库源文件内容，用于分组测试。');

  const d = db.load();
  d.conversations = [{
    id: 'conv1', title: '测试会话', ownerId: 'u1',
    createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
    messages: [{
      id: 'm1', role: 'user', time: '2026-11-15T00:00:00.000Z',
      content: [{ type: 'file_url', file_url: { url: '/uploads/2026-11-15/file_att.pdf', name: '报表.pdf', mime: 'application/pdf' } }]
    }]
  }];
  // 落盘会话附件
  touchFile('2026-11-15/file_att.pdf', 'pdf');
  db.save();

  // groups 计数
  const g = storage.groups();
  assert.ok(g.ok);
  const byKey = Object.fromEntries(g.groups.map((x) => [x.key, x.count]));
  assert.equal(byKey.kb, 1, '知识库分组 = 1（1 个源文件）');
  assert.equal(byKey.conversation, 1, '对话记录分组 = 1（1 个附件）');
  assert.equal(byKey.agent, 0, '智能体分组 = 0');
  assert.equal(byKey.all, 2, '全部 = 2 个文件');
  assert.equal(g.stats.totalFiles, 2);

  // entities：知识库分组
  const kbEnt = storage.entities('kb');
  assert.equal(kbEnt.kind, 'entity');
  assert.equal(kbEnt.entities.length, 1);
  assert.equal(kbEnt.entities[0].name, '产品库');
  assert.equal(kbEnt.entities[0].fileCount, 1);
  assert.ok(kbEnt.entities[0].files[0].onDisk, '知识库源文件应已落盘');

  // entities：对话记录分组
  const convEnt = storage.entities('conversation');
  assert.equal(convEnt.entities.length, 1);
  assert.equal(convEnt.entities[0].title, '测试会话');
  assert.equal(convEnt.entities[0].fileCount, 1);
  assert.equal(convEnt.entities[0].files[0].kind, 'attachment');
  assert.equal(convEnt.entities[0].files[0].name, '报表.pdf');

  // entities：智能体分组（空）
  const agentEnt = storage.entities('agent');
  assert.equal(agentEnt.kind, 'entity');
  assert.equal(agentEnt.entities.length, 0);

  // entities：all 平铺
  const all = storage.entities('all');
  assert.equal(all.kind, 'file');
  assert.equal(all.total, 2);
});

test('存储：会话附件落盘后按业务归属归类（不再靠文件类型分组）', () => {
  const { storage, db } = fresh();
  const d = db.load();
  d.conversations = [{
    id: 'conv1', title: '带图片的会话', ownerId: 'u1',
    createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
    messages: [{
      id: 'm1', role: 'user', time: '2026-11-15T00:00:00.000Z',
      content: [
        { type: 'file_url', file_url: { url: '/uploads/2026-11-15/file_doc.txt', name: '文档.txt' } },
        { type: 'image_url', image_url: { url: '/uploads/2026-11-15/img_photo.png' } }
      ]
    }]
  }];
  touchFile('2026-11-15/file_doc.txt', 'txt');
  touchFile('2026-11-15/img_photo.png', 'png');
  db.save();

  const convEnt = storage.entities('conversation');
  assert.equal(convEnt.entities.length, 1);
  const files = convEnt.entities[0].files;
  assert.equal(files.length, 2);
  assert.equal(files[0].kind, 'attachment');
  assert.equal(files[1].kind, 'image');
  // 全部文件的类型统计仍按 kind 分类
  const all = storage.entities('all');
  const kinds = all.items.map((it) => it.kind).sort();
  assert.deepEqual(kinds, ['attachment', 'image']);
});
