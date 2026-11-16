'use strict';

/**
 * 零依赖 MCP 客户端（Model Context Protocol）
 *
 * 实现 MCP 规范的核心子集，支持 stdio 传输（spawn 子进程 + JSON-RPC 2.0）：
 *   - initialize：握手（协商协议版本 / 能力）
 *   - tools/list：发现 MCP Server 暴露的工具
 *   - tools/call：调用某个工具，返回结果
 *
 * 协议要点（MCP 2024-11-05 起，initialize 用 notifications/initialized 通知握手）：
 *   1. 发送 initialize 请求
 *   2. 收到响应后发送 notifications/initialized 通知
 *   3. 之后可正常调用 tools/list、tools/call
 *
 * 传输格式：每行一个 JSON-RPC 消息（newline-delimited JSON，实际 MCP stdio 用 LSP 风格
 * Content-Length 头，但多数 MCP server 也接受纯行分隔 JSON；此处按行分隔读取，并兼容
 * Content-Length 头）。为稳妥起见，读取器按「先尝试 Content-Length 分帧，失败回退按行」。
 */

const { spawn } = require('child_process');
const readline = require('readline');

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT = 15000;  // 单次 RPC 超时（ms）

let seq = 0;
function nextId() {
  seq = (seq + 1) % 0x7fffffff;
  return seq;
}

/**
 * 创建 MCP stdio 客户端连接
 * @param {object} opts { command, args?:string[], env?:object, cwd?:string }
 * @returns {{request:Function, listTools:Function, callTool:Function, close:Function, pid:number}}
 */
function connect(opts) {
  const command = String(opts.command || '').trim();
  if (!command) throw new Error('MCP 命令不能为空');

  const child = spawn(command, Array.isArray(opts.args) ? opts.args : [], {
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  });

  const pending = new Map();       // id -> {resolve, reject, timer}
  let buffer = '';                 // 累积的未解析字节
  let closed = false;
  let stderrTail = '';             // stderr 最近输出（诊断用）
  let initialized = false;

  child.on('error', (e) => {
    closed = true;
    for (const [, p] of pending) p.reject(new Error(`MCP 子进程启动失败：${e.message}`));
    pending.clear();
  });

  child.on('exit', (code) => {
    if (closed) return;
    closed = true;
    const err = new Error(`MCP 子进程已退出（code ${code}）${stderrTail ? '：' + stderrTail.slice(0, 200) : ''}`);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  });

  child.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-1000);
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    parseBuffer();
  });

  function parseBuffer() {
    // 尝试 Content-Length 分帧
    let idx;
    while (true) {
      const headerMatch = buffer.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/);
      if (headerMatch) {
        const len = parseInt(headerMatch[1], 10);
        if (buffer.length >= headerMatch[0].length + len) {
          const body = buffer.slice(headerMatch[0].length, headerMatch[0].length + len);
          buffer = buffer.slice(headerMatch[0].length + len);
          try { handleMessage(JSON.parse(body)); } catch (_) {}
          continue;
        }
        return; // 等更多数据
      }
      // 回退：按行分隔
      idx = buffer.indexOf('\n');
      if (idx < 0) return;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try { handleMessage(JSON.parse(line)); } catch (_) {}
      }
    }
  }

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    // 服务端通知（无 id）
    if (msg.id === undefined || msg.id === null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`MCP 错误 ${msg.error.code || ''}：${msg.error.message || JSON.stringify(msg.error)}`));
    else p.resolve(msg.result);
  }

  function request(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    if (closed) return Promise.reject(new Error('MCP 连接已关闭'));
    const id = nextId();
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP 请求超时（${method}）`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify(payload) + '\n', (e) => {
        if (e) { pending.delete(id); clearTimeout(timer); reject(new Error(`写入失败：${e.message}`)); }
      });
    });
  }

  async function initialize() {
    const r = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'xfyun-workbench', version: '2.0.0' }
    }, DEFAULT_TIMEOUT);
    initialized = true;
    // 握手完成通知（部分 server 需要收到才继续处理后续请求）
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch (_) {}
    return r;
  }

  async function listTools() {
    if (!initialized) await initialize();
    const r = await request('tools/list', {}, DEFAULT_TIMEOUT);
    const tools = (r && r.tools) || [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} }
    }));
  }

  async function callTool(name, args = {}) {
    if (!initialized) await initialize();
    const r = await request('tools/call', { name, arguments: args }, DEFAULT_TIMEOUT);
    // 结果内容：content 数组（文本/图片等），或早期规范的直接字段
    return extractToolResult(r);
  }

  function close() {
    if (closed) return;
    closed = true;
    try { child.kill(); } catch (_) {}
  }

  return { request, initialize, listTools, callTool, close, get pid() { return child.pid; }, isClosed: () => closed };
}

/** 从 tools/call 响应提取可读文本 */
function extractToolResult(r) {
  if (!r) return '';
  if (Array.isArray(r.content)) {
    const texts = r.content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text);
    if (texts.length) return texts.join('\n');
    // 图片等非文本内容：给出描述
    const others = r.content.filter((c) => c && c.type !== 'text');
    if (others.length) return `[非文本内容 ${others.length} 项]`;
    return '';
  }
  if (r.structuredContent !== undefined) return JSON.stringify(r.structuredContent);
  if (r.text !== undefined) return String(r.text);
  return JSON.stringify(r);
}

module.exports = { connect, extractToolResult, PROTOCOL_VERSION };
