'use strict';

/* ============ 工作台：多会话文本对话 ============ */

const els = {
  configSelect: document.getElementById('configSelect'),
  curConfigName: document.getElementById('curConfigName'),
  statusLine: document.getElementById('statusLine'),
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('sendBtn'),
  teamLogoutBtn: document.getElementById('teamLogoutBtn'),
  meCenterBtn: document.getElementById('meCenterBtn'),
  teamUserTag: document.getElementById('teamUserTag'),
  adminLink: document.getElementById('adminLink'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  newConvBtn: document.getElementById('newConvBtn'),
  delConvBtn: document.getElementById('delConvBtn'),
  convList: document.getElementById('convList'),
  wbLogoutBtn: document.getElementById('wbLogoutBtn'),
  toastWrap: document.getElementById('toastWrap'),
  thinkingBtn: document.getElementById('thinkingBtn'),
  effortSelect: document.getElementById('effortSelect'),
  effortLabel: document.getElementById('effortLabel'),
  effortSeg: document.getElementById('effortSeg'),
  webSearchBtn: document.getElementById('webSearchBtn'),
  kbBtn: document.getElementById('kbBtn'),
  kbWrap: document.getElementById('kbWrap'),
  kbSelect: document.getElementById('kbSelect'),
  kbPickerBtn: document.getElementById('kbPickerBtn'),
  kbPickerLabel: document.getElementById('kbPickerLabel'),
  kbPickerMenu: document.getElementById('kbPickerMenu'),
  wfPickerBtn: document.getElementById('wfPickerBtn'),
  wfPickerLabel: document.getElementById('wfPickerLabel'),
  wfPickerMenu: document.getElementById('wfPickerMenu'),
  agentBanner: document.getElementById('agentBanner'),
  noticeBar: document.getElementById('noticeBar'),
  noticeText: document.getElementById('noticeText'),
  noticeCloseBtn: document.getElementById('noticeCloseBtn'),
  fileAttachBtn: document.getElementById('fileAttachBtn'),
  fileAttachInput: document.getElementById('fileAttachInput'),
  modeSwitch: document.getElementById('modeSwitch'),
  wfModeWrap: document.getElementById('wfModeWrap'),
  wfModeSelect: document.getElementById('wfModeSelect'),
  viewChat: document.getElementById('viewChat'),
  viewApps: document.getElementById('viewApps'),
  viewKb: document.getElementById('viewKb'),
  viewWorkflow: document.getElementById('viewWorkflow'),
  appsGroups: document.getElementById('appsGroups'),
  kbViewGrid: document.getElementById('kbViewGrid'),
  kbViewTest: document.getElementById('kbViewTest'),
  kbViewTestName: document.getElementById('kbViewTestName'),
  kbViewQuery: document.getElementById('kbViewQuery'),
  kbViewTestBtn: document.getElementById('kbViewTestBtn'),
  kbViewResults: document.getElementById('kbViewResults'),
  promptBtn: document.getElementById('promptBtn'),
  promptPanel: document.getElementById('promptPanel'),
  promptInput: document.getElementById('promptInput'),
  promptCount: document.getElementById('promptCount'),
  promptResetBtn: document.getElementById('promptResetBtn'),
  promptSaveBtn: document.getElementById('promptSaveBtn'),
  chatInput: document.getElementById('chatInput'),
  attachRow: document.getElementById('attachRow'),
  attachBtn: document.getElementById('attachBtn'),
  fileInput: document.getElementById('fileInput'),
  // 分享对话
  shareBtn: document.getElementById('shareBtn'),
  shareModal: document.getElementById('shareModal'),
  shareModalClose: document.getElementById('shareModalClose'),
  shareExpiry: document.getElementById('shareExpiry'),
  shareCreateBtn: document.getElementById('shareCreateBtn'),
  shareLinkBox: document.getElementById('shareLinkBox'),
  shareLinkInput: document.getElementById('shareLinkInput'),
  shareLinkCopyBtn: document.getElementById('shareLinkCopyBtn'),
  shareList: document.getElementById('shareList'),
  // 员工自建应用 / 知识库
  addAgentBtn: document.getElementById('addAgentBtn'),
  addKbBtn: document.getElementById('addKbBtn'),
  agentModal: document.getElementById('agentModal'),
  agentModalTitle: document.getElementById('agentModalTitle'),
  a_id: document.getElementById('a_id'),
  a_name: document.getElementById('a_name'),
  a_emoji: document.getElementById('a_emoji'),
  a_icon: document.getElementById('a_icon'),
  a_desc: document.getElementById('a_desc'),
  a_welcome: document.getElementById('a_welcome'),
  a_suggests: document.getElementById('a_suggests'),
  a_systemPrompt: document.getElementById('a_systemPrompt'),
  a_visibility: document.getElementById('a_visibility'),
  saveAgentBtn: document.getElementById('saveAgentBtn'),
  kbCreateModal: document.getElementById('kbCreateModal'),
  kbCreateTitle: document.getElementById('kbCreateTitle'),
  kc_id: document.getElementById('kc_id'),
  kc_name: document.getElementById('kc_name'),
  kc_remark: document.getElementById('kc_remark'),
  kc_visibility: document.getElementById('kc_visibility'),
  saveKbBtn: document.getElementById('saveKbBtn')
};

let configs = [];
let currentConfigId = null;
// 后台「界面显示设置」：前端面板是否显示模型名字（默认显示；关闭后只显示配置名称）
let uiSettings = { showModelName: true };
let conversations = [];   // 会话元信息列表
let currentConv = null;   // 当前会话 {id, title, messages}
let sending = false;
let chatAbort = null;     // 当前发送的 AbortController（停止按钮用）
let isViewer = false;     // 只读成员（禁用发送；setBusy 恢复时保持禁用）
let modelSwitchNotice = null; // 「已切换模型」对话框提示节点
let pendingAttachments = []; // 通用附件（文档 / 音视频 / 压缩包）：{ id, name, size, mime, status, url }
let responseMode = 'chat';   // 响应模式：chat 对话 / workflow 工作流
let wfModeId = '';           // 工作流模式下选中的工作流
let currentUser = null;      // 当前登录员工 {id, role, username, displayName}（用于自建应用/知识库的归属判定）

/* ================= 会话参数（深度思考 / 思考强度 / 联网 / 系统提示） =================
 * 用户手动改过的项存 localStorage（记住选择）；未手动改过的项跟随当前模型配置的默认值。
 * 请求时随 body 一起发给后端，覆盖配置默认值（含"关闭"这类显式 false）。
 */
const params = {
  enableThinking: false,
  reasoningEffort: 'high',
  webSearch: false,
  useKb: false,
  kbId: '',
  systemPrompt: ''
};

const PARAM_KEYS = {
  enableThinking: 'wb_thinking',
  reasoningEffort: 'wb_effort',
  webSearch: 'wb_websearch',
  useKb: 'wb_usekb',
  kbId: 'wb_kbid',
  systemPrompt: 'wb_prompt'
};

/** 读 localStorage 偏好；null 表示用户没手动设置过 */
function getPref(key) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v;
  } catch (_) { return null; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* 隐私模式忽略 */ }
}
function clearPref(key) {
  try { localStorage.removeItem(key); } catch (_) { /* 忽略 */ }
}

/* ================= 参数工具栏自绘下拉（知识库 / 工作流） =================
 * 原生 <select> 的弹出面板无法定制样式（各浏览器灰底系统菜单），
 * 这里改成「隐藏 select + 自绘菜单」：select 仍是唯一数据源（选项、选中值、
 * change 事件全部沿用原逻辑），菜单只负责展示与点选，选中项带 ✓、智能体
 * 自动绑定的项带「智能体」标记。
 */
const pickerKb = {
  wrap: els.kbWrap, btn: els.kbPickerBtn, label: els.kbPickerLabel,
  menu: els.kbPickerMenu, select: els.kbSelect, placeholder: '不使用知识库'
};
const pickerWf = {
  wrap: els.wfModeWrap, btn: els.wfPickerBtn, label: els.wfPickerLabel,
  menu: els.wfPickerMenu, select: els.wfModeSelect, placeholder: '选择工作流'
};

function pickerClose(p) {
  if (!p || !p.wrap) return;
  p.wrap.classList.remove('open');
  if (p.btn) p.btn.setAttribute('aria-expanded', 'false');
}
function pickerCloseAll() { pickerClose(pickerKb); pickerClose(pickerWf); }

/** 把 select 当前选中项同步到按钮文字与菜单高亮（按钮用短名，菜单用完整文字） */
function syncPicker(p) {
  if (!p || !p.select) return;
  const sel = p.select;
  const opt = sel.options[sel.selectedIndex];
  const text = opt ? (opt.dataset.short || opt.textContent) : (p.placeholder || '');
  const full = opt ? opt.textContent : text;
  if (p.label) {
    if (p.label.textContent !== text) p.label.textContent = text;
    p.label.title = full;
  }
  if (p.wrap) p.wrap.classList.toggle('picked', !!sel.value);
  if (p.menu) {
    p.menu.querySelectorAll('.picker-item').forEach((b) => {
      const on = b.dataset.value === sel.value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
}

/** 按 select 的选项重建菜单 */
function buildPicker(p) {
  if (!p || !p.menu || !p.select) return;
  const menu = p.menu;
  menu.textContent = '';
  Array.from(p.select.options).forEach((o) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'picker-item';
    item.dataset.value = o.value;
    item.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'pi-name';
    name.textContent = o.textContent;
    name.title = o.textContent;
    item.appendChild(name);
    if (o.dataset.auto === '1') {
      const tag = document.createElement('span');
      tag.className = 'pi-tag';
      tag.textContent = '智能体';
      tag.title = '当前智能体自动关联，无需手动选择';
      item.appendChild(tag);
    }
    if (o.value === p.select.value) item.classList.add('active');
    item.addEventListener('click', () => {
      p.select.value = o.value;
      p.select.dispatchEvent(new Event('change')); // 复用原有 change 逻辑（存偏好 / 提示）
      syncPicker(p);
      pickerClose(p);
    });
    menu.appendChild(item);
  });
  syncPicker(p);
}

function initPicker(p) {
  if (!p || !p.btn || !p.wrap) return;
  p.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = p.wrap.classList.contains('open');
    pickerCloseAll();
    if (wasOpen) return;
    p.wrap.classList.add('open');
    p.btn.setAttribute('aria-expanded', 'true');
    const on = p.menu.querySelector('.picker-item.active');
    if (on) on.scrollIntoView({ block: 'nearest' });
  });
  p.menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pickerClose(p); p.btn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!p.wrap.contains(e.target)) pickerClose(p);
  });
}
initPicker(pickerKb);
initPicker(pickerWf);

/** 加载/切换配置时调用：用户手动设过的项用偏好值，未设过的项跟随该配置的默认值 */
function applyConfigDefaults(cfg) {
  if (!cfg) return;
  const prefThinking = getPref(PARAM_KEYS.enableThinking);
  params.enableThinking = prefThinking === null ? !!cfg.enableThinking : prefThinking === '1';
  const prefEffort = getPref(PARAM_KEYS.reasoningEffort);
  params.reasoningEffort = prefEffort === null
    ? (cfg.reasoningEffort === 'max' ? 'max' : 'high')
    : (prefEffort === 'max' ? 'max' : 'high');
  const prefWeb = getPref(PARAM_KEYS.webSearch);
  params.webSearch = prefWeb === null ? !!cfg.webSearch : prefWeb === '1';
  const prefPrompt = getPref(PARAM_KEYS.systemPrompt);
  params.systemPrompt = prefPrompt === null ? (cfg.systemPrompt || '') : prefPrompt;
}

/**
 * 工作流控件是否可用：只有「召唤了智能体」且它绑定了工作流（或系统里有工作流）时才开放。
 * 普通对话不出现工作流 / 知识库，只保留工作模式（思考 / 联网）。
 */
function showWorkflowControls() {
  if (!currentAgent) return false;
  const hasBound = !!currentAgent.wfId;
  return hasBound || (typeof wfCache !== 'undefined' && wfCache.length > 0);
}

/** 把 params 状态渲染到工具栏控件 */
function renderParams() {
  const hasAgent = !!currentAgent;
  const showWf = showWorkflowControls();
  // 智能体专属控件：普通对话隐藏；工作流模式在无智能体时强制回到对话模式
  if (!showWf && responseMode === 'workflow') setResponseMode('chat');
  if (els.modeSwitch) els.modeSwitch.style.display = showWf ? '' : 'none';
  if (els.thinkingBtn) els.thinkingBtn.classList.toggle('active', params.enableThinking);
  if (els.webSearchBtn) els.webSearchBtn.classList.toggle('active', params.webSearch);
  if (els.kbBtn) {
    els.kbBtn.style.display = hasAgent ? '' : 'none';
    els.kbBtn.classList.toggle('active', params.useKb);
  }
  if (els.kbWrap) els.kbWrap.style.display = (hasAgent && params.useKb) ? '' : 'none';
  if (els.kbSelect && els.kbSelect.value !== params.kbId) els.kbSelect.value = params.kbId;
  syncPicker(pickerKb);
  syncPicker(pickerWf);
  if (els.effortSelect) els.effortSelect.value = params.reasoningEffort;
  // 分段选择器视觉态与参数同步（localStorage 恢复 / 深度思考开关重渲染时保持一致）
  if (els.effortSeg) {
    els.effortSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === params.reasoningEffort);
    });
  }
  // 深度思考关闭时禁用强度选择
  if (els.effortLabel) els.effortLabel.classList.toggle('disabled', !params.enableThinking);
  if (els.promptBtn) els.promptBtn.classList.toggle('active', !!params.systemPrompt);
  if (els.promptInput && els.promptInput.value !== params.systemPrompt) {
    els.promptInput.value = params.systemPrompt;
  }
  if (els.promptCount) els.promptCount.textContent = `${params.systemPrompt.length} 字`;
}

/* —— 控件事件 —— */
if (els.thinkingBtn) els.thinkingBtn.addEventListener('click', () => {
  params.enableThinking = !params.enableThinking;
  setPref(PARAM_KEYS.enableThinking, params.enableThinking ? '1' : '0');
  renderParams();
  toast(params.enableThinking ? '已开启深度思考' : '已关闭深度思考', 'success');
});
if (els.effortSelect) els.effortSelect.addEventListener('change', () => {
  params.reasoningEffort = els.effortSelect.value === 'max' ? 'max' : 'high';
  setPref(PARAM_KEYS.reasoningEffort, params.reasoningEffort);
  renderParams();
  toast(`思考强度：${params.reasoningEffort}`, 'success');
});
// 强度分段选择器：点击 → 同步隐藏 select 并复用其 change 逻辑（存储/提示/重渲染）
if (els.effortSeg) {
  els.effortSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    if (els.effortLabel && els.effortLabel.classList.contains('disabled')) return;
    els.effortSelect.value = btn.dataset.value;
    els.effortSelect.dispatchEvent(new Event('change'));
  });
}
if (els.webSearchBtn) els.webSearchBtn.addEventListener('click', () => {
  params.webSearch = !params.webSearch;
  setPref(PARAM_KEYS.webSearch, params.webSearch ? '1' : '0');
  renderParams();
  toast(params.webSearch ? '已开启联网搜索' : '已关闭联网搜索', 'success');
});

/* —— 知识库开关与选择（仅登录员工；访客 /api/kb 返回 401） —— */
let kbListLoaded = false;
let kbCache = [];       // 知识库元信息缓存（智能体自动关联时复用，避免重复请求）
let preAgentKb = null;  // 进入智能体前用户自己的知识库选择（退出应用时还原）
let preAgentWf = null;  // 进入智能体前用户自己的工作流选择（退出应用时还原）

/** 重建知识库下拉：智能体关联的库打 data-auto 标记（菜单里显示「智能体」tag） */
function renderKbOptions() {
  if (!els.kbSelect) return;
  const auto = (currentAgent && currentAgent.kbId) || '';
  const autoHit = !!auto && kbCache.some((k) => k.id === auto);
  els.kbSelect.innerHTML = kbCache.length
    ? '<option value="">不使用知识库</option>' + kbCache.map((k) =>
      `<option value="${esc(k.id)}"${k.id === auto ? ' data-auto="1"' : ''} data-short="${esc(k.name)}">${esc(k.name)}（${k.chunkCount} 段）</option>`).join('')
    : '<option value="">暂无知识库（请在后台创建）</option>';
  // 选中优先级：智能体绑定 → 用户偏好 → 不使用
  const wanted = autoHit ? auto : params.kbId;
  const hit = kbCache.some((k) => k.id === wanted);
  els.kbSelect.value = hit ? wanted : '';
  params.kbId = hit ? wanted : '';
  buildPicker(pickerKb);
}

