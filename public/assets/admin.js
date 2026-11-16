'use strict';

/* ============ 后台管理：模型配置 + 运行日志 ============ */

const $ = (sel) => document.querySelector(sel);

const els = {
  tabs: document.querySelectorAll('.nav-item[data-tab]'),
  panes: {
    overview: $('#pane-overview'),
    api: $('#pane-api'),
    logs: $('#pane-logs'),
    kb: $('#pane-kb'),
    agents: $('#pane-agents'),
    mcp: $('#pane-mcp'),
    plugins: $('#pane-plugins'),
    workflows: $('#pane-workflows'),
    network: $('#pane-network'),
    memory: $('#pane-memory'),
    users: $('#pane-users'),
    audit: $('#pane-audit'),
    notice: $('#pane-notice'),
    system: $('#pane-system'),
    storage: $('#pane-storage')
  },
  pageTitle: $('#pageTitle'),
  recentAuditRows: $('#recentAuditRows'),
  configRows: $('#configRows'),
  cfgStats: $('#cfgStats'),
  logRows: $('#logRows'),
  logCountBadge: $('#logCountBadge'),
  statusFilter: $('#statusFilter'),
  pageInfo: $('#pageInfo'),
  pingRows: $('#pingRows'),
  pingStatus: $('#pingStatus'),
  pingBtn: $('#pingBtn'),
  memRows: $('#memRows'),
  memKeyword: $('#memKeyword'),
  memPageInfo: $('#memPageInfo'),
  memStats: $('#memStats'),
  memOwnerFilter: $('#memOwnerFilter'),
  overviewCards: $('#overviewCards'),
  logKeyword: $('#logKeyword'),
  logModelFilter: $('#logModelFilter'),
  logDateFrom: $('#logDateFrom'),
  logDateTo: $('#logDateTo'),
  logSort: $('#logSort'),
  currentUser: $('#currentUser'),
  userRows: $('#userRows'),
  auditRows: $('#auditRows'),
  auditPageInfo: $('#auditPageInfo'),
  auditActionFilter: $('#auditActionFilter'),
  auditKeyword: $('#auditKeyword'),
  myLoginsBody: $('#myLoginsBody'),
  kbList: $('#kbList'),
  kbStats: $('#kbStats'),
  kbModalTitle: $('#kbModalTitle'),
  kbFilesBox: $('#kbFilesBox'),
  kbFilesTable: $('#kbFilesTable'),
  kbFileSearch: $('#kbFileSearch'),
  kbTestResults: $('#kbTestResults'),
  kbModalStats: $('#kbModalStats'),
  kbMemberSelect: $('#kbMemberSelect'),
  kbMemberCanEdit: $('#kbMemberCanEdit'),
  kbMembersTable: $('#kbMembersTable'),
  kbMemberHint: $('#kbMemberHint'),
  kbCfgName: $('#kbCfgName'),
  kbCfgRemark: $('#kbCfgRemark'),
  kbCfgModelId: $('#kbCfgModelId'),
  agentList: $('#agentList'),
  agentStats: $('#agentStats'),
  mcpRows: $('#mcpRows'),
  mcpStats: $('#mcpStats'),
  pluginGrid: $('#pluginGrid'),
  pluginStats: $('#pluginStats'),
  noticeStatus: $('#noticeStatus'),
  ttsStatus: $('#ttsStatus'),
  wfList: $('#wfList'),
  wfStats: $('#wfStats'),
  toastWrap: $('#toastWrap'),
  storageStats: $('#storageStats'),
  storageSide: $('#storageSide'),
  storageGroups: $('#storageGroups'),
  storageGroupTitle: $('#storageGroupTitle'),
  storageGroupCount: $('#storageGroupCount'),
  storageContent: $('#storageContent'),
  storageKeyword: $('#storageKeyword'),
  storageRefreshBtn: $('#storageRefreshBtn'),
  storageCleanBtn: $('#storageCleanBtn')
};

const page = { limit: 50, offset: 0, total: 0 };
const memPage = { limit: 20, offset: 0, total: 0, keyword: '', ownerId: '' };
let editingId = null;
let memoryCurrent = null; // 当前查看的会话记录

/* ---------- 团队账号（P1/P2） ---------- */
const userMap = {};        // id -> 用户（供「归属」列展示）
let userMapLoaded = false;
let currentUserId = null;
let currentUserRole = '';
const ROLE_LABELS = { owner: '超级管理员', admin: '管理员', member: '成员', viewer: '只读成员' };
const AUDIT_LABELS = {
  'auth.login_ok': '登录成功', 'auth.login_fail': '登录失败', 'auth.logout': '退出登录',
  'auth.password_change': '修改密码', 'auth.register': '注册账号',
  'user.create': '创建账号', 'user.update': '修改账号', 'user.disable': '停用账号',
  'user.enable': '启用账号', 'user.reset_password': '重置密码',
  'config.create': '新增配置', 'config.update': '修改配置', 'config.delete': '删除配置',
  'config.activate': '设默认配置', 'config.settings': '修改全局设置', 'config.test': '测试连通性',
  'memory.note': '保存备注', 'memory.delete': '删除会话记录', 'memory.export': '导出会话',
  'log.clear': '清空日志',
  'kb.create': '创建知识库', 'kb.update': '修改知识库', 'kb.delete': '删除知识库',
  'kb.import': '知识库导入', 'kb.delete_file': '知识库删除文件',
  'agent.create': '创建智能体', 'agent.update': '修改智能体', 'agent.delete': '删除智能体',
  'workflow.create': '创建工作流', 'workflow.update': '保存工作流画布', 'workflow.delete': '删除工作流'
};

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  els.toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])
  );
}

async function api(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (e) {
    const err = new Error('无法连接后端服务，请确认服务已启动（默认 http://127.0.0.1:4000，双击「启动.bat」或执行 npm start）');
    err.network = true;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    // 后台会话失效：提示并跳登录页（带 next=/admin，重新登录后直接回后台）
    toast('登录已失效，请重新登录', 'error');
    setTimeout(() => { location.href = '/team-login?next=' + encodeURIComponent(location.pathname); }, 900);
    const e = new Error(data.error || '未登录');
    e.status = 401;
    throw e;
  }
  if (!resp.ok || data.ok === false) {
    const err = data.error || (data.errors && data.errors.join('；')) || `HTTP ${resp.status}`;
    const e = new Error(err);
    e.status = resp.status;
    throw e;
  }
  return data.data;
}

/* ================= 侧边导航（F 型结构） ================= */
const PAGE_TITLES = {
  overview: '数据概览', api: '模型配置', logs: '运行日志', kb: '知识库', agents: '智能体',
  mcp: 'MCP 服务', plugins: '插件市场',
  workflows: '工作流', network: '云中心延时', memory: '记忆管理', users: '成员管理',
  audit: '审计日志', notice: '系统设置', system: '系统信息', storage: '文件存储'
};
// 各页面首次进入是否已加载（概览页为首页默认加载）
const paneLoaded = { overview: false };

els.tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabs.forEach((b) => b.classList.toggle('active', b === btn));
    const name = btn.dataset.tab;
    if (els.pageTitle) els.pageTitle.textContent = PAGE_TITLES[name] || '后台管理';
    for (const k in els.panes) els.panes[k].classList.toggle('active', k === name);
    document.body.classList.remove('side-open');
    if (els.sideBackdrop) els.sideBackdrop.style.display = 'none';
    if (name === 'overview') { loadOverview(); loadRecentAudit(); }
    if (name === 'logs') loadLogs();
    if (name === 'kb') loadKb();
    if (name === 'storage') loadStorage();
    if (name === 'agents') loadAgents();
    if (name === 'mcp') loadMcp();
    if (name === 'plugins') loadPlugins();
    if (name === 'workflows') loadWorkflows();
    if (name === 'network') loadPing(true);
    if (name === 'memory') { ensureUserMap(); loadMemory(); }
    if (name === 'users') loadUsers();
    if (name === 'audit') loadAudit();
    if (name === 'notice') { loadNotice(); loadTts(); }
    if (name === 'system') { loadSystemInfo(); loadSiPort(); runSiDiagnose(); }
  });
});

// 移动端抽屉开关
(function () {
  const toggle = document.getElementById('sideToggle');
  const backdrop = document.getElementById('sideBackdrop');
  if (!toggle) return;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = document.body.classList.toggle('side-open');
    if (backdrop) backdrop.style.display = open ? 'block' : 'none';
  });
  if (backdrop) backdrop.addEventListener('click', () => {
    document.body.classList.remove('side-open');
    backdrop.style.display = 'none';
  });
})();

/* ================= 模型配置 ================= */

// 国内外主流模型供应商预设（选择后自动填接口风格与地址，并给出常用模型一键填入）
const PROVIDER_PRESETS = [
  { key: 'xfyun', name: '讯飞星火 MaaS', apiStyle: 'xfyun', baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com', models: ['xopglm53', 'spark-x2.6', 'spark-max-32k', 'generalv3.5'] },
  { key: 'openai', name: 'OpenAI', apiStyle: 'openai', baseUrl: 'https://api.openai.com', models: ['gpt-5.2', 'gpt-4.1', 'gpt-4o', 'o4-mini'] },
  { key: 'anthropic', name: 'Anthropic Claude（需兼容网关）', apiStyle: 'openai', baseUrl: '', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4'] },
  { key: 'gemini', name: 'Google Gemini', apiStyle: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { key: 'deepseek', name: 'DeepSeek 深度求索', apiStyle: 'openai', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { key: 'kimi', name: '月之暗面 Kimi', apiStyle: 'openai', baseUrl: 'https://api.moonshot.cn', models: ['kimi-k2', 'kimi-latest', 'moonshot-v1-128k'] },
  { key: 'qwen', name: '阿里通义千问', apiStyle: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max', 'qwen3-235b-a22b'] },
  { key: 'zhipu', name: '智谱 GLM', apiStyle: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.7', 'glm-4.6v', 'glm-4-flash', 'glm-4v-plus'] },
  { key: 'doubao', name: '字节跳动 豆包', apiStyle: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-32k', 'doubao-1.5-vision-pro', 'doubao-1.5-thinking-pro'] },
  { key: 'hunyuan', name: '腾讯混元', apiStyle: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com', models: ['hunyuan-turbos', 'hunyuan-t1', 'hunyuan-vision'] },
  { key: 'qianfan', name: '百度千帆', apiStyle: 'openai', baseUrl: 'https://qianfan.baidubce.com', models: ['ernie-4.5-turbo', 'ernie-speed-128k', 'ernie-4.0'] },
  { key: 'minimax', name: 'MiniMax 稀宇科技', apiStyle: 'openai', baseUrl: 'https://api.minimax.chat', models: ['abab7-chat-preview', 'minimax-01', 'abab6.5s-chat'] },
  { key: 'stepfun', name: '阶跃星辰 Step', apiStyle: 'openai', baseUrl: 'https://api.stepfun.com', models: ['step-2-16k', 'step-1v-8k（视觉）', 'step-1o-turbo（视觉）'] },
  { key: 'yi', name: '零一万物 Yi', apiStyle: 'openai', baseUrl: 'https://api.lingyiwanwu.com', models: ['yi-lightning', 'yi-large', 'yi-vision-v2'] },
  { key: 'siliconflow', name: '硅基流动 SiliconFlow', apiStyle: 'openai', baseUrl: 'https://api.siliconflow.cn', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B', 'Qwen/Qwen2.5-VL-72B'] },
  { key: 'grok', name: 'xAI Grok', apiStyle: 'openai', baseUrl: 'https://api.x.ai', models: ['grok-4', 'grok-3', 'grok-2-vision'] },
  { key: 'groq', name: 'Groq（Llama 系列）', apiStyle: 'openai', baseUrl: 'https://api.groq.com/openai', models: ['llama-4-maverick', 'llama-4-scout', 'qwen3-32b'] }
];

// 填充供应商预设下拉
(function fillPresetSelect() {
  const sel = document.getElementById('f_preset');
  if (!sel) return;
  PROVIDER_PRESETS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
})();

async function loadConfigs() {
  let list = [];
  try {
    list = await api('/api/configs');
  } catch (e) {
    toast('加载配置失败：' + e.message, 'error');
  }
  renderConfigs(list);
}

function renderConfigs(list) {
  els.configRows.innerHTML = '';
  const activeCount = list.filter((c) => c.active).length;
  els.cfgStats.textContent = `共 ${list.length} 条配置`;
  if (!list.length) {
    els.configRows.innerHTML = '<tr><td colspan="11" class="empty">暂无配置，点击「+ 新增配置」添加</td></tr>';
    return;
  }
  const CAP_LABELS = { vision: '🖼️ 视觉', tti: '🎨 文生图', t2v: '🎬 文生视频' };
  for (const c of list) {
    const schedBadge = c.enabled === false
      ? '<span class="badge">停用</span>'
      : (c.priority == null || c.priority === 100 ? '<span class="badge">参与 · 默</span>' : `<span class="badge ok">参与 · ${c.priority}</span>`);
    const styleBadge = c.apiStyle === 'openai'
      ? '<span class="badge ok">OpenAI 兼容</span>'
      : '<span class="badge">讯飞 v2</span>';
    const caps = ['chat'].concat(Array.isArray(c.capabilities) ? c.capabilities : []);
    const capTags = [...new Set(caps)].map((x) => CAP_LABELS[x] || '').filter(Boolean).join(' ') || '💬';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${esc(c.name)}</b></td>
      <td>${capTags}</td>
      <td>${c.active ? '<span class="badge active">默认</span>' : '<span class="badge">备用</span>'}</td>
      <td>${schedBadge}</td>
      <td>${styleBadge}</td>
      <td>${esc(c.baseUrl)}</td>
      <td>${esc(c.model)}</td>
      <td><code>${esc(c.apiKey)}</code></td>
      <td>${c.temperature ?? '-'}</td>
      <td>${esc((c.updatedAt || '').slice(0, 19).replace('T', ' '))}</td>
      <td>
        <button class="btn" data-act="test" data-id="${c._id}">测试</button>
        <button class="btn" data-act="edit" data-id="${c._id}">编辑</button>
        ${c.active ? '' : `<button class="btn" data-act="activate" data-id="${c._id}">设为默认</button>`}
        <button class="btn danger" data-act="del" data-id="${c._id}">删除</button>
      </td>`;
    els.configRows.appendChild(tr);
  }
}

els.configRows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'test') {
      await runTest(id, btn);
      return;
    } else if (act === 'edit') {
      // 拉取完整配置（含明文 API Key，仅管理员）：编辑时直接显示 Key
      const c = await api(`/api/configs/${id}/full`);
      openModal(c);
    } else if (act === 'activate') {
      await api(`/api/configs/${id}/activate`, { method: 'POST', body: '{}' });
      toast('已设为默认配置', 'success');
      loadConfigs();
    } else if (act === 'del') {
      if (!confirm('确定删除该配置？')) return;
      await api(`/api/configs/${id}`, { method: 'DELETE' });
      toast('已删除', 'success');
      loadConfigs();
    }
  } catch (err) {
    toast('操作失败：' + err.message, 'error');
  }
});

/* ---------- Token 可用性测试 ---------- */
async function runTest(id, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    // 用原生 fetch 以便同时拿到 latencyMs 与 error（api() 会抛出）
    const resp = await fetch(`/api/configs/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      toast('登录已失效，请重新登录', 'error');
      setTimeout(() => { location.href = '/team-login?next=' + encodeURIComponent(location.pathname); }, 900);
      return;
    }
    if (data.ok) {
      showTestResult(true, data.latencyMs, data.reply, data.usage);
    } else {
      showTestResult(false, data.latencyMs || null, null, null, data.error || '未知错误');
    }
  } catch (e) {
    toast('测试请求异常：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function showTestResult(success, latency, reply, usage, error) {
  const body = $('#testModalBody');
  if (success) {
    body.innerHTML = `
      <div style="padding:6px 0 12px"><span class="badge ok">测试通过 ✓</span></div>
      <div class="log-title">模型回复</div>
      <div class="log-content">${esc(reply || '(空)')}</div>
      <div style="margin-top:12px" class="log-title">Token 用量</div>
      <div style="font-size:13px;line-height:1.9">
        输入 / 输出 / 总计：<b>${esc(usage.prompt_tokens)}</b> / <b>${esc(usage.completion_tokens)}</b> / <b>${esc(usage.total_tokens)}</b><br/>
        耗时：${esc(latency)}ms
      </div>`;
  } else {
    body.innerHTML = `
      <div style="padding:6px 0 12px"><span class="badge err">测试失败 ✗</span></div>
      <div class="log-title">错误信息</div>
      <div class="log-content" style="color:#b91c1c">${esc(error || '未知错误')}</div>
      <div style="margin-top:12px;font-size:13px">耗时：${esc(latency)}ms</div>`;
  }
  $('#testModal').style.display = 'grid';
}

/* ---------- 弹层 ---------- */
function openModal(c) {
  editingId = c ? c._id : null;
  $('#modalTitle').textContent = c ? '编辑配置' : '新增配置';
  $('#f_id').value = c ? c._id : '';
  $('#f_preset').value = '';
  $('#f_name').value = c ? c.name : '';
  $('#f_apiStyle').value = (c && c.apiStyle) || 'xfyun';
  $('#f_baseUrl').value = c ? c.baseUrl : 'https://maas-api.cn-huabei-1.xf-yun.com';
  $('#f_apiKey').value = c ? (c.apiKey || '') : '';
  $('#f_model').value = c ? c.model : '';
  // 能力类型
  const caps = (c && Array.isArray(c.capabilities)) ? c.capabilities : ['chat'];
  $('#f_cap_vision').checked = caps.includes('vision');
  $('#f_cap_t2v').checked = caps.includes('t2v');
  $('#f_temperature').value = c ? c.temperature ?? 0.7 : 0.7;
  $('#f_topP').value = c && c.topP != null ? c.topP : '';
  $('#f_maxTokens').value = c && c.maxTokens != null ? c.maxTokens : '';
  $('#f_reasoningEffort').value = (c && c.reasoningEffort) || 'high';
  $('#f_enableThinking').checked = c ? !!c.enableThinking : false;
  $('#f_webSearch').checked = c ? !!c.webSearch : false;
  $('#f_presencePenalty').value = c ? (c.presencePenalty ?? 0) : 0;
  $('#f_frequencyPenalty').value = c ? (c.frequencyPenalty ?? 0) : 0;
  $('#f_systemPrompt').value = c ? (c.systemPrompt || '') : '';
  $('#f_user').value = c ? (c.user || '') : '';
  $('#f_enabled').checked = c ? !(c.enabled === false) : true;
  $('#f_priority').value = c ? (c.priority ?? 100) : 100;
  // 图片生成（TTI）
  $('#f_ttiEnabled').checked = c ? !!c.ttiEnabled : false;
  $('#f_ttiModel').value = c ? (c.ttiModel || '') : '';
  $('#f_ttiBaseUrl').value = c ? (c.ttiBaseUrl || '') : '';
  $('#f_ttiWidth').value = c ? (c.ttiWidth ?? 512) : 512;
  $('#f_ttiHeight').value = c ? (c.ttiHeight ?? 512) : 512;
  $('#f_ttiSeed').value = c && c.ttiSeed != null ? c.ttiSeed : '';
  $('#f_numInferenceSteps').value = c ? (c.numInferenceSteps ?? 20) : 20;
  $('#f_guidanceScale').value = c ? (c.guidanceScale ?? 5) : 5;
  $('#f_scheduler').value = (c && c.scheduler) || 'DPM++ 2M Karras';
  $('#f_negativePrompt').value = c ? (c.negativePrompt || '') : '';
  $('#f_uid').value = c ? (c.uid || '') : '';
  $('#f_patchId').value = c ? (c.patchId || '') : '';
  $('#f_remark').value = c ? (c.remark || '') : '';
  updateTtiVisibility();
  $('#configModal').style.display = 'grid';
}

// TTI 仅讯飞风格支持：OpenAI 兼容风格下隐藏图片生成组
function updateTtiVisibility() {
  const isXf = $('#f_apiStyle').value === 'xfyun';
  const show = isXf;
  $('#ttiSep').style.display = show ? '' : 'none';
  $('#ttiGroup').style.display = show ? '' : 'none';
  if (!show) $('#f_ttiEnabled').checked = false;
}
$('#f_apiStyle').addEventListener('change', updateTtiVisibility);

// 供应商预设：填充接口风格与地址 + 常用模型 chips（点击填入 f_model）
$('#f_preset').addEventListener('change', () => {
  const p = PROVIDER_PRESETS.find((x) => x.key === $('#f_preset').value);
  if (!p) {
    $('#f_modelChips').innerHTML = '';
    updateTtiVisibility();
    return;
  }
  $('#f_apiStyle').value = p.apiStyle;
  if (p.baseUrl) $('#f_baseUrl').value = p.baseUrl;
  updateTtiVisibility();
  // 常用模型 chips
  const chips = $('#f_modelChips');
  chips.innerHTML = (p.models || []).map((m) => `<button class="model-chip" type="button">${esc(m)}</button>`).join('');
  chips.querySelectorAll('.model-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('#f_model').value = chip.textContent;
      $('#f_model').focus();
    });
  });
  // 自动填入第一个常用模型，避免用户漏填导致「model 不能为空」而保存失败、列表不显示
  if (p.models && p.models.length && !$('#f_model').value.trim()) {
    $('#f_model').value = p.models[0];
  }
  $('#f_model').placeholder = '如 ' + (p.models || [])[0] || '';
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $(`#${btn.dataset.close}`).style.display = 'none';
  });
});

$('#addConfigBtn').addEventListener('click', () => openModal(null));

$('#saveConfigBtn').addEventListener('click', async () => {
  const capabilities = ['chat'];
  if ($('#f_cap_vision').checked) capabilities.push('vision');
  if ($('#f_cap_t2v').checked) capabilities.push('t2v');
  if ($('#f_ttiEnabled').checked) capabilities.push('tti');
  const payload = {
    name: $('#f_name').value.trim(),
    apiStyle: $('#f_apiStyle').value,
    capabilities,
    baseUrl: $('#f_baseUrl').value.trim(),
    apiKey: $('#f_apiKey').value.trim(),
    model: $('#f_model').value.trim(),
    temperature: $('#f_temperature').value === '' ? null : Number($('#f_temperature').value),
    topP: $('#f_topP').value === '' ? null : Number($('#f_topP').value),
    maxTokens: $('#f_maxTokens').value === '' ? null : Number($('#f_maxTokens').value),
    reasoningEffort: $('#f_reasoningEffort').value,
    enableThinking: $('#f_enableThinking').checked,
    webSearch: $('#f_webSearch').checked,
    presencePenalty: Number($('#f_presencePenalty').value),
    frequencyPenalty: Number($('#f_frequencyPenalty').value),
    systemPrompt: $('#f_systemPrompt').value.trim(),
    user: $('#f_user').value.trim(),
    enabled: $('#f_enabled').checked,
    priority: $('#f_priority').value === '' ? null : Number($('#f_priority').value),
    // 图片生成（TTI）
    ttiEnabled: $('#f_ttiEnabled').checked,
    ttiModel: $('#f_ttiModel').value.trim(),
    ttiBaseUrl: $('#f_ttiBaseUrl').value.trim(),
    ttiWidth: $('#f_ttiWidth').value === '' ? null : Number($('#f_ttiWidth').value),
    ttiHeight: $('#f_ttiHeight').value === '' ? null : Number($('#f_ttiHeight').value),
    ttiSeed: $('#f_ttiSeed').value === '' ? null : Number($('#f_ttiSeed').value),
    numInferenceSteps: $('#f_numInferenceSteps').value === '' ? null : Number($('#f_numInferenceSteps').value),
    guidanceScale: $('#f_guidanceScale').value === '' ? null : Number($('#f_guidanceScale').value),
    scheduler: $('#f_scheduler').value,
    negativePrompt: $('#f_negativePrompt').value.trim(),
    uid: $('#f_uid').value.trim(),
    patchId: $('#f_patchId').value.trim(),
    remark: $('#f_remark').value.trim()
  };
  try {
    if (editingId) {
      await api(`/api/configs/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('配置已更新', 'success');
    } else {
      await api('/api/configs', { method: 'POST', body: JSON.stringify(payload) });
      toast('配置已新增', 'success');
    }
    $('#configModal').style.display = 'none';
    loadConfigs();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

/* ================= 运行日志 ================= */
async function loadLogs() {
  try {
    const q = new URLSearchParams({ limit: page.limit, offset: page.offset });
    const status = els.statusFilter.value;
    if (status) q.set('status', status);
    const kw = els.logKeyword.value.trim();
    if (kw) q.set('keyword', kw);
    const model = els.logModelFilter.value;
    if (model) q.set('model', model);
    if (els.logDateFrom.value) q.set('dateFrom', new Date(`${els.logDateFrom.value}T00:00:00`).toISOString());
    if (els.logDateTo.value) q.set('dateTo', new Date(`${els.logDateTo.value}T23:59:59`).toISOString());
    const sort = els.logSort.value;
    if (sort && sort !== 'time_desc') {
      const idx = sort.lastIndexOf('_');
      q.set('sort', sort.slice(0, idx));
      q.set('dir', sort.slice(idx + 1));
    }
    const data = await api(`/api/logs?${q.toString()}`);
    page.total = data.total;
    renderLogs(data.items);
    els.logCountBadge.textContent = data.total;
    renderPageInfo();
  } catch (e) {
    if (e.status === 401) return;
    toast('加载日志失败：' + e.message, 'error');
  }
}

// 日志筛选器变更 → 回到第一页
['statusFilter', 'logKeyword', 'logModelFilter', 'logDateFrom', 'logDateTo', 'logSort'].forEach((id) => {
  els[id].addEventListener('change', () => { page.offset = 0; loadLogs(); });
});
els.logKeyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); page.offset = 0; loadLogs(); }
});

function renderLogs(items) {
  els.logRows.innerHTML = '';
  if (!items.length) {
    els.logRows.innerHTML = '<tr><td colspan="9" class="empty">暂无日志</td></tr>';
    return;
  }
  items.forEach((l) => {
    const req = l.request || {};
    const q1 = (req.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join(' | ');
    const q = q1.length > 40 ? q1.slice(0, 40) + '…' : q1;
    const reply = l.response && l.response.content ? l.response.content : (l.error || '');
    const r = reply.length > 60 ? reply.slice(0, 60) + '…' : reply;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc((l.time || '').slice(0, 19).replace('T', ' '))}</td>
      <td>${l.status === 'ok' ? '<span class="badge ok">成功</span>' : '<span class="badge err">失败</span>'}</td>
      <td>${esc(l.configName || l.configId || '-')}</td>
      <td>${esc(l.model || '-')}</td>
      <td>${(l.latencyMs ?? 0)}ms</td>
      <td>${l.promptTokens ?? '-'} / ${l.completionTokens ?? '-'} / ${l.totalTokens ?? '-'}</td>
      <td class="truncate">${esc(q || '‹system/空›')}</td>
      <td class="truncate">${esc(r)}</td>
      <td><button class="btn" data-logid="${l.id}">详情</button></td>`;
    els.logRows.appendChild(tr);
  });
}

function renderPageInfo() {
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));
  const cur = Math.floor(page.offset / page.limit) + 1;
  els.pageInfo.textContent = `第 ${cur} / ${totalPages} 页 · 共 ${page.total} 条`;
}

els.logRows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-logid]');
  if (!btn) return;
  try {
    const l = await api(`/api/logs/${btn.dataset.logid}`);
    showLogDetail(l);
  } catch (err) {
    toast('加载日志详情失败：' + err.message, 'error');
  }
});

function showLogDetail(l) {
  const body = $('#logModalBody');
  const fmt = (o) => JSON.stringify(o, null, 2) || '(空)';
  body.innerHTML = `
    <div style="margin-bottom:12px"><span class="log-title">基本信息</span>
      <div style="font-size:13px;line-height:1.8">
        时间：${esc(l.time)}<br/>配置：${esc(l.configName || '-')}<br/>模型：${esc(l.model || '-')}<br/>
        状态：${l.status === 'ok' ? '成功' : '失败'} · 耗时：${l.latencyMs ?? 0}ms · ${l.httpStatus ? 'HTTP ' + l.httpStatus : ''}
      </div>
    </div>
    <div style="margin-bottom:12px"><span class="log-title">请求参数</span>
      <div class="log-content">${esc(fmt(l.request))}</div>
    </div>
    <div><span class="log-title">返回结果</span>
      <div class="log-content">${esc(fmt(l.response || { error: l.error || '' }))}</div>
    </div>`;
  if (l.error) body.innerHTML += `<div style="margin-top:12px" class="log-title">错误</div><div class="log-content" style="color:#ffb4b4">${esc(l.error)}</div>`;
  $('#logModal').style.display = 'grid';
}

$('#refreshLogsBtn').addEventListener('click', () => { page.offset = 0; loadLogs(); });
$('#statusFilter').addEventListener('change', () => { page.offset = 0; loadLogs(); });
$('#prevPageBtn').addEventListener('click', () => {
  if (page.offset > 0) { page.offset -= page.limit; loadLogs(); }
});
$('#nextPageBtn').addEventListener('click', () => {
  if (page.offset + page.limit < page.total) { page.offset += page.limit; loadLogs(); }
});
$('#clearLogsBtn').addEventListener('click', async () => {
  if (!confirm('确定清空全部运行日志？此操作不可恢复。')) return;
  try {
    await api('/api/logs', { method: 'DELETE' });
    toast('日志已清空', 'success');
    page.offset = 0;
    loadLogs();
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
});

setInterval(loadLogs, 15000); // 自动刷新日志

/* ================= 云中心延时 / 连通性 ================= */
function latencyClass(ms) {
  if (ms < 200) return 'ok';      // 绿色：优秀
  if (ms < 800) return 'text-dim'; // 常规灰
  return 'danger';                // 红色：高延时
}

async function loadPing(showBusy) {
  if (showBusy && els.pingBtn) {
    els.pingBtn.disabled = true;
    els.pingBtn.textContent = '测量中…';
  }
  try {
    const data = await api('/api/network/ping-all');
    renderPing(data);
  } catch (e) {
    els.pingRows.innerHTML = `<tr><td colspan="9" class="empty">连通性探测失败：${esc(e.message)}</td></tr>`;
    if (els.pingStatus) els.pingStatus.textContent = '探测失败';
  } finally {
    if (els.pingBtn) {
      els.pingBtn.disabled = false;
      els.pingBtn.textContent = '立即测量连通性 / 延时';
    }
  }
}

function renderPing(list) {
  els.pingRows.innerHTML = '';
  if (!list.length) {
    els.pingRows.innerHTML = '<tr><td colspan="9" class="empty">暂无配置可探测</td></tr>';
    if (els.pingStatus) els.pingStatus.textContent = '配置数为 0';
    return;
  }
  if (els.pingStatus) {
    els.pingStatus.textContent = `已自动获取 ${list.length} 个配置的云中心连通性 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  }
  list.forEach((p) => {
    const tr = document.createElement('tr');
    const lat = p.latencyMs;
    const latCell = lat >= 0 ? `<span class="${latencyClass(lat)}">${lat}ms</span>` : '-';
    tr.innerHTML = `
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(p.model)}</td>
      <td>${p.active ? '<span class="badge active">默认</span>' : ''}</td>
      <td>${esc(p.baseUrl)}</td>
      <td>${p.reachable ? '<span class="badge ok">连通</span>' : '<span class="badge err">不可达</span>'}</td>
      <td>${latCell}</td>
      <td>${p.httpStatus || '-'}</td>
      <td class="truncate">${esc(p.reason || (p.httpStatus ? `HTTP ${p.httpStatus} 可达` : ''))}</td>
      <td>${esc((p.probedAt || '').slice(0, 19).replace('T', ' '))}</td>`;
    els.pingRows.appendChild(tr);
  });
}

els.pingBtn.addEventListener('click', () => loadPing(true));

// 云中心延时：自动获取（每 30s，仅当「云中心延时」页签可见时探测，避免无谓请求）
setInterval(() => {
  if (els.panes.network.classList.contains('active')) loadPing(false);
}, 30000);

/* ================= 多 API 调度设置 ================= */
async function loadSettings() {
  try {
    const s = await api('/api/configs/settings');
    $('#s_autoSwitch').checked = s.autoSwitch;
    $('#s_cooldownSec').value = s.cooldownSec;
    $('#wb_enabled').checked = !!s.workbenchAuthEnabled;
    $('#wb_password').value = '';
    // 界面显示：默认显示模型名字（旧库无该字段时按开启处理）
    $('#ui_showModelName').checked = s.showModelName !== false;
  } catch (e) {
    toast('加载调度设置失败：' + e.message, 'error');
  }
}

/* ================= 界面显示设置（模型名字开关） ================= */
$('#saveUiDisplayBtn').addEventListener('click', async () => {
  const btn = $('#saveUiDisplayBtn');
  btn.disabled = true;
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({ showModelName: $('#ui_showModelName').checked })
    });
    toast($('#ui_showModelName').checked ? '已开启：前端面板显示模型名字' : '已关闭：前端面板只显示配置名称', 'success');
    loadSettings();
  } catch (e) {
    if (e.status === 401) return;
    toast('保存失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#saveSchedBtn').addEventListener('click', async () => {
  const btn = $('#saveSchedBtn');
  btn.disabled = true;
  try {
    const payload = {
      autoSwitch: $('#s_autoSwitch').checked,
      cooldownSec: Number($('#s_cooldownSec').value) || 30
    };
    await api('/api/configs/settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast('调度设置已保存', 'success');
  } catch (e) {
    if (e.status === 401) return;
    toast('保存失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ================= 工作台访问控制（访客密码） ================= */
$('#saveWbAuthBtn').addEventListener('click', async () => {
  const btn = $('#saveWbAuthBtn');
  btn.disabled = true;
  try {
    const payload = {
      // 调度设置一并提交，保持两个卡片状态一致
      autoSwitch: $('#s_autoSwitch').checked,
      cooldownSec: Number($('#s_cooldownSec').value) || 30,
      workbenchAuthEnabled: $('#wb_enabled').checked
    };
    const pwd = $('#wb_password').value.trim();
    if (pwd) payload.workbenchPassword = pwd; // 留空 = 不修改已有密码
    await api('/api/configs/settings', { method: 'PUT', body: JSON.stringify(payload) });
    toast($('#wb_enabled').checked ? '工作台密码保护已开启' : '工作台密码保护已关闭', 'success');
    $('#wb_password').value = '';
    loadSettings();
  } catch (e) {
    if (e.status === 401) return;
    toast('保存失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

/* ================= 记忆管理 · 会话记录 ================= */
function fmtTime(iso) {
  return iso ? String(iso).slice(0, 19).replace('T', ' ') : '-';
}

async function loadMemory() {
  try {
    const q = new URLSearchParams({ limit: memPage.limit, offset: memPage.offset });
    if (memPage.keyword) q.set('keyword', memPage.keyword);
    if (memPage.ownerId) q.set('ownerId', memPage.ownerId);
    const data = await api(`/api/admin/memory?${q.toString()}`);
    memPage.total = data.total;
    renderMemStats(data.stats);
    renderMemory(data.items);
    renderMemPageInfo();
  } catch (e) {
    if (e.status === 401) return;
    toast('加载会话记录失败：' + e.message, 'error');
  }
}

function renderMemStats(stats) {
  if (!stats) { els.memStats.innerHTML = ''; return; }
  const items = [
    ['会话总数', stats.totalConversations],
    ['消息总数', stats.totalMessages],
    ['我的消息', stats.totalUserMessages],
    ['AI 回复', stats.totalAssistantMessages],
    ['已备注', stats.notedConversations]
  ];
  els.memStats.innerHTML = items
    .map(([label, v]) => `<div class="mem-stat"><b>${esc(v ?? 0)}</b><span>${label}</span></div>`)
    .join('');
}

function renderMemory(items) {
  els.memRows.innerHTML = '';
  if (!items.length) {
    els.memRows.innerHTML = `<tr><td colspan="7" class="empty">${memPage.keyword || memPage.ownerId ? '没有匹配的会话记录' : '暂无会话记录'}</td></tr>`;
    return;
  }
  items.forEach((c) => {
    const owner = c.ownerId ? (userMap[c.ownerId] ? `${esc(userMap[c.ownerId].displayName || userMap[c.ownerId].username)}（${ROLE_LABELS[userMap[c.ownerId].role] || ''}）` : esc(c.ownerId)) : '<span style="color:var(--text-dim)">访客</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${esc(c.title || '新对话')}</b><div class="note-text" style="color:var(--text-dim)">${esc(c.preview || '')}</div></td>
      <td>${owner}</td>
      <td>${c.count ?? 0}</td>
      <td class="mem-note-cell">${c.note
        ? `<span class="note-text has" title="${esc(c.note)}">${esc(c.note)}</span>`
        : '<span class="note-text">（未备注）</span>'}</td>
      <td>${esc(fmtTime(c.createdAt))}</td>
      <td>${esc(fmtTime(c.updatedAt))}</td>
      <td>
        <button class="btn" data-mem-act="view" data-id="${c.id}">查看</button>
        <button class="btn" data-mem-act="note" data-id="${c.id}">备注</button>
        <button class="btn danger" data-mem-act="del" data-id="${c.id}">删除</button>
      </td>`;
    els.memRows.appendChild(tr);
  });
}

function renderMemPageInfo() {
  const totalPages = Math.max(1, Math.ceil(memPage.total / memPage.limit));
  const cur = Math.floor(memPage.offset / memPage.limit) + 1;
  els.memPageInfo.textContent = `第 ${cur} / ${totalPages} 页 · 共 ${memPage.total} 条`;
}

els.memRows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-mem-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.memAct;
  try {
    if (act === 'view') {
      await openMemoryDetail(id);
    } else if (act === 'note') {
      await openMemoryDetail(id, true);
    } else if (act === 'del') {
      const item = memPage.total;
      if (!confirm('确定删除该会话记录？消息将永久丢失，此操作不可恢复。')) return;
      await api(`/api/admin/memory/${id}`, { method: 'DELETE' });
      toast('已删除会话记录', 'success');
      loadMemory();
    }
  } catch (err) {
    if (err.status === 401) return;
    toast('操作失败：' + err.message, 'error');
  }
});

