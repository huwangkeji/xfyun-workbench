'use strict';

/**
 * 智能体（AI 助手）服务
 *
 * 智能体 = 预设角色（systemPrompt + 头像/描述）的对话助手模板，对应脑图
 * 「智能体中台 / 数字员工 / 提效工具」三个分支的落地形态：
 *   - 管理端（owner/admin）维护全部智能体，可一键导入「数字员工」预置模板；
 *   - 工作台成员在侧栏选择助手，其 systemPrompt 随对话注入（复用现有参数链路）；
 *   - 可见性：public 全员可用；private 仅创建者与管理员可用。
 *
 * 数据形状（db.json 顶层 agents 数组）：
 *   { id, presetKey?, name, emoji, desc, systemPrompt,
 *     visibility: 'public'|'private', ownerId, ownerName, createdAt, updatedAt,
 *     // —— 应用配置（v2：对齐「应用配置」脑图） ——
 *     configId: '',            // 绑定模型配置（空 = 跟随全局调度）
 *     temperature: null,       // 温度（null = 用模型配置默认）
 *     maxTokens: null,         // 回复上限（null = 不限制）
 *     kbId: '',                // 关联知识库（空 = 不关联）
 *     kbMinScore: 0,           // 检索最低相关度（0 = 不过滤）
 *     kbMaxRefs: 5,            // 引用上限（注入分段数）
 *     variables: [],           // 参数变量 [{key,label,type, options[],required}]
 *   }
 */

const db = require('./db');
const workflowService = require('./workflowService');
const configService = require('./configService');

const MAX_AGENTS = 200;
const PROMPT_MAX = 8000;
const MAX_VARIABLES = 10;
const VAR_TYPES = ['text', 'paragraph', 'select'];

function nowIso() {
  return new Date().toISOString();
}

function data() {
  const d = db.load();
  if (!Array.isArray(d.agents)) d.agents = [];
  return d;
}

function findAgent(id) {
  return data().agents.find((a) => a.id === id) || null;
}