/**
 * 拉取知识库列表。
 * @param {{quiet?: boolean}} [opts] quiet=true 时不弹错误提示（自动关联场景用）
 */
async function loadKbList(opts = {}) {
  if (!els.kbSelect) return kbCache;
  try {
    kbCache = await api('/api/kb');
    kbListLoaded = true;
    renderKbOptions();
    renderParams();
    return kbCache;
  } catch (e) {
    if (e.status === 401) {
      params.useKb = false;
      setPref(PARAM_KEYS.useKb, '0');
      renderParams();
      if (!opts.quiet) toast('知识库功能仅对登录员工开放', 'error');
    } else if (!opts.quiet) {
      toast('知识库列表加载失败：' + e.message, 'error');
    }
    return kbCache;
  }
}
if (els.kbBtn) els.kbBtn.addEventListener('click', () => {
  params.useKb = !params.useKb;
  setPref(PARAM_KEYS.useKb, params.useKb ? '1' : '0');
  renderParams();
  if (params.useKb) {
    if (!kbListLoaded) loadKbList().then(() => {
      if (!params.kbId) toast('请在工具栏选择要关联的知识库', '');
    });
    else if (!params.kbId) toast('请在工具栏选择要关联的知识库', '');
    else toast('已开启知识库检索', 'success');
  } else {
    toast('已关闭知识库检索', 'success');
  }
});
if (els.kbSelect) els.kbSelect.addEventListener('change', () => {
  params.kbId = els.kbSelect.value;
  setPref(PARAM_KEYS.kbId, params.kbId);
  syncPicker(pickerKb);
  if (!params.kbId && params.useKb) toast('未选择知识库，本次提问不会检索注入', '');
});

/* —— 智能助手（智能体）：在「应用中心」选卡片启用，横幅展示并可一键退出 —— */
let agentsLoaded = false;
let agentsList = []; // 智能体列表（应用中心网格用）
let currentAgent = null; // 当前选中的应用（发送时携带 agentId，服务端应用其模型/温度/知识库配置）
async function loadAgentsList() {
  try {
    agentsList = await api('/api/agents');
    agentsLoaded = true;
    renderAppsGrid();
  } catch (e) {
    if (e.status === 401) return; // 访客：应用中心不可用
    toast('智能助手列表加载失败：' + e.message, 'error');
  }
}

// 应用中心网格：分类页签（全部/数字员工/提效工具/自定义）+ 分组渲染
let appsTab = 'all';
// 判断当前员工是否可管理某智能体（本人创建的，或 owner/admin）
function canManageAgent(a) {
  if (!currentUser) return false;
  if (currentUser.role === 'owner' || currentUser.role === 'admin') return true;
  return a.ownerId === currentUser.id;
}
// 应用图标：icon 为图片 URL 时渲染 <img>，否则渲染 emoji（默认 🤖）
function agentIconHtml(a) {
  const icon = a.icon || '';
  if (icon && (icon.startsWith('/') || /^https?:\/\//i.test(icon))) {
    return `<img class="app-card-img" src="${esc(icon)}" alt="${esc(a.name || '')}" />`;
  }
  return esc(a.emoji || '🤖');
}
function renderAppsGrid() {
  if (!els.appsGroups) return;
  if (!agentsList.length) {
    els.appsGroups.innerHTML = '<div class="empty">暂无智能体，点击右上角「＋ 新建智能体」创建你的第一个智能体。</div>';
    return;
  }
  const filters = {
    all: () => true,
    dept: (a) => (a.presetKey || '').startsWith('dept.'),
    tool: (a) => (a.presetKey || '').startsWith('tool.'),
    custom: (a) => !(a.presetKey || '').startsWith('dept.') && !(a.presetKey || '').startsWith('tool.')
  };
  const shown = agentsList.filter(filters[appsTab] || filters.all);
  let html = `<div class="apps-tabs">
    ${[['all', '全部'], ['dept', '数字员工'], ['tool', '提效工具'], ['custom', '自定义']].map(([k, label]) => `<button class="apps-tab${appsTab === k ? ' active' : ''}" data-apps-tab="${k}">${label}</button>`).join('')}
  </div>`;
  html += `<div class="apps-grid">${shown.map((a) => {
    const mine = canManageAgent(a);
    const vis = a.visibility === 'private' ? '<span class="badge err">私有</span>' : '';
    const presetTag = a.presetKey ? '<span class="badge">预置</span>' : '';
    const metaParts = [];
    if (a.desc) metaParts.push(esc(a.desc));
    metaParts.push(`${esc((a.createdAt || '').slice(0, 10))} 由 ${esc(a.ownerName || '-')} 创建`);
    if (a.configId) metaParts.push('已绑定模型');
    if (a.kbId) metaParts.push('已关联知识库');
    if ((a.variables || []).length) metaParts.push(`${a.variables.length} 个参数变量`);
    const manageBtns = mine ? `<div class="kb-actions">
      <button class="btn btn-sm primary" data-agent-act="edit" data-id="${a.id}">编辑</button>
      <button class="btn btn-sm danger" data-agent-act="del" data-id="${a.id}">删除</button>
    </div>` : '';
    return `
    <div class="kb-card" data-agent-id="${a.id}" title="点击使用 · ${esc(a.desc || a.name)}">
      <h4>${a.icon && (a.icon.startsWith('/') || /^https?:\/\//i.test(a.icon)) ? `<img class="agent-mini-icon" src="${esc(a.icon)}" alt="" />` : esc(a.emoji)} ${esc(a.name)} ${presetTag}${vis}</h4>
      <div class="kb-meta">${metaParts.join(' · ')}</div>
      ${manageBtns}
      <div class="kb-actions"><button class="btn btn-sm" data-agent-use data-id="${a.id}">进入对话</button></div>
    </div>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">该分类暂无智能体</div>'}</div>`;
  // 非全部页签下仍显示对应分组标题
  els.appsGroups.innerHTML = html;
}
els.appsGroups.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-apps-tab]');
  if (tabBtn) {
    appsTab = tabBtn.dataset.appsTab;
    renderAppsGrid();
    return;
  }
  // 管理按钮（编辑/删除）优先于选中卡片
  const actBtn = e.target.closest('[data-agent-act]');
  if (actBtn) {
    const id = actBtn.dataset.id;
    const a = agentsList.find((x) => x.id === id);
    if (actBtn.dataset.agentAct === 'edit' && a) openAgentModal(a);
    else if (actBtn.dataset.agentAct === 'del' && a) deleteAgent(a);
    return;
  }
  // 「进入对话」按钮
  const useBtn = e.target.closest('[data-agent-use]');
  const card = e.target.closest('.kb-card[data-agent-id]');
  const id = useBtn ? useBtn.dataset.id : (card ? card.dataset.agentId : null);
  if (!id) return;
  const a = agentsList.find((x) => x.id === id);
  if (a) selectAgent(a);
  switchWsView('chat');
});

// 智能助手横幅（对话页顶部：头像 + 介绍 + 开场白 + 预设问题）
function renderAgentBanner(agent) {
  if (!els.agentBanner) return;
  if (!agent) {
    els.agentBanner.style.display = 'none';
    els.agentBanner.innerHTML = '';
    return;
  }
  const suggests = (agent.suggests || []).map((s) => `<button class="suggest-chip" type="button">${esc(s)}</button>`).join('');  // 参数变量表单（应用配置定义；发送时收集，服务端注入角色设定）
  const vars = (agent.variables || []);
  const varsHtml = vars.length ? `
    <div class="agent-vars">
      ${vars.map((v) => {
        const req = v.required ? ' <b style="color:var(--danger)">*</b>' : '';
        if (v.type === 'select') {
          const opts = (v.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
          return `<label class="agent-var"><span>${esc(v.label || v.key)}${req}</span>
            <select class="wb-var" data-key="${esc(v.key)}"><option value="">请选择</option>${opts}</select></label>`;
        }
        if (v.type === 'paragraph') {
          return `<label class="agent-var"><span>${esc(v.label || v.key)}${req}</span>
            <textarea class="wb-var" rows="2" data-key="${esc(v.key)}" placeholder="请输入"></textarea></label>`;
        }
        return `<label class="agent-var"><span>${esc(v.label || v.key)}${req}</span>
          <input class="wb-var" data-key="${esc(v.key)}" placeholder="请输入" /></label>`;
      }).join('')}
    </div>` : '';
  // 自动关联提示：知识库 / 工作流（选中智能体时已自动同步到工具栏）
  const bindChips = [];
  if (agent.kbId) {
    const k = kbCache.find((x) => x.id === agent.kbId);
    bindChips.push(`<span class="agent-bind-chip" title="对话时自动检索该知识库">📚 ${esc(k ? k.name : '知识库不可用')}</span>`);
  }
  if (agent.wfId) {
    const w = wfCache.find((x) => x.id === agent.wfId);
    bindChips.push(`<span class="agent-bind-chip" title="切到 🧩 工作流模式时自动选中该工作流">🧩 ${esc(w ? w.name : '工作流不可用')}</span>`);
  }
  const bindsHtml = bindChips.length
    ? `<div class="agent-binds"><span class="agent-binds-label">自动关联</span>${bindChips.join('')}</div>`
    : '';
  const hasBody = !!(agent.welcome || varsHtml || suggests || bindsHtml);
  els.agentBanner.innerHTML = `
    <div class="agent-banner-card">
      <div class="agent-banner-head">
        <span class="agent-banner-emoji">${agentIconHtml(agent)}</span>
        <div class="agent-banner-title">
          <b>${esc(agent.name)}</b>
          ${agent.desc ? `<span>${esc(agent.desc)}</span>` : ''}
        </div>
        <span class="spacer" style="flex:1"></span>
        ${hasBody ? `<button class="agent-collapse" type="button" title="折叠 / 展开" aria-expanded="true"><span class="agent-collapse-arrow">▾</span> 折叠</button>` : ''}
        <button class="agent-exit" type="button" title="退出当前应用，恢复直接对话">✕ 退出应用</button>
      </div>
      ${hasBody ? `<div class="agent-banner-body">${bindsHtml}${agent.welcome ? `<div class="agent-banner-welcome">${esc(agent.welcome)}</div>` : ''}${varsHtml}${suggests ? `<div class="suggest-row">${suggests}</div>` : ''}</div>` : ''}
    </div>`;
  els.agentBanner.style.display = '';
  els.agentBanner.querySelector('.agent-exit').addEventListener('click', clearAgent);
  const collapseBtn = els.agentBanner.querySelector('.agent-collapse');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const body = els.agentBanner.querySelector('.agent-banner-body');
      const card = els.agentBanner.querySelector('.agent-banner-card');
      const arrow = collapseBtn.querySelector('.agent-collapse-arrow');
      if (!body) return;
      const collapsed = body.classList.toggle('collapsed');
      if (card) card.classList.toggle('collapsed', collapsed);
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      collapseBtn.innerHTML = collapsed ? '<span class="agent-collapse-arrow">▸</span> 展开' : '<span class="agent-collapse-arrow">▾</span> 折叠';
      collapseBtn.title = collapsed ? '展开' : '折叠';
    });
  }
  els.agentBanner.querySelectorAll('.suggest-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      els.input.value = chip.textContent;
      els.input.focus();
      autoGrow();
    });
  });
}

/** 收集当前应用的参数变量；必填缺失时返回 { missing } */
function collectAgentVars() {
  if (!currentAgent || !(currentAgent.variables || []).length) return { values: null };
  const values = {};
  const missing = [];
  document.querySelectorAll('.wb-var').forEach((el) => {
    const key = el.dataset.key;
    const val = (el.value || '').trim();
    values[key] = val;
    const def = currentAgent.variables.find((v) => v.key === key);
    if (def && def.required && !val) missing.push(def.label || def.key);
  });
  return { values, missing };
}

/* —— 工作台视图切换（对话 / 应用中心 / 知识库 / 工作流） —— */
let kbViewLoaded = false;
function switchWsView(name) {
  const views = { chat: els.viewChat, apps: els.viewApps, kb: els.viewKb, workflow: els.viewWorkflow };
  for (const k in views) {
    if (views[k]) views[k].style.display = k === name ? '' : 'none';
  }
  document.querySelectorAll('.ws-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.wsview === name));
  document.querySelectorAll('.rail-item[data-wsview]').forEach((b) => b.classList.toggle('active', b.dataset.wsview === name));
  if (name === 'kb') loadKbView();
  if (name === 'workflow') loadWorkflows();
}
document.querySelectorAll('.ws-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchWsView(btn.dataset.wsview));
});
// 图标栏视图切换（应用 / 知识库；聊天图标由抽屉逻辑单独处理）
document.querySelectorAll('.rail-item[data-wsview]').forEach((btn) => {
  if (btn.dataset.wsview === 'chat') return; // 聊天图标在 initSidebarDrawer 里处理
  btn.addEventListener('click', () => switchWsView(btn.dataset.wsview));
});