async function openMemoryDetail(id, focusNote = false) {
  try {
    const conv = await api(`/api/admin/memory/${id}`);
    memoryCurrent = conv;
    const msgs = (conv.messages || []).filter((m) => m.role !== 'system');
    $('#memoryModalTitle').textContent = `会话记录：${conv.title || '新对话'}`;
    const body = $('#memoryModalBody');
    body.innerHTML = `
      <div style="font-size:13px;line-height:1.9;margin-bottom:14px;color:var(--text-dim)">
        ID：${esc(conv.id)} · 创建：${esc(fmtTime(conv.createdAt))} · 更新：${esc(fmtTime(conv.updatedAt))} · 消息 ${msgs.length} 条
      </div>
      <div class="mem-detail-msg" style="border-left-color:var(--accent)">
        <div class="who" style="color:var(--accent)">管理员备注（仅后台可见）</div>
        <textarea class="input" id="memNoteInput" rows="3" placeholder="记录这条会话的运营备忘，例如用户反馈、待跟进事项…" style="width:100%">${esc(conv.note || '')}</textarea>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <button class="btn primary btn-sm" id="memNoteSaveBtn">保存备注</button>
          <span class="hint" id="memNoteTip" style="display:none">已保存</span>
        </div>
      </div>
      <div class="log-title" style="margin:6px 0 10px">对话记录</div>
      <div>${msgs.map((m) => `
        <div class="mem-detail-msg">
          <div class="who ${m.role}">${m.role === 'user' ? '我' : 'AI'}</div>
          <div class="txt">${esc(m.content || '')}</div>
          <div class="time">${esc(fmtTime(m.time))}</div>
        </div>`).join('') || '<div class="empty">（无消息）</div>'}
      </div>`;
    $('#memoryModal').style.display = 'grid';

    $('#memNoteSaveBtn').addEventListener('click', async () => {
      const note = $('#memNoteInput').value;
      try {
        await api(`/api/admin/memory/${conv.id}/note`, { method: 'PUT', body: JSON.stringify({ note }) });
        memoryCurrent.note = note;
        $('#memNoteTip').style.display = 'inline';
        setTimeout(() => { $('#memNoteTip').style.display = 'none'; }, 2000);
        loadMemory();
      } catch (err) {
        if (err.status === 401) return;
        toast('备注保存失败：' + err.message, 'error');
      }
    });

    if (focusNote) $('#memNoteInput').focus();
  } catch (err) {
    if (err.status === 401) return;
    toast('加载会话详情失败：' + err.message, 'error');
  }
}

/* ---------- 记忆管理：导出 / 删除 / 搜索 / 分页 ---------- */
function exportMemory(format) {
  if (!memoryCurrent) return;
  // 直接触发浏览器下载（cookie 会自动携带，服务端校验登录态）
  window.location.href = `/api/admin/memory/${memoryCurrent.id}/export?format=${format}`;
}

$('#memExportJsonBtn').addEventListener('click', () => exportMemory('json'));
$('#memExportMdBtn').addEventListener('click', () => exportMemory('md'));

$('#memDeleteBtn').addEventListener('click', async () => {
  if (!memoryCurrent) return;
  if (!confirm('确定删除该会话记录？消息将永久丢失，此操作不可恢复。')) return;
  try {
    await api(`/api/admin/memory/${memoryCurrent.id}`, { method: 'DELETE' });
    toast('已删除会话记录', 'success');
    $('#memoryModal').style.display = 'none';
    memoryCurrent = null;
    loadMemory();
  } catch (e) {
    if (e.status === 401) return;
    toast('删除失败：' + e.message, 'error');
  }
});

function searchMemory() {
  memPage.keyword = els.memKeyword.value.trim();
  memPage.offset = 0;
  loadMemory();
}
$('#memSearchBtn').addEventListener('click', searchMemory);
els.memKeyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); searchMemory(); }
});
$('#memResetBtn').addEventListener('click', () => {
  els.memKeyword.value = '';
  els.memOwnerFilter.value = '';
  memPage.keyword = '';
  memPage.ownerId = '';
  memPage.offset = 0;
  loadMemory();
});
// 按成员筛选
els.memOwnerFilter.addEventListener('change', () => {
  memPage.ownerId = els.memOwnerFilter.value;
  memPage.offset = 0;
  loadMemory();
});
$('#memRefreshBtn').addEventListener('click', loadMemory);
$('#memPrevBtn').addEventListener('click', () => {
  if (memPage.offset > 0) { memPage.offset -= memPage.limit; loadMemory(); }
});
$('#memNextBtn').addEventListener('click', () => {
  if (memPage.offset + memPage.limit < memPage.total) { memPage.offset += memPage.limit; loadMemory(); }
});

/* ================= 成员管理（P1） ================= */
async function ensureUserMap() {
  if (userMapLoaded) return;
  try {
    const list = await api('/api/admin/users');
    list.forEach((u) => { userMap[u.id] = u; });
    userMapLoaded = true;
    // 填充「按成员筛选」下拉
    els.memOwnerFilter.innerHTML = '<option value="">全部成员</option>'
      + list.map((u) => `<option value="${u.id}">${esc(u.displayName || u.username)}（${u.username}）</option>`).join('');
    if (memPage.ownerId) els.memOwnerFilter.value = memPage.ownerId;
  } catch (_) { /* 非管理员身份时静默（成员筛选不可用） */ }
}

async function loadUsers() {
  try {
    const list = await api('/api/admin/users');
    list.forEach((u) => { userMap[u.id] = u; });
    userMapLoaded = true;
    renderUsers(list);
  } catch (e) {
    if (e.status === 401) return;
    if (e.status === 403) {
      els.userRows.innerHTML = '<tr><td colspan="7" class="empty">无权限查看（仅 owner / admin）</td></tr>';
      return;
    }
    toast('加载成员失败：' + e.message, 'error');
  }
}

