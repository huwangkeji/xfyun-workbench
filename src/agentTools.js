'use strict';

/**
 * 智能体工具能力协调器（MCP + 插件）
 *
 * 职责：
 *   1. 根据智能体绑定（agent.plugins / agent.mcpTools）生成 function calling 的 tools 定义
 *   2. 执行模型返回的 tool_calls（分发到插件 execute 或 MCP callTool）
 *
 * 工具命名规则（避免 MCP 工具与插件重名冲突）：
 *   - 插件：原 key（如 calculator、datetime）
 *   - MCP 工具：`mcp_<mcpId>_<toolName>`（mcpId 取后 8 位，防超长）
 */

const pluginService = require('./pluginService');
const mcpService = require('./mcpService');

/** MCP 工具名映射：`mcp_<suffix>_<toolName>` -> { mcpId, toolName }（suffix 固定取 mcpId 后 8 位） */
function mcpToolKey(mcpId, toolName) {
  const suffix = String(mcpId).slice(-8);
  return `mcp_${suffix}_${toolName}`;
}

/** 解析 MCP 工具 key，返回 { suffix, toolName } 或 null（suffix 恰为 8 位，规避工具名含下划线歧义） */
function parseMcpToolKey(key) {
  const m = /^mcp_([A-Za-z0-9_-]{8})_(.+)$/.exec(String(key || ''));
  if (!m) return null;
  return { suffix: m[1], toolName: m[2] };
}

/**
 * 生成智能体绑定的 tools 定义（OpenAI function calling 格式）
 * @param {object} agent 智能体原始对象（含 plugins / mcpTools 字段）
 * @returns {{tools:Array, registry:Map}} tools 定义数组 + 名称->执行器注册表
 */
async function buildTools(agent) {
  const tools = [];
  const registry = new Map(); // toolName -> { type:'plugin'|'mcp', ... }

  // 1) 插件工具
  const pluginKeys = Array.isArray(agent.plugins) ? agent.plugins : [];
  const enabledPlugins = pluginService.listEnabled();
  const enabledKeySet = new Set(enabledPlugins.map((p) => p.key));
  for (const key of pluginKeys) {
    if (!enabledKeySet.has(key)) continue;
    const def = enabledPlugins.find((p) => p.key === key);
    tools.push({
      type: 'function',
      function: { name: key, description: def.description, parameters: def.params }
    });
    registry.set(key, { type: 'plugin', key });
  }

  // 2) MCP 工具（逐个连接发现，失败跳过并记录）
  const mcpBindings = Array.isArray(agent.mcpTools) ? agent.mcpTools : [];
  for (const binding of mcpBindings) {
    if (!binding || !binding.mcpId || !Array.isArray(binding.tools)) continue;
    const r = await mcpService.listTools(binding.mcpId);
    if (!r.ok) continue; // 单个 MCP 不可用不影响其他工具
    const wanted = new Set(binding.tools);
    for (const t of r.data) {
      if (!wanted.has(t.name)) continue;
      const fname = mcpToolKey(binding.mcpId, t.name);
      tools.push({
        type: 'function',
        function: {
          name: fname,
          description: t.description || t.name,
          parameters: t.inputSchema || { type: 'object', properties: {} }
        }
      });
      registry.set(fname, { type: 'mcp', mcpId: binding.mcpId, toolName: t.name });
    }
  }

  return { tools, registry };
}

/**
 * 执行单个 tool_call
 * @param {{type:string, key?, mcpId?, toolName?}} executor 注册表项
 * @param {object|string} args 模型返回的 arguments（JSON 字符串或对象）
 * @returns {Promise<string>} 工具结果文本
 */
async function executeTool(executor, args) {
  let parsed = args;
  if (typeof args === 'string') {
    try { parsed = JSON.parse(args); } catch (_) { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};
  if (executor.type === 'plugin') {
    return pluginService.execute(executor.key, parsed);
  }
  if (executor.type === 'mcp') {
    const r = await mcpService.callTool(executor.mcpId, executor.toolName, parsed);
    if (!r.ok) throw new Error(r.error || 'MCP 工具调用失败');
    return String(r.data);
  }
  throw new Error('未知工具类型');
}

module.exports = { buildTools, executeTool, mcpToolKey, parseMcpToolKey };