/* —— 知识库视图（成员卡片网格 + 检索测试） —— */
let kbViewCurrent = null;
let kbList = []; // 知识库元信息列表（自建管理用）
// 判断当前员工是否可管理某知识库（本人创建的，或 owner/admin）
function canManageKb(k) {
  if (!currentUser) return false;
  if (currentUser.role === 'owner' || currentUser.role === 'admin') return true;
  return k.ownerId === currentUser.id;
}
async function loadKbView() {
  if (!els.kbViewGrid) return;
  try {
    kbList = await api('/api/kb');
    if (!kbList.length) {
      els.kbViewGrid.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无知识库，点击右上角「＋ 新建知识库」创建你的第一个知识库。</div>';
      return;
    }
    els.kbViewGrid.innerHTML = kbList.map((k) => {
      const mine = canManageKb(k);
      const vis = k.visibility === 'private' ? '<span class="badge err">私有</span>' : '<span class="badge">公共</span>';
      const manageBtns = mine ? `<div class="kb-actions">
        <button class="btn btn-sm primary" data-kb-act="edit" data-id="${k.id}">管理 / 导入</button>
        <button class="btn btn-sm danger" data-kb-act="del" data-id="${k.id}">删除</button>
      </div>` : '';
      return `
      <div class="kb-card" data-kb-id="${k.id}" title="点击检索测试 · ${esc(k.remark || k.name)}">
        <h4>📚 ${esc(k.name)} ${vis}</h4>
        ${k.remark ? `<div class="kb-meta">${esc(k.remark)}</div>` : ''}
        <div class="kb-meta">文件 ${k.fileCount} 个 · 分段 ${k.chunkCount} 条 · ${esc((k.createdAt || '').slice(0, 10))} 由 ${esc(k.ownerName || '-')} 创建</div>
        ${manageBtns}
        <div class="kb-actions"><button class="btn btn-sm" data-kb-test data-id="${k.id}">检索测试</button></div>
      </div>`;
    }).join('');
  } catch (e) {
    if (e.status === 401) {
      els.kbViewGrid.innerHTML = '<div class="empty" style="grid-column:1/-1">知识库仅对登录员工开放，请先登录。</div>';
      return;
    }
    els.kbViewGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">加载失败：${esc(e.message)}</div>`;
  }
}
els.kbViewGrid.addEventListener('click', (e) => {
  // 管理按钮（编辑/删除）优先于选中卡片
  const actBtn = e.target.closest('[data-kb-act]');
  if (actBtn) {
    const id = actBtn.dataset.id;
    const k = kbList.find((x) => x.id === id);
    if (actBtn.dataset.kbAct === 'edit' && k) openKbManageModal(k.id);
    else if (actBtn.dataset.kbAct === 'del' && k) deleteKb(k);
    return;
  }
  // 「检索测试」按钮
  const testBtn = e.target.closest('[data-kb-test]');
  const card = e.target.closest('.kb-card[data-kb-id]');
  const id = testBtn ? testBtn.dataset.id : (card ? card.dataset.kbId : null);
  if (!id) return;
  kbViewCurrent = { id };
  const nameEl = card ? card.querySelector('h4') : null;
  els.kbViewTestName.textContent = nameEl ? nameEl.textContent : id;
  els.kbViewTest.style.display = '';
  els.kbViewResults.innerHTML = '';
  els.kbViewQuery.focus();
});
els.kbViewTestBtn.addEventListener('click', async () => {
  if (!kbViewCurrent) return;
  const q = els.kbViewQuery.value.trim();
  if (!q) { toast('请输入测试问题', 'error'); return; }
  els.kbViewResults.innerHTML = '<div class="hint">检索中…</div>';
  try {
    const r = await api(`/api/kb/${kbViewCurrent.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: q })
    });
    if (!r.chunks.length) {
      els.kbViewResults.innerHTML = '<div class="hint">没有检索到相关分段。</div>';
      return;
    }
    els.kbViewResults.innerHTML = (() => {
      const top = r.chunks[0].score || 1;
      return r.chunks.map((c, i) => {
        const pct = Math.min(100, Math.round((c.score / top) * 100));
        return `
      <div class="kb-chunk kb-search-hit">
        <div class="kb-chunk-head"><span class="score">#${i + 1} · 相关度 ${c.score}（${pct}%）</span></div>
        <pre>${esc(c.text)}</pre>
      </div>`;
      }).join('');
    })();
  } catch (e) {
    els.kbViewResults.innerHTML = `<div class="hint">检索失败：${esc(e.message)}</div>`;
  }
});
els.kbViewQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); els.kbViewTestBtn.click(); } });

/* —— 应用选择 / 退出：注入 systemPrompt + 应用配置（模型/知识库/工作流/参数变量）+ 渲染横幅 —— */

/**
 * 自动管理智能体对应的知识库与工作流：
 *   1) 列表未加载时按需拉取（静默，不打扰用户）；
 *   2) 知识库：有绑定 → 自动开启检索并选中该库；无绑定 → 关闭检索，避免沿用上一个智能体的库；
 *   3) 工作流：有绑定 → 预先选中（切到工作流模式即可直接运行），无绑定保持用户自己的选择。
 * 用户随后仍可在工具栏手动改成别的库 / 工作流（手动选择优先，直到切换智能体）。
 */
async function syncAgentResources(a) {
  const notes = [];
  if (a.kbId) {
    if (!kbListLoaded) await loadKbList({ quiet: true });
    const hit = kbCache.find((k) => k.id === a.kbId);
    if (hit) {
      params.useKb = true;
      params.kbId = a.kbId;
      setPref(PARAM_KEYS.useKb, '1');
      setPref(PARAM_KEYS.kbId, a.kbId);
      renderKbOptions();
      notes.push(`知识库「${hit.name}」`);
    } else if (kbListLoaded) {
      toast('该智能体关联的知识库不可用（可能已删除或无权限）', 'error');
    }
  } else {
    params.useKb = false;
    params.kbId = '';
    setPref(PARAM_KEYS.useKb, '0');
    setPref(PARAM_KEYS.kbId, '');
    if (kbListLoaded) renderKbOptions();
  }
  if (a.wfId) {
    if (!wfListLoaded) await loadWfModeList({ quiet: true });
    const hitWf = wfCache.find((w) => w.id === a.wfId);
    if (hitWf) {
      wfModeId = a.wfId;
      setPref('wb_wfid', wfModeId);
      renderWfOptions();
      notes.push(`工作流「${hitWf.name}」`);
    } else if (wfListLoaded && wfCache.length) {
      toast('该智能体绑定的工作流不可用（可能已删除或无权限）', 'error');
    }
  } else {
    // 未绑定：仍拉一次工作流列表，让「召唤智能体后可切到工作流模式」可用；选中项回落到用户自己的
    if (!wfListLoaded) await loadWfModeList({ quiet: true });
    if (wfListLoaded) {
      wfModeId = preAgentWf && wfCache.some((w) => w.id === preAgentWf) ? preAgentWf : '';
      setPref('wb_wfid', wfModeId);
      renderWfOptions();
    }
  }
  renderParams();
  return notes;
}

async function selectAgent(a) {
  if (!a) return;
  // 首次进入智能体前，记住用户自己的知识库 / 工作流选择，退出应用时还原
  if (!preAgentKb) preAgentKb = { useKb: params.useKb, kbId: params.kbId };
  if (preAgentWf === null) preAgentWf = wfModeId;
  currentAgent = a;
  params.systemPrompt = a.systemPrompt;
  setPref(PARAM_KEYS.systemPrompt, a.systemPrompt);
  // 应用绑定模型配置：存在该配置则切换当前配置下拉（显式选择优先于跟随调度）
  if (a.configId && els.configSelect) {
    const has = Array.from(els.configSelect.options).some((o) => o.value === a.configId);
    if (has && els.configSelect.value !== a.configId) {
      els.configSelect.value = a.configId;
      els.configSelect.dispatchEvent(new Event('change'));
    }
  }
  const notes = await syncAgentResources(a);
  renderParams();
  renderAgentBanner(a);
  const tail = notes.length ? ` · 已自动关联 ${notes.join('、')}` : '';
  toast(`已启用助手「${a.emoji || '🤖'} ${a.name}」${tail}`, 'success');
}

/** 退出当前应用：清空角色设定与参数变量，还原用户自己的知识库 / 工作流选择 */
function clearAgent() {
  currentAgent = null;
  params.systemPrompt = '';
  setPref(PARAM_KEYS.systemPrompt, '');
  // 还原进入智能体前的知识库选择（自动开启的检索一并回退）
  if (preAgentKb) {
    params.useKb = !!preAgentKb.useKb;
    params.kbId = preAgentKb.kbId || '';
    setPref(PARAM_KEYS.useKb, params.useKb ? '1' : '0');
    setPref(PARAM_KEYS.kbId, params.kbId);
    preAgentKb = null;
    if (kbListLoaded) renderKbOptions();
  }
  // 工作流回到进入智能体前的选择（清掉智能体自动绑定的那个）
  if (preAgentWf !== null) {
    wfModeId = wfCache.some((w) => w.id === preAgentWf) ? preAgentWf : '';
    preAgentWf = null;
    setPref('wb_wfid', wfModeId);
    if (wfListLoaded) renderWfOptions();
  }
  renderParams();
  renderAgentBanner(null);
  toast('已切换为直接对话（使用配置默认系统提示）', 'success');
}

/* —— 通知公告：工作台侧栏顶部展示（关闭按公告版本记忆，更新后重新出现） —— */
async function loadNotice() {
  if (!els.noticeBar) return;
  try {
    const d = await api('/api/notice');
    if (!d.enabled || !d.text) return;
    const closedFor = getPref('wb_notice_closed');
    if (closedFor === d.updatedAt) return; // 用户已关闭过这一版公告
    els.noticeText.textContent = d.text;
    els.noticeBar.style.display = '';
    if (els.noticeCloseBtn) {
      els.noticeCloseBtn.onclick = () => {
        els.noticeBar.style.display = 'none';
        setPref('wb_notice_closed', d.updatedAt);
      };
    }
  } catch (_) { /* 公告获取失败静默 */ }
}
if (els.promptBtn) els.promptBtn.addEventListener('click', () => {
  const show = els.promptPanel.style.display === 'none';
  els.promptPanel.style.display = show ? '' : 'none';
  els.promptBtn.classList.toggle('active', show || !!params.systemPrompt);
  if (show) { els.promptInput.focus(); }
});
if (els.promptInput) els.promptInput.addEventListener('input', () => {
  params.systemPrompt = els.promptInput.value;
  setPref(PARAM_KEYS.systemPrompt, params.systemPrompt);
  renderParams();
});
if (els.promptResetBtn) els.promptResetBtn.addEventListener('click', () => {
  // 恢复配置默认：清掉手动偏好，重新取当前配置值
  clearPref(PARAM_KEYS.systemPrompt);
  const cfg = configs.find((c) => c._id === currentConfigId);
  params.systemPrompt = (cfg && cfg.systemPrompt) || '';
  renderParams();
  toast('已恢复为配置中的默认系统提示', 'success');
});
if (els.promptSaveBtn) els.promptSaveBtn.addEventListener('click', () => {
  els.promptPanel.style.display = 'none';
});

/* ================= 图片粘贴 / 拖拽 / 选择上传 =================
 * 状态：pendingImages = [{ id, name, size, dataUrl, width, height,
 *                          status: 'pending'|'uploading'|'done'|'error', url, error, progress }]
 *   - pending   已读入本地，等待上传
 *   - uploading 上传中（progress 0~100）
 *   - done      上传成功，拿到 /uploads URL，可随消息发送
 *   - error     上传失败，可重试或删除
 * 说明：上传用 XHR 以拿到上传进度；base64 经 JSON 上报，后端落盘 public/uploads。
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 与后端一致：单张 8MB
const MAX_IMAGE_COUNT = 9;               // 与后端一致：一次最多 9 张
let pendingImages = [];
let imgSeq = 0;

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

const $ = (sel) => {
  if (typeof sel !== 'string') return null;
  // 兼容两种语义：# 前缀走 querySelector（画布代码），否则走 getElementById（原 app.js 代码）
  if (sel.startsWith('#')) return document.querySelector(sel);
  return document.getElementById(sel);
};

async function api(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (e) {
    // 用户点「停止」主动中止：保留 AbortError 语义，别包装成"无法连接"（调用方据此区分）
    if (e && e.name === 'AbortError') throw e;
    // fetch 在网络层失败：服务未启动 / 端口不通 / 连接被重置（进程崩溃）
    const err = new Error('无法连接后端服务，请确认服务已启动（默认 http://127.0.0.1:4000，双击「启动.bat」或执行 npm start）');
    err.network = true;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    // 区分两种未登录：访客密码保护 → 访客登录页；员工会话失效/停用 → 员工登录页
    if (data.code === 'WB_AUTH_REQUIRED') {
      toast('请先输入工作台密码', 'error');
      setTimeout(() => { location.href = '/login'; }, 900);
    } else {
      toast('登录已失效，请重新登录', 'error');
      // 带当前页回跳：重新登录后直接回到原页面（如 /admin），不用手动找入口
      setTimeout(() => { location.href = '/team-login?next=' + encodeURIComponent(location.pathname); }, 900);
    }
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
  // 兼容两种响应形态：
  //   常规接口  {ok:true, data:...}      → 取 data
  //   /api/chat {ok:true, latencyMs, result, ...} → 平铺无 data 字段，取整个 body
  // 早年无条件取 data.data，对 /api/chat 会得到 undefined，
  // 导致 send() 里 data.result 抛 "Cannot read properties of undefined (reading 'result')"。
  return data.data !== undefined ? data.data : data;
}

/* ================= 图片粘贴 / 拖拽 / 选择上传 ================= */

/** 读取本地图片文件 → dataUrl（FileReader） */
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 加入待上传列表（粘贴/拖拽/选择器共用）
 * 前端预检：数量、大小；格式与尺寸由后端校验（魔数级，不可伪造）
 */
async function addImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f);
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    if (!/^image\//i.test(file.type || '')) {
      toast(`「${file.name || '未知文件'}」不是图片文件，已跳过`, 'error');
      continue;
    }
    if (pendingImages.length >= MAX_IMAGE_COUNT) {
      toast(`一次最多附加 ${MAX_IMAGE_COUNT} 张图片`, 'error');
      break;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`「${file.name}」大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 8MB 上限，已跳过`, 'error');
      continue;
    }
    try {
      const dataUrl = await readImageFile(file);
      const item = {
        id: `img_${++imgSeq}_${Date.now()}`,
        name: file.name || `粘贴图片_${imgSeq}.png`,
        size: file.size,
        dataUrl,
        status: 'pending',
        progress: 0,
        url: '',
        error: ''
      };
      pendingImages.push(item);
      added++;
      uploadImage(item); // 读入即上传，发送时通常已完成
    } catch (e) {
      toast(`「${file.name || '图片'}」读取失败：${e.message}`, 'error');
    }
  }
  if (added) renderAttachRow();
}

/**
 * 上传单张图片（XHR 以获取上传进度）
 * 成功 → status=done + url；失败 → status=error + error（可重试）
 */
function uploadImage(item) {
  if (!item || item.status === 'uploading' || item.status === 'done') return;
  item.status = 'uploading';
  item.progress = 0;
  item.error = '';
  renderAttachRow();

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      item.progress = Math.round((e.loaded / e.total) * 100);
      updateAttachProgress(item);
    }
  };
  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) { data = {}; }
    if (xhr.status === 401) {
      // 与 api() 一致：访客密码 → /login；员工会话失效 → /team-login
    if (data.code === 'WB_AUTH_REQUIRED') {
      toast('请先输入工作台密码', 'error');
      setTimeout(() => { location.href = '/login'; }, 900);
    } else {
      toast('登录已失效，请重新登录', 'error');
      setTimeout(() => { location.href = '/team-login?next=' + encodeURIComponent(location.pathname); }, 900);
    }
    item.status = 'error';
      item.error = '未登录';
    } else if (xhr.status >= 200 && xhr.status < 300 && data.ok && data.data && data.data.files && data.data.files[0]) {
      const f = data.data.files[0];
      item.status = 'done';
      item.progress = 100;
      item.url = f.url;
      item.width = f.width;
      item.height = f.height;
      item.size = f.size || item.size;
      item.error = '';
    } else {
      item.status = 'error';
      item.error = data.error || `上传失败（HTTP ${xhr.status}）`;
      toast(`「${item.name}」上传失败：${item.error}`, 'error');
    }
    renderAttachRow();
  };
  xhr.onerror = () => {
    item.status = 'error';
    item.error = '网络错误，无法连接上传服务';
    renderAttachRow();
  };
  xhr.send(JSON.stringify({ images: [{ name: item.name, dataUrl: item.dataUrl }] }));
}

/** 仅更新进度显示，避免整行重绘打断交互 */
function updateAttachProgress(item) {
  const el = els.attachRow.querySelector(`[data-img-id="${item.id}"] .attach-progress-bar`);
  if (el) el.style.width = `${item.progress}%`;
}

/** 渲染待上传图片缩略图条（含状态：等待/上传中/成功/失败） */
function renderAttachRow() {
  if (!els.attachRow) return;
  const hasImages = pendingImages.length > 0;
  const hasFiles = pendingAttachments.length > 0;
  if (!hasImages && !hasFiles) {
    els.attachRow.style.display = 'none';
    els.attachRow.innerHTML = '';
    return;
  }
  els.attachRow.style.display = '';
  els.attachRow.innerHTML = '';
  for (const item of pendingImages) {
    const box = document.createElement('div');
    box.className = `attach-thumb ${item.status}`;
    box.dataset.imgId = item.id;
    const sizeText = item.size ? `${(item.size / 1024).toFixed(0)}KB` : '';
    const dimText = item.width ? `${item.width}×${item.height}` : '';
    const statusText = item.status === 'pending' ? '等待上传'
      : item.status === 'uploading' ? `上传中 ${item.progress}%`
      : item.status === 'error' ? '上传失败（点击重试）'
      : [sizeText, dimText].filter(Boolean).join(' · ');
    box.innerHTML = `
      <img src="${esc(item.dataUrl)}" alt="${esc(item.name)}" />
      <div class="attach-del" title="移除该图片">×</div>
      <div class="attach-progress"><div class="attach-progress-bar" style="width:${item.status === 'done' ? 100 : item.progress}%"></div></div>
      <div class="attach-name" title="${esc(item.error || item.name)}">${esc(statusText)}</div>`;
    box.querySelector('.attach-del').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingImages = pendingImages.filter((x) => x.id !== item.id);
      renderAttachRow();
    });
    box.addEventListener('click', () => {
      if (item.status === 'error') uploadImage(item);
    });
    els.attachRow.appendChild(box);
  }
  // 通用附件 chips（文档 / 音视频 / 压缩包）
  for (const item of pendingAttachments) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    const sizeText = item.size ? `${(item.size / 1024).toFixed(0)}KB` : '';
    const statusText = item.status === 'uploading' ? '上传中…'
      : item.status === 'error' ? '上传失败'
      : sizeText;
    chip.innerHTML = `📎 <span class="chip-name" title="${esc(item.name)}">${esc(item.name)}</span><span class="chip-size">${esc(statusText)}</span><button class="chip-del" title="移除附件">×</button>`;
    chip.querySelector('.chip-del').addEventListener('click', () => {
      pendingAttachments = pendingAttachments.filter((x) => x.id !== item.id);
      renderAttachRow();
    });
    els.attachRow.appendChild(chip);
  }
}

/* ---------- 附件上传（文档 / 音视频 / 压缩包，大小与格式上限由后台配置） ---------- */
async function uploadAttachments(files) {
  const ul = (uiSettings && uiSettings.uploadLimits) || {};
  const attLimit = ul.attachment || {};
  const allowExts = Array.isArray(attLimit.exts) && attLimit.exts.length ? attLimit.exts : null;
  const maxBytes = Number.isFinite(Number(attLimit.maxBytes)) && Number(attLimit.maxBytes) > 0 ? Number(attLimit.maxBytes) : 20 * 1024 * 1024;
  for (const file of files) {
    const ext = (file.name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';
    if (allowExts && !allowExts.includes(ext)) {
      toast(`附件 ${file.name} 类型 .${ext || '(无扩展名)'} 不在允许范围内（${allowExts.join('/')}）`, 'error');
      continue;
    }
    if (file.size > maxBytes) {
      toast(`附件 ${file.name} 超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限`, 'error');
      continue;
    }
    const id = 'at' + Date.now() + Math.random().toString(36).slice(2, 5);
    const item = { id, name: file.name, size: file.size, mime: file.type || '', status: 'uploading', url: '' };
    pendingAttachments.push(item);
    renderAttachRow();
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(file);
      });
      const r = await api('/api/upload/files', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, dataUrl })
      });
      item.url = r.url;
      item.mime = r.mime || item.mime;
      item.status = 'done';
    } catch (e) {
      item.status = 'error';
      toast(`附件 ${file.name} 上传失败：${e.message}`, 'error');
    }
    renderAttachRow();
  }
}
if (els.fileAttachBtn) els.fileAttachBtn.addEventListener('click', () => els.fileAttachInput.click());
if (els.fileAttachInput) els.fileAttachInput.addEventListener('change', () => {
  const files = Array.from(els.fileAttachInput.files || []);
  els.fileAttachInput.value = '';
  if (files.length) uploadAttachments(files);
});

/* ---------- 响应模式（对话 / 工作流） ---------- */
let wfListLoaded = false;
let wfCache = [];   // 工作流元信息缓存（智能体自动绑定 / 自动选中时复用）

/** 重建工作流下拉：智能体绑定的工作流打 data-auto 标记并优先选中 */
function renderWfOptions() {
  if (!els.wfModeSelect) return;
  const auto = (currentAgent && currentAgent.wfId) || '';
  const autoHit = !!auto && wfCache.some((w) => w.id === auto);
  els.wfModeSelect.innerHTML = wfCache.length
    ? '<option value="" data-short="选择工作流">请选择要运行的工作流</option>' + wfCache.map((w) =>
      `<option value="${esc(w.id)}"${w.id === auto ? ' data-auto="1"' : ''} data-short="${esc(w.name)}">${esc(w.name)}（${w.nodeCount} 节点）</option>`).join('')
    : '<option value="">暂无工作流（请在后台创建）</option>';
  // 选中优先级：智能体绑定 → 用户偏好 → 未选择
  const wanted = autoHit ? auto : wfModeId;
  const hit = wfCache.some((w) => w.id === wanted);
  els.wfModeSelect.value = hit ? wanted : '';
  wfModeId = hit ? wanted : '';
  buildPicker(pickerWf);
}

/**
 * 拉取工作流列表。
 * @param {{quiet?: boolean}} [opts] quiet=true 时不弹错误提示（自动绑定场景用）
 */
async function loadWfModeList(opts = {}) {
  if (!els.wfModeSelect) return wfCache;
  try {
    wfCache = await api('/api/workflows');
    wfListLoaded = true;
    renderWfOptions();
    return wfCache;
  } catch (e) {
    if (e.status === 401) {
      // 访客 / 未登录：强制对话模式，禁用工作流按钮
      setResponseMode('chat');
      document.querySelectorAll('#modeSwitch .mode-btn').forEach((b) => {
        if (b.dataset.mode === 'workflow') b.disabled = true;
      });
    } else if (!opts.quiet) {
      toast('工作流列表加载失败：' + e.message, 'error');
    }
    return wfCache;
  }
}

/** 切换响应模式（供顶部胶囊按钮与初始化调用） */
function setResponseMode(mode) {
  // 普通对话（未召唤智能体）不允许进入工作流模式
  if (mode === 'workflow' && !showWorkflowControls()) mode = 'chat';
  responseMode = mode === 'workflow' ? 'workflow' : 'chat';
  try { localStorage.setItem('wb_mode', responseMode); } catch (_) {}
  document.querySelectorAll('#modeSwitch .mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === responseMode);
  });
  if (els.wfModeWrap) els.wfModeWrap.style.display = (responseMode === 'workflow' && showWorkflowControls()) ? '' : 'none';
  if (responseMode === 'workflow') {
    // 进入工作流模式：列表没加载过就拉取；已加载则按当前智能体重算选中项
    if (!wfListLoaded) loadWfModeList();
    else renderWfOptions();
  } else {
    pickerClose(pickerWf);
  }
}

if (els.modeSwitch) {
  els.modeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn || btn.disabled) return;
    setResponseMode(btn.dataset.mode);
    if (responseMode === 'workflow') {
      toast('工作流模式：发送的问题将按编排链路执行', '');
    }
  });
}
if (els.wfModeSelect) els.wfModeSelect.addEventListener('change', () => {
  wfModeId = els.wfModeSelect.value;
  try { localStorage.setItem('wb_wfid', wfModeId); } catch (_) {}
  syncPicker(pickerWf);
});

/* ---------- 粘贴事件（捕获级：兼容 Ctrl+V 与右键菜单粘贴） ---------- */
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  const files = [];
  if (items && items.length) {
    // 注意：DataTransferItemList 仅保证索引访问（部分浏览器不支持 for...of），用下标遍历
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind === 'file' && /^image\//i.test(it.type || '')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  // 兼容部分浏览器只提供 files 的场合
  if (!files.length && e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) {
    for (let i = 0; i < e.clipboardData.files.length; i++) {
      const f = e.clipboardData.files[i];
      if (f && /^image\//i.test(f.type || '')) files.push(f);
    }
  }
  if (!files.length) return; // 纯文本粘贴：放行默认行为（输入框正常输入）
  e.preventDefault();       // 有图片：阻止默认（避免把图片名/地址粘进输入框）
  addImageFiles(files);
});

/* ---------- 拖拽放入 ---------- */
if (els.chatInput) {
  ['dragenter', 'dragover'].forEach((ev) => {
    els.chatInput.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.chatInput.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.chatInput.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ev === 'dragleave' && els.chatInput.contains(e.relatedTarget)) return;
      els.chatInput.classList.remove('dragover');
    });
  });
  els.chatInput.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) addImageFiles(dt.files);
  });
}

/* ---------- 附件按钮 → 文件选择器 ---------- */
if (els.attachBtn && els.fileInput) {
  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files && els.fileInput.files.length) addImageFiles(els.fileInput.files);
    els.fileInput.value = ''; // 允许重复选同一文件
  });
}

/* ---------- 消息内容工具：文本/数组 content 兼容 ---------- */
function contentParts(content) {
  if (typeof content === 'string') return { text: content, images: [], files: [] };
  if (Array.isArray(content)) {
    const text = content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
    const images = content
      .filter((p) => p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string')
      .map((p) => p.image_url.url);
    // 附件（文件 / 音视频）：存档展示，不发给模型
    const files = content
      .filter((p) => p && p.type === 'file_url' && p.file_url && typeof p.file_url.url === 'string')
      .map((p) => ({ url: p.file_url.url, name: p.file_url.name || '', mime: p.file_url.mime || '' }));
    return { text, images, files };
  }
  return { text: '', images: [], files: [] };
}

/* ================= 配置加载 ================= */
async function loadConfigs() {
  try {
    configs = await api('/api/configs');
    // 界面显示设置（GET 开放）：控制面板是否拼接模型名字
    try { uiSettings = await api('/api/configs/settings'); } catch (_) { /* 读不到用默认（显示） */ }
  } catch (e) {
    toast(`加载配置失败：${e.message}`, 'error');
    configs = [];
  }
  els.configSelect.innerHTML = '';
  if (!configs.length) {
    els.configSelect.innerHTML = '<option value="">（无配置，请先到后台管理添加）</option>';
    els.curConfigName.textContent = '未配置 API';
  } else {
    const active = configs.find((c) => c.active) || configs[0];
    currentConfigId = active._id;
    for (const c of configs) {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = configLabel(c);
      opt.selected = c._id === currentConfigId;
      els.configSelect.appendChild(opt);
    }
    updateConfigLabel();
    // 参数工具栏：跟随激活配置的默认值（用户手动改过的项仍用偏好）
    applyConfigDefaults(active);
    renderParams();
  }
  loadConversations();
}

/** 配置在面板上的展示名：后台开关关闭时只显示配置名称，不拼接模型名字 */
function configLabel(c) {
  if (!c) return '未选择配置';
  return uiSettings.showModelName === false ? c.name : `${c.name} · ${c.model}`;
}

function updateConfigLabel() {
  const c = configs.find((x) => x._id === currentConfigId);
  els.curConfigName.textContent = configLabel(c);
}

els.configSelect.addEventListener('change', () => {
  currentConfigId = els.configSelect.value;
  updateConfigLabel();
  // 切换配置：未手动设置过的参数跟随新配置默认值
  const cfg = configs.find((c) => c._id === currentConfigId);
  applyConfigDefaults(cfg);
  renderParams();
  // 在对话框里提示本次切换（下一条消息起生效；发送后自动清除）
  showModelSwitchNotice(configLabel(cfg));
});

/* ================= 会话管理 ================= */
async function loadConversations() {
  try {
    conversations = await api('/api/conversations');
  } catch (e) {
    toast(`加载会话失败：${e.message}`, 'error');
    conversations = [];
  }
  // 没有任何会话时，自动新建一个默认会话，保证可直接对话
  if (!conversations.length) {
    try {
      const conv = await api('/api/conversations', { method: 'POST', body: JSON.stringify({}) });
      conversations = [conv];
      currentConv = conv;
    } catch (_) { /* 忽略 */ }
  }
  // 当前会话已不存在时，切到最近一个
  if (!currentConv || !conversations.some((c) => c.id === currentConv.id)) {
    if (conversations.length) await switchConv(conversations[0].id, false);
  } else {
    renderConvList();
    renderMessages();
  }
}

function renderConvList() {
  els.convList.innerHTML = '';
  if (!conversations.length) {
    els.convList.innerHTML = '<div class="conv-empty">暂无会话，点击「新增对话」创建</div>';
    return;
  }
  conversations.forEach((c) => {
    const item = document.createElement('div');
    item.className = `conv-item ${c.id === (currentConv && currentConv.id) ? 'active' : ''}`;
    const n = (c.messages && c.messages.length) || c.count || 0;
    item.innerHTML = `
      <div class="conv-body">
        <div class="conv-title">${esc(c.title || '新对话')}</div>
        <div class="conv-sub">${n} 条 · ${esc(shortTime(c.updatedAt))}</div>
      </div>
      <button class="conv-del" title="删除该对话">×</button>`;
    item.querySelector('.conv-body').addEventListener('click', () => switchConv(c.id));
    item.querySelector('.conv-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConv(c.id);
    });
    els.convList.appendChild(item);
  });
}

function shortTime(iso) {
  if (!iso) return '';
  return iso.slice(5, 16).replace('T', ' ');
}

async function switchConv(id, reload = true) {
  if (!id) return;
  try {
    currentConv = await api(`/api/conversations/${id}`);
    renderConvList();
    renderMessages();
  } catch (e) {
    toast(`切换会话失败：${e.message}`, 'error');
  }
}

async function newConv() {
  try {
    const conv = await api('/api/conversations', { method: 'POST', body: JSON.stringify({}) });
    currentConv = conv;
    await loadConversations();
    els.input && els.input.focus();
  } catch (e) {
    toast(`新建对话失败：${e.message}`, 'error');
  }
}

async function deleteConv(id) {
  const target = conversations.find((c) => c.id === id);
  if (!confirm(`确定删除对话「${target ? target.title : id}」？该对话消息将被永久删除。`)) return;
  try {
    await api(`/api/conversations/${id}`, { method: 'DELETE' });
    if (currentConv && currentConv.id === id) currentConv = null;
    conversations = conversations.filter((c) => c.id !== id);
    if (!conversations.length) {
      const conv = await api('/api/conversations', { method: 'POST', body: JSON.stringify({}) });
      conversations = [conv];
      currentConv = conv;
    } else if (!currentConv) {
      await switchConv(conversations[0].id, false);
    }
    renderConvList();
    renderMessages();
    toast('已删除对话', 'success');
  } catch (e) {
    toast(`删除失败：${e.message}`, 'error');
  }
}

els.newConvBtn.addEventListener('click', newConv);
els.delConvBtn.addEventListener('click', () => {
  if (currentConv) deleteConv(currentConv.id);
  else toast('请先选择一个对话', 'error');
});

/* ================= 消息渲染 ================= */

/* 消息级前端状态（不持久化）：
 * - views:     msgId → 'rendered' | 'source'（原文/还原视图偏好，仅内存）
 * - fbPending: 正在提交评价的 msgId（防连点）
 * 权威状态以服务端为准：currentConv.messages[].feedback / .id
 */
const msgState = { views: new Map(), fbPending: new Set() };

function renderMessages() {
  els.messages.innerHTML = '';
  removeModelSwitchNotice(); // 重渲染消息列表时清掉切换提示（它不属于会话内容）
  const list = (currentConv && currentConv.messages) || [];
  if (!list.length) {
    els.messages.innerHTML = '<div class="empty">开始新的对话：在下方输入消息。系统提示/参数可在后台管理配置。</div>';
    return;
  }
  for (const m of list) {
    if (m.role === 'system') continue;
    addMsg(m.role === 'user' ? 'user' : 'assistant', m.content, {
      mid: m.id || '',
      feedback: m.feedback,
      meta: shortTime(m.time)
    });
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

/** 消息工具条 HTML：复制▾ / 朗读(仅AI回复) / 原文切换 / 点赞 / 差评（错误消息仅保留复制） */
function buildMsgTools(extra, role) {
  const copyPart = `
      <div class="copy-group">
        <button class="tool-btn" data-act="copy" title="复制">⧉ 复制</button>
        <div class="copy-menu">
          <button data-copy="text">复制纯文本</button>
          <button data-copy="md">复制 Markdown</button>
        </div>
      </div>`;
  if (extra.error) return `<div class="msg-tools">${copyPart}</div>`;
  const speakPart = role === 'assistant' ? `<button class="tool-btn" data-act="speak" title="朗读">🔊</button>` : '';
  return `<div class="msg-tools">${copyPart}
      ${speakPart}
      <button class="tool-btn" data-act="source" title="查看 / 还原 Markdown 原文">&lt;/&gt;</button>
      <button class="tool-btn" data-act="like" title="点赞">👍</button>
      <button class="tool-btn" data-act="dislike" title="差评">👎</button>
    </div>`;
}

function addMsg(role, content, extra = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}${extra.error ? ' error' : ''}`;
  const avatar = role === 'user' ? '我' : 'AI';
  // 兼容纯文本与多模态数组 content（[{type:'text'},{type:'image_url',...}]）
  const { text, images, files } = contentParts(content);
  const mid = extra.mid || '';
  wrap.dataset.mid = mid;
  wrap.dataset.fb = (extra.feedback && extra.feedback.value) || '';

  // 气泡主体：错误消息走纯文本；其余走 Markdown 渲染 + 原文（还原）双视图
  let bodyHtml;
  if (extra.error) {
    bodyHtml = text ? `<div class="bubble plain">${esc(text)}</div>` : '<div class="bubble"></div>';
  } else if (text) {
    bodyHtml = `<div class="bubble md">${window.MD ? MD.render(text) : esc(text)}</div>
      <div class="bubble md-src" hidden><pre>${esc(text)}</pre></div>`;
  } else {
    bodyHtml = '<div class="bubble"></div>';
  }
  const imgsHtml = images
    .map((src) => `<div class="inline-img"><img src="${esc(src)}" alt="消息图片" loading="lazy" /></div>`)
    .join('');
  // 附件渲染：视频内嵌播放器；其他文件为下载链接 chip
  const filesHtml = (files || []).map((f) => {
    if (/^video\//.test(f.mime)) {
      return `<div class="file-part"><video controls preload="metadata" src="${esc(f.url)}"></video><div class="chip-size">${esc(f.name)}</div></div>`;
    }
    return `<div class="file-part"><span class="attach-chip">📎 <a class="chip-name" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></span></div>`;
  }).join('');
  const meta = extra.meta ? `<div class="meta">${extra.meta}</div>` : '';

  // 底部一行：[操作按钮] + 耗时/用量等信息（窄屏自动折行，不挤压正文）
  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="msg-main">
      <div class="msg-body">${bodyHtml}${imgsHtml}${filesHtml}</div>
      <div class="msg-foot">${buildMsgTools(extra, role)}${meta}</div>
    </div>`;
  bindMsgTools(wrap, text);
  paintFeedback(wrap);
  // 恢复该消息的原文视图偏好（仅内存，刷新后回到渲染视图）
  if (mid && msgState.views.get(mid) === 'source' && !extra.error && text) {
    const mdB = wrap.querySelector('.bubble.md');
    const srcB = wrap.querySelector('.bubble.md-src');
    const srcBtn = wrap.querySelector('[data-act="source"]');
    if (mdB && srcB && srcBtn) {
      mdB.setAttribute('hidden', '');
      srcB.removeAttribute('hidden');
      srcBtn.classList.add('active');
    }
  }
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
}

/** 绑定单条消息工具条事件（rawText = 该消息的原始 Markdown 文本） */
function bindMsgTools(wrap, rawText) {
  const tools = wrap.querySelector('.msg-tools');
  if (!tools) return;

  // —— 复制：按钮开合菜单，二选一（纯文本 / Markdown） ——
  const copyBtn = tools.querySelector('[data-act="copy"]');
  const group = tools.querySelector('.copy-group');
  if (copyBtn && group) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = group.classList.contains('open');
      closeAllCopyMenus();
      if (!wasOpen) group.classList.add('open');
    });
    group.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllCopyMenus();
        if (!rawText || !rawText.trim()) { toast('该消息没有文本内容', 'error'); return; }
        copyText(btn.dataset.copy === 'md' ? rawText : MD.toPlain(rawText),
          btn.dataset.copy === 'md' ? 'Markdown' : '纯文本');
      });
    });
  }

  // —— 原文（还原）视图切换 ——
  const srcBtn = tools.querySelector('[data-act="source"]');
  if (srcBtn) {
    srcBtn.addEventListener('click', () => {
      const mdB = wrap.querySelector('.bubble.md');
      const srcB = wrap.querySelector('.bubble.md-src');
      if (!mdB || !srcB) return;
      const showSrc = srcB.hasAttribute('hidden'); // 当前是渲染视图 → 切到原文
      srcB.toggleAttribute('hidden', !showSrc);
      mdB.toggleAttribute('hidden', showSrc);
      srcBtn.classList.toggle('active', showSrc);
      const mid = wrap.dataset.mid;
      if (mid) msgState.views.set(mid, showSrc ? 'source' : 'rendered');
    });
  }

  // —— 朗读（TTS）——
  const speakBtn = tools.querySelector('[data-act="speak"]');
  if (speakBtn) speakBtn.addEventListener('click', () => toggleSpeak(wrap, rawText, speakBtn));

  // —— 点赞 / 差评 ——
  const likeBtn = tools.querySelector('[data-act="like"]');
  const disBtn = tools.querySelector('[data-act="dislike"]');
  if (likeBtn) likeBtn.addEventListener('click', () => submitFeedback(wrap, 'up'));
  if (disBtn) disBtn.addEventListener('click', () => submitFeedback(wrap, 'down'));
}

/** 评价按钮激活态（data-fb: '' | 'up' | 'down'） */
function paintFeedback(wrap) {
  const v = wrap.dataset.fb || '';
  const like = wrap.querySelector('[data-act="like"]');
  const dis = wrap.querySelector('[data-act="dislike"]');
  if (like) like.classList.toggle('active', v === 'up');
  if (dis) dis.classList.toggle('active', v === 'down');
}

/**
 * 提交评价（乐观更新 + 失败回滚）
 * 互斥：同一时刻只有一个激活；再次点击同一按钮 = 取消（value=null）
 */
async function submitFeedback(wrap, value) {
  const mid = wrap.dataset.mid || '';
  if (!mid) { toast('该消息暂不支持评价（缺少消息 ID）', 'error'); return; }
  if (msgState.fbPending.has(mid)) return;
  const prev = wrap.dataset.fb || '';
  const next = prev === value ? '' : value;
  wrap.dataset.fb = next;
  paintFeedback(wrap);
  msgState.fbPending.add(mid);
  try {
    await api(`/api/conversations/${currentConv.id}/messages/${encodeURIComponent(mid)}/feedback`, {
      method: 'PUT',
      body: JSON.stringify({ value: next || null })
    });
    // 同步本地消息数据（切换会话/刷新前不丢状态）
    const m = (currentConv.messages || []).find((x) => x.id === mid);
    if (m) m.feedback = next ? { value: next, at: new Date().toISOString() } : null;
    toast(next === 'up' ? '已点赞' : next === 'down' ? '已记录差评' : '已取消评价', 'success');
  } catch (e) {
    wrap.dataset.fb = prev;
    paintFeedback(wrap);
    toast('评价提交失败：' + e.message, 'error');
  } finally {
    msgState.fbPending.delete(mid);
  }
}

/* ---------- 朗读（TTS 语音合成） ---------- */
let ttsConfig = null;    // 后台 TTS 配置缓存 {enabled, model, voices:[{name,voice}]}
let ttsAudio = null;     // 当前播放的 Audio 实例
let ttsActiveBtn = null; // 当前激活的朗读按钮（用于播放中/停止状态切换）

async function ensureTtsConfig() {
  if (ttsConfig) return ttsConfig;
  try {
    ttsConfig = await api('/api/tts/config');
  } catch (_) {
    ttsConfig = { enabled: false, model: '', voices: [] };
  }
  return ttsConfig;
}

/** 停止当前朗读，恢复按钮状态 */
function stopSpeak() {
  if (ttsAudio) {
    try { ttsAudio.pause(); } catch (_) {}
    ttsAudio = null;
  }
  if (ttsActiveBtn) {
    ttsActiveBtn.textContent = '🔊';
    ttsActiveBtn.title = '朗读';
    ttsActiveBtn.classList.remove('active');
    ttsActiveBtn = null;
  }
}

/**
 * 朗读/停止切换：取消息纯文本 → 调 /api/tts/synthesize → <audio> 播放。
 * 支持音色选择：若配置了多个音色，先弹出音色选择；单音色直接播放。
 */
async function toggleSpeak(wrap, rawText, btn) {
  // 正在播放同一条：点击 = 停止
  if (ttsActiveBtn === btn) { stopSpeak(); return; }
  // 播放别的消息前先停掉当前
  stopSpeak();

  const text = rawText ? MD.toPlain(rawText).trim() : '';
  if (!text) { toast('该消息没有可朗读的文本', 'error'); return; }

  const cfg = await ensureTtsConfig();
  if (!cfg || !cfg.enabled) {
    toast('朗读功能未启用，请联系管理员在后台「语音合成」配置并开启', 'error');
    return;
  }
  const voices = Array.isArray(cfg.voices) ? cfg.voices.filter((v) => v && v.voice) : [];

  let voice = '';
  if (voices.length > 1) {
    // 多音色：弹出选择（内联下拉）
    voice = await pickVoice(voices);
    if (voice === null) return; // 用户取消
  } else if (voices.length === 1) {
    voice = voices[0].voice;
  }
  // 0 个音色：voice 留空，服务端回落 'alloy' 或默认

  // 进入加载态
  btn.textContent = '⏳';
  btn.classList.add('active');
  btn.title = '合成中…';
  ttsActiveBtn = btn;

  try {
    const resp = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice })
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    ttsAudio = audio;
    btn.textContent = '⏹';
    btn.title = '停止朗读';
    audio.onended = () => { URL.revokeObjectURL(url); stopSpeak(); };
    audio.onerror = () => { URL.revokeObjectURL(url); toast('音频播放失败', 'error'); stopSpeak(); };
    await audio.play();
  } catch (e) {
    toast('朗读失败：' + e.message, 'error');
    stopSpeak();
  }
}

/** 多音色选择：临时在按钮旁弹出下拉菜单，返回选中的 voice（取消返回 null） */
function pickVoice(voices) {
  return new Promise((resolve) => {
    const menu = document.createElement('div');
    menu.className = 'voice-menu';
    menu.innerHTML = voices.map((v, i) =>
      `<button type="button" data-vidx="${i}">${esc(v.name || v.voice)}</button>`).join('');
    document.body.appendChild(menu);

    // 定位到按钮下方
    const r = (ttsActiveBtn && ttsActiveBtn.getBoundingClientRect()) || null;
    if (r) {
      menu.style.position = 'fixed';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.left = r.left + 'px';
    }

    const cleanup = () => { menu.remove(); document.removeEventListener('click', onDoc); };
    const onDoc = (e) => { if (!menu.contains(e.target)) { cleanup(); resolve(null); } };
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vidx]');
      if (!b) return;
      const v = voices[Number(b.dataset.vidx)];
      cleanup();
      resolve(v ? v.voice : '');
    });
    document.addEventListener('click', onDoc);
  });
}

/* ---------- 复制（剪贴板 API + execCommand 降级） ---------- */
async function copyText(text, label) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
    // 降级：隐藏 textarea + execCommand（非安全上下文 / 权限被拒时）
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
  }
  toast(ok ? `已复制${label}` : '复制失败，请手动选择文本复制', ok ? 'success' : 'error');
}

/** 关闭所有打开中的复制下拉菜单 */
function closeAllCopyMenus() {
  document.querySelectorAll('.copy-group.open').forEach((g) => g.classList.remove('open'));
}
document.addEventListener('click', closeAllCopyMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllCopyMenus(); });

function setBusy(busy, hint = '') {
  sending = busy;
  // 发送键在等待期间变为「停止」键：一点即中止本次请求
  if (busy) {
    els.sendBtn.textContent = '⏹ 停止';
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add('danger');
    els.sendBtn.title = '停止当前请求（服务端调用仍会完成）';
  } else {
    els.sendBtn.textContent = '发送';
    els.sendBtn.disabled = isViewer; // 只读成员保持禁用
    els.sendBtn.classList.remove('danger');
    els.sendBtn.title = '';
  }
  els.statusLine.innerHTML = busy ? `<span class="spinner"></span> ${hint}` : '';
  if (busy) {
    const t = document.createElement('div');
    t.className = 'typing';
    t.id = 'typingIndicator';
    t.innerHTML = '<span class="spinner"></span> 模型思考中…';
    els.messages.appendChild(t);
    els.messages.scrollTop = els.messages.scrollHeight;
  } else {
    const t = document.getElementById('typingIndicator');
    t && t.remove();
  }
}

/** 停止当前发送：中止 fetch 等待（服务端上游调用仍会跑完并计费，属非流式接口的固有行为） */
function abortChat() {
  if (chatAbort) chatAbort.abort();
}

/** 在对话框里放一条「已切换模型」提示（同一条会话内切换配置时调用；发送下一条消息或再次切换时清除） */
function showModelSwitchNotice(label) {
  removeModelSwitchNotice();
  const div = document.createElement('div');
  div.className = 'model-switch-notice';
  div.id = 'modelSwitchNotice';
  div.textContent = `🔄 已切换模型：${label}（下一条消息起使用新模型）`;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  modelSwitchNotice = div;
}

function removeModelSwitchNotice() {
  if (modelSwitchNotice) { modelSwitchNotice.remove(); modelSwitchNotice = null; }
  const old = document.getElementById('modelSwitchNotice');
  if (old) old.remove();
}

// 当前会话用于上下文的对话历史（仅 user/assistant，system 由后端按配置注入）
// 兼容多模态消息：数组 content 原样保留（图片部分由后端内联为 base64 后发给上游）
function convoHistory() {
  const list = [];
  if (currentConv && Array.isArray(currentConv.messages)) {
    for (const m of currentConv.messages) {
      if (m.role === 'system') continue;
      if (typeof m.content === 'string' && m.content.trim()) list.push({ role: m.role, content: m.content });
      else if (Array.isArray(m.content) && m.content.length) list.push({ role: m.role, content: m.content });
    }
  }
  return list;
}

async function persistMessages(msgs) {
  if (!currentConv) return;
  try {
    currentConv = await api(`/api/conversations/${currentConv.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages: msgs, configId: currentConfigId || undefined })
    });
    // 把刚入库消息的 id 回写到对应 DOM 节点（点赞/差评/原文切换依赖 data-mid）
    if (Array.isArray(msgs) && msgs.length) syncNewMsgIds(currentConv, msgs.length);
    const meta = conversations.find((c) => c.id === currentConv.id);
    if (meta) { meta.count = currentConv.messages.length; meta.updatedAt = currentConv.updatedAt; }
    renderConvList();
  } catch (e) {
    toast('消息保存失败：' + e.message, 'error');
  }
}