function renderUsers(list) {
  els.userRows.innerHTML = '';
  if (!list.length) {
    els.userRows.innerHTML = '<tr><td colspan="8" class="empty">暂无成员</td></tr>';
    return;
  }
  list.forEach((u) => {
    const isSelf = u.id === currentUserId;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${esc(u.username)}</b>${isSelf ? ' <span class="badge ok">当前</span>' : ''}</td>
      <td>${esc(u.displayName || '-')}</td>
      <td>${esc(u.department || '-')}</td>
      <td>${ROLE_LABELS[u.role] || esc(u.role)}</td>
      <td>${u.status === 'active' ? '<span class="badge ok">启用</span>' : '<span class="badge err">已停用</span>'}</td>
      <td>${esc(fmtTime(u.lastLoginAt))}</td>
      <td>${esc(fmtTime(u.createdAt))}</td>
      <td>
        <button class="btn" data-user-act="edit" data-id="${u.id}">编辑</button>
        <button class="btn" data-user-act="reset" data-id="${u.id}">重置密码</button>
        ${u.status === 'active'
          ? `<button class="btn danger" data-user-act="disable" data-id="${u.id}" ${isSelf ? 'disabled title="不能停用自己"' : ''}>停用</button>`
          : '<button class="btn" data-user-act="enable" data-id="' + u.id + '">启用</button>'}
      </td>`;
    els.userRows.appendChild(tr);
  });
}

function openUserModal(user) {
  $('#u_id').value = user ? user.id : '';
  $('#u_username').value = user ? user.username : '';
  $('#u_displayName').value = user ? (user.displayName || '') : '';
  $('#u_department').value = user ? (user.department || '') : '';
  $('#u_role').value = user ? user.role : 'member';
  $('#u_status').value = user ? user.status : 'active';
  $('#u_password').value = '';
  $('#userModalTitle').textContent = user ? `编辑成员：${user.username}` : '新增成员';
  // 创建模式：显示用户名/初始密码；编辑模式：显示状态，隐藏密码（重置走单独按钮）
  $('#u_username_wrap').style.display = user ? 'none' : '';
  $('#u_password_wrap').style.display = user ? 'none' : '';
  $('#u_status_wrap').style.display = user ? '' : 'none';
  $('#resetPwdBtn').style.display = user ? '' : 'none';
  $('#u_role').disabled = !!(user && user.id === currentUserId);
  $('#u_role_hint').textContent = (user && user.id === currentUserId)
    ? '不能修改自己的角色'
    : (currentUserRole === 'owner' ? '创建 admin / owner 需本人是超级管理员。' : '仅超级管理员可创建 admin / owner 账号。');
  $('#u_hint').textContent = user
    ? '停用后该账号立即无法登录，历史数据完整保留。'
    : '初始密码至少 8 位，须同时包含字母和数字。';
  $('#userModal').style.display = 'grid';
}

$('#addUserBtn').addEventListener('click', () => openUserModal(null));
$('#refreshUsersBtn').addEventListener('click', loadUsers);

$('#saveUserBtn').addEventListener('click', async () => {
  const id = $('#u_id').value;
  const displayName = $('#u_displayName').value.trim();
  const department = $('#u_department').value.trim();
  try {
    if (id) {
      const payload = { displayName, department, role: $('#u_role').value, status: $('#u_status').value };
      if (id === currentUserId) { delete payload.role; delete payload.status; }
      await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('成员信息已更新', 'success');
    } else {
      const username = $('#u_username').value.trim();
      const password = $('#u_password').value;
      if (!username) { toast('请输入用户名', 'error'); return; }
      if (password.length < 8) { toast('初始密码至少 8 位', 'error'); return; }
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) { toast('密码须同时包含字母和数字', 'error'); return; }
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, department, password, role: $('#u_role').value })
      });
      toast('成员已创建', 'success');
    }
    $('#userModal').style.display = 'none';
    userMapLoaded = false;
    loadUsers();
    ensureUserMap();
  } catch (e) {
    if (e.status === 401) return;
    toast('保存失败：' + e.message, 'error');
  }
});

$('#resetPwdBtn').addEventListener('click', async () => {
  const id = $('#u_id').value;
  if (!id) return;
  if (!confirm('重置该成员的密码？将生成随机临时密码，对方下次登录需改密。')) return;
  try {
    const data = await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ resetPassword: true }) });
    const u = userMap[id];
    $('#tempPwdUser').textContent = u ? (u.displayName || u.username) : id;
    $('#tempPwdValue').textContent = data.tempPassword || '(未返回)';
    $('#tempPwdModal').style.display = 'grid';
  } catch (e) {
    if (e.status === 401) return;
    toast('重置失败：' + e.message, 'error');
  }
});

els.userRows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-user-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.userAct;
  try {
    if (act === 'edit') {
      openUserModal(userMap[id] || null);
    } else if (act === 'reset') {
      openUserModal(userMap[id] || null);
      $('#resetPwdBtn').click();
    } else if (act === 'disable' || act === 'enable') {
      const u = userMap[id];
      const ok = confirm(act === 'disable'
        ? `确定停用「${u ? (u.displayName || u.username) : id}」？停用后立即无法登录，历史数据保留。`
        : `确定启用「${u ? (u.displayName || u.username) : id}」？`);
      if (!ok) return;
      await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ status: act === 'disable' ? 'disabled' : 'active' }) });
      toast(act === 'disable' ? '已停用' : '已启用', 'success');
      userMapLoaded = false;
      loadUsers();
      ensureUserMap();
    }
  } catch (err) {
    if (err.status === 401) return;
    toast('操作失败：' + err.message, 'error');
  }
});

/* ================= 审计日志（P1） ================= */
const auditPage = { limit: 50, offset: 0, total: 0, action: '', keyword: '' };

// 填充操作类型下拉（首次）
if (els.auditActionFilter.options.length <= 1) {
  Object.entries(AUDIT_LABELS).forEach(([k, v]) => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = v;
    els.auditActionFilter.appendChild(opt);
  });
}

async function loadAudit() {
  try {
    const q = new URLSearchParams({ limit: auditPage.limit, offset: auditPage.offset });
    if (auditPage.action) q.set('action', auditPage.action);
    if (auditPage.keyword) q.set('keyword', auditPage.keyword);
    const data = await api(`/api/admin/audit-logs?${q.toString()}`);
    auditPage.total = data.total;
    renderAudit(data.items);
    const totalPages = Math.max(1, Math.ceil(auditPage.total / auditPage.limit));
    const cur = Math.floor(auditPage.offset / auditPage.limit) + 1;
    els.auditPageInfo.textContent = `第 ${cur} / ${totalPages} 页 · 共 ${auditPage.total} 条`;
  } catch (e) {
    if (e.status === 401) return;
    if (e.status === 403) {
      els.auditRows.innerHTML = '<tr><td colspan="6" class="empty">无权限查看（仅 owner / admin）</td></tr>';
      return;
    }
    toast('加载审计日志失败：' + e.message, 'error');
  }
}

function renderAudit(items) {
  els.auditRows.innerHTML = '';
  if (!items.length) {
    els.auditRows.innerHTML = '<tr><td colspan="6" class="empty">暂无审计记录</td></tr>';
    return;
  }
  items.forEach((l) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(fmtTime(l.time))}</td>
      <td>${esc(l.actorName || '-')}</td>
      <td>${esc(AUDIT_LABELS[l.action] || l.action)}</td>
      <td>${esc(l.target || '-')}</td>
      <td class="truncate" title="${esc(l.detail || '')}">${esc(l.detail || '-')}</td>
      <td>${esc((l.ip || '').replace('::ffff:', '') || '-')}</td>`;
    els.auditRows.appendChild(tr);
  });
}

$('#auditSearchBtn').addEventListener('click', () => {
  auditPage.action = els.auditActionFilter.value;
  auditPage.keyword = els.auditKeyword.value.trim();
  auditPage.offset = 0;
  loadAudit();
});
els.auditActionFilter.addEventListener('change', () => {
  auditPage.action = els.auditActionFilter.value;
  auditPage.offset = 0;
  loadAudit();
});
els.auditKeyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#auditSearchBtn').click(); }
});
$('#auditRefreshBtn').addEventListener('click', loadAudit);
$('#auditPrevBtn').addEventListener('click', () => {
  if (auditPage.offset > 0) { auditPage.offset -= auditPage.limit; loadAudit(); }
});
$('#auditNextBtn').addEventListener('click', () => {
  if (auditPage.offset + auditPage.limit < auditPage.total) { auditPage.offset += auditPage.limit; loadAudit(); }
});

/* ================= 数据概览（仪表盘首页） ================= */
async function loadOverview() {
  try {
    const d = await api('/api/admin/overview?days=1');
    const cards = [
      ['📋', 'blue', '今日请求', d.totalRequests ?? 0],
      ['✅', 'green', '成功率', d.successRate === null ? '-' : `${d.successRate}%`],
      ['🔢', 'cyan', '今日 Token', d.totalTokens ?? 0],
      ['⏱️', 'orange', '平均耗时', d.avgLatencyMs === null ? '-' : `${d.avgLatencyMs}ms`],
      ['👥', 'blue', '活跃成员', d.activeActors ?? 0],
      ['⚡', 'orange', '今日失败', d.errorRequests ?? 0]
    ];
    els.overviewCards.innerHTML = cards
      .map(([ico, color, label, v]) => `
        <div class="stat-card">
          <div class="stat-ico ${color}">${ico}</div>
          <div><b>${esc(v)}</b><span>${label}</span></div>
        </div>`)
      .join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    els.overviewCards.innerHTML = '<div class="hint">概览加载失败</div>';
  }
}

/* 概览页 · 最近动态（审计最新 8 条） */
async function loadRecentAudit() {
  if (!els.recentAuditRows) return;
  try {
    const data = await api('/api/admin/audit-logs?limit=8');
    const items = data.items || [];
    if (!items.length) {
      els.recentAuditRows.innerHTML = '<tr><td colspan="4" class="empty">暂无操作记录</td></tr>';
      return;
    }
    els.recentAuditRows.innerHTML = items.map((l) => `
      <tr>
        <td>${esc(fmtTime(l.time))}</td>
        <td>${esc(l.actorName || '-')}</td>
        <td>${esc(AUDIT_LABELS[l.action] || l.action)}</td>
        <td class="truncate" title="${esc(l.target || '')}">${esc(l.target || '-')}</td>
      </tr>`).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    els.recentAuditRows.innerHTML = '<tr><td colspan="4" class="empty">加载失败</td></tr>';
  }
}

/* ================= 智能体 ================= */
async function loadAgents() {
  try {
    const list = await api('/api/admin/agents');
    els.agentStats.textContent = `共 ${list.length} 个智能体`;
    if (!list.length) {
      els.agentList.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无智能体：点击「导入预置模板」一键添加数字员工与提效工具，或「+ 新建智能体」自定义。</div>';
      return;
    }
    els.agentList.innerHTML = list.map((a) => `
      <div class="kb-card">
        <h4>${a.icon && (a.icon.startsWith('/') || /^https?:\/\//i.test(a.icon)) ? `<img class="agent-mini-icon" src="${esc(a.icon)}" alt="" />` : esc(a.emoji)} ${esc(a.name)} ${a.presetKey ? '<span class="badge">预置</span>' : ''} ${a.visibility === 'private' ? '<span class="badge err">私有</span>' : ''}</h4>
        ${a.desc ? `<div class="kb-meta">${esc(a.desc)}</div>` : ''}
        <div class="kb-meta">${esc((a.createdAt || '').slice(0, 10))} 由 ${esc(a.ownerName || '-')} 创建${a.configId ? ' · 已绑定模型' : ''}${a.kbId ? ' · 已关联知识库' : ''}${(a.variables || []).length ? ` · ${a.variables.length} 个参数变量` : ''}${(a.plugins || []).length || (a.mcpTools || []).length ? ` · ${(a.plugins || []).length + (a.mcpTools || []).reduce((n, b) => n + (b.tools || []).length, 0)} 个工具` : ''}</div>
        <div class="kb-actions">
          <button class="btn btn-sm primary" data-agent-act="edit" data-id="${a.id}">编辑</button>
          <button class="btn btn-sm" data-agent-act="share" data-id="${a.id}" ${a.visibility === 'private' ? 'disabled title="私有应用不可对外分享"' : ''}>🔗 分享</button>
          <button class="btn btn-sm danger" data-agent-act="del" data-id="${a.id}">删除</button>
        </div>
      </div>`).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载智能体失败：' + e.message, 'error');
  }
}

/* ================= MCP 服务管理 ================= */

let mcpCache = [];

async function loadMcp() {
  try {
    const list = await api('/api/admin/mcp');
    mcpCache = list;
    els.mcpStats.textContent = `共 ${list.length} 个 MCP 服务`;
    if (!list.length) {
      els.mcpRows.innerHTML = '<tr><td colspan="8" class="empty">暂无 MCP 服务：点击「+ 新增 MCP 服务」配置外部 MCP Server（stdio 启动命令）。</td></tr>';
      return;
    }
    els.mcpRows.innerHTML = list.map((m) => `
      <tr>
        <td>${esc(m.name)}</td>
        <td><code>${esc(m.command)}</code>${(m.args || []).length ? `<div class="hint">${esc(m.args.join(' '))}</div>` : ''}</td>
        <td>${(m.args || []).length || (m.envKeys || []).length ? '<span class="badge">' + (m.args || []).length + ' 参数 / ' + (m.envKeys || []).length + ' 变量</span>' : '<span class="hint">—</span>'}</td>
        <td>${m.enabled ? '<span class="kb-status ok">● 已启用</span>' : '<span class="kb-status" style="color:var(--danger,#f87171)">● 停用</span>'}</td>
        <td><button class="btn btn-sm" data-mcp-act="tools" data-id="${m.id}">查看工具</button></td>
        <td>${esc(m.ownerName || '-')}</td>
        <td>${esc((m.updatedAt || '').slice(0, 10))}</td>
        <td>
          <button class="btn btn-sm primary" data-mcp-act="edit" data-id="${m.id}">编辑</button>
          <button class="btn btn-sm" data-mcp-act="test" data-id="${m.id}">测试</button>
          <button class="btn btn-sm danger" data-mcp-act="del" data-id="${m.id}">删除</button>
        </td>
      </tr>`).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载 MCP 服务失败：' + e.message, 'error');
  }
}

function openMcpModal(mcp) {
  $('#m_id').value = mcp ? mcp.id : '';
  $('#mcpModalTitle').textContent = mcp ? `编辑 MCP 服务：${mcp.name}` : '新增 MCP 服务';
  $('#m_name').value = mcp ? mcp.name : '';
  $('#m_command').value = mcp ? mcp.command : '';
  $('#m_args').value = mcp && Array.isArray(mcp.args) ? mcp.args.join('\n') : '';
  $('#m_env').value = mcp && Array.isArray(mcp.envKeys) ? mcp.envKeys.map((k) => `${k}=`).join('\n') : '';
  $('#m_enabled').checked = mcp ? mcp.enabled : true;
  $('#m_testResult').textContent = '';
  $('#mcpModalHint').textContent = '';
  $('#mcpModal').style.display = 'grid';
}

function collectMcpForm() {
  const env = {};
  $('#m_env').value.split('\n').forEach((line) => {
    const idx = line.indexOf('=');
    if (idx <= 0) return;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1);
    if (k) env[k] = v;
  });
  return {
    name: $('#m_name').value.trim(),
    command: $('#m_command').value.trim(),
    args: $('#m_args').value.split('\n').map((s) => s.trim()).filter(Boolean),
    env,
    enabled: $('#m_enabled').checked
  };
}

async function testMcp(id, silent) {
  const btn = silent ? null : document.querySelector(`[data-mcp-act="test"][data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
  try {
    const r = await api(`/api/admin/mcp/${id}/test`, { method: 'POST', body: '{}' });
    if (silent) return r;
    toast(`连接成功，发现 ${r.count} 个工具`, 'success');
    return r;
  } catch (e) {
    if (silent) throw e;
    toast('测试失败：' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '测试'; }
  }
}

els.mcpRows && els.mcpRows.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-mcp-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.mcpAct;
  const mcp = mcpCache.find((m) => m.id === id);
  if (act === 'edit') openMcpModal(mcp);
  else if (act === 'test') testMcp(id);
  else if (act === 'tools') {
    toast('连接中…');
    try {
      const tools = await api(`/api/mcp/${id}/tools`);
      const names = tools.map((t) => `• ${t.name}：${t.description || ''}`).join('\n');
      alert(`「${mcp ? mcp.name : id}」暴露的工具（${tools.length} 个）：\n\n${names || '（无）'}`);
    } catch (e2) { toast('获取工具失败：' + e2.message, 'error'); }
  } else if (act === 'del') {
    if (!confirm(`删除 MCP 服务「${mcp ? mcp.name : id}」？绑定了该服务的智能体将无法再调用其工具。`)) return;
    try {
      await api(`/api/admin/mcp/${id}`, { method: 'DELETE' });
      toast('已删除', 'success');
      loadMcp();
    } catch (e2) { toast('删除失败：' + e2.message, 'error'); }
  }
});

$('#addMcpBtn').addEventListener('click', () => openMcpModal(null));
$('#refreshMcpBtn').addEventListener('click', loadMcp);

$('#saveMcpBtn').addEventListener('click', async () => {
  const id = $('#m_id').value;
  const payload = collectMcpForm();
  try {
    if (id) {
      await api(`/api/admin/mcp/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('MCP 服务已更新', 'success');
    } else {
      await api('/api/admin/mcp', { method: 'POST', body: JSON.stringify(payload) });
      toast('MCP 服务已创建', 'success');
    }
    $('#mcpModal').style.display = 'none';
    loadMcp();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

$('#m_testBtn').addEventListener('click', async () => {
  const id = $('#m_id').value;
  const resultEl = $('#m_testResult');
  // 未保存的新配置：先临时保存再测试
  let testId = id;
  if (!id) {
    const payload = collectMcpForm();
    try {
      const r = await api('/api/admin/mcp', { method: 'POST', body: JSON.stringify(payload) });
      testId = r.id;
      $('#m_id').value = r.id;
      $('#mcpModalTitle').textContent = `编辑 MCP 服务：${r.name}`;
    } catch (e) {
      resultEl.textContent = '保存失败：' + e.message;
      resultEl.style.color = 'var(--danger,#f87171)';
      return;
    }
  }
  resultEl.textContent = '连接中…';
  resultEl.style.color = '';
  try {
    const r = await testMcp(testId, true);
    resultEl.textContent = `✓ 连接成功，发现 ${r.count} 个工具`;
    resultEl.style.color = 'var(--success,#34d399)';
  } catch (e) {
    resultEl.textContent = '✗ 连接失败：' + e.message;
    resultEl.style.color = 'var(--danger,#f87171)';
  }
});

/* ================= 插件市场 ================= */

const PLUGIN_TYPE_LABEL = { builtin: '内置', local: '自建', remote: '远程' };

async function loadPlugins() {
  try {
    const list = await api('/api/admin/plugins');
    const installed = list.filter((p) => p.installed).length;
    const custom = list.filter((p) => p.type && p.type !== 'builtin').length;
    els.pluginStats.textContent = `已安装 ${installed} / 共 ${list.length} 个插件${custom ? `（含 ${custom} 个自建 / 远程）` : ''}`;
    els.pluginGrid.innerHTML = list.map((p) => {
      const type = p.type || 'builtin';
      const tag = PLUGIN_TYPE_LABEL[type] || type;
      const sub = type === 'remote' && p.endpoint ? ` · ${esc(p.endpoint)}` : '';
      return `
      <div class="plugin-card ${p.enabled ? 'enabled' : ''}">
        <div class="plugin-emoji">${esc(p.emoji)}</div>
        <div class="plugin-body">
          <h4>${esc(p.name)}<span class="plugin-type-badge ${type}">${tag}</span></h4>
          <div class="hint">${esc(p.description)}</div>
          <div class="kb-meta"><code>${esc(p.key)}</code>${sub}</div>
        </div>
        <div class="plugin-actions">
          ${type !== 'builtin' ? `<button class="btn btn-sm" data-plugin-act="edit" data-key="${p.key}">编辑</button>` : ''}
          ${p.installed
            ? `<button class="btn btn-sm ${p.enabled ? 'primary' : ''}" data-plugin-act="${p.enabled ? 'disable' : 'enable'}" data-key="${p.key}">${p.enabled ? '停用' : '启用'}</button>
               <button class="btn btn-sm danger" data-plugin-act="uninstall" data-key="${p.key}">${type === 'builtin' ? '卸载' : '删除'}</button>`
            : `<button class="btn btn-sm primary" data-plugin-act="install" data-key="${p.key}">安装</button>`}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载插件失败：' + e.message, 'error');
  }
}

els.pluginGrid && els.pluginGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-plugin-act]');
  if (!btn) return;
  const key = btn.dataset.key;
  const act = btn.dataset.pluginAct;
  try {
    if (act === 'edit') {
      openPluginModal(null, key);
      return;
    }
    if (act === 'install') {
      await api(`/api/admin/plugins/${key}/install`, { method: 'POST', body: '{}' });
      toast('插件已安装', 'success');
    } else if (act === 'uninstall') {
      await api(`/api/admin/plugins/${key}`, { method: 'DELETE' });
      toast('插件已卸载', 'success');
    } else if (act === 'enable') {
      await api(`/api/admin/plugins/${key}`, { method: 'PUT', body: JSON.stringify({ enabled: true }) });
      toast('插件已启用', 'success');
    } else if (act === 'disable') {
      await api(`/api/admin/plugins/${key}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
      toast('插件已停用', 'success');
    }
    loadPlugins();
  } catch (e2) {
    toast('操作失败：' + e2.message, 'error');
  }
});

$('#refreshPluginsBtn').addEventListener('click', loadPlugins);

/* ---------- 插件 / 远程技能编辑弹窗 ---------- */

const pl$ = (id) => document.getElementById(id);
let plEditingKey = null;   // null = 新建
let plType = 'local';

const PL_CODE_TEMPLATE = [
  '// 自定义插件：模型传入的参数在 args，返回字符串即工具结果',
  '// 可用 fetch 请求外部接口；单次执行最长 25 秒',
  'async function run(args, ctx) {',
  '  const q = args.query || \'\';',
  '  return `收到参数：${q}（时间 ${ctx.now()}）`;',
  '}'
].join('\n');

function plSetType(type) {
  plType = type === 'remote' ? 'remote' : 'local';
  document.querySelectorAll('#pluginTypeSeg .mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pltype === plType);
  });
  pl$('pl_local_box').style.display = plType === 'local' ? '' : 'none';
  pl$('pl_remote_box').style.display = plType === 'remote' ? '' : 'none';
  if (!plEditingKey) {
    pl$('pluginModalTitle').textContent = plType === 'remote' ? '添加远程技能' : '上传插件';
  }
}

function plReset() {
  pl$('pl_name').value = '';
  pl$('pl_emoji').value = plType === 'remote' ? '🌐' : '🧩';
  pl$('pl_key').value = '';
  pl$('pl_key').disabled = false;
  pl$('pl_desc').value = '';
  pl$('pl_params').value = '{\n  "query": { "type": "string", "description": "要处理的输入内容" }\n}';
  pl$('pl_required').value = 'query';
  pl$('pl_code').value = PL_CODE_TEMPLATE;
  pl$('pl_endpoint').value = '';
  pl$('pl_method').value = 'POST';
  pl$('pl_timeout').value = '15000';
  pl$('pl_authType').value = 'none';
  pl$('pl_authToken').value = '';
  pl$('pl_authHeader').value = '';
  pl$('pl_headers').value = '';
  pl$('pl_resultPath').value = '';
  pl$('pl_testArgs').value = '{"query":"你好"}';
  pl$('pl_testOut').textContent = '保存插件后可在此处测试调用结果';
  pl$('pl_testOut').classList.remove('err');
  pl$('plDeleteBtn').style.display = 'none';
  pl$('pluginSaveBtn').textContent = '保存并启用';
}

async function openPluginModal(type, key) {
  plEditingKey = key || null;
  plReset();
  if (type) plSetType(type);
  else plSetType('local');
  pl$('pluginModal').style.display = 'grid';
  if (!key) return;
  try {
    const d = await api(`/api/admin/plugins/${encodeURIComponent(key)}`);
    plSetType(d.type);
    pl$('pluginModalTitle').textContent = `编辑${d.type === 'remote' ? '远程技能' : '插件'}：${d.name}`;
    pl$('pl_name').value = d.name || '';
    pl$('pl_emoji').value = d.emoji || '';
    pl$('pl_key').value = d.key;
    pl$('pl_key').disabled = true;
    pl$('pl_desc').value = d.description || '';
    pl$('pl_params').value = JSON.stringify((d.params && d.params.properties) || {}, null, 2);
    pl$('pl_required').value = ((d.params && d.params.required) || []).join(', ');
    if (d.type === 'local') {
      pl$('pl_code').value = d.code || '';
    } else {
      pl$('pl_endpoint').value = d.endpoint || '';
      pl$('pl_method').value = d.method || 'POST';
      pl$('pl_timeout').value = String(d.timeoutMs || 15000);
      pl$('pl_authType').value = d.authType || 'none';
      pl$('pl_authHeader').value = d.authHeader || '';
      pl$('pl_headers').value = d.headers && Object.keys(d.headers).length ? JSON.stringify(d.headers, null, 2) : '';
      pl$('pl_resultPath').value = d.resultPath || '';
      pl$('pl_authToken').placeholder = d.hasToken ? '已保存，留空则不修改' : '留空则不带鉴权';
    }
    pl$('plDeleteBtn').style.display = '';
    pl$('pluginSaveBtn').textContent = '保存修改';
  } catch (e) {
    toast('读取插件失败：' + e.message, 'error');
    pl$('pluginModal').style.display = 'none';
  }
}

function closePluginModal() {
  pl$('pluginModal').style.display = 'none';
  plEditingKey = null;
}

function plParseJson(text, label) {
  const t = String(text || '').trim();
  if (!t) return {};
  try { return JSON.parse(t); } catch (_) { throw new Error(`${label}不是合法的 JSON`); }
}