/** 图标：icon 为图片 URL（/uploads/... 或 http 开头）时作图片，否则回退 emoji */
function iconOf(a) {
  const icon = a.icon || '';
  if (icon && (icon.startsWith('/') || /^https?:\/\//i.test(icon))) return icon;
  return a.emoji || '🤖';
}

function meta(a) {
  return {
    id: a.id,
    presetKey: a.presetKey || '',
    name: a.name,
    emoji: a.emoji || '🤖',
    icon: iconOf(a),
    desc: a.desc || '',
    systemPrompt: a.systemPrompt || '',
    visibility: a.visibility === 'private' ? 'private' : 'public',
    welcome: a.welcome || '',
    suggests: Array.isArray(a.suggests) ? a.suggests : [],
    suggestNext: a.suggestNext !== false,  // 下一步指引：默认开启
    wfId: a.wfId || '',                   // 绑定的画布工作流
    // —— 工具能力（MCP 工具 + 插件）——
    plugins: Array.isArray(a.plugins) ? a.plugins : [],
    mcpTools: Array.isArray(a.mcpTools) ? a.mcpTools : [],
    // —— 应用配置 ——
    configId: a.configId || '',
    temperature: typeof a.temperature === 'number' ? a.temperature : null,
    maxTokens: Number.isFinite(a.maxTokens) ? a.maxTokens : null,
    kbId: a.kbId || '',
    kbMinScore: Number.isFinite(a.kbMinScore) ? a.kbMinScore : 0,
    kbMaxRefs: Number.isFinite(a.kbMaxRefs) ? a.kbMaxRefs : 5,
    variables: Array.isArray(a.variables) ? a.variables : [],
    ownerId: a.ownerId || '',
    ownerName: a.ownerName || '',
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  };
}

/** 工作台可选列表：登录员工可见 public + 本人 private（管理员同样只看公共+自有，后台管理页看全部） */
function listForActor(actor) {
  const d = data().agents;
  return d
    .filter((a) => a.visibility !== 'private' || (actor && (a.ownerId === actor.id || ['owner', 'admin'].includes(actor.role))))
    .map(meta);
}

/** 后台管理列表：全部智能体 */
function listAll() {
  return data().agents.map(meta);
}

/** 按操作者取单个智能体（可见性校验：public 任何人可用；private 仅属主/管理员） */
function getForActor(id, actor) {
  const a = findAgent(id);
  if (!a) return null;
  if (a.visibility === 'private' && !(actor && (a.ownerId === actor.id || ['owner', 'admin'].includes(actor.role)))) return null;
  return a;
}

/** 参数变量解析与校验：[{key,label,type,options[],required}] */
function parseVariables(raw) {
  const errors = [];
  if (raw === undefined || raw === null) return { errors, variables: [] };
  if (!Array.isArray(raw)) { errors.push('参数变量必须是数组'); return { errors, variables: [] }; }
  if (raw.length > MAX_VARIABLES) { errors.push(`参数变量最多 ${MAX_VARIABLES} 个`); return { errors, variables: [] }; }
  const variables = [];
  const keys = new Set();
  for (const v of raw) {
    if (!v || typeof v !== 'object') { errors.push('参数变量格式不正确'); continue; }
    const key = String(v.key || '').trim();
    const label = String(v.label || key).trim().slice(0, 30);
    const type = VAR_TYPES.includes(v.type) ? v.type : 'text';
    if (!/^[\w\u4e00-\u9fa5]{1,20}$/.test(key)) { errors.push(`变量标识「${key || '(空)'}」不合法（1-20 位字母/数字/下划线/中文）`); continue; }
    if (keys.has(key)) { errors.push(`变量标识重复：「${key}」`); continue; }
    keys.add(key);
    let options = [];
    if (type === 'select') {
      options = (Array.isArray(v.options) ? v.options : String(v.options || '').split(/[,，\n]+/))
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, 20);
      if (!options.length) errors.push(`下拉变量「${label}」至少需要一个选项`);
    }
    variables.push({ key, label, type, options, required: v.required === true });
  }
  return { errors, variables };
}

function validate(body, { excludeId = '' } = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  const errors = [];
  if (!name) errors.push('名称不能为空');
  if (name.length > 30) errors.push('名称最长 30 字符');
  if (!systemPrompt) errors.push('系统提示（角色设定）不能为空');
  if (systemPrompt.length > PROMPT_MAX) errors.push(`系统提示最长 ${PROMPT_MAX} 字符`);
  const emoji = typeof body.emoji === 'string' && body.emoji.trim() ? body.emoji.trim().slice(0, 8) : '🤖';
  // 图标：优先自定义图片 URL（/uploads/... 或 http 开头），否则回退 emoji；空 = 跟随 emoji
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 300) : '';
  // 下一步指引（对话结束生成引导问题）
  const suggestNext = body.suggestNext !== false;
  // 绑定画布工作流
  const wfId = typeof body.wfId === 'string' ? body.wfId.trim().slice(0, 64) : '';
  const desc = typeof body.desc === 'string' ? body.desc.trim().slice(0, 100) : '';
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  // 开场白与预设问题（工作台对话页展示）
  const welcome = typeof body.welcome === 'string' ? body.welcome.trim().slice(0, 500) : '';
  let suggests = Array.isArray(body.suggests) ? body.suggests : [];
  suggests = suggests
    .map((s) => String(s || '').trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 4);
  // —— 应用配置 ——
  const configId = typeof body.configId === 'string' ? body.configId.trim().slice(0, 64) : '';
  let temperature = null;
  if (body.temperature !== undefined && body.temperature !== null && body.temperature !== '') {
    temperature = Number(body.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) errors.push('温度取值范围 0 - 2');
  }
  let maxTokens = null;
  if (body.maxTokens !== undefined && body.maxTokens !== null && body.maxTokens !== '') {
    maxTokens = parseInt(body.maxTokens, 10);
    if (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > 1000000) errors.push('回复上限取值范围 1 - 1000000');
  }
  const kbId = typeof body.kbId === 'string' ? body.kbId.trim().slice(0, 64) : '';
  let kbMinScore = 0;
  if (body.kbMinScore !== undefined && body.kbMinScore !== null && body.kbMinScore !== '') {
    kbMinScore = Number(body.kbMinScore);
    if (!Number.isFinite(kbMinScore) || kbMinScore < 0 || kbMinScore > 1000) errors.push('最低相关度取值范围 0 - 1000');
  }
  let kbMaxRefs = 5;
  if (body.kbMaxRefs !== undefined && body.kbMaxRefs !== null && body.kbMaxRefs !== '') {
    kbMaxRefs = parseInt(body.kbMaxRefs, 10);
    if (!Number.isFinite(kbMaxRefs) || kbMaxRefs < 1 || kbMaxRefs > 20) errors.push('引用上限取值范围 1 - 20');
  }
  const { errors: varErrors, variables } = parseVariables(body.variables);
  errors.push(...varErrors);
  // —— 工具能力绑定 ——
  const plugins = Array.isArray(body.plugins)
    ? [...new Set(body.plugins.map((p) => String(p || '').trim()).filter((p) => /^[A-Za-z0-9_-]{1,50}$/.test(p)))].slice(0, 50)
    : [];
  let mcpTools = [];
  if (Array.isArray(body.mcpTools)) {
    for (const b of body.mcpTools) {
      if (!b || typeof b !== 'object') continue;
      const mcpId = String(b.mcpId || '').trim().slice(0, 64);
      const tools = Array.isArray(b.tools)
        ? [...new Set(b.tools.map((t) => String(t || '').trim()).filter(Boolean))].slice(0, 100)
        : [];
      if (mcpId && tools.length) mcpTools.push({ mcpId, tools });
    }
    mcpTools = mcpTools.slice(0, 20);
  }
  if (name && data().agents.some((a) => a.id !== excludeId && a.name === name)) errors.push('已存在同名智能体');
  return { errors, name, systemPrompt, emoji, icon, suggestNext, wfId, desc, visibility, welcome, suggests, configId, temperature, maxTokens, kbId, kbMinScore, kbMaxRefs, variables, plugins, mcpTools };
}