/** persistMessages 后：把最后 count 条入库消息的 id 同步到消息列表最后 count 个 .msg 节点 */
function syncNewMsgIds(conv, count) {
  const nodes = els.messages.querySelectorAll('.msg');
  const fresh = (conv.messages || []).slice(-count);
  for (let k = 0; k < count; k++) {
    const node = nodes[nodes.length - count + k];
    if (node && fresh[k] && fresh[k].id) node.dataset.mid = fresh[k].id;
  }
}

/* ================= 发送 ================= */
/** 组装本次发送的用户消息 content：纯文本 → 字符串；带图片 → 多模态数组（图片用 /uploads URL） */
function buildUserContent(text, images) {
  const done = images.filter((im) => im.status === 'done' && im.url);
  if (!done.length) return text;
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const im of done) {
    parts.push({ type: 'image_url', image_url: { url: im.url } });
  }
  return parts;
}

async function send() {
  const text = els.input.value.trim();
  if (sending) return;
  if (!text && !pendingImages.length) return;
  if (!currentConfigId) {
    toast('请先在顶部选择模型配置（或到后台管理添加）', 'error');
    return;
  }
  if (!currentConv) {
    await newConv();
    if (!currentConv) return;
  }

  // 图片状态检查：上传中 → 等待；失败 → 阻止发送并提示重试/移除
  if (pendingImages.some((im) => im.status === 'uploading')) {
    toast('图片正在上传中，请稍候…', 'error');
    return;
  }
  if (pendingImages.some((im) => im.status === 'error' || (im.status !== 'done'))) {
    toast('有图片上传失败，请点击缩略图重试或先移除', 'error');
    return;
  }

  if (pendingAttachments.some((a) => a.status === 'uploading')) {
    toast('附件正在上传中，请稍候…', 'error');
    return;
  }

  const attachNote = pendingAttachments
    .filter((a) => a.status === 'done')
    .map((a) => `[附件: ${a.name}]`)
    .join(' ');
  const userContent = buildUserContent(attachNote ? (text ? text + '\n\n' + attachNote : attachNote) : text, pendingImages);

  els.input.value = '';
  autoGrow();
  pendingImages = []; // 先清空待发列表（内容已并入消息体）
  renderAttachRow();
  removeModelSwitchNotice(); // 切换提示已使命（下一条消息起用新模型）
  addMsg('user', userContent);

  const history = convoHistory();
  history.push({ role: 'user', content: userContent });

  chatAbort = new AbortController();
  setBusy(true, '服务进行中…');
  try {
    /* —— 工作流模式：按编排链路执行，不走普通对话 —— */
    if (responseMode === 'workflow') {
      if (!wfModeId) {
        addMsg('assistant', '请先在输入框下方的 🧩 下拉里选择一个要运行的工作流（召唤智能体时会自动带上它绑定的工作流）', { error: true });
        await persistMessages([{ role: 'user', content: userContent }]);
        return;
      }
      const wr = await api(`/api/workflows/${wfModeId}/run`, {
        method: 'POST',
        signal: chatAbort.signal,
        body: JSON.stringify({ query: text })
      });
      const stepsNote = (wr.steps && wr.steps.length) ? `${wr.steps.length} 步` : '完成';
      addMsg('assistant', wr.output || '(工作流无输出)', {
        meta: `🧩 工作流执行 · ${stepsNote} · ${wr.latencyMs}ms`
      });
      await persistMessages([
        { role: 'user', content: userContent },
        { role: 'assistant', content: wr.output || '' }
      ]);
      if (currentConv && currentConv.title === '新对话') {
        const t = (text || '').trim().replace(/\s+/g, ' ').slice(0, 18) || '工作流对话';
        try { await api(`/api/conversations/${currentConv.id}`, { method: 'PUT', body: JSON.stringify({ title: t }) }); } catch (_) {}
        if (currentConv) currentConv.title = t;
        renderConvList();
      }
      return;
    }

    // 应用参数变量必填校验（有应用且定义了变量时）
    const av = collectAgentVars();
    if (av.missing && av.missing.length) {
      toast('请先填写必填参数：' + av.missing.join('、'), 'error');
      return;
    }

    const data = await api('/api/chat', {
      method: 'POST',
      signal: chatAbort.signal,
      body: JSON.stringify({
        configId: currentConfigId,
        messages: history,
        // 应用（智能体）归属：服务端按应用配置应用绑定模型/温度/回复上限/关联知识库
        agentId: currentAgent ? currentAgent.id : undefined,
        variables: av.values || undefined,
        // 参数工具栏的本次会话设置（覆盖配置默认值，含显式关闭）
        enableThinking: params.enableThinking,
        reasoningEffort: params.reasoningEffort,
        webSearch: params.webSearch,
        // 知识库检索注入（开启且已选库才传；后端仅对登录员工生效）
        // 知识库随智能体走：普通对话不注入（避免沿用上次智能体的库）
        kbId: currentAgent && params.useKb && params.kbId ? params.kbId : undefined,
        systemPrompt: params.systemPrompt
      })
    });
    const r = data.result;
    const sec = ((data.latencyMs || 0) / 1000).toFixed(1);
    const u = r.usage || {};
    // 思考型模型可能只返回 reasoning_content；工具调用时 content 可能为空——分别回退展示
    const replyText = r.content
      || (r.reasoning_content ? `（模型未生成正文，以下为思考过程）\n${r.reasoning_content}` : '')
      || (Array.isArray(r.tool_calls) && r.tool_calls.length
        ? `（模型发起工具调用）\n${JSON.stringify(r.tool_calls, null, 2)}`
        : '');
    // 补充展示文档新增的响应明细：结束原因 / 工具调用 / 推理 token
    const bits = [];
    if (r.finish_reason && r.finish_reason !== 'stop') bits.push(`结束原因 ${esc(r.finish_reason)}`);
    if (Array.isArray(r.tool_calls) && r.tool_calls.length) {
      bits.push(`工具调用 ${esc(r.tool_calls.map((t) => t.function && t.function.name).filter(Boolean).join(', ') || '未知')}`);
    }
    if (u.reasoning_tokens) bits.push(`推理 ${u.reasoning_tokens} tokens`);
    if (u.cached_tokens) bits.push(`缓存命中 ${u.cached_tokens} tokens`);
    const metaExtra = bits.length ? ` · ${bits.join(' · ')}` : '';
    addMsg('assistant', replyText || '(模型未返回正文)', {
      meta: `耗时 ${sec}s · 输入 ${u.prompt_tokens ?? '-'} · 输出 ${u.completion_tokens ?? '-'} · 总 ${u.total_tokens ?? '-'} tokens · 模型 ${esc(r.model_id || '')}${metaExtra}`
    });
    await persistMessages([
      { role: 'user', content: userContent },
      { role: 'assistant', content: r.content || '' }
    ]);
    // 自动以首条问题命名该对话（纯图片消息时用「图片对话」）
    if (currentConv && (currentConv.title === '新对话')) {
      const t = (text || '').trim().replace(/\s+/g, ' ').slice(0, 18) || (userContent !== text ? '图片对话' : '新对话');
      try { await api(`/api/conversations/${currentConv.id}`, { method: 'PUT', body: JSON.stringify({ title: t }) }); } catch (_) {}
      if (currentConv) currentConv.title = t;
      renderConvList();
    }
  } catch (e) {
    await persistMessages([{ role: 'user', content: userContent }]);
    if (e && e.name === 'AbortError') {
      // 用户点了「停止」：保留已发送的用户消息，标注中止
      addMsg('assistant', '已停止生成', { meta: '已手动停止；服务端调用仍会完成并计费' });
    } else {
      addMsg('assistant', `调用失败：${e.message}`, { error: true });
    }
  } finally {
    chatAbort = null;
    setBusy(false);
  }
}

