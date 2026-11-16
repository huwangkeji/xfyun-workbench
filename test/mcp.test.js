'use strict';

/**
 * MCP 服务 / 插件市场 / 智能体工具绑定 用例（node:test，零依赖）
 * 数据隔离：XFYUN_DATA_DIR 指向临时目录。
 */

process.env.XFYUN_DATA_DIR = require('os').tmpdir() + '/xfyun-mcp-test-' + process.pid;

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.XFYUN_DATA_DIR;

beforeEach(() => {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
});

function fresh() {
  return {
    plugin: require('../src/pluginService'),
    mcp: require('../src/mcpService'),
    mcpClient: require('../src/mcpClient'),
    agentTools: require('../src/agentTools'),
    agent: require('../src/agentService')
  };
}

const owner = { id: 'u1', username: 'owner', displayName: 'Owner', role: 'owner' };

/* ================= 插件市场 ================= */

test('插件市场：安装/卸载/启用停用/列表', () => {
  const { plugin } = fresh();
  const all = plugin.listAll();
  assert.ok(all.length >= 5, '内置插件至少 5 个');
  assert.ok(all.every((p) => !p.installed), '初始均未安装');

  assert.ok(plugin.install('calculator').ok);
  assert.ok(plugin.listAll().find((p) => p.key === 'calculator').installed);
  assert.ok(plugin.setEnabled('calculator', false).ok);
  assert.equal(plugin.listAll().find((p) => p.key === 'calculator').enabled, false);
  assert.ok(plugin.setEnabled('calculator', true).ok);
  assert.ok(plugin.uninstall('calculator').ok);
  assert.ok(!plugin.listAll().find((p) => p.key === 'calculator').installed);
  assert.equal(plugin.install('not_exist').ok, false);
});

test('插件：安全表达式求值 + 注入拦截', async () => {
  const { plugin } = fresh();
  plugin.install('calculator');
  assert.equal(await plugin.execute('calculator', { expression: '(3+5)*2' }), '16');
  assert.equal(await plugin.execute('calculator', { expression: 'sqrt(16)' }), '4');
  assert.equal(await plugin.execute('calculator', { expression: 'max(3,7)' }), '7');
  // 注入拦截
  await assert.rejects(() => plugin.execute('calculator', { expression: 'process.exit()' }));
  await assert.rejects(() => plugin.execute('calculator', { expression: 'require("fs")' }));
  await assert.rejects(() => plugin.execute('calculator', { expression: '1;2' }));
  // 未安装插件不可执行
  plugin.uninstall('calculator');
  await assert.rejects(() => plugin.execute('calculator', { expression: '1+1' }));
});

test('插件：toolDefs 导出 function calling 格式', () => {
  const { plugin } = fresh();
  const defs = plugin.toolDefs(['calculator', 'datetime']);
  assert.equal(defs.length, 2);
  assert.equal(defs[0].type, 'function');
  assert.equal(defs[0].function.name, 'calculator');
  assert.ok(defs[0].function.parameters);
});

/* ================= MCP 服务 ================= */

test('MCP：创建校验 / 列表 / 更新 / 删除 / 脱敏', () => {
  const { mcp } = fresh();
  const r = mcp.create({ name: '天气', command: 'node', args: ['srv.js'], env: { API_KEY: 'secret' } }, owner);
  assert.ok(r.ok);
  assert.equal(r.data.name, '天气');
  assert.deepEqual(r.data.envKeys, ['API_KEY'], 'env 值脱敏，仅暴露 key');
  assert.equal(r.data.env, undefined, 'meta 不含 env 明文');

  // 重名拦截
  const dup = mcp.create({ name: '天气', command: 'x' }, owner);
  assert.equal(dup.ok, false);

  // 校验
  const bad = mcp.create({ name: '', command: 'x' }, owner);
  assert.equal(bad.ok, false);

  // 更新
  const up = mcp.update(r.data.id, { name: '天气2' });
  assert.ok(up.ok);
  assert.equal(up.data.name, '天气2');

  // 删除
  assert.ok(mcp.remove(r.data.id).ok);
  assert.equal(mcp.get(r.data.id), null);
});