/** 为智能体自动创建默认编排工作流（entry → ai），返回工作流 id；失败返回 '' */
function autoCreateWorkflow(agent, actor) {
  try {
    // 默认模型配置：优先用智能体绑定的 configId，否则取第一个可用配置
    let configId = agent.configId || '';
    if (!configId) {
      const cfgs = configService.list();
      configId = cfgs.length ? cfgs[0]._id : '';
    }
    const nodes = [];
    const entryId = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    nodes.push({ id: entryId, type: 'entry', x: 120, y: 120, cfg: {} });
    // 有可用模型配置时才追加 AI 对话节点，否则仅保留入口（保证工作流可创建、后台可见）
    if (configId) {
      const aiId = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + 'a';
      const systemPrompt = (agent.systemPrompt || '').trim() || '你是「' + agent.name + '」，请根据用户的问题给出准确、有帮助的回答。';
      nodes.push({ id: aiId, type: 'ai', x: 420, y: 120, cfg: { configId, systemPrompt } });
      const r = workflowService.create({
        name: `${agent.name} · 工作流`,
        desc: `由智能体「${agent.name}」自动创建的编排工作流`,
        nodes,
        edges: [{ from: entryId, to: aiId }]
      }, actor);
      if (r.ok && r.data) return r.data.id;
      // 降级：AI 节点创建失败（如模型配置失效），仅建入口节点工作流
    }
    const r2 = workflowService.create({
      name: `${agent.name} · 工作流`,
      desc: `由智能体「${agent.name}」自动创建的编排工作流`,
      nodes,
      edges: []
    }, actor);
    return r2.ok && r2.data ? r2.data.id : '';
  } catch (e) {
    return '';
  }
}