els.sendBtn.addEventListener('click', () => {
  if (sending) { abortChat(); return; } // 等待期间发送键即停止键
  send();
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 220) + 'px';
}
els.input.addEventListener('input', autoGrow);

// 清空当前会话
els.clearChatBtn.addEventListener('click', async () => {
  if (!currentConv) return;
  if (!confirm('清空当前会话的所有消息？该操作不可恢复。')) return;
  try {
    currentConv = await api(`/api/conversations/${currentConv.id}/messages`, { method: 'DELETE' });
    const meta = conversations.find((c) => c.id === currentConv.id);
    if (meta) { meta.count = 0; meta.updatedAt = currentConv.updatedAt; }
    renderConvList();
    renderMessages();
    toast('本会话已清空', 'success');
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
});

/* ================= 分享对话（快照 + 只读链接） ================= */

function openShareModal() {
  if (!currentConv) { toast('请先选择一个对话', 'error'); return; }
  const hasMsg = (currentConv.messages || []).some((m) => m.role !== 'system');
  if (!hasMsg) { toast('当前对话还没有消息，无法分享', 'error'); return; }
  els.shareLinkBox.style.display = 'none';
  els.shareLinkInput.value = '';
  els.shareModal.style.display = '';
  loadShareList();
}

function closeShareModal() {
  els.shareModal.style.display = 'none';
}

async function loadShareList() {
  if (!currentConv) return;
  els.shareList.innerHTML = '<div class="share-empty">加载中…</div>';
  try {
    const list = await api(`/api/conversations/${currentConv.id}/shares`);
    renderShareList(Array.isArray(list) ? list : []);
  } catch (e) {
    els.shareList.innerHTML = `<div class="share-empty">加载失败：${esc(e.message)}</div>`;
  }
}

function renderShareList(list) {
  if (!list.length) {
    els.shareList.innerHTML = '<div class="share-empty">还没有分享链接，点击上方按钮生成</div>';
    return;
  }
  els.shareList.innerHTML = '';
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'share-row';
    const exp = s.expiresAt ? `到期 ${esc(shortTime(s.expiresAt))}` : '永久有效';
    row.innerHTML = `
      <div class="share-row-main">
        <div class="share-row-token" title="${esc(s.token)}">/s/${esc(s.token.slice(0, 8))}…</div>
        <div class="share-row-sub">创建于 ${esc(shortTime(s.createdAt))} · ${exp} · ${s.messageCount} 条消息</div>
      </div>
      <button class="btn btn-sm" data-act="copy-link">复制</button>
      <button class="btn btn-sm danger" data-act="revoke">撤销</button>`;
    row.querySelector('[data-act="copy-link"]').addEventListener('click', () => {
      copyText(`${location.origin}/s/${s.token}`, '分享链接');
    });
    row.querySelector('[data-act="revoke"]').addEventListener('click', async () => {
      if (!confirm('撤销后该链接立即失效，确定撤销？')) return;
      try {
        await api(`/api/conversations/${currentConv.id}/shares/${encodeURIComponent(s.token)}`, { method: 'DELETE' });
        toast('已撤销分享', 'success');
        loadShareList();
      } catch (e) {
        toast('撤销失败：' + e.message, 'error');
      }
    });
    els.shareList.appendChild(row);
  }
}

