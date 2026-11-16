'use strict';

/**
 * MCP 服务管理（后台配置 MCP Server，智能体可勾选启用其工具）
 *
 * 数据形状（db.json 顶层 mcps 数组）：
 *   { id, name, transport: 'stdio', command, args:[], env:{}, enabled, ownerId, ownerName, createdAt, updatedAt }
 *
 * 能力：
 *   - CRUD（增删改查）
 *   - test(id)：连接 + initialize + tools/list，返回发现的工具
 *   - listTools(id)：发现工具（缓存友好，实时连接）
 *   - callTool(id, toolName, args)：调用工具（对话 function calling 用）
 */

const db = require('./db');
const mcpClient = require('./mcpClient');
const configService = require('./configService');

const MAX_MCPS = 50;

function nowIso() { return new Date().toISOString(); }

function data() {
  const d = db.load();
  if (!Array.isArray(d.mcps)) d.mcps = [];
  return d;
}

function findMcp(id) {
  return data().mcps.find((m) => m.id === id) || null;
}

/** 脱敏元信息（不含 env 明文，但保留命令/URL 用于展示） */
function meta(m) {
  return {
    id: m.id,
    name: m.name,
    transport: m.transport === 'stdio' ? 'stdio' : 'stdio', // 当前仅 stdio
    command: m.command || '',
    args: Array.isArray(m.args) ? m.args : [],
    envKeys: Object.keys(m.env || {}),
    enabled: m.enabled !== false,
    ownerId: m.ownerId || '',
    ownerName: m.ownerName || '',
    createdAt: m.createdAt,
    updatedAt: m.updatedAt
  };
}

function list() {
  return data().mcps.map(meta);
}

function get(id) {
  const m = findMcp(id);
  return m ? meta(m) : null;
}

/** 校验配置 */
function validate(body) {
  const errors = [];
  const name = String(body.name || '').trim();
  const command = String(body.command || '').trim();
  if (!name) errors.push('名称不能为空');
  if (name.length > 50) errors.push('名称最长 50 字符');
  if (!command) errors.push('启动命令不能为空');
  if (command.length > 500) errors.push('命令过长');
  const args = Array.isArray(body.args) ? body.args.map((a) => String(a).slice(0, 200)) : [];
  const env = {};
  if (body.env && typeof body.env === 'object') {
    for (const [k, v] of Object.entries(body.env)) {
      if (k && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) env[k] = String(v).slice(0, 1000);
    }
  }
  return { errors, name, command, args, env };
}

function create(body, actor) {
  const { errors, name, command, args, env } = validate(body);
  if (errors.length) return { ok: false, errors };
  const d = data();
  if (d.mcps.length >= MAX_MCPS) return { ok: false, errors: [`MCP 服务数量已达上限（${MAX_MCPS}）`] };
  if (d.mcps.some((m) => m.name === name)) return { ok: false, errors: ['已存在同名 MCP 服务'] };
  const mcp = {
    id: db.getNextId('mcp'),
    name,
    transport: 'stdio',
    command,
    args,
    env,
    enabled: body.enabled !== false,
    ownerId: actor ? actor.id : '',
    ownerName: actor ? (actor.displayName || actor.username) : '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  d.mcps.push(mcp);
  db.save();
  return { ok: true, data: meta(mcp) };
}

function update(id, body, actor) {
  const mcp = findMcp(id);
  if (!mcp) return { ok: false, notFound: true };
  const { errors, name, command, args, env } = validate({
    name: body.name !== undefined ? body.name : mcp.name,
    command: body.command !== undefined ? body.command : mcp.command,
    args: body.args !== undefined ? body.args : mcp.args,
    env: body.env !== undefined ? body.env : mcp.env
  });
  if (errors.length) return { ok: false, errors };
  mcp.name = name;
  mcp.command = command;
  mcp.args = args;
  mcp.env = env;
  if (body.enabled !== undefined) mcp.enabled = body.enabled !== false;
  mcp.updatedAt = nowIso();
  db.save();
  return { ok: true, data: meta(mcp) };
}

function remove(id) {
  const d = data();
  const idx = d.mcps.findIndex((m) => m.id === id);
  if (idx < 0) return { ok: false, notFound: true };
  const [removed] = d.mcps.splice(idx, 1);
  db.save();
  return { ok: true, data: { id: removed.id, name: removed.name } };
}

/** 用真实配置连接（env 值一般不需加密，直接透传） */
function buildConnectOpts(mcp) {
  const env = {};
  for (const [k, v] of Object.entries(mcp.env || {})) {
    env[k] = v;
  }
  return { command: mcp.command, args: mcp.args || [], env };
}

/** 测试连接：initialize + tools/list，返回工具列表 */
async function test(id) {
  const mcp = findMcp(id);
  if (!mcp) return { ok: false, notFound: true };
  const client = mcpClient.connect(buildConnectOpts(mcp));
  try {
    await client.initialize();
    const tools = await client.listTools();
    return { ok: true, data: { tools, count: tools.length } };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.close();
  }
}

/** 发现工具（连接 + tools/list） */
async function listTools(id) {
  const mcp = findMcp(id);
  if (!mcp) return { ok: false, notFound: true };
  if (mcp.enabled === false) return { ok: false, error: 'MCP 服务已停用' };
  const client = mcpClient.connect(buildConnectOpts(mcp));
  try {
    const tools = await client.listTools();
    return { ok: true, data: tools };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.close();
  }
}

/** 调用工具（对话 function calling 用） */
async function callTool(id, toolName, args) {
  const mcp = findMcp(id);
  if (!mcp) return { ok: false, notFound: true };
  if (mcp.enabled === false) return { ok: false, error: 'MCP 服务已停用' };
  const client = mcpClient.connect(buildConnectOpts(mcp));
  try {
    const result = await client.callTool(toolName, args || {});
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.close();
  }
}

module.exports = { list, get, create, update, remove, test, listTools, callTool };