function create(body, actor) {
  const { errors, name, systemPrompt, emoji, icon, suggestNext, wfId, desc, visibility, welcome, suggests, configId, temperature, maxTokens, kbId, kbMinScore, kbMaxRefs, variables, plugins, mcpTools } = validate(body);
  if (errors.length) return { ok: false, errors };
  const d = data();
  if (d.agents.length >= MAX_AGENTS) return { ok: false, errors: [`智能体数量已达上限（${MAX_AGENTS} 个）`] };
  const agent = {
    id: db.getNextId('agt'),
    presetKey: typeof body.presetKey === 'string' ? body.presetKey : '',
    name,
    emoji,
    icon,
    suggestNext,
    wfId,
    desc,
    systemPrompt,
    visibility,
    welcome,
    suggests,
    configId,
    temperature,
    maxTokens,
    kbId,
    kbMinScore,
    kbMaxRefs,
    variables,
    plugins,
    mcpTools,
    ownerId: actor ? actor.id : '',
    ownerName: actor ? (actor.displayName || actor.username) : '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  // 未手动绑定工作流时，自动创建一个默认编排工作流并关联（后台「工作流」菜单可见）
  if (!agent.wfId) {
    agent.wfId = autoCreateWorkflow(agent, actor);
  }
  d.agents.push(agent);
  db.save();
  return { ok: true, data: meta(agent) };
}

function update(id, body) {
  const agent = findAgent(id);
  if (!agent) return { ok: false, notFound: true };
  // 部分更新：缺省字段沿用现有值后再校验（否则只改开场白会触发"系统提示为空"）
  const merged = {
    name: body.name !== undefined ? body.name : agent.name,
    emoji: body.emoji !== undefined ? body.emoji : agent.emoji,
    icon: body.icon !== undefined ? body.icon : (agent.icon || ''),
    suggestNext: body.suggestNext !== undefined ? body.suggestNext : (agent.suggestNext !== false),
    wfId: body.wfId !== undefined ? body.wfId : (agent.wfId || ''),
    desc: body.desc !== undefined ? body.desc : agent.desc,
    systemPrompt: body.systemPrompt !== undefined ? body.systemPrompt : agent.systemPrompt,
    visibility: body.visibility !== undefined ? body.visibility : agent.visibility,
    welcome: body.welcome !== undefined ? body.welcome : agent.welcome,
    suggests: body.suggests !== undefined ? body.suggests : agent.suggests,
    // 应用配置：显式 null/空串 = 清除（恢复默认），undefined = 保持不变
    configId: body.configId !== undefined ? body.configId : (agent.configId || ''),
    temperature: body.temperature !== undefined ? body.temperature : agent.temperature,
    maxTokens: body.maxTokens !== undefined ? body.maxTokens : agent.maxTokens,
    kbId: body.kbId !== undefined ? body.kbId : (agent.kbId || ''),
    kbMinScore: body.kbMinScore !== undefined ? body.kbMinScore : agent.kbMinScore,
    kbMaxRefs: body.kbMaxRefs !== undefined ? body.kbMaxRefs : agent.kbMaxRefs,
    variables: body.variables !== undefined ? body.variables : (agent.variables || []),
    plugins: body.plugins !== undefined ? body.plugins : (agent.plugins || []),
    mcpTools: body.mcpTools !== undefined ? body.mcpTools : (agent.mcpTools || [])
  };
  const { errors, name, systemPrompt, emoji, icon, suggestNext, wfId, desc, visibility, welcome, suggests, configId, temperature, maxTokens, kbId, kbMinScore, kbMaxRefs, variables, plugins, mcpTools } = validate(merged, { excludeId: id });
  if (errors.length) return { ok: false, errors };
  Object.assign(agent, { name, systemPrompt, emoji, icon, suggestNext, wfId, desc, visibility, welcome, suggests, configId, temperature, maxTokens, kbId, kbMinScore, kbMaxRefs, variables, plugins, mcpTools });
  agent.updatedAt = nowIso();
  db.save();
  return { ok: true, data: meta(agent) };
}

function remove(id) {
  const d = data();
  const idx = d.agents.findIndex((a) => a.id === id);
  if (idx < 0) return { ok: false, notFound: true };
  const [removed] = d.agents.splice(idx, 1);
  // 级联：删除应用时同步撤销其全部对外分享链接（防悬空链接 410 空转）
  try {
    const appShareService = require('./appShareService');
    appShareService.revokeByAgent(id);
  } catch (_) { /* 分享服务异常不阻断删除 */ }
  db.save();
  return { ok: true, data: { id: removed.id, name: removed.name } };
}

/**
 * 员工端属主校验：非管理员只能改/删「本人创建」的智能体。
 * 公开智能体一旦创建即全员可见，为避免员工误删他人/官方内容，
 * 员工仅能管理本人（ownerId === actor.id）创建的智能体；owner/admin 不受限。
 * @returns {ok:boolean, agent?, forbidden?:boolean, notFound?:boolean}
 */
function ownedAgent(id, actor) {
  const agent = findAgent(id);
  if (!agent) return { ok: false, notFound: true };
  if (!actor) return { ok: false, forbidden: true };
  if (actor.role === 'owner' || actor.role === 'admin') return { ok: true, agent };
  if (agent.ownerId === actor.id) return { ok: true, agent };
  return { ok: false, forbidden: true };
}

function stats() {
  const agents = data().agents;
  return {
    total: agents.length,
    publicCount: agents.filter((a) => a.visibility !== 'private').length,
    presetCount: agents.filter((a) => a.presetKey).length
  };
}

/* ================= 预置模板（数字员工 + 提效工具） =================
 * presetKey 幂等：导入时只补缺失的 key，不覆盖已有改名/改词的自定义。
 */

const PRESETS = [
  // —— 数字员工（按部门职能） ——
  { presetKey: 'dept.presales', name: '售前顾问', emoji: '💼', desc: '数字员工 · 市场', visibility: 'public', welcome: '您好，我是售前顾问！把您的产品与目标客户告诉我，我来帮您梳理卖点、设计话术与推进方案。', suggests: ['帮我把这段产品介绍改写成销售话术', '整理一份售前需求清单', '客户嫌价格贵，我该怎么回应？'], systemPrompt: '你是资深售前顾问，熟悉解决方案宣讲与需求挖掘。回答客户咨询时：先澄清需求场景，再给出方案要点与成功案例式描述，语言专业自信，主动推进到下一步（演示/POC/报价）。' },
  { presetKey: 'dept.aftersales', name: '售后客服', emoji: '🛎️', desc: '数字员工 · 售后', visibility: 'public', welcome: '您好，售后客服在线！请描述您遇到的问题，我会给出分步解决建议。', suggests: ['商品收到有破损怎么处理？', '如何申请退款？', '设备过保了还能修吗？'], systemPrompt: '你是耐心专业的售后客服。处理用户问题时：先安抚情绪并复述问题确认理解，再给出分步解决方案与预期时限；无法在线解决时明确说明升级路径。回复使用简洁友好的中文。' },
  { presetKey: 'dept.marketing', name: '市场策划', emoji: '📣', desc: '数字员工 · 市场', visibility: 'public', welcome: '您好，市场策划上线！告诉我活动主题与预算，我来出完整方案。', suggests: ['做一份新品发布会方案', '预算 5 万怎么投流？', '写一份季度营销日历'], systemPrompt: '你是市场策划专家，擅长活动方案、传播节奏与渠道组合。输出方案时给出目标、受众、核心信息、渠道与排期、衡量指标，用表格化结构呈现，并提供 2-3 个可替换的创意方向。' },
  { presetKey: 'dept.hr', name: '人事专员', emoji: '🧑‍💼', desc: '数字员工 · 人事', visibility: 'public', welcome: '您好，人事专员为您服务！招聘、入离职、绩效与制度问题都可以问我。', suggests: ['帮我写一份招聘 JD', '试用期辞退的合规要点', '组织一场团建的方案'], systemPrompt: '你是专业的人事专员，熟悉招聘、入离职流程、绩效与员工关系。回答遵循劳动法规常识与公司合规口径，涉及敏感问题提示以官方政策为准；输出制度/通知类文本时使用正式公文语气。' },
  { presetKey: 'dept.admin', name: '行政助理', emoji: '🗂️', desc: '数字员工 · 行政', visibility: 'public', welcome: '您好，行政助理在线！会议、通知、差旅、物资，交给我。', suggests: ['起草一份放假通知', '安排一场 20 人会议', '写一份采购申请'], systemPrompt: '你是高效细致的行政助理，擅长会议安排、通知起草、物资与差旅事务。输出通知/纪要时格式规范（标题/时间/地点/事项/责任人），重点信息置顶，语言简洁不冗余。' },
  { presetKey: 'dept.finance', name: '财务分析师', emoji: '📊', desc: '数字员工 · 财务', visibility: 'public', welcome: '您好，财务分析师在线！发我数据或问题，我按口径给结论。', suggests: ['帮我分析这张费用表', '毛利率下滑的可能原因', '做一份预算模板'], systemPrompt: '你是严谨的财务分析师。分析数据时先说明口径与假设，再给结论与依据；涉及税务/合规问题提示以专业意见为准。输出包含关键指标表与同比/环比变化，金额注明单位。' },
  { presetKey: 'dept.dev', name: '研发工程师', emoji: '💻', desc: '数字员工 · 研发', visibility: 'public', welcome: '您好，研发工程师在线！技术栈与场景说清楚，代码直接给您。', suggests: ['帮我审查这段代码', '设计一个限流方案', '这个报错怎么解决？'], systemPrompt: '你是资深软件工程师。回答技术问题时：先确认技术栈与场景，给出可直接运行的代码与关键注释；说明复杂度、边界条件与常见坑；不确定的信息明确标注。默认使用中文注释。' },
  { presetKey: 'dept.legal', name: '法务顾问', emoji: '⚖️', desc: '数字员工 · 法务', visibility: 'public', welcome: '您好，法务顾问在线！合同、合规、劳动纠纷问题，我先给结论再列依据。', suggests: ['审一下这份合同的风险点', '竞业协议怎么签才有效？', '商标被侵权怎么办？'], systemPrompt: '你是企业法务顾问，擅长合同审查要点与合规风险提示。回答先给结论，再列依据与风险等级（高/中/低），并给修改建议；每次答复末尾提醒：具体事项请以正式法律意见为准。' },
  { presetKey: 'dept.itops', name: 'IT 运维', emoji: '🖥️', desc: '数字员工 · IT/信息部', visibility: 'public', welcome: '您好，IT 运维支持在线！现象描述得越细，排查越快。', suggests: ['服务器 CPU 飙高怎么排查？', '公司网络经常掉线', '如何规划数据备份？'], systemPrompt: '你是企业 IT 运维支持。排查问题时按「现象 → 可能原因 → 分步排查 → 解决方案」输出，命令给出可直接复制的代码块，并注明风险操作需管理员确认。' },
  // —— 提效工具（通用） ——
  { presetKey: 'tool.polish', name: '文案整理', emoji: '📝', desc: '把口语草稿整理成书面文案', visibility: 'public', welcome: '把您的口语草稿或零散想法发给我，我来整理成书面文案。', suggests: ['把这段会议发言整理成要点', '润色这条客户消息', '把语音转写稿改成周报'], systemPrompt: '你是文案编辑。用户给出草稿后：保留原意，修正语病与错别字，按逻辑分段，输出书面化、简洁有力的版本；如需取舍请在文末用一句话说明主要改动。直接输出整理结果。' },
  { presetKey: 'tool.weekly', name: '周报生成', emoji: '📄', desc: '把流水账整理成结构化周报', visibility: 'public', welcome: '把本周做的事流水账式发给我，我来生成结构化周报。', suggests: ['生成我的本周周报', '把项目进度整理成周报', '周报太水了，帮我充实一下'], systemPrompt: '你是周报助手。把用户给的本周工作流水整理成周报：①本周完成（按重要度排序，含量化结果）②进行中与风险 ③下周计划。每条一行，动词开头；信息不足处用【待补充】标注而不是编造。' },
  { presetKey: 'tool.promo', name: '宣传文案', emoji: '✍️', desc: '产品/活动的推广文案', visibility: 'public', welcome: '告诉我产品/活动与目标人群，我来出主标语 + 推广文案 + 社媒短文案。', suggests: ['给新品写一条主标语', '朋友圈推广文案', '小红书种草文'], systemPrompt: '你是品牌文案专家。根据用户给的主题产出：1 条主标语（≤15 字）+ 一段 100-150 字的推广文案 + 3 条社交媒体短文案（不同风格）。语言有画面感，不堆砌形容词。' },
  { presetKey: 'tool.report', name: '报告撰写', emoji: '📑', desc: '提纲与正文的结构化报告', visibility: 'public', welcome: '告诉我报告主题与用途，我先给提纲，确认后写正文。', suggests: ['写一份市场分析报告提纲', '年度总结报告', '竞品分析框架'], systemPrompt: '你是报告撰写专家。根据主题先给章节提纲（一级/二级标题）征询确认要点，然后按提纲输出正文：每节观点句开头，数据与结论加粗；信息不足处以【待补充数据】占位，不编造。' },
  { presetKey: 'tool.meeting', name: '会议纪要', emoji: '🗒️', desc: '把会议记录整理成纪要', visibility: 'public', welcome: '把会议记录原稿发给我，我来整理成规范纪要。', suggests: ['整理这份会议录音转写', '提炼待办与责任人', '把纪要改成邮件版本'], systemPrompt: '你是会议纪要助手。把用户的会议记录整理为：①会议主题与时间 ②与会人 ③结论与决议 ④待办事项（任务/责任人/截止时间，表格呈现）⑤遗留问题。忠实于原始记录，不添加不存在的内容。' }
];

/** 幂等导入预置模板：只补缺失 presetKey；返回新增数量 */
function seedPresets(actor) {
  const d = data();
  const existing = new Set(d.agents.map((a) => a.presetKey).filter(Boolean));
  const now = nowIso();
  let added = 0;
  for (const p of PRESETS) {
    if (existing.has(p.presetKey)) continue;
    d.agents.push({
      id: db.getNextId('agt'),
      presetKey: p.presetKey,
      name: p.name,
      emoji: p.emoji,
      desc: p.desc,
      systemPrompt: p.systemPrompt,
      welcome: p.welcome || '',
      suggests: Array.isArray(p.suggests) ? p.suggests : [],
      visibility: 'public',
      ownerId: actor ? actor.id : '',
      ownerName: actor ? (actor.displayName || actor.username) : '预置模板',
      createdAt: now,
      updatedAt: now
    });
    added++;
  }
  if (added) db.save();
  return { ok: true, added, total: PRESETS.length };
}

module.exports = { listForActor, listAll, getForActor, create, update, remove, ownedAgent, stats, seedPresets, PRESETS };