if (els.shareBtn) els.shareBtn.addEventListener('click', openShareModal);
if (els.shareModalClose) els.shareModalClose.addEventListener('click', closeShareModal);
if (els.shareModal) els.shareModal.addEventListener('click', (e) => {
  if (e.target === els.shareModal) closeShareModal(); // 点遮罩关闭
});
if (els.shareCreateBtn) els.shareCreateBtn.addEventListener('click', async () => {
  if (!currentConv) return;
  try {
    els.shareCreateBtn.disabled = true;
    const days = Number(els.shareExpiry.value);
    const d = await api(`/api/conversations/${currentConv.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ expiresInDays: days })
    });
    els.shareLinkInput.value = `${location.origin}${d.url}`;
    els.shareLinkBox.style.display = '';
    els.shareLinkInput.select();
    toast('分享链接已生成', 'success');
    loadShareList();
  } catch (e) {
    toast('生成分享失败：' + e.message, 'error');
  } finally {
    els.shareCreateBtn.disabled = false;
  }
});
if (els.shareLinkCopyBtn) els.shareLinkCopyBtn.addEventListener('click', () => {
  const v = els.shareLinkInput.value;
  if (v) copyText(v, '分享链接');
});

/* ---------- 工作台访客密码：登出按钮（功能开启时才显示） ---------- */
async function initWorkbenchAuth() {
  try {
    const resp = await fetch('/api/workbench/status');
    const d = await resp.json().catch(() => ({}));
    if (d && d.ok && d.data && d.data.enabled) {
      els.wbLogoutBtn.style.display = '';
    }
  } catch (_) { /* 服务异常时保持隐藏 */ }
}

els.wbLogoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/workbench/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (_) { /* 即使请求失败也跳登录页 */ }
  location.href = '/login';
});

/* ---------- 团队账号：员工身份 / 员工中心入口 / 退出登录（登录态才显示） ---------- */
/* ---------- 聊天区壁纸 + 毛玻璃 ---------- */
let wallpaperLayer = null;
function applyWallpaper(url, blur) {
  // 复用/创建壁纸层（插到 body 最前，保证在所有内容之下）
  if (!wallpaperLayer) {
    wallpaperLayer = document.createElement('div');
    wallpaperLayer.className = 'chat-wallpaper';
    document.body.insertBefore(wallpaperLayer, document.body.firstChild);
  }
  if (url) {
    wallpaperLayer.style.backgroundImage = `url("${String(url).replace(/"/g, '')}")`;
    wallpaperLayer.style.display = '';
    wallpaperLayer.classList.toggle('blur', !!blur);
  } else {
    wallpaperLayer.style.backgroundImage = 'none';
    wallpaperLayer.style.display = 'none';
    wallpaperLayer.classList.remove('blur');
  }
}

async function initTeamAuth() {
  try {
    const resp = await fetch('/api/auth/me', { headers: { 'Content-Type': 'application/json' } });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok && d.ok && d.data && d.data.user) {
      const u = d.data.user;
      currentUser = u;
      els.teamLogoutBtn.style.display = '';
      els.meCenterBtn.style.display = '';
      // 应用个性化壁纸（聊天区背景 + 毛玻璃）
      applyWallpaper(u.wallpaper, u.wallpaperBlur);
      // 顶栏展示身份
      const roleLabel = { owner: '超管', admin: '管理员', member: '成员', viewer: '只读' }[u.role] || u.role;
      els.teamUserTag.textContent = `${u.displayName || u.username} · ${roleLabel}`;
      els.teamUserTag.style.display = '';
      // 后台管理仅 owner/admin 可见（member 点进去也会被弹回，干脆隐藏）
      if (u.role !== 'owner' && u.role !== 'admin') {
        els.adminLink.style.display = 'none';
      }
      // viewer 为只读角色：禁用发送
      if (u.role === 'viewer') {
        isViewer = true;
        els.sendBtn.disabled = true;
        els.sendBtn.title = '只读成员不能发起对话，请联系管理员调整角色';
        els.input.disabled = true;
        els.input.placeholder = '只读成员不能发起对话（可查看历史会话）';
      }
      // 身份就绪后重渲染应用/知识库网格，让「本人可管理」的编辑/删除按钮正确显示
      renderAppsGrid();
      if (kbList.length) loadKbView();
    }
  } catch (_) { /* 服务异常时保持隐藏 */ }
}

els.teamLogoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (_) { /* 即使请求失败也跳登录页 */ }
  location.href = '/team-login';
});

/* ---------- 侧栏抽屉（聊天图标 / ☰ 唤出，选中会话后收起，Esc / 点击遮罩关闭） ---------- */
(function initSidebarDrawer() {
  const drawer = document.getElementById('sideDrawer');
  const backdrop = document.getElementById('sideDrawerBackdrop');
  const mobileBackdrop = document.getElementById('sidebarBackdrop');
  const toggle = document.getElementById('sidebarToggle');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  if (!drawer) return;

  function open() {
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('show');
    if (mobileBackdrop) mobileBackdrop.classList.add('show');
  }
  function close() {
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
    if (mobileBackdrop) mobileBackdrop.classList.remove('show');
  }

  if (toggle) toggle.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
  if (mobileBackdrop) mobileBackdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // 点击图标栏「聊天」时：已在该视图则切换抽屉，否则切换到聊天视图并展开抽屉
  const chatRailBtn = document.querySelector('.rail-item[data-wsview="chat"]');
  if (chatRailBtn) {
    chatRailBtn.addEventListener('click', () => {
      if (chatRailBtn.classList.contains('active')) {
        drawer.classList.contains('open') ? close() : open();
      } else {
        switchWsView('chat');
        open();
      }
    });
  }

  // 选中会话 / 切换配置后自动收起
  document.getElementById('convList') && document.getElementById('convList').addEventListener('click', (e) => {
    if (e.target.closest('.conv-item') || e.target.closest('.conv-del')) close();
  });
  document.getElementById('configSelect') && document.getElementById('configSelect').addEventListener('change', close);
})();

/* ================= 员工自建应用（智能体）与知识库 =================
 * 与后台创建方式一致：智能体（名称/emoji/描述/开场白/预设问题/角色设定/可见性）、
 * 知识库（名称/备注/可见性）。员工仅能编辑/删除本人创建的（owner/admin 不受限）。
 */