test('MCP：stdio 连接 / 发现工具 / 调用工具', async () => {
  const { mcp, mcpClient, agentTools } = fresh();
  // 内联构造一个极简 MCP echo server 文件
  const serverFile = path.join(DATA_DIR, 'echo.js');
  fs.writeFileSync(serverFile, `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => {
  l = l.trim(); if (!l) return;
  let m; try { m = JSON.parse(l); } catch (_) { return; }
  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} } } }) + '\\n');
  else if (m.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ tools:[{ name:'add', description:'加法', inputSchema:{ type:'object', properties:{ a:{type:'number'}, b:{type:'number'} } } }] } }) + '\\n');
  else if (m.method === 'tools/call') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ content:[{ type:'text', text:String((Number(m.params.arguments.a)||0)+(Number(m.params.arguments.b)||0)) }] } }) + '\\n');
});
`);

  const r = mcp.create({ name: 'echo', command: 'node', args: [serverFile], env: {} }, owner);
  assert.ok(r.ok);

  const testRes = await mcp.test(r.data.id);
  assert.ok(testRes.ok, testRes.error || '测试连接应成功');
  assert.equal(testRes.data.count, 1);
  assert.equal(testRes.data.tools[0].name, 'add');

  const callRes = await mcp.callTool(r.data.id, 'add', { a: 3, b: 4 });
  assert.ok(callRes.ok);
  assert.equal(callRes.data, '7');

  // 工具名映射
  assert.match(agentTools.mcpToolKey(r.data.id, 'add'), /^mcp_[A-Za-z0-9_-]{8}_add$/);

  mcp.remove(r.data.id);
});

/* ================= 智能体工具绑定 ================= */

test('智能体：plugins / mcpTools 字段持久化与校验', () => {
  const { agent } = fresh();
  const r = agent.create({
    name: '带工具智能体', systemPrompt: 'x',
    plugins: ['calculator', 'calculator', 'bad!!'],
    mcpTools: [{ mcpId: 'm1', tools: ['echo', 'echo'] }, { mcpId: '', tools: [] }]
  }, owner);
  assert.ok(r.ok);
  assert.deepEqual(r.data.plugins, ['calculator'], '插件去重、清洗非法值');
  assert.deepEqual(r.data.mcpTools, [{ mcpId: 'm1', tools: ['echo'] }], 'MCP 绑定去重、过滤空项');

  // 更新
  const up = agent.update(r.data.id, { plugins: ['datetime'] });
  assert.ok(up.ok);
  assert.deepEqual(up.data.plugins, ['datetime']);

  // meta 默认值
  const plain = agent.create({ name: '无工具', systemPrompt: 'x' }, owner);
  assert.deepEqual(plain.data.plugins, []);
  assert.deepEqual(plain.data.mcpTools, []);
});

test('agentTools.buildTools：插件 + MCP 工具合并', async () => {
  const { plugin, mcp, agentTools } = fresh();
  plugin.install('calculator');
  plugin.install('datetime');

  const serverFile = path.join(DATA_DIR, 'echo.js');
  fs.writeFileSync(serverFile, `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (l) => {
  l = l.trim(); if (!l) return;
  let m; try { m = JSON.parse(l); } catch (_) { return; }
  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} } } }) + '\\n');
  else if (m.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ tools:[{ name:'hello', description:'打招呼' }] } }) + '\\n');
  else if (m.method === 'tools/call') process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:m.id, result:{ content:[{ type:'text', text:'hi' }] } }) + '\\n');
});
`);
  const mr = mcp.create({ name: 'echo', command: 'node', args: [serverFile], env: {} }, owner);

  const { tools, registry } = await agentTools.buildTools({
    plugins: ['calculator', 'datetime'],
    mcpTools: [{ mcpId: mr.data.id, tools: ['hello'] }]
  });

  const names = tools.map((t) => t.function.name);
  assert.ok(names.includes('calculator'));
  assert.ok(names.includes('datetime'));
  assert.equal(names.filter((n) => n.startsWith('mcp_')).length, 1);
  assert.equal(registry.size, 3);

  // 执行插件工具
  assert.equal(await agentTools.executeTool(registry.get('calculator'), { expression: '2+2' }), '4');

  mcp.remove(mr.data.id);
  plugin.uninstall('calculator');
  plugin.uninstall('datetime');
});