async function savePlugin() {
  const btn = pl$('pluginSaveBtn');
  let params;
  let headers = {};
  try {
    params = plParseJson(pl$('pl_params').value, '参数定义');
    if (plType === 'remote') headers = plParseJson(pl$('pl_headers').value, '附加请求头');
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const body = {
    existing: !!plEditingKey,
    key: pl$('pl_key').value.trim(),
    type: plType,
    name: pl$('pl_name').value.trim(),
    emoji: pl$('pl_emoji').value.trim(),
    description: pl$('pl_desc').value.trim(),
    params: { properties: params, required: pl$('pl_required').value.split(/[,，\s]+/).filter(Boolean) },
    code: plType === 'local' ? pl$('pl_code').value : '',
    endpoint: pl$('pl_endpoint').value.trim(),
    method: pl$('pl_method').value,
    timeoutMs: Number(pl$('pl_timeout').value) || 15000,
    authType: pl$('pl_authType').value,
    authToken: pl$('pl_authToken').value,
    authHeader: pl$('pl_authHeader').value.trim(),
    headers,
    resultPath: pl$('pl_resultPath').value.trim()
  };
  if (!body.name) { toast('请填写插件名称', 'error'); return; }
  if (plType === 'remote' && pl$('pl_authToken').value === '' && plEditingKey) {
    // 编辑远程技能时留空 Token 表示不修改：用后端回填
    body.keepToken = true;
  }
  btn.disabled = true;
  const html = btn.textContent;
  btn.textContent = '保存中…';
  try {
    const saved = await api('/api/admin/plugins/save', { method: 'POST', body: JSON.stringify(body) });
    toast(`已保存${saved.type === 'remote' ? '远程技能' : '插件'}「${saved.name}」`, 'success');
    plEditingKey = saved.key;
    pl$('pl_key').value = saved.key;
    pl$('pl_key').disabled = true;
    pl$('plDeleteBtn').style.display = '';
    pl$('pluginSaveBtn').textContent = '保存修改';
    pl$('pluginModalTitle').textContent = `编辑${saved.type === 'remote' ? '远程技能' : '插件'}：${saved.name}`;
    loadPlugins();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = html;
  }
}

async function testPlugin() {
  const key = plEditingKey || pl$('pl_key').value.trim();
  if (!plEditingKey) { toast('请先保存插件，再测试调用', ''); return; }
  let args = {};
  try { args = plParseJson(pl$('pl_testArgs').value, '测试参数'); } catch (e) { toast(e.message, 'error'); return; }
  const out = pl$('pl_testOut');
  out.classList.remove('err');
  out.textContent = '调用中…';
  try {
    const r = await api(`/api/admin/plugins/${encodeURIComponent(key)}/test`, {
      method: 'POST',
      body: JSON.stringify({ args })
    });
    out.textContent = `${r.result || '(空结果)'}\n\n--- 耗时 ${r.latencyMs}ms`;
    toast('测试成功', 'success');
  } catch (e) {
    out.classList.add('err');
    out.textContent = '调用失败：' + e.message;
  }
}

async function deletePlugin() {
  const key = plEditingKey;
  if (!key) return;
  if (!confirm(`删除插件「${key}」？已绑定该插件的智能体将不再能调用它。`)) return;
  try {
    await api(`/api/admin/plugins/${encodeURIComponent(key)}`, { method: 'DELETE' });
    toast('插件已删除', 'success');
    closePluginModal();
    loadPlugins();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

if (pl$('pluginModal')) {
  pl$('pluginModalClose').addEventListener('click', closePluginModal);
  pl$('pluginModalCancel').addEventListener('click', closePluginModal);
  pl$('pluginModal').addEventListener('click', (e) => { if (e.target === pl$('pluginModal')) closePluginModal(); });
  document.querySelectorAll('#pluginTypeSeg .mode-btn').forEach((b) => {
    b.addEventListener('click', () => plSetType(b.dataset.pltype));
  });
  pl$('pluginSaveBtn').addEventListener('click', savePlugin);
  pl$('pl_testBtn').addEventListener('click', testPlugin);
  pl$('plDeleteBtn').addEventListener('click', deletePlugin);
  pl$('pl_uploadBtn').addEventListener('click', () => pl$('pl_fileInput').click());
  pl$('pl_fileInput').addEventListener('change', () => {
    const file = (pl$('pl_fileInput').files || [])[0];
    pl$('pl_fileInput').value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const isJson = /\.json$/i.test(file.name);
      if (isJson) {
        try {
          const m = JSON.parse(text);
          if (m.name) pl$('pl_name').value = m.name;
          if (m.key) pl$('pl_key').value = m.key;
          if (m.emoji) pl$('pl_emoji').value = m.emoji;
          if (m.description) pl$('pl_desc').value = m.description;
          if (m.params) pl$('pl_params').value = JSON.stringify(m.params.properties || m.params, null, 2);
          if (Array.isArray(m.required)) pl$('pl_required').value = m.required.join(', ');
          if (m.key && /^[A-Za-z]/.test(m.key)) pl$('pl_key').value = m.key;
          const t = m.type === 'remote' ? 'remote' : 'local';
          plSetType(t);
          if (t === 'local' && m.code) pl$('pl_code').value = m.code;
          if (t === 'remote') {
            if (m.endpoint) pl$('pl_endpoint').value = m.endpoint;
            if (m.method) pl$('pl_method').value = m.method;
            if (m.resultPath) pl$('pl_resultPath').value = m.resultPath;
            if (m.headers) pl$('pl_headers').value = JSON.stringify(m.headers, null, 2);
          }
          toast('已从 JSON 清单填充表单', 'success');
          return;
        } catch (_) { /* 非清单 JSON：当代码处理 */ }
      }
      pl$('pl_code').value = text;
      plSetType('local');
      toast(`已导入 ${file.name}`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  });
}
document.getElementById('uploadPluginBtn').addEventListener('click', () => openPluginModal('local'));
document.getElementById('addRemoteBtn').addEventListener('click', () => openPluginModal('remote'));

/* ---------- 智能体工具绑定（插件 + MCP） ---------- */

async function loadAgentToolOptions(agent) {
  const pluginBox = $('#a_pluginBox');
  const mcpBox = $('#a_mcpBox');
  const selectedPlugins = new Set(agent && Array.isArray(agent.plugins) ? agent.plugins : []);
  const selectedMcp = agent && Array.isArray(agent.mcpTools) ? agent.mcpTools : []; // [{mcpId, tools:[]}]

  // 插件列表
  try {
    const plugins = await api('/api/plugins');
    const installed = plugins.filter((p) => p.installed);
    if (!installed.length) {
      pluginBox.innerHTML = '<div class="hint">暂无已安装插件：请先在「插件市场」安装并启用。</div>';
    } else {
      pluginBox.innerHTML = installed.map((p) => `
        <label class="tool-check-item ${p.enabled ? '' : 'disabled'}">
          <input type="checkbox" class="a-plugin-check" value="${esc(p.key)}" ${selectedPlugins.has(p.key) ? 'checked' : ''} ${p.enabled ? '' : 'disabled'} />
          <span>${esc(p.emoji)} ${esc(p.name)}</span>
          ${p.enabled ? '' : '<span class="badge err">未启用</span>'}
        </label>`).join('');
    }
  } catch (e) {
    pluginBox.innerHTML = `<div class="hint">加载插件失败：${esc(e.message)}</div>`;
  }

  // MCP 工具列表
  try {
    const mcps = await api('/api/mcp');
    const enabled = mcps.filter((m) => m.enabled);
    if (!enabled.length) {
      mcpBox.innerHTML = '<div class="hint">暂无已启用的 MCP 服务：请先在「MCP 服务」页配置并测试。</div>';
      return;
    }
    // 逐个发现工具（异步，但为控制复杂度逐服务加载并展示占位）
    const blocks = [];
    for (const m of enabled) {
      const sel = (selectedMcp.find((b) => b.mcpId === m.id) || {}).tools || [];
      const selSet = new Set(sel);
      let toolsHtml;
      try {
        const tools = await api(`/api/mcp/${m.id}/tools`);
        toolsHtml = tools.length
          ? tools.map((t) => `
              <label class="tool-check-item">
                <input type="checkbox" class="a-mcp-check" data-mcp="${esc(m.id)}" value="${esc(t.name)}" ${selSet.has(t.name) ? 'checked' : ''} />
                <span>${esc(t.name)}</span>
              </label>`).join('')
          : '<div class="hint">（无工具）</div>';
      } catch (e2) {
        toolsHtml = `<div class="hint" style="color:var(--danger,#f87171)">连接失败：${esc(e2.message)}</div>`;
      }
      blocks.push(`<div class="mcp-tool-group">
        <div class="mcp-tool-head">🔗 ${esc(m.name)}</div>
        <div class="tool-check-grid">${toolsHtml}</div>
      </div>`);
    }
    mcpBox.innerHTML = blocks.join('');
  } catch (e) {
    mcpBox.innerHTML = `<div class="hint">加载 MCP 服务失败：${esc(e.message)}</div>`;
  }
}

function collectAgentTools() {
  const plugins = Array.from(document.querySelectorAll('.a-plugin-check:checked')).map((c) => c.value);
  const mcpMap = new Map();
  document.querySelectorAll('.a-mcp-check:checked').forEach((c) => {
    const mcpId = c.dataset.mcp;
    if (!mcpMap.has(mcpId)) mcpMap.set(mcpId, []);
    mcpMap.get(mcpId).push(c.value);
  });
  const mcpTools = Array.from(mcpMap.entries()).map(([mcpId, tools]) => ({ mcpId, tools }));
  return { plugins, mcpTools };
}

/* ---------- 应用配置：模型/知识库/工作流下拉选项（弹窗打开时懒加载） ---------- */
let agentModalOptions = { configs: [], kbs: [], workflows: [] };async function loadAgentModalOptions() {
  try {
    const [configs, kbs, workflows] = await Promise.all([api('/api/configs'), api('/api/admin/kb'), api('/api/admin/workflows')]);
    agentModalOptions.configs = Array.isArray(configs) ? configs : [];
    agentModalOptions.kbs = Array.isArray(kbs) ? kbs : [];
    agentModalOptions.workflows = Array.isArray(workflows) ? workflows : [];
  } catch (e) { /* 静默：下拉保持空（跟随调度/不关联） */ }
}
function fillAgentModalSelects(agent) {
  const cfgSel = $('#a_configId');
  const kbSel = $('#a_kbId');
  const wfSel = $('#a_wfId');
  cfgSel.innerHTML = '<option value="">（跟随全局调度）</option>'
    + agentModalOptions.configs.map((c) => `<option value="${esc(c._id)}" ${agent && agent.configId === c._id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
  kbSel.innerHTML = '<option value="">（不关联）</option>'
    + agentModalOptions.kbs.map((k) => `<option value="${esc(k.id)}" ${agent && agent.kbId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  if (wfSel) wfSel.innerHTML = '<option value="">（不绑定）</option>'
    + agentModalOptions.workflows.map((w) => `<option value="${esc(w.id)}" ${agent && agent.wfId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
}

/* ---------- 智能体弹窗页签切换 ---------- */
function switchAgentTab(name) {
  document.querySelectorAll('#agentModal [data-agenttab]').forEach((b) => b.classList.toggle('active', b.dataset.agenttab === name));
  document.querySelectorAll('#agentModal [data-agentpane]').forEach((p) => { p.style.display = p.dataset.agentpane === name ? '' : 'none'; });
}
document.querySelectorAll('#agentModal [data-agenttab]').forEach((b) => b.addEventListener('click', () => {
  switchAgentTab(b.dataset.agenttab);
  if (b.dataset.agenttab === 'logs' && $('#a_id').value) loadAgentLogs($('#a_id').value);
}));

/* ---------- 对话日志（按应用筛选） ---------- */
async function loadAgentLogs(agentId) {
  const box = $('#a_logsBox');
  if (!box) return;
  box.innerHTML = '<div class="hint">加载中…</div>';
  try {
    const r = await api(`/api/logs?agentId=${encodeURIComponent(agentId)}&limit=50`);
    const items = r.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="hint">暂无该应用的调用记录。</div>';
      return;
    }
    box.innerHTML = `<table class="kb-file-table"><thead><tr>
      <th>时间</th><th>用户</th><th>模型</th><th>状态</th><th>耗时</th><th>Token</th>
    </tr></thead><tbody>${items.map((l) => `
      <tr>
        <td>${esc((l.time || '').slice(0, 19).replace('T', ' '))}</td>
        <td>${esc(l.actorName || l.actorId || '访客')}</td>
        <td>${esc(l.model || '-')}</td>
        <td>${l.status === 'ok' ? '<span class="kb-status ok">● 成功</span>' : '<span class="kb-status" style="color:var(--danger,#f87171)">● 失败</span>'}</td>
        <td>${l.latencyMs != null ? l.latencyMs + 'ms' : '-'}</td>
        <td>${l.totalTokens != null ? l.totalTokens : '-'}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    box.innerHTML = `<div class="hint">加载失败：${esc(e.message)}</div>`;
  }
}

/* ---------- 调试预览 ---------- */
async function debugAgentChat() {
  const out = $('#a_debugOut');
  const q = $('#a_debugQuery').value.trim();
  if (!q) { toast('请输入调试问题', 'error'); return; }
  const id = $('#a_id').value;
  if (!id) { toast('请先保存应用后再调试', 'error'); return; }
  out.innerHTML = '<div class="hint">思考中…</div>';
  try {
    const r = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ agentId: id, messages: [{ role: 'user', content: q }] })
    });
    const content = (r.result && (r.result.content || r.result.reply)) || '';
    out.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word">${esc(content || '(空回复)')}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="hint">调试失败：${esc(e.message)}</div>`;
  }
}

/* ---------- 参数变量编辑器（文本 / 段落 / 下拉框） ---------- */
function addVarRow(v) {
  const box = $('#a_varsBox');
  const row = document.createElement('div');
  row.className = 'var-row';
  const def = v || {};
  row.innerHTML = `
    <input class="var-key" placeholder="标识 key" value="${esc(def.key || '')}" maxlength="20" />
    <input class="var-label" placeholder="显示名" value="${esc(def.label || '')}" maxlength="30" />
    <select class="var-type">
      ${['text', 'paragraph', 'select'].map((t) => `<option value="${t}" ${def.type === t ? 'selected' : ''}>${t === 'text' ? '文本' : t === 'paragraph' ? '段落' : '下拉框'}</option>`).join('')}
    </select>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap"><input class="var-required" type="checkbox" ${def.required ? 'checked' : ''} />必填</label>
    <button class="var-del" type="button" title="删除">✕</button>`;
  const typeSel = row.querySelector('.var-type');
  const optsWrap = document.createElement('div');
  optsWrap.className = 'var-opts';
  typeSel.addEventListener('change', syncOpts);
  function syncOpts() {
    const has = typeSel.value === 'select';
    let optsInput = optsWrap.querySelector('input');
    if (has && !optsInput) {
      optsInput = document.createElement('input');
      optsInput.className = 'var-options';
      optsInput.placeholder = '下拉选项，逗号分隔（如：售前,售后,投诉）';
      optsWrap.appendChild(optsInput);
    } else if (!has && optsInput) {
      optsInput.remove();
      optsInput = null;
    }
    if (has && optsInput && Array.isArray(def.options)) optsInput.value = def.options.join(',');
  }
  syncOpts();
  row.appendChild(optsWrap);
  row.querySelector('.var-del').addEventListener('click', () => row.remove());
  box.appendChild(row);
}
function collectVars() {
  const out = [];
  document.querySelectorAll('#a_varsBox .var-row').forEach((row) => {
    const key = row.querySelector('.var-key').value.trim();
    if (!key) return;
    const type = row.querySelector('.var-type').value;
    const optsInput = row.querySelector('.var-options');
    out.push({
      key,
      label: row.querySelector('.var-label').value.trim() || key,
      type,
      options: type === 'select' && optsInput
        ? optsInput.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
        : [],
      required: row.querySelector('.var-required').checked
    });
  });
  return out;
}

function openAgentModal(agent) {
  $('#a_id').value = agent ? agent.id : '';
  $('#agentModalTitle').textContent = agent ? `编辑智能体 · ${agent.name}` : '新建智能体';
  // 顶部图标与删除按钮
  $('#agentPageIcon').textContent = agent ? (agent.emoji || '🤖') : '🤖';
  if ($('#agentDeleteBtn')) $('#agentDeleteBtn').style.display = agent ? '' : 'none';
  switchAgentTab('bot');
  $('#a_name').value = agent ? agent.name : '';
  if (window.iconPickerSet) iconPickerSet(agent);
  $('#a_desc').value = agent ? (agent.desc || '') : '';
  $('#a_systemPrompt').value = agent ? (agent.systemPrompt || '') : '';
  $('#a_welcome').value = agent ? (agent.welcome || '') : '';
  $('#a_suggests').value = agent && Array.isArray(agent.suggests) ? agent.suggests.join('\n') : '';
  $('#a_visibility').value = agent ? agent.visibility : 'public';
  // 下一步指引
  const suggestNextEl = $('#a_suggestNext');
  if (suggestNextEl) suggestNextEl.checked = agent ? (agent.suggestNext !== false) : true;
  // —— 应用配置（v2）——
  loadAgentModalOptions().then(() => fillAgentModalSelects(agent));
  loadAgentToolOptions(agent);
  $('#a_temperature').value = agent && agent.temperature !== null && agent.temperature !== undefined ? agent.temperature : '';
  $('#a_maxTokens').value = agent && agent.maxTokens ? agent.maxTokens : '';
  $('#a_kbMaxRefs').value = agent && agent.kbMaxRefs ? agent.kbMaxRefs : 5;
  $('#a_kbMinScore').value = agent && agent.kbMinScore ? agent.kbMinScore : '';
  $('#a_varsBox').innerHTML = '';
  (agent && Array.isArray(agent.variables) ? agent.variables : []).forEach((v) => addVarRow(v));
  // 调试预览复位
  $('#a_debugOut').innerHTML = '<div class="hint">输入问题后点击「发送」，对该应用进行调试预览。</div>';
  $('#a_debugQuery').value = '';
  $('#agentModal').style.display = 'flex';
}

// 返回按钮关闭智能体编辑页
$('#agentBackBtn').addEventListener('click', () => {
  $('#agentModal').style.display = 'none';
  loadAgents();
});
// 删除按钮
$('#agentDeleteBtn').addEventListener('click', async () => {
  const id = $('#a_id').value;
  if (!id) return;
  if (!confirm('删除该智能体？工作台将不再显示，其对外分享链接也会一并撤销。')) return;
  try {
    await api(`/api/admin/agents/${id}`, { method: 'DELETE' });
    toast('智能体已删除', 'success');
    $('#agentModal').style.display = 'none';
    loadAgents();
  } catch (e2) {
    toast('删除失败：' + e2.message, 'error');
  }
});

$('#addAgentBtn').addEventListener('click', () => openAgentModal(null));
$('#a_addVar').addEventListener('click', () => addVarRow({}));

$('#saveAgentBtn').addEventListener('click', async () => {
  const id = $('#a_id').value;
  const payload = {
    name: $('#a_name').value.trim(),
    emoji: $('#a_emoji').value.trim() || '🤖',
    icon: $('#a_icon').value.trim(),
    desc: $('#a_desc').value.trim(),
    systemPrompt: $('#a_systemPrompt').value.trim(),
    welcome: $('#a_welcome').value.trim(),
    suggests: $('#a_suggests').value.split('\n').map((s) => s.trim()).filter(Boolean),
    suggestNext: $('#a_suggestNext') ? $('#a_suggestNext').checked : true,
    wfId: $('#a_wfId') ? $('#a_wfId').value : '',
    visibility: $('#a_visibility').value,
    // —— 应用配置（v2）——
    configId: $('#a_configId').value,
    temperature: $('#a_temperature').value === '' ? null : Number($('#a_temperature').value),
    maxTokens: $('#a_maxTokens').value === '' ? null : parseInt($('#a_maxTokens').value, 10),
    kbId: $('#a_kbId').value,
    kbMaxRefs: parseInt($('#a_kbMaxRefs').value, 10) || 5,
    kbMinScore: $('#a_kbMinScore').value === '' ? 0 : Number($('#a_kbMinScore').value),
    variables: collectVars(),
    ...collectAgentTools()
  };
  try {
    if (id) {
      await api(`/api/admin/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('智能体已更新', 'success');
    } else {
      const r = await api('/api/admin/agents', { method: 'POST', body: JSON.stringify(payload) });
      $('#a_id').value = r.id; // 记录新 ID，便于调试预览
      toast('智能体已创建', 'success');
    }
    $('#agentModal').style.display = 'none';
    loadAgents();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// 调试预览 + 分享按钮
$('#a_debugBtn').addEventListener('click', debugAgentChat);
$('#a_debugQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); debugAgentChat(); } });
$('#a_shareBtn').addEventListener('click', () => {
  const id = $('#a_id').value;
  if (!id) { toast('请先保存应用后再分享', 'error'); return; }
  // 复用分享弹窗：先取该应用再打开
  api('/api/admin/agents').then((list) => {
    const a = list.find((x) => x.id === id);
    if (a) openShareModal(a);
  }).catch((e) => toast('加载失败：' + e.message, 'error'));
});

$('#seedAgentsBtn').addEventListener('click', async () => {
  const btn = $('#seedAgentsBtn');
  btn.disabled = true;
  try {
    const r = await api('/api/admin/agents/seed', { method: 'POST', body: '{}' });
    toast(r.added > 0 ? `已导入 ${r.added} 个预置模板` : '预置模板已齐全，无需导入', 'success');
    loadAgents();
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#refreshAgentsBtn').addEventListener('click', loadAgents);

els.agentList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-agent-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.agentAct === 'edit') {
    const list = await api('/api/admin/agents');
    openAgentModal(list.find((a) => a.id === id) || null);
  } else if (btn.dataset.agentAct === 'share') {
    const list = await api('/api/admin/agents');
    openShareModal(list.find((a) => a.id === id) || null);
  } else if (btn.dataset.agentAct === 'del') {
    if (!confirm('删除该智能体？工作台将不再显示，其对外分享链接也会一并撤销。')) return;
    try {
      await api(`/api/admin/agents/${id}`, { method: 'DELETE' });
      toast('智能体已删除', 'success');
      loadAgents();
    } catch (e2) {
      toast('删除失败：' + e2.message, 'error');
    }
  }
});

/* ================= 应用对外分享管理 ================= */
let shareAgent = null;

function shareUrl(token) {
  return `${location.origin}/a/${token}`;
}

async function openShareModal(agent) {
  if (!agent) return;
  shareAgent = agent;
  $('#shareModalTitle').textContent = `对外分享：${agent.emoji} ${agent.name}`;
  $('#sh_password').value = '';
  $('#shareModal').style.display = 'grid';
  await loadShareList(agent.id);
}

async function loadShareList(agentId) {
  const box = $('#shList');
  try {
    const list = await api(`/api/admin/agents/${agentId}/shares`);
    if (!list.length) {
      box.innerHTML = '<div class="hint">暂无分享链接。配置上方参数后点击「创建分享链接」。</div>';
      return;
    }
    box.innerHTML = list.map((s) => `
      <div class="share-row">
        <span class="share-url" title="${esc(shareUrl(s.token))}">${esc(shareUrl(s.token))}</span>
        <span class="share-meta">${s.qpm ? `${s.qpm} QPM` : '不限流'} · ${s.expiresAt ? '至 ' + esc(s.expiresAt.slice(0, 10)) : '永久'}${s.hasPassword ? ' · 🔒' : ''} · 访问 ${s.hits || 0} 次</span>
        <button class="btn btn-sm" data-sh-copy="${esc(s.token)}">复制</button>
        <button class="btn btn-sm danger" data-sh-revoke="${esc(s.token)}">撤销</button>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = '<div class="hint">分享列表加载失败：' + esc(e.message) + '</div>';
  }
}

$('#shCreateBtn').addEventListener('click', async () => {
  if (!shareAgent) return;
  const days = parseInt($('#sh_expiry').value, 10);
  try {
    const r = await api(`/api/admin/agents/${shareAgent.id}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        qpm: parseInt($('#sh_qpm').value, 10) || 0,
        expiresInDays: days,
        password: $('#sh_password').value.trim()
      })
    });
    toast('分享链接已创建', 'success');
    // 弹层内即时提示完整链接（移动端长按可复制）
    await loadShareList(shareAgent.id);
    try { await navigator.clipboard.writeText(shareUrl(r.token)); toast('链接已复制：' + shareUrl(r.token), 'success'); }
    catch (_) { toast('链接：' + shareUrl(r.token), 'success'); }
  } catch (e) {
    toast('创建失败：' + e.message, 'error');
  }
});

$('#shList').addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-sh-copy]');
  const revokeBtn = e.target.closest('[data-sh-revoke]');
  if (copyBtn) {
    const url = shareUrl(copyBtn.dataset.shCopy);
    try { await navigator.clipboard.writeText(url); toast('已复制链接', 'success'); }
    catch (_) { toast('复制失败，请手动复制：' + url, 'error'); }
  } else if (revokeBtn) {
    if (!confirm('撤销该分享链接？已发出的链接将立即失效。')) return;
    try {
      await api(`/api/admin/agents/${shareAgent.id}/shares/${revokeBtn.dataset.shRevoke}`, { method: 'DELETE' });
      toast('已撤销', 'success');
      loadShareList(shareAgent.id);
    } catch (e2) {
      toast('撤销失败：' + e2.message, 'error');
    }
  }
});

/* ================= 通知公告 ================= */
async function loadNotice() {
  try {
    const s = await api('/api/configs/settings');
    // 品牌与版权
    $('#site_name').value = s.siteName || '';
    $('#footer_text').value = s.footerText || '';
    $('#contact_email').value = s.contactEmail || '';
    $('#icp_beian').value = s.icpBeian || '';
    $('#police_beian').value = s.policeBeian || '';
    // 门户首页文案与默认主题
    $('#hero_badge').value = s.heroBadge || '';
    $('#hero_title').value = s.heroTitle || '';
    $('#hero_title_hl').value = s.heroTitleHl || '';
    $('#hero_desc').value = s.heroDesc || '';
    $('#default_theme').value = s.defaultTheme === 'dark' ? 'dark' : 'light';
    // 页面管理（登录页标语 / 协议）
    $('#login_tagline').value = s.loginTagline || '';
    $('#service_agreement').value = s.serviceAgreement || '';
    $('#privacy_policy').value = s.privacyPolicy || '';
    // 文件上传配置（知识库文件 / 对话附件）
    const ul = (s && s.uploadLimits) || {};
    $('#up_kb_exts').value = (ul.kb && ul.kb.exts || []).join(',');
    $('#up_kb_max').value = Math.round(((ul.kb && ul.kb.maxBytes) || 2 * 1024 * 1024) / 1024 / 1024);
    $('#up_att_exts').value = (ul.attachment && ul.attachment.exts || []).join(',');
    $('#up_att_max').value = Math.round(((ul.attachment && ul.attachment.maxBytes) || 20 * 1024 * 1024) / 1024 / 1024);
    // 通知公告
    const a = (s && s.announcement) || { enabled: false, text: '' };
    $('#notice_enabled').checked = !!a.enabled;
    $('#notice_text').value = a.text || '';
    els.noticeStatus.textContent = a.enabled && a.text
      ? `当前状态：展示中（更新于 ${(a.updatedAt || '').slice(0, 19).replace('T', ' ')}）`
      : '当前状态：未展示';
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载设置失败：' + e.message, 'error');
  }
}

$('#saveBrandingBtn').addEventListener('click', async () => {
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({
        siteName: $('#site_name').value,
        footerText: $('#footer_text').value,
        contactEmail: $('#contact_email').value,
        icpBeian: $('#icp_beian').value,
        policeBeian: $('#police_beian').value
      })
    });
    toast('品牌设置已保存，全站已生效', 'success');
    if (typeof window.applyBranding === 'function') window.applyBranding();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

$('#savePortalBtn').addEventListener('click', async () => {
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({
        heroBadge: $('#hero_badge').value,
        heroTitle: $('#hero_title').value,
        heroTitleHl: $('#hero_title_hl').value,
        heroDesc: $('#hero_desc').value,
        defaultTheme: $('#default_theme').value
      })
    });
    toast('门户文案已保存，打开门户首页（/）查看效果', 'success');
    if (typeof window.applyBranding === 'function') window.applyBranding();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

$('#savePagesBtn').addEventListener('click', async () => {
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({
        loginTagline: $('#login_tagline').value,
        serviceAgreement: $('#service_agreement').value,
        privacyPolicy: $('#privacy_policy').value
      })
    });
    toast('页面管理已保存，登录页刷新后生效', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

$('#saveUploadLimitsBtn').addEventListener('click', async () => {
  const parseExts = (s) => s.split(/[,，、\s]+/).map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({
        uploadLimits: {
          kb: {
            exts: parseExts($('#up_kb_exts').value),
            maxBytes: Math.floor(Number($('#up_kb_max').value) * 1024 * 1024)
          },
          attachment: {
            exts: parseExts($('#up_att_exts').value),
            maxBytes: Math.floor(Number($('#up_att_max').value) * 1024 * 1024)
          }
        }
      })
    });
    toast('文件上传配置已保存，员工端上传即时生效', 'success');
    loadNotice();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

$('#saveNoticeBtn').addEventListener('click', async () => {
  try {
    await api('/api/configs/settings', {
      method: 'PUT',
      body: JSON.stringify({
        announcement: {
          enabled: $('#notice_enabled').checked,
          text: $('#notice_text').value
        }
      })
    });
    toast('公告已保存', 'success');
    loadNotice();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

/* ================= 语音合成（TTS）配置 ================= */
let ttsVoices = []; // 音色列表（编辑态缓存）

function renderTtsVoices() {
  const box = $('#ttsVoicesBox');
  if (!box) return;
  box.innerHTML = ttsVoices.map((v, i) => `
    <div class="row-2" style="margin-bottom:8px" data-tts-voice-row="${i}">
      <label class="field" style="margin-bottom:0"><span>展示名（如「温柔女声」）</span>
        <input class="input tts-v-name" value="${esc(v.name || '')}" placeholder="如 温柔女声" />
      </label>
      <label class="field" style="margin-bottom:0"><span>上游音色标识 voice（如 alloy）</span>
        <input class="input tts-v-voice" value="${esc(v.voice || '')}" placeholder="如 alloy" />
      </label>
    </div>`).join('');
}

function collectTtsVoices() {
  const rows = document.querySelectorAll('#ttsVoicesBox [data-tts-voice-row]');
  const voices = [];
  rows.forEach((row) => {
    const name = row.querySelector('.tts-v-name').value.trim();
    const voice = row.querySelector('.tts-v-voice').value.trim();
    if (name && voice) voices.push({ name, voice });
  });
  return voices;
}

async function loadTts() {
  try {
    const c = await api('/api/admin/tts');
    $('#tts_enabled').checked = !!c.enabled;
    $('#tts_baseUrl').value = c.baseUrl || '';
    $('#tts_apiKey').value = ''; // 不回填明文，留空 = 不修改
    $('#tts_model').value = c.model || 'mimo-v2.5-tts';
    ttsVoices = Array.isArray(c.voices) ? c.voices : [];
    if (!ttsVoices.length) ttsVoices = [{ name: '', voice: '' }];
    renderTtsVoices();
    els.ttsStatus.textContent = c.enabled ? '当前状态：已启用' : '当前状态：未启用';
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载语音合成配置失败：' + e.message, 'error');
  }
}

$('#ttsAddVoice').addEventListener('click', () => {
  // 先收集当前已填写的音色，再追加空行（避免重渲染丢失已输入的值）
  ttsVoices = collectTtsVoices();
  ttsVoices.push({ name: '', voice: '' });
  renderTtsVoices();
});

$('#saveTtsBtn').addEventListener('click', async () => {
  const payload = {
    enabled: $('#tts_enabled').checked,
    baseUrl: $('#tts_baseUrl').value.trim(),
    model: $('#tts_model').value.trim(),
    voices: collectTtsVoices()
  };
  const key = $('#tts_apiKey').value.trim();
  if (key) payload.apiKey = key; // 仅非空时提交，避免覆盖为脱敏值
  try {
    await api('/api/admin/tts', { method: 'PUT', body: JSON.stringify(payload) });
    toast('语音合成配置已保存', 'success');
    $('#tts_apiKey').value = '';
    loadTts();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

/* ================= 画布工作流 ================= */
const NODE_META = {
  entry: { label: '用户问题', emoji: '🧑', color: '#8b5cf6', desc: '工作流入口：用户的问题从这里进入，沿连线向下游执行', output: '用户问题' },
  ai: { label: 'AI 对话', emoji: '🤖', color: '#3b82f6', desc: '大模型对话：根据系统提示词与上游内容生成回复', output: 'AI 回复内容' },
  kb: { label: '知识库搜索', emoji: '📚', color: '#14b8a6', desc: '在关联知识库中检索相关内容，作为下游引用', output: '引用内容' },
  reply: { label: '指定回复', emoji: '💬', color: '#ef4444', desc: '直接返回一段指定内容，常用于引导与提示', output: '回复内容' },
  transform: { label: '文本加工', emoji: '📝', color: '#22c55e', desc: '按模板对上游文本进行加工改写', output: '文本输出' },
  judge: { label: '判断器', emoji: '🚦', color: '#f59e0b', desc: '按关键词判断，命中走 ✓是、未命中走 ✗否', output: '判断结果' },
  complete: { label: '问题补全', emoji: '🔎', color: '#22c55e', desc: '把口语化问题补全为语义完整、可直接回答的问题', output: '补全结果' },
  classify: { label: '问题分类', emoji: '🗂️', color: '#8b5cf6', desc: 'AI 从给定类目中选出最匹配的一个', output: '类目结果' },
  extract: { label: '内容提取', emoji: '🧲', color: '#ec4899', desc: 'AI 按字段从上游文本提取结构化信息', output: '完整提取结果' },
  http: { label: 'HTTP 模块', emoji: '🌐', color: '#06b6d4', desc: '发起 HTTP 请求，返回响应正文', output: '响应正文' }
};
// 画布编辑状态（保存时整体提交）
const wfCanvas = { id: null, name: '', nodes: [], edges: [], variables: [], options: { kbs: [], configs: [] } };
let wfScale = 1; // 画布缩放

async function loadWorkflows() {
  try {
    const list = await api('/api/admin/workflows');
    els.wfStats.textContent = `共 ${list.length} 个工作流`;
    if (!list.length) {
      els.wfList.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无工作流，点击「+ 新建工作流」创建后进入画布编排。</div>';
      return;
    }
    els.wfList.innerHTML = list.map((w) => `
      <div class="kb-card">
        <h4>🧩 ${esc(w.name)}</h4>
        ${w.desc ? `<div class="kb-meta">${esc(w.desc)}</div>` : ''}
        <div class="kb-meta">节点 ${w.nodeCount} · 连线 ${w.edgeCount}<br/>${esc((w.updatedAt || '').slice(0, 19).replace('T', ' '))} 更新</div>
        <div class="kb-actions">
          <button class="btn btn-sm primary" data-wf-act="open" data-id="${w.id}">打开画布</button>
          <button class="btn btn-sm danger" data-wf-act="del" data-id="${w.id}">删除</button>
        </div>
      </div>`).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载工作流失败：' + e.message, 'error');
  }
}

$('#addWfBtn').addEventListener('click', () => {
  $('#wfc_name').value = '';
  $('#wfc_desc').value = '';
  $('#wfCreateModal').style.display = 'grid';
});

$('#wfCreateBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#wfc_name').value.trim(),
        desc: $('#wfc_desc').value.trim(),
        nodes: [{ id: 'n' + Date.now().toString(36), type: 'entry', x: 160, y: 120, cfg: {} }],
        edges: []
      })
    });
    $('#wfCreateModal').style.display = 'none';
    toast('工作流已创建', 'success');
    loadWorkflows();
    openWfCanvas(r.id, r.name);
  } catch (e) {
    toast('创建失败：' + e.message, 'error');
  }
});

$('#refreshWfBtn').addEventListener('click', loadWorkflows);

els.wfList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-wf-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.wfAct === 'open') {
    const wf = await api(`/api/admin/workflows/${id}`);
    openWfCanvas(id, wf.name, wf);
  } else if (btn.dataset.wfAct === 'del') {
    if (!confirm('删除该工作流？')) return;
    try {
      await api(`/api/admin/workflows/${id}`, { method: 'DELETE' });
      toast('工作流已删除', 'success');
      loadWorkflows();
    } catch (e2) {
      toast('删除失败：' + e2.message, 'error');
    }
  }
});

/* ---------- 画布编辑器 ---------- */
async function openWfCanvas(id, name, preset) {
  try {
    wfCanvas.id = id;
    wfCanvas.name = name;
    wfScale = 1;
    applyWfScale();
    if (preset) {
      wfCanvas.nodes = JSON.parse(JSON.stringify(preset.nodes || []));
      wfCanvas.edges = JSON.parse(JSON.stringify(preset.edges || []));
      wfCanvas.variables = JSON.parse(JSON.stringify(preset.variables || []));
    } else {
      wfCanvas.nodes = [{ id: 'n' + Date.now().toString(36), type: 'entry', x: 160, y: 140, cfg: {} }];
      wfCanvas.edges = [];
      wfCanvas.variables = [];
    }
    wfCanvas.options = await api('/api/admin/workflows/options');
    $('#wfCanvasTitle').textContent = `工作流 · ${name}`;
    renderWfVars();
    $('#wfDebugOut').innerHTML = '<div class="hint">在左侧节点面板点击添加节点；从节点右侧圆点拖到目标节点左侧圆点建立连线。保存后可在右侧输入问题测试运行。</div>';
    $('#wfCanvas').style.display = 'flex';
    renderWfNodes();
    drawWfEdges();
  } catch (e) {
    toast('打开画布失败：' + e.message, 'error');
  }
}

function wfOptionsSelect(type, cfg, nodeId) {
  if (type === 'ai') {
    const opts = wfCanvas.options.configs.map((c) => `<option value="${c.id}" ${cfg.configId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
    return `<div class="field"><span>对话模型 *</span><select data-wf-cfg="configId"><option value="">请选择</option>${opts}</select></div>
      <div class="field"><span>系统提示词</span><textarea rows="3" data-wf-cfg="systemPrompt" placeholder="模型固定的引导词，可引导对话方向">${esc(cfg.systemPrompt || '')}</textarea></div>
      <div class="field"><span>聊天记录（预留，调试为单轮）</span><input type="number" value="${esc(String(cfg.chatHistory ?? 6))}" disabled /></div>`;
  }
  if (type === 'kb') {
    const opts = wfCanvas.options.kbs.map((k) => `<option value="${k.id}" ${cfg.kbId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
    return `<div class="field"><span>知识库 *</span><select data-wf-cfg="kbId"><option value="">请选择</option>${opts}</select></div>
      <div class="field"><span>返回条数 TopK</span><input type="number" min="1" max="20" value="${esc(String(cfg.topK ?? 5))}" data-wf-cfg="topK" /></div>
      <div class="hint">两个输出口：✓ 命中（检索到分段）/ ○ 结果为空，可分别连线到不同下游。</div>`;
  }
  if (type === 'transform') {
    return `<div class="field"><span>加工模板 *（{{input}} = 上游文本）</span><textarea rows="3" data-wf-cfg="template" placeholder="例如：请把下面的内容整理成要点：&#10;{{input}}">${esc(cfg.template || '')}</textarea></div>`;
  }
  if (type === 'judge') {
    return `<div class="field"><span>判断关键词 *（逗号分隔，命中走 ✓是）</span><input data-wf-cfg="keywords" placeholder="如：价格,优惠,退款" value="${esc(cfg.keywords || '')}" /></div>
      <div class="hint">✓ 是：问题包含任一关键词；✗ 否：未包含。分别连线到不同下游。</div>`;
  }
  if (type === 'reply') {
    return `<div class="field"><span>固定回复内容 *</span><textarea rows="3" data-wf-cfg="text" placeholder="命中该节点时直接返回这段文本">${esc(cfg.text || '')}</textarea></div>`;
  }
  // —— v2 新节点配置表单 ——
  if (type === 'complete') {
    const opts = wfCanvas.options.configs.map((c) => `<option value="${c.id}" ${cfg.configId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
    return `<div class="field"><span>模型配置 *</span><select data-wf-cfg="configId"><option value="">请选择</option>${opts}</select></div>
      <div class="field"><span>补全引导词（可选，覆盖默认改写规则）</span><textarea rows="2" data-wf-cfg="systemPrompt" placeholder="默认：把口语化问题补全为语义完整、可直接回答的问题">${esc(cfg.systemPrompt || '')}</textarea></div>
      <div class="hint">输出 = 补全后的问题，下游 AI 对话节点以它为输入。</div>`;
  }
  if (type === 'classify') {
    const opts = wfCanvas.options.configs.map((c) => `<option value="${c.id}" ${cfg.configId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
    return `<div class="field"><span>模型配置 *</span><select data-wf-cfg="configId"><option value="">请选择</option>${opts}</select></div>
      <div class="field"><span>类目 *（每行一个，最多 20 个）</span><textarea rows="3" data-wf-cfg="categories" placeholder="售前咨询&#10;售后问题&#10;投诉建议">${esc(cfg.categories || '')}</textarea></div>
      <div class="hint">AI 从类目中选最匹配的一个，输出类目名；常接判断器/指定回复做分流。</div>`;
  }
  if (type === 'extract') {
    const opts = wfCanvas.options.configs.map((c) => `<option value="${c.id}" ${cfg.configId === c.id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
    return `<div class="field"><span>模型配置 *</span><select data-wf-cfg="configId"><option value="">请选择</option>${opts}</select></div>
      <div class="field"><span>提取字段 *（每行一个，最多 15 个）</span><textarea rows="3" data-wf-cfg="fields" placeholder="姓名&#10;手机号&#10;地址">${esc(cfg.fields || '')}</textarea></div>
      <div class="hint">从上游文本提取字段，输出 JSON。两个输出口：✓ 完整提取（所有字段非空）/ ○ 字段缺失。</div>`;
  }
  if (type === 'http') {
    return `<div class="field"><span>请求方法</span><select data-wf-cfg="method">
      ${['GET', 'POST', 'PUT', 'DELETE'].map((m) => `<option value="${m}" ${String(cfg.method || 'GET').toUpperCase() === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select></div>
    <div class="field"><span>URL *（http/https）</span><input data-wf-cfg="url" placeholder="https://api.example.com/path" value="${esc(cfg.url || '')}" /></div>
    <div class="field"><span>请求体模板（{{input}} = 上游文本，仅非 GET 生效）</span><textarea rows="2" data-wf-cfg="bodyTemplate" placeholder='{"query": "{{input}}"}'>${esc(cfg.bodyTemplate || '')}</textarea></div>
    <div class="field"><span>超时（秒，≤30）</span><input type="number" min="1" max="30" data-wf-cfg="timeoutSec" value="${esc(String(cfg.timeoutSec ?? 10))}" /></div>
    <div class="hint">输出 = 响应正文（截断 8000 字符）。请勿配置内网/敏感地址。</div>`;
  }
  return '<div class="hint">工作流入口：用户的问题从这里进入，沿连线向下游执行。</div>';
}

/* ---------- 工作流变量（开始节点输入变量，对齐 Coze「参数变量」） ---------- */
const WF_VAR_TYPE_LABELS = { text: '文本', paragraph: '段落', select: '下拉' };
function wfVarKeyGen() {
  return 'v' + Math.random().toString(36).slice(2, 8);
}
function renderWfVars() {
  const box = $('#wfVarsBox');
  if (!box) return;
  const vars = wfCanvas.variables || [];
  if (!vars.length) {
    box.innerHTML = '<div class="hint" style="font-size:12px">暂无变量，点击下方「＋ 新增变量」添加。</div>';
    return;
  }
  box.innerHTML = vars.map((v) => `
    <div class="wf-var-item" data-key="${esc(v.key)}">
      <span class="wf-var-name" title="${esc(v.name)}（${esc(v.key)}）">${esc(v.name || v.key)}</span>
      <span class="wf-var-badge">${WF_VAR_TYPE_LABELS[v.type] || '文本'}${v.required ? ' · 必填' : ''}</span>
      <button class="wf-var-btn" data-act="edit" title="编辑变量">✎</button>
      <button class="wf-var-btn del" data-act="del" title="删除变量">✕</button>
    </div>`).join('');
  // 事件委托
  box.querySelectorAll('.wf-var-item').forEach((item) => {
    const key = item.dataset.key;
    item.querySelector('[data-act="edit"]').addEventListener('click', () => {
      const v = (wfCanvas.variables || []).find((x) => x.key === key);
      if (v) openWfVarModal(v);
    });
    item.querySelector('[data-act="del"]').addEventListener('click', () => {
      wfCanvas.variables = (wfCanvas.variables || []).filter((x) => x.key !== key);
      renderWfVars();
    });
  });
}
function openWfVarModal(v) {
  const isEdit = !!v;
  $('#wfVarModalTitle').textContent = isEdit ? '编辑变量' : '新增变量';
  $('#wfVar_editKey').value = isEdit ? v.key : '';
  $('#wfVar_name').value = isEdit ? (v.name || '') : '';
  $('#wfVar_key').value = isEdit ? v.key : wfVarKeyGen();
  $('#wfVar_type').value = isEdit ? (v.type || 'text') : 'text';
  $('#wfVar_required').checked = isEdit ? !!v.required : false;
  $('#wfVar_maxLength').value = isEdit ? (v.maxLength || 0) : 0;
  $('#wfVar_options').value = isEdit && Array.isArray(v.options) ? v.options.join('\n') : '';
  syncWfVarType();
  $('#wfVarModal').style.display = 'grid';
}
function syncWfVarType() {
  const t = $('#wfVar_type').value;
  $('#wfVar_optionsWrap').style.display = t === 'select' ? '' : 'none';
}

function renderWfNodes() {
  const layer = $('#wfNodesLayer');
  layer.innerHTML = '';
  wfCanvas.nodes.forEach((n) => {
    const div = document.createElement('div');
    div.className = `wf-node type-${n.type}`;
    div.style.left = n.x + 'px';
    div.style.top = n.y + 'px';
    div.dataset.nodeId = n.id;
    const m = NODE_META[n.type] || { label: n.type, emoji: '📦', color: '#94a3b8', desc: '', output: '输出' };
    // 输出口：分支节点有多个输出口（判断器 ✓/✗、知识库 命中/为空、提取 完整/缺失）
    const branchPorts = n.type === 'judge' ? [['yes', '✓ 命中', '#22c55e'], ['no', '✗ 未命中', '#f87171']]
      : n.type === 'kb' ? [['hit', '✓ 命中', '#22c55e'], ['miss', '○ 结果为空', '#f59e0b']]
      : n.type === 'extract' ? [['full', '✓ 完整提取', '#22c55e'], ['partial', '○ 字段缺失', '#f59e0b']]
      : null;
    // 输出区：分支节点多个输出口，普通节点单个输出口（带变量名）
    const outHtml = branchPorts
      ? branchPorts.map(([p, label, color]) => `
          <div class="wf-out-row"><span class="wf-port wf-port-out" data-port="${p}" title="${label}" style="border-color:${color}"></span><span class="wf-out-label" style="color:${color}">${label}</span></div>`).join('')
      : `<div class="wf-out-row"><span class="wf-port wf-port-out" title="拖到目标节点连线"></span><span class="wf-out-label">${esc(m.output || '输出')}</span></div>`;
    // 输入端口（入口节点无输入）
    const inPort = n.type === 'entry'
      ? ''
      : '<span class="wf-port wf-port-in" title="输入"></span>';
    // 配置字段（内联，data-wf-cfg 写回 node.cfg）
    const cfgHtml = wfOptionsSelect(n.type, n.cfg || {}, n.id);
    div.innerHTML = `
      <div class="wf-node-head">
        <span class="wf-node-ico" style="background:${m.color}">${m.emoji}</span>
        <span class="wf-node-name">${esc(m.label)}</span>
        <span class="wf-node-actions">
          <button class="wf-del" title="删除节点">✕</button>
        </span>
      </div>
      <div class="wf-node-desc">${esc(m.desc)}</div>
      ${n.type !== 'entry' ? `<div class="wf-sec-title">输入</div>` : ''}
      <div class="wf-node-body">
        ${inPort}
        ${cfgHtml}
      </div>
      <div class="wf-sec-title">输出</div>
      <div class="wf-node-section">${outHtml}</div>`;
    // 配置字段变化 → 写回 state（节点高度可能变化，重绘连线）
    let wfRedrawTimer = null;
    div.querySelectorAll('[data-wf-cfg]').forEach((el) => {
      const onCfgChange = () => {
        n.cfg = n.cfg || {};
        n.cfg[el.dataset.wfCfg] = el.value;
        clearTimeout(wfRedrawTimer);
        wfRedrawTimer = setTimeout(drawWfEdges, 120);
      };
      el.addEventListener('change', onCfgChange);
      el.addEventListener('input', onCfgChange);
    });
    // 拖拽移动
    const head = div.querySelector('.wf-node-head');
    head.addEventListener('pointerdown', (e) => startWfDrag(e, n, div));
    // 删除节点
    div.querySelector('.wf-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (n.type === 'entry') { toast('入口节点不可删除', 'error'); return; }
      wfCanvas.nodes = wfCanvas.nodes.filter((x) => x.id !== n.id);
      wfCanvas.edges = wfCanvas.edges.filter((e) => e.from !== n.id && e.to !== n.id);
      renderWfNodes();
      drawWfEdges();
    });
    layer.appendChild(div);
  });
}

/* ---------- 节点配置弹窗 ---------- */
let wfConfigNodeId = null;
function openWfNodeConfig(node) {
  wfConfigNodeId = node.id;
  const m = NODE_META[node.type] || { label: node.type, emoji: '📦' };
  $('#wfNodeConfigTitle').textContent = `${m.emoji} ${m.label}`;
  $('#wfNodeConfigBody').innerHTML = `
    <div class="hint" style="margin-bottom:12px">${esc(m.desc)}</div>
    ${wfOptionsSelect(node.type, node.cfg || {}, node.id)}`;
  // 配置字段变化 → 写回 node.cfg
  const body = $('#wfNodeConfigBody');
  body.querySelectorAll('[data-wf-cfg]').forEach((el) => {
    const onCfgChange = () => {
      node.cfg = node.cfg || {};
      node.cfg[el.dataset.wfCfg] = el.value;
    };
    el.addEventListener('change', onCfgChange);
    el.addEventListener('input', onCfgChange);
  });
  $('#wfNodeConfigModal').style.display = 'grid';
}
function closeWfNodeConfig() {
  $('#wfNodeConfigModal').style.display = 'none';
  wfConfigNodeId = null;
  drawWfEdges(); // 配置可能改变节点高度，重绘连线
}

let wfDrag = null;
function startWfDrag(e, node, div) {
  if (e.target.closest('.wf-del')) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  // Pointer 捕获：拖拽中所有事件重定向到标题元素，规避原生文本选择/拖拽抢占
  try { div.setPointerCapture(e.pointerId); } catch (_) {}
  wfDrag = { node, div, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y, scale: wfScale || 1 };
  // 监听绑定到捕获元素（捕获后 move/up 都会派发到这里）
  const onMove = (ev) => {
    if (!wfDrag) return;
    // 画布缩放后屏幕位移要除以缩放倍率才是逻辑坐标位移
    const dx = (ev.clientX - wfDrag.startX) / wfDrag.scale;
    const dy = (ev.clientY - wfDrag.startY) / wfDrag.scale;
    wfDrag.node.x = Math.max(0, wfDrag.origX + dx);
    wfDrag.node.y = Math.max(0, wfDrag.origY + dy);
    wfDrag.div.style.left = wfDrag.node.x + 'px';
    wfDrag.div.style.top = wfDrag.node.y + 'px';
    drawWfEdges();
  };
  const onEnd = () => {
    div.removeEventListener('pointermove', onMove);
    div.removeEventListener('pointerup', onEnd);
    div.removeEventListener('pointercancel', onEnd);
    wfDrag = null;
  };
  div.addEventListener('pointermove', onMove);
  div.addEventListener('pointerup', onEnd);
  div.addEventListener('pointercancel', onEnd);
}

function wfPortPos(nodeId, port) {
  // 基于 DOM 实测端口位置（用 getBoundingClientRect 计算端口中心相对画布内层的坐标）
  const nodeEl = document.querySelector(`.wf-node[data-node-id="${nodeId}"]`);
  const node = wfCanvas.nodes.find((n) => n.id === nodeId);
  if (!nodeEl || !node) return { x: node ? node.x : 0, y: node ? node.y : 0 };
  let portEl = null;
  if (port === 'in') portEl = nodeEl.querySelector('.wf-port-in');
  else if (port === 'out') portEl = nodeEl.querySelector('.wf-port-out:not([data-port])');
  else portEl = nodeEl.querySelector(`.wf-port-out[data-port="${port}"]`);
  if (!portEl) portEl = nodeEl.querySelector('.wf-port-out');
  if (!portEl) return { x: node.x, y: node.y };
  const inner = $('#wfCanvasInner');
  const pr = portEl.getBoundingClientRect();
  const ir = inner ? inner.getBoundingClientRect() : { left: 0, top: 0 };
  const scale = wfScale || 1;
  // 除以 scale：getBoundingClientRect 返回渲染后（已缩放）坐标，SVG 边用逻辑坐标
  return {
    x: (pr.left - ir.left + pr.width / 2) / scale,
    y: (pr.top - ir.top + pr.height / 2) / scale
  };
}

function drawWfEdges() {
  const svg = $('#wfEdges');
  // 保留 defs，清空路径
  svg.innerHTML = '<defs><marker id="wfArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8fa3c8"/></marker></defs>';
  const byId = new Map(wfCanvas.nodes.map((n) => [n.id, n]));
  wfCanvas.edges.forEach((e, idx) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    const p1 = wfPortPos(e.from, e.fromPort || 'out');
    const p2 = wfPortPos(e.to, 'in');
    const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
    const d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'edge');
    // 分支边：标注颜色（✓ 绿色 / ✗、○ 红色）
    if ((e.fromPort || 'out') !== 'out') {
      const hit = e.fromPort === 'yes' || e.fromPort === 'hit' || e.fromPort === 'full';
      path.setAttribute('stroke', hit ? '#34d399' : '#f87171');
      path.removeAttribute('marker-end');
    }
    path.addEventListener('click', () => {
      if (!confirm('删除这条连线？')) return;
      wfCanvas.edges.splice(idx, 1);
      drawWfEdges();
    });
    svg.appendChild(path);
  });
}

// 连线交互（Pointer 版）：输出圆点按下 → 捕获指针拖出临时线 → 释放时用
// elementFromPoint 命中目标节点。原生 mousedown/mouseup 在拖拽中会被文本选择
// 等原生行为抢占导致 mouseup 丢失（表现为"无法连线"），Pointer 捕获彻底规避。
(function initWfConnect() {
  let linking = null; // { from, fromPort }

  function canvasPoint(e) {
    const inner = $('#wfCanvasInner');
    const rect = inner.getBoundingClientRect();
    const scale = wfScale || 1;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  }

  function drawTempLine(pt) {
    const svg = $('#wfEdges');
    const start = wfPortPos(linking.from, linking.fromPort);
    const dx = Math.max(30, Math.abs(pt.x - start.x) / 2);
    const d = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${pt.x - dx} ${pt.y}, ${pt.x} ${pt.y}`;
    svg.innerHTML = '<defs><marker id="wfArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8fa3c8"/></marker></defs>'
      + `<path class="edge-temp" d="${d}"/>`
      + wfCanvas.edges.map((e) => {
        const a = wfPortPos(e.from, e.fromPort || 'out');
        const b = wfPortPos(e.to, 'in');
        const ddx = Math.max(40, Math.abs(b.x - a.x) / 2);
        return `<path class="edge" d="M ${a.x} ${a.y} C ${a.x + ddx} ${a.y}, ${b.x - ddx} ${b.y}, ${b.x} ${b.y}"/>`;
      }).join('');
  }

  document.addEventListener('pointerdown', (e) => {
    const port = e.target.closest('.wf-port-out');
    if (!port) return;
    const nodeEl = port.closest('.wf-node');
    if (!nodeEl) return;
    linking = { from: nodeEl.dataset.nodeId, fromPort: port.dataset.port || 'out' };
    e.preventDefault();
    try { port.setPointerCapture(e.pointerId); } catch (_) {}
  });

  document.addEventListener('pointermove', (e) => {
    if (!linking) return;
    drawTempLine(canvasPoint(e));
  });

  function finish(e) {
    if (!linking) return;
    const info = { from: linking.from, fromPort: linking.fromPort };
    linking = null;
    drawWfEdges(); // 清除临时线并按最终状态重绘
    // 释放点命中目标节点（elementFromPoint 不依赖 mouseup 的 target 语义）
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = el && el.closest('.wf-node');
    if (!nodeEl) { toast('连线需释放到目标节点上', 'error'); return; }
    const target = nodeEl.dataset.nodeId;
    if (target === info.from) return;
    if (wfCanvas.edges.some((x) => x.from === info.from && x.to === target)) {
      toast('这两个节点之间已有连线', 'error');
      return;
    }
    wfCanvas.edges.push({ from: info.from, fromPort: info.fromPort, to: target });
    drawWfEdges();
    toast('已连接', 'success');
  }
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', () => { if (linking) { linking = null; drawWfEdges(); } });
})();

// 节点面板：点击添加（位置级联偏移，避免新节点堆叠）
document.querySelectorAll('[data-wf-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.wfAdd;
    if (type === 'entry' && wfCanvas.nodes.some((n) => n.type === 'entry')) {
      toast('入口节点只能有一个', 'error');
      return;
    }
    const vp = $('#wfViewport');
    const seq = wfCanvas.nodes.length;
    wfCanvas.nodes.push({
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type,
      x: vp.scrollLeft + 300 + seq * 280,
      y: vp.scrollTop + 120 + seq * 70,
      cfg: type === 'reply' ? { text: '' } : type === 'transform' ? { template: '' } : type === 'judge' ? { keywords: '' }
        : type === 'classify' ? { configId: '', categories: '' } : type === 'extract' ? { configId: '', fields: '' }
        : type === 'http' ? { method: 'GET', url: '', bodyTemplate: '', timeoutSec: 10 } : {}
    });
    renderWfNodes();
    drawWfEdges();
  });
});

/* 画布缩放 */
function applyWfScale() {
  const inner = $('#wfCanvasInner');
  if (inner) inner.style.transform = `scale(${wfScale})`;
}
$('#wfZoomIn').addEventListener('click', () => { wfScale = Math.min(1.5, Math.round((wfScale + 0.1) * 10) / 10); applyWfScale(); drawWfEdges(); });
$('#wfZoomOut').addEventListener('click', () => { wfScale = Math.max(0.4, Math.round((wfScale - 0.1) * 10) / 10); applyWfScale(); drawWfEdges(); });
$('#wfZoomReset').addEventListener('click', () => { wfScale = 1; applyWfScale(); drawWfEdges(); });

// 鼠标滚轮缩放画布（在视口内滚动即可放大/缩小，无需点击按钮）
{
  const vp = $('#wfViewport');
  if (vp) vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1; // 向上滚放大，向下滚缩小
    wfScale = Math.min(1.5, Math.max(0.4, Math.round((wfScale + delta) * 10) / 10));
    applyWfScale();
    drawWfEdges();
  }, { passive: false });
}

$('#wfCanvasBack').addEventListener('click', () => {
  $('#wfCanvas').style.display = 'none';
  loadWorkflows();
});

$('#wfSaveBtn').addEventListener('click', async () => {
  try {
    await api(`/api/admin/workflows/${wfCanvas.id}`, {
      method: 'PUT',
      body: JSON.stringify({ nodes: wfCanvas.nodes, edges: wfCanvas.edges, variables: wfCanvas.variables || [] })
    });
    toast('画布已保存', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// —— 工作流变量：新增 / 编辑 / 保存 ——
$('#wfAddVarBtn').addEventListener('click', () => openWfVarModal(null));
$('#wfVar_type').addEventListener('change', syncWfVarType);
$('#wfVarSaveBtn').addEventListener('click', () => {
  const name = $('#wfVar_name').value.trim();
  const key = $('#wfVar_key').value.trim();
  if (!name) { toast('请输入变量名', 'error'); return; }
  if (!key) { toast('请输入变量 key', 'error'); return; }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(key)) { toast('变量 key 仅支持字母/数字/下划线，且以字母或下划线开头', 'error'); return; }
  const editKey = $('#wfVar_editKey').value;
  const type = $('#wfVar_type').value;
  const required = $('#wfVar_required').checked;
  const maxLength = parseInt($('#wfVar_maxLength').value, 10) || 0;
  const options = type === 'select' ? $('#wfVar_options').value.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const list = wfCanvas.variables || [];
  // 编辑：替换同 key；新增：key 不能与已有重复
  if (editKey) {
    const idx = list.findIndex((x) => x.key === editKey);
    if (idx >= 0) list[idx] = { key, name, type, required, maxLength, options };
  } else {
    if (list.some((x) => x.key === key)) { toast('变量 key 已存在', 'error'); return; }
    list.push({ key, name, type, required, maxLength, options });
  }
  wfCanvas.variables = list;
  $('#wfVarModal').style.display = 'none';
  renderWfVars();
  toast('变量已保存，记得点击「保存画布」', 'success');
});

// —— 节点配置弹窗：关闭 / 保存 / 删除 ——
$('#wfNodeConfigClose').addEventListener('click', closeWfNodeConfig);
$('#wfNodeConfigCancel').addEventListener('click', closeWfNodeConfig);
$('#wfNodeConfigSave').addEventListener('click', () => {
  closeWfNodeConfig();
  toast('节点配置已更新，记得点击「保存画布」', 'success');
});
$('#wfNodeDeleteBtn').addEventListener('click', () => {
  const n = wfCanvas.nodes.find((x) => x.id === wfConfigNodeId);
  if (!n) { closeWfNodeConfig(); return; }
  if (n.type === 'entry') { toast('入口节点不可删除', 'error'); return; }
  wfCanvas.nodes = wfCanvas.nodes.filter((x) => x.id !== n.id);
  wfCanvas.edges = wfCanvas.edges.filter((e) => e.from !== n.id && e.to !== n.id);
  closeWfNodeConfig();
  renderWfNodes();
  drawWfEdges();
  toast('节点已删除', 'success');
});
// 点击遮罩关闭
$('#wfNodeConfigModal').addEventListener('click', (e) => {
  if (e.target === $('#wfNodeConfigModal')) closeWfNodeConfig();
});
// Esc 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#wfNodeConfigModal').style.display === 'grid') closeWfNodeConfig();
});

$('#wfRunBtn').addEventListener('click', () => {
  $('#wfTestQuery').focus();
  toast('在右侧输入测试问题后点击「运行工作流」', '');
});

$('#wfRunQueryBtn').addEventListener('click', async () => {
  const q = $('#wfTestQuery').value.trim();
  if (!q) { toast('请输入测试问题', 'error'); return; }
  const out = $('#wfDebugOut');
  out.innerHTML = '<div class="hint">执行中…（AI 对话节点会真实调用上游模型）</div>';
  try {
    const r = await api(`/api/admin/workflows/${wfCanvas.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ query: q })
    });
    out.innerHTML = (r.steps || []).map((s) => `
      <div class="kb-chunk" style="margin-bottom:8px">
        <div class="kb-chunk-head"><b>${esc(s.name)}</b><span class="spacer"></span></div>
        <div style="white-space:pre-wrap;word-break:break-word">${esc(s.summary || '')}</div>
        ${s.output ? `<div class="field-sep" style="margin:6px 0">输出</div><div style="white-space:pre-wrap;word-break:break-word">${esc(s.output)}</div>` : ''}
      </div>`).join('')
      + `<div class="kb-chunk kb-search-hit"><div class="kb-chunk-head"><b>最终输出</b><span class="spacer"></span><span>${r.latencyMs}ms</span></div><div style="white-space:pre-wrap;word-break:break-word">${esc(r.output || '(空)')}</div></div>`;
  } catch (e) {
    out.innerHTML = `<div class="hint">执行失败：${esc(e.message)}</div>`;
  }
});

/* ================= 系统信息（V3.32：资源 / 规模 / Token / 模块 / 诊断 / 端口） ================= */
const si$ = (id) => document.getElementById(id);

function siNum(n) { return Number(n || 0).toLocaleString('zh-CN'); }
function siTok(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}
function siBytes(b) {
  const v = Number(b) || 0;
  if (!v) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
function siDur(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时 ${m} 分`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${s % 60} 秒`;
}
const SI_STATUS_TEXT = { ok: '正常', warn: '注意', error: '异常', info: '提示', idle: '未启用' };
function siPill(level, text) {
  const cls = level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'info' ? 'info' : '';
  return `<span class="si-pill ${cls}"><i></i>${esc(text || SI_STATUS_TEXT[level] || '—')}</span>`;
}
function siBarClass(pct, warnAt, dangerAt) {
  return pct >= dangerAt ? 'danger' : pct >= warnAt ? 'warn' : '';
}

async function loadSystemInfo() {
  if (!si$('siCounts')) return;
  try {
    const d = await api('/api/admin/system-info');
    renderSiSnapshot(d);
    renderSiCounts(d);
    renderSiTokens(d.tokens || {});
    renderSiModules(Array.isArray(d.modules) ? d.modules : []);
    if (!siPortLoaded) loadSiPort();
    // 旧后端兜底提示：老进程没有 modules / tokens 时给出明确指引，避免误以为是页面坏了
    siStaleHint(!Array.isArray(d.modules) || !d.tokens);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    if (e.status === 404) siStaleHint(true);
    toast('系统信息加载失败：' + e.message, 'error');
  }
}

/** 后端仍是旧版本（未加载新接口）时的顶部提示 */
function siStaleHint(show) {
  const el = si$('siStale');
  if (!el) return;
  if (!show) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = '<b>⚠️ 后端服务仍是旧版本</b><span>当前进程没有加载「模块状态 / Token 统计 / 诊断修复」接口（HTTP 404）。请重启服务后再刷新本页：双击 <code>启动.bat</code> → [2] 停止服务 → [1] 启动服务。</span>';
}

function renderSiSnapshot(d) {
  const cpu = Number(d.cpuUsagePct) || 0;
  si$('siCpuVal').textContent = cpu + '%';
  const cpuBar = si$('siCpuBar');
  cpuBar.style.width = Math.max(cpu, 1.5) + '%';
  cpuBar.className = siBarClass(cpu, 80, 95);
  si$('siCpuCore').textContent = `${d.cpuCores || 0} 核`;
  const model = (d.cpuModel || '').replace(/\s+/g, ' ').trim();
  si$('siCpuFoot').textContent = `${d.cpuCores || 0} 核 · ${d.platformLabel || '-'}${model ? ' · ' + model.slice(0, 30) : ''}`;

  const mem = d.memory || {};
  si$('siMemVal').textContent = `${mem.usedPct || 0}%`;
  const memBar = si$('siMemBar');
  memBar.style.width = Math.max(mem.usedPct || 0, 1.5) + '%';
  memBar.className = siBarClass(mem.usedPct || 0, 80, 92);
  si$('siMemTotal').textContent = `共 ${siBytes((mem.totalMB || 0) * 1024 * 1024)}`;
  si$('siMemFoot').textContent = `系统占用 ${mem.usedPct || 0}%（已用 ${mem.usedMB || 0} MB）· 本进程 ${mem.rssMB || 0} MB（Heap ${mem.heapUsedMB || 0} MB）`;

  si$('siEnv').innerHTML = [
    ['主机', d.host || '-'],
    ['系统', `${d.platformLabel || '-'} · ${d.osRelease || '-'}`],
    ['Node', `${d.node || '-'}（v${d.version || '-'}）`],
    ['运行时长', siDur(d.uptimeSec)],
    ['数据目录', d.dataDir || '-', true]
  ].map(([k, v, ell]) => `<div${ell ? ' class="si-kv-ellipsis" title="' + esc(String(v)) + '"' : ''}><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('');
}

function renderSiCounts(d) {
  const c = d.counts || {};
  const tiles = [
    ['成员账号', siNum(c.members), `启用 ${siNum(c.membersActive)} 人`],
    ['模型配置', siNum(c.configs), `启用 ${siNum(c.configsEnabled)} 个通道`],
    ['会话记录', siNum(c.conversations), `${siNum(c.messages)} 条消息 · ${siNum(c.shares)} 个分享`],
    ['智能体', siNum(c.agents), `${siNum(c.agentsWithKb)} 关联知识库 · ${siNum(c.agentsWithWf)} 绑定工作流`],
    ['知识库', siNum(c.knowledgeBases), `${siNum(c.kbFiles)} 文件 · ${siNum(c.kbChunks)} 分段`],
    ['画布工作流', siNum(c.workflows), `${siNum(c.workflowNodes)} 个节点`],
    ['上传文件', siNum(c.uploadFiles), siBytes(c.uploadBytes)],
    ['数据体积', siBytes(d.dbSizeBytes), `${esc(d.dbFile || 'db.json')} · 插件 ${siNum(c.plugins)} / MCP ${siNum(c.mcps)}`]
  ];
  si$('siCounts').innerHTML = tiles.map(([label, value, em]) =>
    `<div class="si-tile"><span>${esc(label)}</span><b>${esc(String(value))}</b><em>${esc(String(em))}</em></div>`
  ).join('');
}

function renderSiTokens(t) {
  const total = t.total || 0;
  const sinceAt = t.since ? new Date(t.since) : null;
  const sinceLabel = sinceAt && !Number.isNaN(sinceAt.getTime())
    ? `${sinceAt.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 起`
    : '近 14 天';
  si$('siTokenHint').textContent = `${sinceLabel} · 累计 ${siTok(total)} tokens / ${siNum(t.calls)} 次调用`;
  si$('siTokens').innerHTML = [
    ['累计输入', `${siTok(t.input)} tokens`],
    ['累计输出', `${siTok(t.output)} tokens`],
    ['累计总量', `${siTok(total)} tokens`],
    ['调用次数', `${siNum(t.calls)} 次`]
  ].map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');

  si$('siTokDays').innerHTML = (t.days || []).length
    ? t.days.map((r) => `<tr>
        <td>${esc(r.date)}</td>
        <td class="num">${siTok(r.total)}</td>
        <td class="num">${siTok(r.input)}</td>
        <td class="num">${siTok(r.output)}</td>
        <td class="num">${siNum(r.calls)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="si-empty">暂无 Token 记录（仅统计非流式请求回传的 usage）</td></tr>';

  si$('siTokModels').innerHTML = (t.models || []).length
    ? t.models.map((r) => `<tr>
        <td>${esc(r.model)}</td>
        <td class="num">${siTok(r.total)}</td>
        <td class="num">${siNum(r.calls)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="si-empty">暂无数据</td></tr>';
}

function renderSiModules(list) {
  const body = si$('siModules');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="3" class="si-empty">暂无模块信息</td></tr>';
    return;
  }
  body.innerHTML = list.map((m) => `<tr>
    <td><span class="si-mod-name">${esc(m.icon || '•')} ${esc(m.name)}</span></td>
    <td>${siPill(m.level, m.status)}</td>
    <td class="si-mod-detail">${esc(m.detail || '')}</td>
  </tr>`).join('');
}

/* ---------- 诊断与修复 ---------- */
let siDiagData = null;

async function runSiDiagnose() {
  const box = si$('siDiag');
  if (!box) return;
  if (siDiagData) box.innerHTML = '<div class="si-diag-box"><b>诊断中…</b><div>正在检查数据文件、目录、模型通道、索引与端口…</div></div>';
  try {
    const d = await api('/api/admin/system-info/diagnose', { method: 'POST' });
    siDiagData = d;
    renderSiDiag(d);
    const level = d.level;
    const el = si$('siOverall');
    if (el) {
      el.className = `si-overall ${level}`;
      el.innerHTML = `<i></i>${level === 'ok' ? '正常' : level === 'warn' ? '需注意' : '异常'}`;
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    const msg = e.status === 404
      ? '后端服务未加载诊断接口（HTTP 404）。请重启服务（启动.bat → [2] 停止 → [1] 启动）后再点「重新诊断」。'
      : e.message;
    box.innerHTML = `<div class="si-diag-box error"><b>诊断失败</b><div>${esc(msg)}</div></div>`;
    if (e.status === 404) siStaleHint(true);
  }
}

function renderSiDiag(d) {
  const box = si$('siDiag');
  const s = d.summary || {};
  const level = d.level || 'ok';
  const head = level === 'ok' ? '系统一切正常' : level === 'warn' ? `发现 ${s.warn} 项需要注意` : `发现 ${s.error} 项异常`;
  const sub = level === 'ok'
    ? '数据文件、目录读写、模型通道、知识库索引、工作流结构、上传目录、日志与端口均未发现问题。'
    : (s.fixable ? `其中 ${s.fixable} 项可点「一键修复」自动处理，其余请按下方明细处理。` : '请按下方明细核对处理。');
  const problems = (d.checks || []).filter((c) => c.level === 'warn' || c.level === 'error');
  const infos = (d.checks || []).filter((c) => c.level === 'info' || c.level === 'idle');
  const okCount = (d.checks || []).filter((c) => c.level === 'ok').length;
  const rows = problems.map((c) => `<div class="si-diag-row">
      <span class="t">${esc(c.title)}</span>
      ${siPill(c.level)}
      <span class="d">${esc(c.detail)}</span>
      ${c.fixable ? '<span class="fix">可修复</span>' : ''}
    </div>`).join('');
  const allRows = (d.checks || []).map((c) => `<div class="si-diag-row">
      <span class="t">${esc(c.title)}</span>
      ${siPill(c.level)}
      <span class="d">${esc(c.detail)}</span>
    </div>`).join('');
  box.innerHTML = `
    <div class="si-diag-box ${level} si-diag-sum">
      <b>${level === 'ok' ? '✅ ' : level === 'warn' ? '⚠️ ' : '⛔ '}${esc(head)}</b>
      <div>${esc(sub)}</div>
    </div>
    ${problems.length ? `<div class="si-diag-rows">${rows}</div>` : ''}
    ${infos.length ? `<div class="si-diag-ok-hint">提示：${infos.map((c) => esc(c.detail)).join('；')}</div>` : ''}
    ${!problems.length && !infos.length ? `<div class="si-diag-ok-hint">已检查 ${okCount} 个项目，全部通过。诊断时间 ${esc((d.at || '').slice(0, 19).replace('T', ' '))}</div>` : ''}
    <details style="margin-top:10px">
      <summary class="hint" style="cursor:pointer">查看全部 ${(d.checks || []).length} 项检查明细</summary>
      <div class="si-diag-rows" style="margin-top:8px">${allRows}</div>
    </details>`;
}

async function siRepair() {
  const btn = si$('siRepairBtn');
  if (!btn) return;
  if (!confirm('将执行安全修复：补建目录、重算知识库计数、修复工作流图、清理失效引用、修剪异常日志。\n（不会删除任何上传文件与业务数据）是否继续？')) return;
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="si-spin">⟳</span> 修复中…';
  try {
    const r = await api('/api/admin/system-info/repair', { method: 'POST' });
    if (r.diagnose) {
      siDiagData = r.diagnose;
      renderSiDiag(r.diagnose);
      const level = r.diagnose.level;
      const el = si$('siOverall');
      if (el) {
        el.className = `si-overall ${level}`;
        el.innerHTML = `<i></i>${level === 'ok' ? '正常' : level === 'warn' ? '需注意' : '异常'}`;
      }
    }
    if (r.changedTotal) {
      const detail = (r.fixed || []).filter((f) => f.changed).map((f) => `${f.title}${f.note ? '：' + f.note : ''}`).join('；');
      toast(`已修复 ${r.changedTotal} 处问题`, 'success');
      if (detail) console.info('[系统修复]', detail);
    } else {
      toast('未发现需要修复的问题', 'success');
    }
    if ((r.errors || []).length) toast('部分修复失败：' + r.errors.join('；'), 'error');
    await loadSystemInfo();
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('修复失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}

/* ---------- Token 统计清零 ---------- */
async function siClearTokens() {
  if (!confirm('清零 Token 用量统计？只重置统计基准时间（此前的用量不再计入累计），运行日志不受影响。')) return;
  const btn = si$('siTokenClear');
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="si-spin">⟳</span>';
  try {
    const r = await api('/api/admin/system-info/tokens/clear', { method: 'POST' });
    if (r.tokens) renderSiTokens(r.tokens);
    toast('Token 统计已清零（运行日志保留）', 'success');
  } catch (e) {
    toast('清零失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}
if (si$('siTokenClear')) si$('siTokenClear').addEventListener('click', siClearTokens);

/* ---------- 服务端口 ---------- */
let siPortLoaded = false;

async function loadSiPort() {
  if (!si$('siPortCurrent')) return;
  try {
    const p = await api('/api/admin/system-info/port');
    siPortLoaded = true;
    si$('siPortCurrent').textContent = `当前端口 ${p.port}`;
    const input = si$('siPortInput');
    if (input && !input.value) input.value = p.port;
    si$('siPortHint').textContent = p.envPort && p.envPort !== p.port
      ? `.env 记录 PORT=${p.envPort}，与当前监听 ${p.port} 不一致（重启后会切换）`
      : '修改后需重启服务生效，点击「应用并重启」自动重启';
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    si$('siPortCurrent').textContent = '端口信息加载失败';
  }
}

async function siCheckPort() {
  const port = Number(si$('siPortInput').value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    toast('请输入 1024-65535 之间的端口号', 'error');
    return;
  }
  const btn = si$('siPortCheck');
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="si-spin">⟳</span> 检查中…';
  try {
    const r = await api('/api/admin/system-info/port/check', { method: 'POST', body: JSON.stringify({ port }) });
    if (r.isCurrent) {
      si$('siPortHint').textContent = `端口 ${port} 正是当前服务使用的端口`;
      toast('该端口是当前端口', '');
    } else if (r.available) {
      si$('siPortHint').textContent = `端口 ${port} 可用，可点击「应用并重启」切换`;
      toast(`端口 ${port} 可用`, 'success');
    } else {
      si$('siPortHint').textContent = `端口 ${port} 不可用：${r.reason}`;
      toast(`端口 ${port} 不可用：${r.reason}`, 'error');
    }
  } catch (e) {
    toast('检查失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = html;
  }
}

/** 切换端口后：轮询新地址，通了就跳转（跨端口属跨源，用 no-cors 只探测"是否已起来"） */
function siWaitRestart(port) {
  const host = location.hostname || '127.0.0.1';
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  const base = `${proto}//${host}:${port}`;
  let tries = 0;
  const tick = async () => {
    tries++;
    try {
      // 新端口服务起来后会响应（opaque 响应也算成功）；连接被拒绝则抛错继续等
      await fetch(`${base}/api/admin/system-info/port?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' });
      si$('siPortHint').textContent = `服务已在新端口 ${port} 启动，正在跳转…`;
      location.href = `${base}/admin`;
      return;
    } catch (_) { /* 还没起来，继续等 */ }
    if (tries > 20) {
      si$('siPortHint').textContent = `未能在 20 秒内连接 ${base}，请确认服务是否已启动`;
      const btn = si$('siPortApply');
      if (btn) btn.disabled = false;
      toast(`请手动打开 ${base}/admin 确认服务状态`, 'error');
      return;
    }
    setTimeout(tick, 1200);
  };
  setTimeout(tick, 1500);
}

async function siApplyPort() {
  const port = Number(si$('siPortInput').value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    toast('请输入 1024-65535 之间的端口号', 'error');
    return;
  }
  if (!confirm(`应用新端口 ${port} 并重启服务？\n服务会短暂中断（约 2-5 秒），当前页面随后自动跳转到新地址。`)) return;
  const btn = si$('siPortApply');
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="si-spin">⟳</span> 重启中…';
  try {
    const r = await api('/api/admin/system-info/port', { method: 'POST', body: JSON.stringify({ port }) });
    if (!r.restarting) {
      btn.disabled = false;
      btn.innerHTML = html;
      si$('siPortHint').textContent = `已写入 .env（PORT=${r.port}），当前服务仍在该端口运行，无需重启`;
      toast('端口配置已保存，无需重启', 'success');
      loadSiPort();
      return;
    }
    si$('siPortHint').textContent = `正在重启服务并切换到端口 ${r.port}…`;
    toast(`端口已改为 ${r.port}，正在重启服务`, 'success');
    siWaitRestart(r.port);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = html;
    toast('应用失败：' + e.message, 'error');
  }
}

if (si$('siRefresh')) si$('siRefresh').addEventListener('click', () => { loadSystemInfo(); loadSiPort(); });
if (si$('siModRefresh')) si$('siModRefresh').addEventListener('click', () => { loadSystemInfo(); });
if (si$('siDiagnoseBtn')) si$('siDiagnoseBtn').addEventListener('click', () => { siDiagData = null; runSiDiagnose(); });
if (si$('siRepairBtn')) si$('siRepairBtn').addEventListener('click', siRepair);
if (si$('siPortCheck')) si$('siPortCheck').addEventListener('click', siCheckPort);
if (si$('siPortApply')) si$('siPortApply').addEventListener('click', siApplyPort);

/* ================= 知识库 ================= */
let kbCurrent = null; // 当前打开的知识库

async function loadKb() {
  try {
    const list = await api('/api/admin/kb');
    const totalChunks = list.reduce((s, k) => s + (k.chunkCount || 0), 0);
    els.kbStats.textContent = `共 ${list.length} 个知识库 · ${totalChunks} 个分段`;
    if (!list.length) {
      els.kbList.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无知识库，点击「+ 新建知识库」创建后导入 txt / md 资料</div>';
      return;
    }
    els.kbList.innerHTML = list.map((k) => `
      <div class="kb-card">
        <h4>📚 ${esc(k.name)}</h4>
        ${k.remark ? `<div class="kb-meta">${esc(k.remark)}</div>` : ''}
        <div class="kb-meta">
          文件 ${k.fileCount} 个 · 分段 ${k.chunkCount} 条 · 约 ${Math.max(1, Math.round(k.chars / 1024))} KB<br/>
          ${esc((k.createdAt || '').slice(0, 10))} 由 ${esc(k.ownerName || '-')} 创建
        </div>
        <div class="kb-actions">
          <button class="btn btn-sm primary" data-kb-act="open" data-id="${k.id}">管理 / 导入</button>
          <button class="btn btn-sm danger" data-kb-act="del" data-id="${k.id}">删除</button>
        </div>
      </div>`).join('');
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载知识库失败：' + e.message, 'error');
  }
}

$('#addKbBtn').addEventListener('click', () => {
  $('#kc_name').value = '';
  $('#kc_remark').value = '';
  $('#kbCreateModal').style.display = 'grid';
});

$('#kbCreateBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/kb', {
      method: 'POST',
      body: JSON.stringify({ name: $('#kc_name').value.trim(), remark: $('#kc_remark').value.trim() })
    });
    $('#kbCreateModal').style.display = 'none';
    toast('知识库已创建', 'success');
    loadKb();
  } catch (e) {
    toast('创建失败：' + e.message, 'error');
  }
});

$('#refreshKbBtn').addEventListener('click', loadKb);

$('#seedKbBtn').addEventListener('click', async () => {
  const btn = $('#seedKbBtn');
  btn.disabled = true;
  try {
    const r = await api('/api/admin/kb/seed', { method: 'POST', body: '{}' });
    toast(r.added > 0 ? `已导入 ${r.added} 个预置知识库（${r.chunks} 个分段）` : '预置知识库已齐全，无需导入', 'success');
    loadKb();
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

els.kbList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-kb-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.kbAct === 'open') {
    openKbModal(id);
  } else if (btn.dataset.kbAct === 'del') {
    if (!confirm('删除该知识库将连同全部分段一起删除，确定？')) return;
    try {
      await api(`/api/admin/kb/${id}`, { method: 'DELETE' });
      toast('知识库已删除', 'success');
      loadKb();
    } catch (e2) {
      toast('删除失败：' + e2.message, 'error');
    }
  }
});

async function openKbModal(id) {
  try {
    kbCurrent = await api(`/api/admin/kb/${id}`);
    $('#kbModalTitle').textContent = `知识库 · ${kbCurrent.name}`;
    // 页签复位到「知识库」（文件列表），配置字段按库填充
    switchKbTab('files');
    const cfg = kbCurrent.cfg || {};
    $('#kbCfgChunkSize').value = cfg.chunkSize ?? 500;
    $('#kbCfgOverlap').value = cfg.overlap ?? 50;
    $('#kbCfgTopK').value = cfg.topK ?? 5;
    $('#kbCfgName').value = kbCurrent.name || '';
    $('#kbCfgRemark').value = kbCurrent.remark || '';
    // 权限页签按库回填
    const vis = kbCurrent.visibility === 'private' ? 'private' : 'all';
    const visRadio = document.querySelector(`#kbModal input[name="kbVisibility"][value="${vis}"]`);
    if (visRadio) visRadio.checked = true;
    // 问答生成模型下拉回填
    await loadKbModelOptions(kbCurrent.modelId);
    // 成员下拉（授权成员选择）
    await ensureUserMap();
    renderKbMemberOptions();
    // 段落管理：筛选条件复位
    kbChunkState = { offset: 0, fileId: '', q: '', total: 0, items: [] };
    $('#kbChunkSearch').value = '';
    const fileSel = $('#kbChunkFileFilter');
    fileSel.innerHTML = '<option value="">全部文件</option>'
      + (kbCurrent.files || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    renderKbModal();
    renderKbFilesTable();
    renderKbMembers();
    loadKbChunks();
    $('#kbModal').style.display = 'flex';
  } catch (e) {
    toast('加载知识库失败：' + e.message, 'error');
  }
}

// 返回按钮关闭知识库编辑页
$('#kbBackBtn').addEventListener('click', () => {
  $('#kbModal').style.display = 'none';
  loadKb();
});

// 弹窗内子页签（知识库 / 文件导入 / 段落管理 / 搜索测试 / 权限 / 配置）
function switchKbTab(name) {
  document.querySelectorAll('#kbModalTabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.kbtab === name));
  document.querySelectorAll('#kbModal [data-kbpane]').forEach((pane) => {
    pane.style.display = pane.dataset.kbpane === name ? '' : 'none';
  });
}
document.querySelectorAll('#kbModalTabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchKbTab(btn.dataset.kbtab));
});

/* ---------- 导入方式（直接分段 / QA 拆分 / 精准数据导入） ---------- */
const KB_MODE_HINTS = {
  text: {
    hint: '按空行分段落聚合切分，相邻段带重叠；适合手册 / 笔记 / 长文资料。',
    fileHint: '单文件 ≤2MB 文本；按「配置」页签中的分段参数自动切分。',
    placeholder: '粘贴资料全文；按空行分段，系统自动切成知识分段。',
    accept: '.txt,.md,.markdown,.log',
    fileBtn: '📎 上传文件（txt / md，可多选）'
  },
  qa: {
    hint: '按空行分隔问答块，块内用「问：」「答：」标注（Q:/A: 亦可）；每个问答对一个分段，适合 FAQ 语料。',
    fileHint: '单文件 ≤2MB 文本；每个问答对独立成段，不按长度切分。',
    placeholder: '问：退货政策是什么？\n答：签收 7 天内可无理由退货……\n\n（空行分隔下一组问答）',
    accept: '.txt,.md,.markdown,.log',
    fileBtn: '📎 上传问答文件（txt / md，可多选）'
  },
  data: {
    hint: '粘贴或上传 CSV 表格（首行为表头）；每行一条记录，首列为检索索引键——查询与索引键一致时精准命中。',
    fileHint: '单文件 ≤2MB 文本；CSV 或制表符分隔，首行必须为表头。',
    placeholder: '工号,姓名,部门\n1001,张三,技术部\n1002,李四,市场部',
    accept: '.csv,.txt,.tsv',
    fileBtn: '📎 上传 CSV 数据文件（可多选）'
  }
};
let kbImportMode = 'text';

function applyImportModeUI() {
  const m = KB_MODE_HINTS[kbImportMode] || KB_MODE_HINTS.text;
  $('#kbModeHint').textContent = m.hint;
  $('#kbFileLimitHint').textContent = m.fileHint;
  $('#kbImportText').placeholder = m.placeholder;
  $('#kbFileInput').accept = m.accept;
  $('#kbFilePickBtn').textContent = m.fileBtn;
}
document.querySelectorAll('#kbModal input[name="kbImportMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked) { kbImportMode = radio.value; applyImportModeUI(); }
  });
});
applyImportModeUI();

// 本地文件选择 → FileReader 读取文本 → 依次导入（按当前导入方式）
$('#kbFilePickBtn').addEventListener('click', () => $('#kbFileInput').click());
$('#kbFileInput').addEventListener('change', async () => {
  if (!kbCurrent) return;
  const files = Array.from($('#kbFileInput').files || []);
  if (!files.length) return;
  const btn = $('#kbFilePickBtn');
  btn.disabled = true;
  btn.textContent = '导入中…';
  let okCount = 0;
  let failMsg = '';
  for (const file of files) {
    try {
      const text = await file.text();
      const r = await api(`/api/admin/kb/${kbCurrent.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ name: file.name, text, mode: kbImportMode })
      });
      okCount++;
    } catch (e) {
      failMsg = `${file.name}：${e.message}`;
    }
  }
  btn.disabled = false;
  applyImportModeUI();
  $('#kbFileInput').value = '';
  if (okCount && !failMsg) toast(`已导入 ${okCount} 个文件`, 'success');
  else if (okCount) toast(`导入 ${okCount} 个成功；失败：${failMsg}`, 'error');
  else toast(`导入失败：${failMsg}`, 'error');
  if (okCount) {
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    kbChunkState.offset = 0;
    renderKbModal();
    loadKbChunks();
    loadKb();
  }
});

$('#saveKbCfgBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  try {
    await api(`/api/admin/kb/${kbCurrent.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#kbCfgName').value.trim(),
        remark: $('#kbCfgRemark').value.trim(),
        modelId: $('#kbCfgModelId').value,
        cfg: {
          chunkSize: $('#kbCfgChunkSize').value,
          overlap: $('#kbCfgOverlap').value,
          topK: $('#kbCfgTopK').value
        }
      })
    });
    toast('知识库配置已保存', 'success');
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    $('#kbModalTitle').textContent = `知识库 · ${kbCurrent.name}`;
    renderKbModal();
    loadKb();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// 问答生成模型下拉加载（复用模型配置列表）
async function loadKbModelOptions(selectedId) {
  const sel = els.kbCfgModelId;
  if (!sel) return;
  try {
    const configs = await api('/api/configs');
    sel.innerHTML = '<option value="">（跟随全局调度）</option>'
      + configs.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
  } catch (_) {
    sel.innerHTML = '<option value="">（跟随全局调度）</option>';
  }
}

function renderKbModal() {
  const kb = kbCurrent;
  els.kbModalStats.textContent = `${kb.fileCount} 个文件 · ${kb.chunkCount} 个分段 · ${(kb.memberCount || 0)} 个授权成员`;
  renderKbFilesTable();
}

// 文件列表表格（# / 名称 / 数据量 / 更新时间 / 状态）
function renderKbFilesTable() {
  const kb = kbCurrent;
  if (!kb) return;
  const kw = ($('#kbFileSearch').value || '').trim().toLowerCase();
  const files = (kb.files || []).filter((f) => !kw || (f.name || '').toLowerCase().includes(kw));
  els.kbFilesTable.innerHTML = files.length
    ? `<table class="kb-file-table"><thead><tr>
        <th style="width:48px">#</th><th>名称</th><th>数据量</th><th>更新时间</th><th>状态</th><th style="width:90px">操作</th>
      </tr></thead><tbody>${files.map((f, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><span class="kb-file-name">📄 ${esc(f.name)}</span><span class="kb-file-mode">${f.mode === 'qa' ? 'QA 拆分' : f.mode === 'data' ? '精准数据' : '直接分段'}</span></td>
          <td>${f.chunkCount} 段 · ${Math.max(1, Math.round(f.size / 1024))} KB</td>
          <td>${esc((f.uploadedAt || '').slice(0, 19).replace('T', ' '))}</td>
          <td><span class="kb-status ok">🟢 已就绪</span></td>
          <td><button class="btn btn-sm danger" data-kb-file="${f.id}">删除</button></td>
        </tr>`).join('')}</tbody></table>`
    : '<div class="hint">暂无文件，点击「＋ 新建」创建虚拟文件，或切到「文件导入」页签上传资料。</div>';
}

// 成员授权列表
function renderKbMembers() {
  const kb = kbCurrent;
  if (!kb) return;
  const members = kb.members || [];
  const isPrivate = kb.visibility === 'private';
  if (els.kbMemberHint) {
    els.kbMemberHint.textContent = isPrivate
      ? '私有库：仅创建者与下列授权成员可用；成员编辑权限控制其能否修改知识库内容。'
      : '公共库：公司所有登录成员均可用，无需单独授权（成员授权仅在设为私有后生效）。';
  }
  const ownerRow = `
    <tr>
      <td>${esc(kb.ownerName || kb.ownerId || '-')}</td>
      <td><span class="tag">创建者</span></td>
      <td>${esc((kb.createdAt || '').slice(0, 19).replace('T', ' '))}</td>
      <td><span class="kb-status ok">● 可编辑</span></td>
      <td><span class="hint">创建者</span></td>
    </tr>`;
  const memberRows = members.map((m) => `
    <tr>
      <td>${esc(m.userName || m.userId)}</td>
      <td>${m.role === 'owner' ? '超管' : m.role === 'admin' ? '管理员' : m.role === 'member' ? '成员' : m.role === 'viewer' ? '只读' : (m.role || '成员')}</td>
      <td>${esc((m.addedAt || '').slice(0, 19).replace('T', ' '))}</td>
      <td><span class="kb-status ${m.canEdit ? 'ok' : ''}">${m.canEdit ? '● 可编辑' : '○ 只读'}</span></td>
      <td>
        <label class="kb-edit-switch"><input type="checkbox" data-kb-member-edit="${esc(m.userId)}" ${m.canEdit ? 'checked' : ''} /> 可编辑</label>
        <button class="btn btn-sm danger" data-kb-member-del="${esc(m.userId)}">移除</button>
      </td>
    </tr>`).join('');
  els.kbMembersTable.innerHTML = `
    <table class="kb-file-table"><thead><tr>
      <th>成员</th><th>角色</th><th>加入时间</th><th>编辑权限</th><th>操作</th>
    </tr></thead><tbody>${ownerRow}${memberRows}</tbody></table>`;
}

/* ---------- 段落管理：分页 + 筛选 + 编辑 / 删除 ---------- */
let kbChunkState = { offset: 0, fileId: '', q: '', total: 0, items: [] };
const KB_CHUNK_PAGE = 20;
const KB_TYPE_LABELS = { text: '分段', qa: '问答', data: '数据' };

async function loadKbChunks(reset = false) {
  if (!kbCurrent) return;
  if (reset) { kbChunkState.offset = 0; kbChunkState.fileId = $('#kbChunkFileFilter').value; kbChunkState.q = $('#kbChunkSearch').value.trim(); }
  try {
    const params = new URLSearchParams({ limit: String(KB_CHUNK_PAGE), offset: String(kbChunkState.offset) });
    if (kbChunkState.fileId) params.set('fileId', kbChunkState.fileId);
    if (kbChunkState.q) params.set('q', kbChunkState.q);
    const r = await api(`/api/admin/kb/${kbCurrent.id}/chunks?${params}`);
    kbChunkState.total = r.total;
    kbChunkState.items = r.items;
    renderKbChunks();
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    $('#kbChunksBox').innerHTML = `<div class="hint">加载分段失败：${esc(e.message)}</div>`;
  }
}

function renderKbChunks() {
  const page = Math.floor(kbChunkState.offset / KB_CHUNK_PAGE) + 1;
  const pages = Math.max(1, Math.ceil(kbChunkState.total / KB_CHUNK_PAGE));
  $('#kbChunkPagerInfo').textContent = kbChunkState.total
    ? `第 ${page} / ${pages} 页 · 共 ${kbChunkState.total} 条`
    : '共 0 条';
  $('#kbChunkPrev').disabled = kbChunkState.offset <= 0;
  $('#kbChunkNext').disabled = kbChunkState.offset + KB_CHUNK_PAGE >= kbChunkState.total;
  const items = kbChunkState.items;
  $('#kbChunksBox').innerHTML = items.length
    ? items.map((c) => {
      const preview = c.length > 160 ? `${esc(c.text.slice(0, 160))}…` : esc(c.text);
      return `
        <div class="kb-chunk">
          <div class="kb-chunk-head">
            <span>#${esc(c.id)}</span>
            <span class="kb-type-badge ${esc(c.type)}">${KB_TYPE_LABELS[c.type] || '分段'}</span>
            ${c.type === 'data' && c.key ? `<span>索引键：${esc(c.key)}</span>` : ''}
            <span>${c.length} 字</span>
            <span class="spacer"></span>
            <button class="btn btn-sm" data-kb-chunk-edit="${c.id}">编辑</button>
            <button class="btn btn-sm danger" data-kb-chunk="${c.id}">删除</button>
          </div>
          <pre>${preview}</pre>
        </div>`;
    }).join('')
    : '<div class="hint">没有符合条件的分段。</div>';
}

$('#kbChunkFilterBtn').addEventListener('click', () => loadKbChunks(true));
$('#kbChunkSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadKbChunks(true); } });
$('#kbChunkFileFilter').addEventListener('change', () => loadKbChunks(true));
$('#kbChunkPrev').addEventListener('click', () => { kbChunkState.offset = Math.max(0, kbChunkState.offset - KB_CHUNK_PAGE); loadKbChunks(); });
$('#kbChunkNext').addEventListener('click', () => { kbChunkState.offset += KB_CHUNK_PAGE; loadKbChunks(); });

// 编辑分段（弹窗）
$('#kbChunksBox').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-kb-chunk-edit]');
  const delBtn = e.target.closest('[data-kb-chunk]');
  if (!editBtn && !delBtn) return;
  if (!kbCurrent) return;
  if (editBtn) {
    const item = (kbChunkState.items || []).find((c) => String(c.id) === editBtn.dataset.kbChunkEdit);
    if (!item) return;
    kbChunkEditingId = item.id;
    $('#kbChunkEditTitle').textContent = `编辑分段 #${item.id}（${KB_TYPE_LABELS[item.type] || '分段'}）`;
    $('#kbChunkEditText').value = item.text;
    $('#kbChunkEditModal').style.display = 'grid';
  } else if (delBtn) {
    try {
      await api(`/api/admin/kb/${kbCurrent.id}/chunks/${delBtn.dataset.kbChunk}`, { method: 'DELETE' });
      toast('分段已删除', 'success');
      await reloadKbAfterMutation();
    } catch (e2) {
      toast('删除失败：' + e2.message, 'error');
    }
  }
});

let kbChunkEditingId = null;
$('#kbChunkEditSaveBtn').addEventListener('click', async () => {
  if (!kbCurrent || !kbChunkEditingId) return;
  const text = $('#kbChunkEditText').value;
  if (!text.trim()) { toast('分段内容不能为空', 'error'); return; }
  try {
    await api(`/api/admin/kb/${kbCurrent.id}/chunks/${kbChunkEditingId}`, {
      method: 'PUT',
      body: JSON.stringify({ text })
    });
    $('#kbChunkEditModal').style.display = 'none';
    toast('分段已保存', 'success');
    await reloadKbAfterMutation();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

/** 段落数据变更后统一刷新（详情 + 段落列表 + 外层列表） */
async function reloadKbAfterMutation() {
  kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
  renderKbModal();
  loadKbChunks();
  loadKb();
}

/* ---------- 权限管理 ---------- */
if ($('#saveKbPermBtn')) $('#saveKbPermBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  const checked = document.querySelector('#kbModal input[name="kbVisibility"]:checked');
  if (!checked) { toast('请选择权限类型', 'error'); return; }
  try {
    await api(`/api/admin/kb/${kbCurrent.id}`, {
      method: 'PUT',
      body: JSON.stringify({ visibility: checked.value })
    });
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    toast(kbCurrent.visibility === 'private' ? '已设为私有库：仅创建者与授权成员可用' : '已设为全员可用', 'success');
    renderKbMembers();
    loadKb();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// 成员下拉填充（复用成员列表）
function renderKbMemberOptions() {
  const sel = els.kbMemberSelect;
  if (!sel) return;
  const existing = new Set((kbCurrent && kbCurrent.members || []).map((m) => m.userId));
  const ownerId = kbCurrent && kbCurrent.ownerId;
  sel.innerHTML = '<option value="">选择成员…</option>'
    + Object.values(userMap)
      .filter((u) => u.id !== ownerId && !existing.has(u.id))
      .map((u) => `<option value="${esc(u.id)}">${esc(u.displayName || u.username)}（${esc(u.username)}）</option>`).join('');
}

// 添加成员
$('#kbAddMemberBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  const userId = els.kbMemberSelect.value;
  if (!userId) { toast('请选择要授权的成员', 'error'); return; }
  const canEdit = els.kbMemberCanEdit.checked;
  try {
    await api(`/api/admin/kb/${kbCurrent.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, canEdit })
    });
    toast('成员已授权', 'success');
    els.kbMemberCanEdit.checked = false;
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    renderKbMembers();
    renderKbMemberOptions();
    renderKbModal();
    loadKb();
  } catch (e) {
    toast('授权失败：' + e.message, 'error');
  }
});

// 成员列表操作：切换可编辑 / 移除
els.kbMembersTable.addEventListener('click', async (e) => {
  if (!kbCurrent) return;
  const editSwitch = e.target.closest('[data-kb-member-edit]');
  const delBtn = e.target.closest('[data-kb-member-del]');
  const userId = editSwitch ? editSwitch.dataset.kbMemberEdit : delBtn ? delBtn.dataset.kbMemberDel : null;
  if (!userId) return;
  try {
    if (editSwitch) {
      await api(`/api/admin/kb/${kbCurrent.id}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ canEdit: editSwitch.checked })
      });
      toast('编辑权限已更新', 'success');
    } else if (delBtn) {
      if (!confirm('移除该成员将使其无法再访问此私有库，确定？')) return;
      await api(`/api/admin/kb/${kbCurrent.id}/members/${userId}`, { method: 'DELETE' });
      toast('成员已移除', 'success');
    }
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    renderKbMembers();
    renderKbMemberOptions();
    renderKbModal();
  } catch (e2) {
    toast('操作失败：' + e2.message, 'error');
  }
});

// 新建虚拟文件（手动录入文本）
$('#kbNewFileBtn').addEventListener('click', () => {
  if (!kbCurrent) return;
  $('#knf_name').value = '';
  $('#knf_text').value = '';
  $('#kbNewFileModal').style.display = 'grid';
});
$('#knfSaveBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  const name = $('#knf_name').value.trim() || '未命名资料';
  const text = $('#knf_text').value;
  if (!text.trim()) { toast('请先填写内容', 'error'); return; }
  const btn = $('#knfSaveBtn');
  btn.disabled = true;
  btn.textContent = '创建中…';
  try {
    await api(`/api/admin/kb/${kbCurrent.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ name, text, mode: 'text' })
    });
    $('#kbNewFileModal').style.display = 'none';
    toast('虚拟文件已创建', 'success');
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    kbChunkState.offset = 0;
    renderKbModal();
    loadKbChunks();
    loadKb();
  } catch (e) {
    toast('创建失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '创建';
  }
});

// 文件搜索
$('#kbFileSearchBtn').addEventListener('click', () => renderKbFilesTable());
$('#kbFileSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); renderKbFilesTable(); }
});

els.kbFilesTable.addEventListener('click', async (e) => {
  const fileBtn = e.target.closest('[data-kb-file]');
  if (!fileBtn) return;
  if (!kbCurrent) return;
  try {
    if (fileBtn) {
      if (!confirm('删除该文件将连同其全部分段一起删除，确定？')) return;
      await api(`/api/admin/kb/${kbCurrent.id}/files/${fileBtn.dataset.kbFile}`, { method: 'DELETE' });
    }
    await reloadKbAfterMutation();
  } catch (e2) {
    toast('操作失败：' + e2.message, 'error');
  }
});

$('#kbImportBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  const text = $('#kbImportText').value;
  const name = $('#kbImportName').value.trim() || (kbImportMode === 'data' ? '未命名数据表' : kbImportMode === 'qa' ? '未命名问答集' : '未命名资料');
  if (!text.trim()) { toast('请先粘贴内容', 'error'); return; }
  const btn = $('#kbImportBtn');
  btn.disabled = true;
  btn.textContent = '导入中…';
  try {
    const r = await api(`/api/admin/kb/${kbCurrent.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ name, text, mode: kbImportMode })
    });
    const label = { text: `切分为 ${r.chunkCount} 个分段`, qa: `拆分出 ${r.chunkCount} 个问答对`, data: `导入 ${r.chunkCount} 条数据记录` };
    toast(`导入成功：${label[r.mode] || label.text}`, 'success');
    $('#kbImportText').value = '';
    $('#kbImportName').value = '';
    kbCurrent = await api(`/api/admin/kb/${kbCurrent.id}`);
    kbChunkState.offset = 0;
    renderKbModal();
    loadKbChunks();
    loadKb();
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '导入';
  }
});

async function kbSearchTest() {
  if (!kbCurrent) return;
  const q = $('#kbTestQuery').value.trim();
  if (!q) { toast('请输入测试问题', 'error'); return; }
  els.kbTestResults.innerHTML = '<div class="hint">检索中…</div>';
  try {
    const r = await api(`/api/admin/kb/${kbCurrent.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: q, topK: 5 })
    });
    if (!r.chunks.length) {
      els.kbTestResults.innerHTML = '<div class="hint">没有检索到相关分段（关键词无命中）。</div>';
      return;
    }
    els.kbTestResults.innerHTML = r.chunks.map((c, i) => `
      <div class="kb-chunk kb-search-hit">
        <div class="kb-chunk-head">
          <span class="score">#${i + 1} · 相关度 ${c.score}</span>
          <span class="kb-type-badge ${esc(c.type)}">${KB_TYPE_LABELS[c.type] || '分段'}</span>
          ${c.exact ? '<span class="kb-exact-hit">🎯 精准命中</span>' : ''}
          <span class="spacer"></span>
        </div>
        <pre>${esc(c.text)}</pre>
      </div>`).join('');
  } catch (e) {
    els.kbTestResults.innerHTML = `<div class="hint">检索失败：${esc(e.message)}</div>`;
  }
}

$('#kbTestBtn').addEventListener('click', kbSearchTest);
$('#kbTestQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); kbSearchTest(); } });

$('#kbDeleteBtn').addEventListener('click', async () => {
  if (!kbCurrent) return;
  if (!confirm('删除该知识库将连同全部分段一起删除，确定？')) return;
  try {
    await api(`/api/admin/kb/${kbCurrent.id}`, { method: 'DELETE' });
    $('#kbModal').style.display = 'none';
    toast('知识库已删除', 'success');
    loadKb();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
});

/* ================= 文件存储管理（网盘式） ================= */
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const STORAGE_KIND_ICONS = { kb: '📚', attachment: '📎', image: '🖼️', avatar: '👤', orphan: '❓' };
const STORAGE_GROUP_ICONS = { all: '🗂️', kb: '📚', conversation: '💬', agent: '🤖', avatar: '👤', orphan: '❓' };

let storageCurrentGroup = 'all';

async function loadStorage() {
  try {
    const kw = els.storageKeyword.value.trim();

    // 分组目录 + 总量统计
    const g = await api('/api/admin/storage/groups');
    const s = g.stats || {};
    els.storageGroups.innerHTML = g.groups.map((grp) => `
      <button class="storage-group-item ${grp.key === storageCurrentGroup ? 'active' : ''}" data-storage-group="${grp.key}">
        <span class="storage-group-ico">${grp.icon}</span>
        <span class="storage-group-label">${esc(grp.label)}</span>
        <span class="badge">${grp.count}</span>
      </button>`).join('');

    // 统计卡片
    els.storageStats.innerHTML = [
      ['文件总数', s.totalFiles ?? 0, '🗄️'],
      ['存储总量', fmtBytes(s.totalBytes ?? 0), '💾'],
      ['知识库', g.groups.find((x) => x.key === 'kb')?.count ?? 0, '📚'],
      ['对话记录', g.groups.find((x) => x.key === 'conversation')?.count ?? 0, '💬'],
      ['智能体', g.groups.find((x) => x.key === 'agent')?.count ?? 0, '🤖'],
      ['未引用文件', s.orphanCount ?? 0, '❓']
    ].map(([label, v, ico]) => `
      <div class="stat-card"><span class="stat-ico">${ico}</span><b>${esc(v)}</b><span>${esc(label)}</span></div>`).join('');

    await renderStorageGroup(storageCurrentGroup, kw);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    toast('加载文件存储失败：' + e.message, 'error');
  }
}

async function renderStorageGroup(group, kw) {
  const d = await api(`/api/admin/storage/entities?group=${encodeURIComponent(group)}`);
  els.storageGroupTitle.textContent = d.groupLabel;

  if (d.kind === 'entity') {
    // 实体目录视图
    let entities = d.entities || [];
    if (kw) entities = entities.filter((e) => (e.name || e.title || '').toLowerCase().includes(kw));
    els.storageGroupCount.textContent = `共 ${entities.length} 个${d.groupLabel === '智能体' ? '智能体' : '对象'}`;
    if (!entities.length) {
      els.storageContent.innerHTML = '<div class="empty">该分组下暂无内容</div>';
      return;
    }
    els.storageContent.innerHTML = entities.map((e) => renderStorageEntity(e)).join('');
  } else {
    // 文件平铺视图（all / orphan）
    let items = d.items || [];
    if (kw) items = items.filter((it) => it.name.toLowerCase().includes(kw) || it.url.toLowerCase().includes(kw));
    els.storageGroupCount.textContent = `共 ${items.length} 个文件`;
    if (!items.length) {
      els.storageContent.innerHTML = '<div class="empty">暂无文件</div>';
      return;
    }
    els.storageContent.innerHTML = `<div class="table-wrap">${renderStorageFileTable(items)}</div>`;
  }
}

function renderStorageEntity(e) {
  const ico = STORAGE_GROUP_ICONS[e.type] || '📄';
  const subTitle = {
    kb: `${e.fileCount} 个文件 · ${e.chunkCount} 个分段`,
    conversation: `${e.fileCount} 个文件 · ${e.messageCount} 条消息`,
    agent: e.desc || '智能体应用',
    avatar: e.username || ''
  }[e.type] || '';

  // 头像实体：直接展示头像图
  const avatarImg = e.type === 'avatar' && e.avatarUrl
    ? `<img class="storage-avatar-img" src="${esc(e.avatarUrl)}" alt="" />`
    : `<span class="storage-entity-ico">${e.type === 'agent' ? esc(e.emoji || '🤖') : ico}</span>`;

  const fileList = (e.files || []).map((f) => {
    const fUrl = f.url || f.storageUrl || '';
    const fRel = f.rel || fUrl.replace('/uploads/', '') || '';
    return `
    <div class="storage-file-row">
      <span class="storage-file-icon">${f.kind === 'image' ? '🖼️' : '📄'}</span>
      <span class="storage-file-name" title="${esc(fRel || fUrl)}">${esc(f.name || pathBasename(fRel || fUrl))}</span>
      ${f.kind === 'image' ? `<a class="btn btn-sm" href="${esc(fUrl)}" target="_blank">预览</a>` : ''}
      <a class="btn btn-sm" href="${esc(fUrl)}" target="_blank" ${f.onDisk ? '' : 'disabled title="文件已不在磁盘"'}>查看</a>
      <span class="hint">${fmtBytes(f.size)}</span>
      <button class="btn btn-sm danger" data-storage-del="${esc(fRel)}">删除</button>
    </div>`;
  }).join('') || '<div class="hint" style="padding:6px 12px">该对象暂无关联文件</div>';

  return `
    <div class="storage-entity">
      <div class="storage-entity-head">
        ${avatarImg}
        <div class="storage-entity-info">
          <b>${esc(e.name || e.title || e.username || '未命名')}</b>
          <span class="hint">${esc(subTitle)}${e.ownerName ? ` · 由 ${esc(e.ownerName)} 创建` : ''}</span>
        </div>
        <span class="spacer"></span>
        ${e.type === 'kb' ? `<button class="btn btn-sm" data-storage-goto="kb" data-id="${esc(e.id)}">管理</button>` : ''}
        ${e.type === 'conversation' ? `<button class="btn btn-sm" data-storage-goto="conv" data-id="${esc(e.id)}">查看会话</button>` : ''}
        ${e.type === 'agent' ? `<button class="btn btn-sm" data-storage-goto="agent" data-id="${esc(e.id)}">查看</button>` : ''}
      </div>
      <div class="storage-file-list">${fileList}</div>
    </div>`;
}

function renderStorageFileTable(items) {
  return `<table>
    <thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>修改时间</th><th>引用来源</th><th>操作</th></tr></thead>
    <tbody>${items.map((it) => `
      <tr>
        <td title="${esc(it.url)}">${esc(it.name)}</td>
        <td><span class="kb-type-badge ${esc(it.kind)}">${STORAGE_KIND_ICONS[it.kind] || '📄'} ${esc(it.kindLabel)}</span></td>
        <td>${esc(fmtBytes(it.size))}</td>
        <td>${esc(fmtTime(new Date(it.mtimeMs).toISOString()))}</td>
        <td class="storage-refs" title="${esc((it.refs || []).join('\n'))}">
          ${it.referenced ? (it.refs || []).slice(0, 2).map((r) => `<span class="tag">${esc(r)}</span>`).join(' ') : '<span class="hint">未引用</span>'}
        </td>
        <td>
          <a class="btn btn-sm" href="${esc(it.url)}" target="_blank">查看</a>
          <button class="btn btn-sm danger" data-storage-del="${esc(it.rel)}">删除</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
}

function pathBasename(p) {
  return String(p || '').split('/').pop();
}

// 分组切换
els.storageGroups.addEventListener('click', (e) => {
  const item = e.target.closest('[data-storage-group]');
  if (!item) return;
  storageCurrentGroup = item.dataset.storageGroup;
  els.storageKeyword.value = '';
  loadStorage();
});

// 实体操作跳转（管理/查看）
els.storageContent.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-storage-goto]');
  if (goto) {
    const type = goto.dataset.storageGoto;
    const id = goto.dataset.id;
    if (type === 'kb') {
      // 切换到知识库页并打开该库
      switchAdminTab('kb');
      if (id) openKbModal(id);
    } else if (type === 'agent') {
      switchAdminTab('agents');
    } else if (type === 'conv') {
      toast('对话记录详情请在「记忆管理」中查看（会话 id: ' + id + '）', 'info');
    }
    return;
  }
  const del = e.target.closest('[data-storage-del]');
  if (del) doStorageDelete(del.dataset.storageDel);
});

function switchAdminTab(name) {
  const btn = Array.from(els.tabs).find((b) => b.dataset.tab === name);
  if (btn) btn.click();
}

async function doStorageDelete(rel) {
  try {
    await api(`/api/admin/storage/${encodeURIComponent(rel)}`, { method: 'DELETE' });
    toast('文件已删除', 'success');
    loadStorage();
  } catch (err) {
    if (err.status === 409) {
      if (confirm(`${err.message}\n\n仍要强制删除吗？删除后关联的知识库 / 对话引用将失效。`)) {
        try {
          await api(`/api/admin/storage/${encodeURIComponent(rel)}?force=1`, { method: 'DELETE' });
          toast('已强制删除', 'success');
          loadStorage();
        } catch (e2) { toast('删除失败：' + e2.message, 'error'); }
      }
    } else {
      toast('删除失败：' + err.message, 'error');
    }
  }
}

els.storageRefreshBtn.addEventListener('click', loadStorage);
els.storageKeyword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); renderStorageGroup(storageCurrentGroup, els.storageKeyword.value.trim()); }
});

els.storageCleanBtn.addEventListener('click', async () => {
  if (!confirm('清理所有「未引用文件」？这些文件已无任何知识库 / 对话 / 头像引用，删除后不可恢复。')) return;
  try {
    const r = await api('/api/admin/storage/clean', { method: 'POST', body: '{}' });
    toast(`已清理 ${r.removed} 个文件（释放 ${fmtBytes(r.freedBytes)}）`, 'success');
    loadStorage();
  } catch (e) {
    toast('清理失败：' + e.message, 'error');
  }
});

/* ================= 当前用户 / 我的登录记录 ================= */
async function initMe() {
  try {
    const data = await api('/api/admin/me');
    const u = data.user;
    currentUserId = u.id;
    currentUserRole = u.role;
    els.currentUser.textContent = `${u.displayName || u.username}（${ROLE_LABELS[u.role] || u.role}）`;
  } catch (_) { /* 静默：顶栏不展示 */ }
}

$('#myLoginsBtn').addEventListener('click', async () => {
  try {
    const list = await api('/api/auth/my-logins');
    els.myLoginsBody.innerHTML = list.length
      ? `<table><thead><tr><th>时间</th><th>事件</th><th>IP</th></tr></thead><tbody>${list.map((l) => `
          <tr><td>${esc(fmtTime(l.time))}</td><td>${esc(AUDIT_LABELS[l.action] || l.action)}</td><td>${esc((l.ip || '').replace('::ffff:', '') || '-')}</td></tr>`).join('')}
        </tbody></table>`
      : '<div class="empty">暂无登录记录</div>';
    $('#myLoginsModal').style.display = 'grid';
  } catch (e) {
    if (e.status === 401) return;
    toast('加载失败：' + e.message, 'error');
  }
});

/* ================= 修改密码 / 退出登录 ================= */
$('#changePwdBtn').addEventListener('click', () => {
  $('#p_old').value = '';
  $('#p_new1').value = '';
  $('#p_new2').value = '';
  $('#pwdModal').style.display = 'grid';
});

$('#savePwdBtn').addEventListener('click', async () => {
  const oldPwd = $('#p_old').value;
  const n1 = $('#p_new1').value;
  const n2 = $('#p_new2').value;
  if (!oldPwd) { toast('请输入当前密码', 'error'); return; }
  if (n1.length < 8) { toast('新密码至少 8 位', 'error'); return; }
  if (!/[A-Za-z]/.test(n1) || !/\d/.test(n1)) { toast('新密码须同时包含字母和数字', 'error'); return; }
  if (n1 !== n2) { toast('两次输入的新密码不一致', 'error'); return; }
  try {
    await api('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: oldPwd, newPassword: n1 })
    });
    toast('密码已修改，请使用新密码重新登录', 'success');
    setTimeout(() => { location.href = '/team-login'; }, 1200);
  } catch (e) {
    if (e.status === 401) return;
    toast('修改失败：' + e.message, 'error');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch (_) { /* 即使请求失败也跳登录页 */ }
  location.href = '/team-login';
});

/* ---------- 初始化 ---------- */
loadOverview();      // 概览页为后台首页
loadRecentAudit();
loadConfigs();
initMe();
ensureUserMap();

// 日志「模型」筛选项由当前配置列表填充
api('/api/configs').then((list) => {
  const models = [...new Set((list || []).map((c) => c.model).filter(Boolean))];
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    els.logModelFilter.appendChild(opt);
  });
}).catch(() => { /* 配置加载失败时模型筛选留空 */ });
loadSettings();