/* ---------- 应用配置：模型/知识库/工作流下拉选项（打开时懒加载） ---------- */
let agentModalOptions = { configs: [], kbs: [], workflows: [] };
async function loadAgentModalOptions() {
  try {
    const [configs, kbs, workflows] = await Promise.all([api('/api/configs'), api('/api/kb'), api('/api/workflows')]);
    agentModalOptions.configs = Array.isArray(configs) ? configs : [];
    agentModalOptions.kbs = Array.isArray(kbs) ? kbs : [];
    agentModalOptions.workflows = Array.isArray(workflows) ? workflows : [];
  } catch (e) { /* 静默：下拉保持空 */ }
}
function fillAgentModalSelects(agent) {
  const cfgSel = $('a_configId');
  const kbSel = $('a_kbId');
  const wfSel = $('a_wfId');
  if (cfgSel) cfgSel.innerHTML = '<option value="">（跟随全局调度）</option>'
    + agentModalOptions.configs.map((c) => `<option value="${esc(c._id)}" ${agent && agent.configId === c._id ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
  if (kbSel) kbSel.innerHTML = '<option value="">（不关联）</option>'
    + agentModalOptions.kbs.map((k) => `<option value="${esc(k.id)}" ${agent && agent.kbId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  if (wfSel) wfSel.innerHTML = '<option value="">（不绑定）</option>'
    + agentModalOptions.workflows.map((w) => `<option value="${esc(w.id)}" ${agent && agent.wfId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
}

/* ---------- 工具（插件 + MCP）加载 ---------- */
async function loadAgentToolOptions(agent) {
  const pluginBox = $('a_pluginBox');
  const mcpBox = $('a_mcpBox');
  const selectedPlugins = new Set(agent && Array.isArray(agent.plugins) ? agent.plugins : []);
  const selectedMcp = agent && Array.isArray(agent.mcpTools) ? agent.mcpTools : [];
  if (pluginBox) {
    try {
      const plugins = await api('/api/plugins');
      const installed = plugins.filter((p) => p.installed);
      if (!installed.length) {
        pluginBox.innerHTML = '<div class="hint">暂无已安装插件：请先由管理员在「插件市场」安装并启用。</div>';
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
  }
  if (mcpBox) {
    try {
      const mcps = await api('/api/mcp');
      const enabled = mcps.filter((m) => m.enabled);
      if (!enabled.length) {
        mcpBox.innerHTML = '<div class="hint">暂无已启用的 MCP 服务：请先由管理员配置并测试。</div>';
        return;
      }
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

/* ---------- 智能体编辑页页签切换 ---------- */
function switchAgentTab(name) {
  document.querySelectorAll('#agentModal [data-agenttab]').forEach((b) => b.classList.toggle('active', b.dataset.agenttab === name));
  document.querySelectorAll('#agentModal [data-agentpane]').forEach((p) => { p.style.display = p.dataset.agentpane === name ? '' : 'none'; });
}

function openAgentModal(agent) {
  if (!els.agentModal) return;
  $('a_id').value = agent ? agent.id : '';
  els.agentModalTitle.textContent = agent ? `编辑智能体 · ${agent.name}` : '新建智能体';
  $('agentPageIcon').textContent = agent ? (agent.emoji || '🤖') : '🤖';
  if ($('agentDeleteBtn')) $('agentDeleteBtn').style.display = agent ? '' : 'none';
  switchAgentTab('bot');
  els.a_name.value = agent ? agent.name : '';
  if (window.iconPickerSet) iconPickerSet(agent);
  els.a_desc.value = agent ? (agent.desc || '') : '';
  els.a_systemPrompt.value = agent ? (agent.systemPrompt || '') : '';
  els.a_welcome.value = agent ? (agent.welcome || '') : '';
  els.a_suggests.value = agent && Array.isArray(agent.suggests) ? agent.suggests.join('\n') : '';
  els.a_visibility.value = agent ? agent.visibility : 'public';
  const suggestNextEl = $('a_suggestNext');
  if (suggestNextEl) suggestNextEl.checked = agent ? (agent.suggestNext !== false) : true;
  loadAgentModalOptions().then(() => fillAgentModalSelects(agent));
  loadAgentToolOptions(agent);
  if ($('a_temperature')) $('a_temperature').value = agent && agent.temperature !== null && agent.temperature !== undefined ? agent.temperature : '';
  if ($('a_maxTokens')) $('a_maxTokens').value = agent && agent.maxTokens ? agent.maxTokens : '';
  if ($('a_kbMaxRefs')) $('a_kbMaxRefs').value = agent && agent.kbMaxRefs ? agent.kbMaxRefs : 5;
  if ($('a_kbMinScore')) $('a_kbMinScore').value = agent && agent.kbMinScore ? agent.kbMinScore : '';
  if ($('a_debugOut')) $('a_debugOut').innerHTML = '<div class="hint">输入问题后点击「发送」，对该应用进行调试预览。</div>';
  if ($('a_debugQuery')) $('a_debugQuery').value = '';
  els.agentModal.style.display = 'flex';
}

function closeAgentModal() {
  if (els.agentModal) els.agentModal.style.display = 'none';
}

/* ---------- 调试预览 ---------- */
async function debugAgentChat() {
  const out = $('a_debugOut');
  const q = $('a_debugQuery').value.trim();
  if (!q) { toast('请输入调试问题', 'error'); return; }
  const id = $('a_id').value;
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

async function deleteAgent(a) {
  if (!confirm(`删除智能体「${a.name}」？删除后工作台将不再显示。`)) return;
  try {
    await api(`/api/agents/${a.id}`, { method: 'DELETE' });
    toast('智能体已删除', 'success');
    await loadAgentsList();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

function openKbCreateModal(kb) {
  if (!els.kbCreateModal) return;
  els.kc_id.value = kb ? kb.id : '';
  els.kbCreateTitle.textContent = kb ? `编辑知识库：${kb.name}` : '新建知识库';
  els.kc_name.value = kb ? kb.name : '';
  els.kc_remark.value = kb ? (kb.remark || '') : '';
  els.kc_visibility.value = kb ? kb.visibility : 'all';
  els.kbCreateModal.style.display = 'grid';
}

function closeKbCreateModal() {
  if (els.kbCreateModal) els.kbCreateModal.style.display = 'none';
}

async function deleteKb(k) {
  if (!confirm(`删除知识库「${k.name}」？其全部分段与文件将一并删除。`)) return;
  try {
    await api(`/api/kb/${k.id}`, { method: 'DELETE' });
    toast('知识库已删除', 'success');
    await loadKbView();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

// —— 事件绑定（元素存在才绑定，避免访客/旧页面报错）——
if (els.addAgentBtn) els.addAgentBtn.addEventListener('click', () => openAgentModal(null));
if (els.saveAgentBtn) els.saveAgentBtn.addEventListener('click', async () => {
  const id = els.a_id.value;
  const payload = {
    name: els.a_name.value.trim(),
    emoji: els.a_emoji.value.trim() || '🤖',
    icon: els.a_icon.value.trim(),
    desc: els.a_desc.value.trim(),
    systemPrompt: els.a_systemPrompt.value.trim(),
    welcome: els.a_welcome.value.trim(),
    suggests: els.a_suggests.value.split('\n').map((s) => s.trim()).filter(Boolean),
    suggestNext: $('a_suggestNext') ? $('a_suggestNext').checked : true,
    visibility: els.a_visibility.value,
    configId: $('a_configId') ? $('a_configId').value : '',
    temperature: $('a_temperature') && $('a_temperature').value === '' ? null : Number($('a_temperature').value),
    maxTokens: $('a_maxTokens') && $('a_maxTokens').value === '' ? null : parseInt($('a_maxTokens').value, 10),
    kbId: $('a_kbId') ? $('a_kbId').value : '',
    kbMaxRefs: $('a_kbMaxRefs') ? (parseInt($('a_kbMaxRefs').value, 10) || 5) : 5,
    kbMinScore: $('a_kbMinScore') && $('a_kbMinScore').value === '' ? 0 : Number($('a_kbMinScore').value),
    wfId: $('a_wfId') ? $('a_wfId').value : '',
    ...collectAgentTools()
  };
  try {
    if (id) {
      await api(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('智能体已更新', 'success');
    } else {
      const r = await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
      els.a_id.value = r.id; // 记录新 ID，便于调试预览
      toast('智能体已创建', 'success');
    }
    closeAgentModal();
    await loadAgentsList();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// 智能体编辑页：页签切换 / 返回 / 删除 / 调试预览
document.querySelectorAll('#agentModal [data-agenttab]').forEach((b) => b.addEventListener('click', () => switchAgentTab(b.dataset.agenttab)));
if ($('agentBackBtn')) $('agentBackBtn').addEventListener('click', () => { closeAgentModal(); loadAgentsList(); });
if ($('agentDeleteBtn')) $('agentDeleteBtn').addEventListener('click', async () => {
  const id = els.a_id.value;
  if (!id) return;
  if (!confirm('删除该智能体？工作台将不再显示。')) return;
  try {
    await api(`/api/agents/${id}`, { method: 'DELETE' });
    toast('智能体已删除', 'success');
    closeAgentModal();
    await loadAgentsList();
  } catch (e2) {
    toast('删除失败：' + e2.message, 'error');
  }
});
if ($('a_debugBtn')) $('a_debugBtn').addEventListener('click', debugAgentChat);
if ($('a_debugQuery')) $('a_debugQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); debugAgentChat(); } });

if (els.addKbBtn) els.addKbBtn.addEventListener('click', () => openKbCreateModal(null));
if (els.saveKbBtn) els.saveKbBtn.addEventListener('click', async () => {
  const id = els.kc_id.value;
  const payload = {
    name: els.kc_name.value.trim(),
    remark: els.kc_remark.value.trim(),
    visibility: els.kc_visibility.value
  };
  try {
    if (id) {
      await api(`/api/kb/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('知识库已更新', 'success');
    } else {
      await api('/api/kb', { method: 'POST', body: JSON.stringify(payload) });
      toast('知识库已创建', 'success');
    }
    closeKbCreateModal();
    await loadKbView();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
});

// 弹窗关闭（data-close 与遮罩点击）
document.querySelectorAll('[data-close="kbCreateModal"]').forEach((b) => b.addEventListener('click', closeKbCreateModal));
if (els.kbCreateModal) els.kbCreateModal.addEventListener('click', (e) => { if (e.target === els.kbCreateModal) closeKbCreateModal(); });

/* ================= 员工端知识库完整管理（6 页签，复用后台逻辑，走 /api/kb） ================= */
const km$ = (id) => document.getElementById(id);
let kmCurrent = null;              // 当前知识库详情（含 files/members/cfg）
let kmChunkState = { offset: 0, fileId: '', q: '', total: 0, items: [] };
const KM_CHUNK_PAGE = 20;
const KM_TYPE_LABELS = { text: '分段', qa: '问答', data: '数据' };
const KM_MODE_HINTS = {
  text: { hint: '按空行分段落聚合切分，相邻段带重叠；适合手册 / 笔记 / 长文资料。', fileHint: '单文件 ≤2MB 文本；按「配置」页签中的分段参数自动切分。', placeholder: '粘贴资料全文；按空行分段，系统自动切成知识分段。', accept: '.txt,.md,.markdown,.log', fileBtn: '📎 上传文件（txt / md，可多选）' },
  qa: { hint: '按空行分隔问答块，块内用「问：」「答：」标注（Q:/A: 亦可）；每个问答对一个分段，适合 FAQ 语料。', fileHint: '单文件 ≤2MB 文本；每个问答对独立成段，不按长度切分。', placeholder: '问：退货政策是什么？\n答：签收 7 天内可无理由退货……\n\n（空行分隔下一组问答）', accept: '.txt,.md,.markdown,.log', fileBtn: '📎 上传问答文件（txt / md，可多选）' },
  data: { hint: '粘贴或上传 CSV 表格（首行为表头）；每行一条记录，首列为检索索引键。', fileHint: '单文件 ≤2MB 文本；CSV 或制表符分隔，首行必须为表头。', placeholder: '工号,姓名,部门\n1001,张三,技术部\n1002,李四,市场部', accept: '.csv,.txt,.tsv', fileBtn: '📎 上传 CSV 数据文件（可多选）' }
};
let kmImportMode = 'text';
let kmChunkEditingId = null;
let kmUserMap = {};              // id -> 用户（成员授权下拉用）
let kmUserMapLoaded = false;

function kmSwitchTab(name) {
  document.querySelectorAll('#kmTabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.kmtab === name));
  document.querySelectorAll('#kbManageModal [data-kmpane]').forEach((p) => { p.style.display = p.dataset.kmpane === name ? '' : 'none'; });
}

async function openKbManageModal(id) {
  try {
    kmCurrent = await api(`/api/kb/${id}`);
    km$('kmTitle').textContent = `知识库管理 · ${kmCurrent.name}`;
    kmSwitchTab('files');
    const cfg = kmCurrent.cfg || {};
    km$('kmCfgChunkSize').value = cfg.chunkSize ?? 500;
    km$('kmCfgOverlap').value = cfg.overlap ?? 50;
    km$('kmCfgTopK').value = cfg.topK ?? 5;
    km$('kmCfgName').value = kmCurrent.name || '';
    km$('kmCfgRemark').value = kmCurrent.remark || '';
    const vis = kmCurrent.visibility === 'private' ? 'private' : 'all';
    const visRadio = document.querySelector(`#kbManageModal input[name="kmVisibility"][value="${vis}"]`);
    if (visRadio) visRadio.checked = true;
    await kmLoadModelOptions(kmCurrent.modelId);
    await kmEnsureUserMap();
    kmRenderMemberOptions();
    kmChunkState = { offset: 0, fileId: '', q: '', total: 0, items: [] };
    km$('kmChunkSearch').value = '';
    const fileSel = km$('kmChunkFileFilter');
    fileSel.innerHTML = '<option value="">全部文件</option>' + (kmCurrent.files || []).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    kmRenderFilesTable();
    kmRenderMembers();
    kmLoadChunks();
    km$('kbManageModal').style.display = 'flex';
  } catch (e) {
    toast('加载知识库失败：' + e.message, 'error');
  }
}

function kmCloseManage() { const m = km$('kbManageModal'); if (m) m.style.display = 'none'; loadKbView(); }

async function kmReload() {
  kmCurrent = await api(`/api/kb/${kmCurrent.id}`);
  kmRenderFilesTable();
  kmRenderMembers();
  kmRenderMemberOptions();
  kmLoadChunks();
  loadKbView();
}

// —— 文件列表表格 ——
function kmRenderFilesTable() {
  const kb = kmCurrent;
  if (!kb) return;
  const kw = (km$('kmFileSearch').value || '').trim().toLowerCase();
  const files = (kb.files || []).filter((f) => !kw || (f.name || '').toLowerCase().includes(kw));
  km$('kmFilesTable').innerHTML = files.length
    ? `<table class="kb-file-table"><thead><tr>
        <th style="width:48px">#</th><th>名称</th><th>数据量</th><th>更新时间</th><th>状态</th><th style="width:90px">操作</th>
      </tr></thead><tbody>${files.map((f, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><span class="kb-file-name">📄 ${esc(f.name)}</span><span class="kb-file-mode">${f.mode === 'qa' ? 'QA 拆分' : f.mode === 'data' ? '精准数据' : '直接分段'}</span></td>
          <td>${f.chunkCount} 段 · ${Math.max(1, Math.round(f.size / 1024))} KB</td>
          <td>${esc((f.uploadedAt || '').slice(0, 19).replace('T', ' '))}</td>
          <td><span class="kb-status ok">🟢 已就绪</span></td>
          <td><button class="btn btn-sm danger" data-km-file="${f.id}">删除</button></td>
        </tr>`).join('')}</tbody></table>`
    : '<div class="hint">暂无文件，点击「＋ 新建」创建虚拟文件，或切到「文件导入」页签上传资料。</div>';
}

// —— 成员授权 ——
function kmRenderMembers() {
  const kb = kmCurrent;
  if (!kb) return;
  const members = kb.members || [];
  const isPrivate = kb.visibility === 'private';
  if (km$('kmMemberHint')) {
    km$('kmMemberHint').textContent = isPrivate
      ? '私有库：仅创建者与下列授权成员可用；成员编辑权限控制其能否修改知识库内容。'
      : '公共库：公司所有登录成员均可用，无需单独授权（成员授权仅在设为私有后生效）。';
  }
  const ownerRow = `<tr>
    <td>${esc(kb.ownerName || kb.ownerId || '-')}</td>
    <td><span class="tag">创建者</span></td>
    <td>${esc((kb.createdAt || '').slice(0, 19).replace('T', ' '))}</td>
    <td><span class="kb-status ok">● 可编辑</span></td>
    <td><span class="hint">创建者</span></td>
  </tr>`;
  const memberRows = members.map((m) => `<tr>
    <td>${esc(m.userName || m.userId)}</td>
    <td>${m.role === 'owner' ? '超管' : m.role === 'admin' ? '管理员' : m.role === 'member' ? '成员' : (m.role || '成员')}</td>
    <td>${esc((m.addedAt || '').slice(0, 19).replace('T', ' '))}</td>
    <td><span class="kb-status ${m.canEdit ? 'ok' : ''}">${m.canEdit ? '● 可编辑' : '○ 只读'}</span></td>
    <td>
      <label class="kb-edit-switch"><input type="checkbox" data-km-member-edit="${esc(m.userId)}" ${m.canEdit ? 'checked' : ''} /> 可编辑</label>
      <button class="btn btn-sm danger" data-km-member-del="${esc(m.userId)}">移除</button>
    </td>
  </tr>`).join('');
  km$('kmMembersTable').innerHTML = `<table class="kb-file-table"><thead><tr>
    <th>成员</th><th>角色</th><th>加入时间</th><th>编辑权限</th><th>操作</th>
  </tr></thead><tbody>${ownerRow}${memberRows}</tbody></table>`;
}

async function kmEnsureUserMap() {
  if (kmUserMapLoaded) return;
  try {
    const list = await api('/api/kb/members-list');
    list.forEach((u) => { kmUserMap[u.id] = u; });
    kmUserMapLoaded = true;
  } catch (_) { /* 非管理员静默 */ }
}

function kmRenderMemberOptions() {
  const sel = km$('kmMemberSelect');
  if (!sel) return;
  const existing = new Set((kmCurrent && kmCurrent.members || []).map((m) => m.userId));
  const ownerId = kmCurrent && kmCurrent.ownerId;
  sel.innerHTML = '<option value="">选择成员…</option>'
    + Object.values(kmUserMap).filter((u) => u.id !== ownerId && !existing.has(u.id))
      .map((u) => `<option value="${esc(u.id)}">${esc(u.displayName || u.username)}（${esc(u.username)}）</option>`).join('');
}

// —— 段落管理 ——
async function kmLoadChunks(reset = false) {
  if (!kmCurrent) return;
  if (reset) { kmChunkState.offset = 0; kmChunkState.fileId = km$('kmChunkFileFilter').value; kmChunkState.q = km$('kmChunkSearch').value.trim(); }
  try {
    const params = new URLSearchParams({ limit: String(KM_CHUNK_PAGE), offset: String(kmChunkState.offset) });
    if (kmChunkState.fileId) params.set('fileId', kmChunkState.fileId);
    if (kmChunkState.q) params.set('q', kmChunkState.q);
    const r = await api(`/api/kb/${kmCurrent.id}/chunks?${params}`);
    kmChunkState.total = r.total;
    kmChunkState.items = r.items;
    kmRenderChunks();
  } catch (e) {
    if (e.status === 401 || e.status === 403) return;
    km$('kmChunksBox').innerHTML = `<div class="hint">加载分段失败：${esc(e.message)}</div>`;
  }
}

function kmRenderChunks() {
  const page = Math.floor(kmChunkState.offset / KM_CHUNK_PAGE) + 1;
  const pages = Math.max(1, Math.ceil(kmChunkState.total / KM_CHUNK_PAGE));
  km$('kmChunkPagerInfo').textContent = kmChunkState.total ? `第 ${page} / ${pages} 页 · 共 ${kmChunkState.total} 条` : '共 0 条';
  km$('kmChunkPrev').disabled = kmChunkState.offset <= 0;
  km$('kmChunkNext').disabled = kmChunkState.offset + KM_CHUNK_PAGE >= kmChunkState.total;
  const items = kmChunkState.items;
  km$('kmChunksBox').innerHTML = items.length
    ? items.map((c) => {
      const preview = c.length > 160 ? `${esc(c.text.slice(0, 160))}…` : esc(c.text);
      return `<div class="kb-chunk">
        <div class="kb-chunk-head">
          <span>#${esc(c.id)}</span>
          <span class="kb-type-badge ${esc(c.type)}">${KM_TYPE_LABELS[c.type] || '分段'}</span>
          ${c.type === 'data' && c.key ? `<span>索引键：${esc(c.key)}</span>` : ''}
          <span>${c.length} 字</span>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-km-chunk-edit="${c.id}">编辑</button>
          <button class="btn btn-sm danger" data-km-chunk="${c.id}">删除</button>
        </div>
        <pre>${preview}</pre>
      </div>`;
    }).join('')
    : '<div class="hint">没有符合条件的分段。</div>';
}

// —— 导入方式 ——
function kmApplyImportUI() {
  const m = KM_MODE_HINTS[kmImportMode] || KM_MODE_HINTS.text;
  km$('kmModeHint').textContent = m.hint;
  km$('kmFileLimitHint').textContent = m.fileHint;
  km$('kmImportText').placeholder = m.placeholder;
  km$('kmFileInput').accept = m.accept;
  km$('kmFilePickBtn').textContent = m.fileBtn;
}

// —— 搜索测试 ——
async function kmSearchTest() {
  if (!kmCurrent) return;
  const q = km$('kmTestQuery').value.trim();
  if (!q) { toast('请输入测试问题', 'error'); return; }
  km$('kmTestResults').innerHTML = '<div class="hint">检索中…</div>';
  try {
    const r = await api(`/api/kb/${kmCurrent.id}/search`, { method: 'POST', body: JSON.stringify({ query: q, topK: 5 }) });
    if (!r.chunks.length) { km$('kmTestResults').innerHTML = '<div class="hint">没有检索到相关分段（关键词无命中）。</div>'; return; }
    km$('kmTestResults').innerHTML = r.chunks.map((c, i) => `
      <div class="kb-chunk kb-search-hit">
        <div class="kb-chunk-head">
          <span class="score">#${i + 1} · 相关度 ${c.score}</span>
          <span class="kb-type-badge ${esc(c.type)}">${KM_TYPE_LABELS[c.type] || '分段'}</span>
          ${c.exact ? '<span class="kb-exact-hit">🎯 精准命中</span>' : ''}
        </div>
        <pre>${esc(c.text)}</pre>
      </div>`).join('');
  } catch (e) {
    km$('kmTestResults').innerHTML = `<div class="hint">检索失败：${esc(e.message)}</div>`;
  }
}

// —— 问答生成模型下拉 ——
async function kmLoadModelOptions(selectedId) {
  const sel = km$('kmCfgModelId');
  if (!sel) return;
  try {
    const configs = await api('/api/configs');
    sel.innerHTML = '<option value="">（跟随全局调度）</option>'
      + configs.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}（${esc(c.model)}）</option>`).join('');
  } catch (_) {
    sel.innerHTML = '<option value="">（跟随全局调度）</option>';
  }
}

// ================= 事件绑定（元素存在才绑定） =================
document.querySelectorAll('#kmTabs .tab-btn').forEach((b) => b.addEventListener('click', () => kmSwitchTab(b.dataset.kmtab)));
document.querySelectorAll('[data-close="kbManageModal"]').forEach((b) => b.addEventListener('click', kmCloseManage));
if (km$('kbManageModal')) km$('kbManageModal').addEventListener('click', (e) => { if (e.target === km$('kbManageModal')) kmCloseManage(); });

if (km$('kmFileSearchBtn')) km$('kmFileSearchBtn').addEventListener('click', () => kmRenderFilesTable());
if (km$('kmFileSearch')) km$('kmFileSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); kmRenderFilesTable(); } });

// 删除文件
if (km$('kmFilesTable')) km$('kmFilesTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-km-file]');
  if (!btn || !kmCurrent) return;
  if (!confirm('删除该文件将连同其全部分段一起删除，确定？')) return;
  try {
    await api(`/api/kb/${kmCurrent.id}/files/${btn.dataset.kmFile}`, { method: 'DELETE' });
    toast('文件已删除', 'success');
    await kmReload();
  } catch (e2) { toast('删除失败：' + e2.message, 'error'); }
});

// 新建虚拟文件
if (km$('kmNewFileBtn')) km$('kmNewFileBtn').addEventListener('click', () => {
  if (!kmCurrent) return;
  km$('kmnf_name').value = '';
  km$('kmnf_text').value = '';
  km$('kmNewFileModal').style.display = 'grid';
});
if (km$('kmnfSaveBtn')) km$('kmnfSaveBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  const name = km$('kmnf_name').value.trim() || '未命名资料';
  const text = km$('kmnf_text').value;
  if (!text.trim()) { toast('请先填写内容', 'error'); return; }
  const btn = km$('kmnfSaveBtn');
  btn.disabled = true; btn.textContent = '创建中…';
  try {
    await api(`/api/kb/${kmCurrent.id}/files`, { method: 'POST', body: JSON.stringify({ name, text, mode: 'text' }) });
    km$('kmNewFileModal').style.display = 'none';
    toast('虚拟文件已创建', 'success');
    kmChunkState.offset = 0;
    await kmReload();
  } catch (e) { toast('创建失败：' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '创建'; }
});
document.querySelectorAll('[data-close="kmNewFileModal"]').forEach((b) => b.addEventListener('click', () => { km$('kmNewFileModal').style.display = 'none'; }));

// 导入方式单选
document.querySelectorAll('#kbManageModal input[name="kmImportMode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { kmImportMode = r.value; kmApplyImportUI(); } }));
if (km$('kmImportText')) kmApplyImportUI();

// 导入（粘贴）
if (km$('kmImportBtn')) km$('kmImportBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  const text = km$('kmImportText').value;
  const name = km$('kmImportName').value.trim() || (kmImportMode === 'data' ? '未命名数据表' : kmImportMode === 'qa' ? '未命名问答集' : '未命名资料');
  if (!text.trim()) { toast('请先粘贴内容', 'error'); return; }
  const btn = km$('kmImportBtn');
  btn.disabled = true; btn.textContent = '导入中…';
  try {
    const r = await api(`/api/kb/${kmCurrent.id}/files`, { method: 'POST', body: JSON.stringify({ name, text, mode: kmImportMode }) });
    const label = { text: `切分为 ${r.chunkCount} 个分段`, qa: `拆分出 ${r.chunkCount} 个问答对`, data: `导入 ${r.chunkCount} 条数据记录` };
    toast(`导入成功：${label[r.mode] || label.text}`, 'success');
    km$('kmImportText').value = '';
    km$('kmImportName').value = '';
    kmChunkState.offset = 0;
    await kmReload();
  } catch (e) { toast('导入失败：' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '导入'; }
});

// 导入（文件上传）
if (km$('kmFilePickBtn')) km$('kmFilePickBtn').addEventListener('click', () => km$('kmFileInput').click());
if (km$('kmFileInput')) km$('kmFileInput').addEventListener('change', async () => {
  if (!kmCurrent) return;
  const files = Array.from(km$('kmFileInput').files || []);
  if (!files.length) return;
  const btn = km$('kmFilePickBtn');
  // 文件格式与大小校验（读后台「文件上传配置」）
  const ul = (uiSettings && uiSettings.uploadLimits) || {};
  const kbLimit = ul.kb || {};
  const allowExts = Array.isArray(kbLimit.exts) && kbLimit.exts.length ? kbLimit.exts : null;
  const maxBytes = Number.isFinite(Number(kbLimit.maxBytes)) && Number(kbLimit.maxBytes) > 0 ? Number(kbLimit.maxBytes) : 2 * 1024 * 1024;
  for (const file of files) {
    const ext = (file.name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';
    if (allowExts && !allowExts.includes(ext)) { toast(`「${file.name}」类型 .${ext} 不允许，当前支持：${allowExts.join('/')}`, 'error'); km$('kmFileInput').value = ''; return; }
    if (file.size > maxBytes) { toast(`「${file.name}」超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限`, 'error'); km$('kmFileInput').value = ''; return; }
  }
  btn.disabled = true; btn.textContent = '导入中…';
  let okCount = 0; let failMsg = '';
  for (const file of files) {
    try {
      const text = await file.text();
      await api(`/api/kb/${kmCurrent.id}/files`, { method: 'POST', body: JSON.stringify({ name: file.name, text, mode: kmImportMode }) });
      okCount++;
    } catch (e) { failMsg = `${file.name}：${e.message}`; }
  }
  btn.disabled = false; kmApplyImportUI(); km$('kmFileInput').value = '';
  if (okCount && !failMsg) toast(`已导入 ${okCount} 个文件`, 'success');
  else if (okCount) toast(`导入 ${okCount} 个成功；失败：${failMsg}`, 'error');
  else toast(`导入失败：${failMsg}`, 'error');
  if (okCount) { kmChunkState.offset = 0; await kmReload(); }
});

// 段落管理事件
if (km$('kmChunkFilterBtn')) km$('kmChunkFilterBtn').addEventListener('click', () => kmLoadChunks(true));
if (km$('kmChunkSearch')) km$('kmChunkSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); kmLoadChunks(true); } });
if (km$('kmChunkFileFilter')) km$('kmChunkFileFilter').addEventListener('change', () => kmLoadChunks(true));
if (km$('kmChunkPrev')) km$('kmChunkPrev').addEventListener('click', () => { kmChunkState.offset = Math.max(0, kmChunkState.offset - KM_CHUNK_PAGE); kmLoadChunks(); });
if (km$('kmChunkNext')) km$('kmChunkNext').addEventListener('click', () => { kmChunkState.offset += KM_CHUNK_PAGE; kmLoadChunks(); });
if (km$('kmChunksBox')) km$('kmChunksBox').addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-km-chunk-edit]');
  const delBtn = e.target.closest('[data-km-chunk]');
  if (!editBtn && !delBtn) return;
  if (!kmCurrent) return;
  if (editBtn) {
    const item = (kmChunkState.items || []).find((c) => String(c.id) === editBtn.dataset.kmChunkEdit);
    if (!item) return;
    kmChunkEditingId = item.id;
    km$('kmChunkEditTitle').textContent = `编辑分段 #${item.id}（${KM_TYPE_LABELS[item.type] || '分段'}）`;
    km$('kmChunkEditText').value = item.text;
    km$('kmChunkEditModal').style.display = 'grid';
  } else if (delBtn) {
    try {
      await api(`/api/kb/${kmCurrent.id}/chunks/${delBtn.dataset.kmChunk}`, { method: 'DELETE' });
      toast('分段已删除', 'success');
      await kmReload();
    } catch (e2) { toast('删除失败：' + e2.message, 'error'); }
  }
});
if (km$('kmChunkEditSaveBtn')) km$('kmChunkEditSaveBtn').addEventListener('click', async () => {
  if (!kmCurrent || !kmChunkEditingId) return;
  const text = km$('kmChunkEditText').value;
  if (!text.trim()) { toast('分段内容不能为空', 'error'); return; }
  try {
    await api(`/api/kb/${kmCurrent.id}/chunks/${kmChunkEditingId}`, { method: 'PUT', body: JSON.stringify({ text }) });
    km$('kmChunkEditModal').style.display = 'none';
    toast('分段已保存', 'success');
    await kmReload();
  } catch (e) { toast('保存失败：' + e.message, 'error'); }
});
document.querySelectorAll('[data-close="kmChunkEditModal"]').forEach((b) => b.addEventListener('click', () => { km$('kmChunkEditModal').style.display = 'none'; }));

// 搜索测试
if (km$('kmTestBtn')) km$('kmTestBtn').addEventListener('click', kmSearchTest);
if (km$('kmTestQuery')) km$('kmTestQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); kmSearchTest(); } });

// 权限保存（可见性）
if (km$('kmSavePermBtn')) km$('kmSavePermBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  const checked = document.querySelector('#kbManageModal input[name="kmVisibility"]:checked');
  if (!checked) { toast('请选择权限类型', 'error'); return; }
  try {
    await api(`/api/kb/${kmCurrent.id}`, { method: 'PUT', body: JSON.stringify({ visibility: checked.value }) });
    toast(checked.value === 'private' ? '已设为私有库：仅创建者与授权成员可用' : '已设为全员可用', 'success');
    await kmReload();
  } catch (e) { toast('保存失败：' + e.message, 'error'); }
});

// 成员授权
if (km$('kmAddMemberBtn')) km$('kmAddMemberBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  const userId = km$('kmMemberSelect').value;
  if (!userId) { toast('请选择要授权的成员', 'error'); return; }
  const canEdit = km$('kmMemberCanEdit').checked;
  try {
    await api(`/api/kb/${kmCurrent.id}/members`, { method: 'POST', body: JSON.stringify({ userId, canEdit }) });
    toast('成员已授权', 'success');
    km$('kmMemberCanEdit').checked = false;
    await kmReload();
  } catch (e) { toast('授权失败：' + e.message, 'error'); }
});
if (km$('kmMembersTable')) km$('kmMembersTable').addEventListener('click', async (e) => {
  if (!kmCurrent) return;
  const editSwitch = e.target.closest('[data-km-member-edit]');
  const delBtn = e.target.closest('[data-km-member-del]');
  const userId = editSwitch ? editSwitch.dataset.kmMemberEdit : delBtn ? delBtn.dataset.kmMemberDel : null;
  if (!userId) return;
  try {
    if (editSwitch) {
      await api(`/api/kb/${kmCurrent.id}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ canEdit: editSwitch.checked }) });
      toast('编辑权限已更新', 'success');
    } else if (delBtn) {
      if (!confirm('移除该成员将使其无法再访问此私有库，确定？')) return;
      await api(`/api/kb/${kmCurrent.id}/members/${userId}`, { method: 'DELETE' });
      toast('成员已移除', 'success');
    }
    await kmReload();
  } catch (e2) { toast('操作失败：' + e2.message, 'error'); }
});

// 配置保存
if (km$('kmSaveCfgBtn')) km$('kmSaveCfgBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  try {
    await api(`/api/kb/${kmCurrent.id}`, { method: 'PUT', body: JSON.stringify({
      name: km$('kmCfgName').value.trim(),
      remark: km$('kmCfgRemark').value.trim(),
      modelId: km$('kmCfgModelId').value,
      cfg: {
        chunkSize: km$('kmCfgChunkSize').value,
        overlap: km$('kmCfgOverlap').value,
        topK: km$('kmCfgTopK').value
      }
    }) });
    toast('知识库配置已保存', 'success');
    await kmReload();
  } catch (e) { toast('保存失败：' + e.message, 'error'); }
});

// 删除知识库（弹窗内）
if (km$('kmDeleteBtn')) km$('kmDeleteBtn').addEventListener('click', async () => {
  if (!kmCurrent) return;
  if (!confirm(`删除知识库「${kmCurrent.name}」？其全部分段与文件将一并删除。`)) return;
  try {
    await api(`/api/kb/${kmCurrent.id}`, { method: 'DELETE' });
    toast('知识库已删除', 'success');
    kmCloseManage();
    await loadKbView();
  } catch (e) { toast('删除失败：' + e.message, 'error'); }
});

// 知识库管理页返回按钮
if (km$('kbBackBtn')) km$('kbBackBtn').addEventListener('click', () => { kmCloseManage(); });

/* ---------- 初始化 ---------- */
// 恢复响应模式偏好（对话 / 工作流）
try {
  responseMode = localStorage.getItem('wb_mode') === 'workflow' ? 'workflow' : 'chat';
  wfModeId = localStorage.getItem('wb_wfid') || '';
} catch (_) {}
setResponseMode(responseMode);
if (responseMode === 'workflow') {
  loadWfModeList();
}
// 恢复知识库偏好（登录态下拉取列表；访客 401 会自动关掉开关）
params.useKb = getPref(PARAM_KEYS.useKb) === '1';
params.kbId = getPref(PARAM_KEYS.kbId) || '';
if (params.useKb) loadKbList();
renderParams();
loadAgentsList();
loadNotice();
loadConfigs();
initWorkbenchAuth();
initTeamAuth();

/* ================= 员工端画布编辑器（工作流，复用后台逻辑，走 /api/workflows） ================= */
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
    const list = await api('/api/workflows');
    const box = $('#wfListBox');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">暂无工作流，点击「＋ 新建工作流」创建后进入画布编排。</div>';
      return;
    }
    box.innerHTML = list.map((w) => `
      <div class="kb-card">
        <h4>🧩 ${esc(w.name)}</h4>
        ${w.desc ? `<div class="kb-meta">${esc(w.desc)}</div>` : ''}
        <div class="kb-meta">节点 ${w.nodeCount} · 连线 ${w.edgeCount} · ${esc((w.updatedAt || '').slice(0, 10))} 由 ${esc(w.ownerName || '-')} 更新</div>
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

$('#wfAddBtn').addEventListener('click', () => {
  $('#wfc_name').value = '';
  $('#wfc_desc').value = '';
  $('#wfCreateModal').style.display = 'grid';
});

$('#wfCreateBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/workflows', {
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


$('#wfListBox').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-wf-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.wfAct === 'open') {
    const wf = await api(`/api/workflows/${id}`);
    openWfCanvas(id, wf.name, wf);
  } else if (btn.dataset.wfAct === 'del') {
    if (!confirm('删除该工作流？')) return;
    try {
      await api(`/api/workflows/${id}`, { method: 'DELETE' });
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
    wfCanvas.options = await api('/api/workflows/options');
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
    await api(`/api/workflows/${wfCanvas.id}`, {
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
    const r = await api(`/api/workflows/${wfCanvas.id}/run`, {
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

