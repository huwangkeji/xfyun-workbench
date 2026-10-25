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
  webSearchBtn: document.getElementById('webSearchBtn'),
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
  shareList: document.getElementById('shareList')
};

let configs = [];
let currentConfigId = null;
let conversations = [];   // 会话元信息列表
let currentConv = null;   // 当前会话 {id, title, messages}
let sending = false;

/* ================= 会话参数（深度思考 / 思考强度 / 联网 / 系统提示） =================
 * 用户手动改过的项存 localStorage（记住选择）；未手动改过的项跟随当前 API 配置的默认值。
 * 请求时随 body 一起发给后端，覆盖配置默认值（含"关闭"这类显式 false）。
 */
const params = {
  enableThinking: false,
  reasoningEffort: 'high',
  webSearch: false,
  systemPrompt: ''
};

const PARAM_KEYS = {
  enableThinking: 'wb_thinking',
  reasoningEffort: 'wb_effort',
  webSearch: 'wb_websearch',
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

/** 把 params 状态渲染到工具栏控件 */
function renderParams() {
  if (els.thinkingBtn) els.thinkingBtn.classList.toggle('active', params.enableThinking);
  if (els.webSearchBtn) els.webSearchBtn.classList.toggle('active', params.webSearch);
  if (els.effortSelect) els.effortSelect.value = params.reasoningEffort;
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
if (els.webSearchBtn) els.webSearchBtn.addEventListener('click', () => {
  params.webSearch = !params.webSearch;
  setPref(PARAM_KEYS.webSearch, params.webSearch ? '1' : '0');
  renderParams();
  toast(params.webSearch ? '已开启联网搜索' : '已关闭联网搜索', 'success');
});
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

async function api(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (e) {
    // fetch 在网络层失败：服务未启动 / 端口不通 / 连接被重置（进程崩溃）
    const err = new Error('无法连接后端服务，请确认服务已启动（默认 http://127.0.0.1:4000，双击「启动.bat」或执行 npm start）');
    err.network = true;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    // 工作台开启了密码保护且未登录（或会话过期）→ 跳登录页
    toast('请先输入工作台密码', 'error');
    setTimeout(() => { location.href = '/login'; }, 900);
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
      // 工作台密码保护：未登录 → 跳登录页（与 api() 行为一致）
      toast('请先输入工作台密码', 'error');
      setTimeout(() => { location.href = '/login'; }, 900);
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
  if (!pendingImages.length) {
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
}

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
  if (typeof content === 'string') return { text: content, images: [] };
  if (Array.isArray(content)) {
    const text = content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
    const images = content
      .filter((p) => p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string')
      .map((p) => p.image_url.url);
    return { text, images };
  }
  return { text: '', images: [] };
}

/* ================= 配置加载 ================= */
async function loadConfigs() {
  try {
    configs = await api('/api/configs');
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
      opt.textContent = `${c.name} · ${c.model}`;
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

function updateConfigLabel() {
  const c = configs.find((x) => x._id === currentConfigId);
  els.curConfigName.textContent = c ? `${c.name} · ${c.model}` : '未选择配置';
}

els.configSelect.addEventListener('change', () => {
  currentConfigId = els.configSelect.value;
  updateConfigLabel();
  // 切换配置：未手动设置过的参数跟随新配置默认值
  const cfg = configs.find((c) => c._id === currentConfigId);
  applyConfigDefaults(cfg);
  renderParams();
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

/** 消息工具条 HTML：复制▾ / 原文切换 / 点赞 / 差评（错误消息仅保留复制） */
function buildMsgTools(extra) {
  const copyPart = `
      <div class="copy-group">
        <button class="tool-btn" data-act="copy" title="复制">⧉ 复制</button>
        <div class="copy-menu">
          <button data-copy="text">复制纯文本</button>
          <button data-copy="md">复制 Markdown</button>
        </div>
      </div>`;
  if (extra.error) return `<div class="msg-tools">${copyPart}</div>`;
  return `<div class="msg-tools">${copyPart}
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
  const { text, images } = contentParts(content);
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
  const meta = extra.meta ? `<div class="meta">${extra.meta}</div>` : '';

  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="msg-main">
      ${buildMsgTools(extra)}
      <div class="msg-body">${bodyHtml}${imgsHtml}</div>
      ${meta}
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
  els.sendBtn.disabled = busy;
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
    toast('请先在顶部选择 API 配置（或到后台管理添加）', 'error');
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

  const userContent = buildUserContent(text, pendingImages);

  els.input.value = '';
  autoGrow();
  pendingImages = []; // 先清空待发列表（内容已并入消息体）
  renderAttachRow();
  addMsg('user', userContent);

  const history = convoHistory();
  history.push({ role: 'user', content: userContent });

  setBusy(true, '请求星火 API…');
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        configId: currentConfigId,
        messages: history,
        // 参数工具栏的本次会话设置（覆盖配置默认值，含显式关闭）
        enableThinking: params.enableThinking,
        reasoningEffort: params.reasoningEffort,
        webSearch: params.webSearch,
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
    addMsg('assistant', `调用失败：${e.message}`, { error: true });
  } finally {
    setBusy(false);
  }
}

els.sendBtn.addEventListener('click', send);
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
async function initTeamAuth() {
  try {
    const resp = await fetch('/api/auth/me', { headers: { 'Content-Type': 'application/json' } });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok && d.ok && d.data && d.data.user) {
      const u = d.data.user;
      els.teamLogoutBtn.style.display = '';
      els.meCenterBtn.style.display = '';
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
        els.sendBtn.disabled = true;
        els.sendBtn.title = '只读成员不能发起对话，请联系管理员调整角色';
        els.input.disabled = true;
        els.input.placeholder = '只读成员不能发起对话（可查看历史会话）';
      }
    }
  } catch (_) { /* 服务异常时保持隐藏 */ }
}

els.teamLogoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (_) { /* 即使请求失败也跳登录页 */ }
  location.href = '/team-login';
});

/* ---------- 移动端：侧栏抽屉（☰ 唤出 / 选中会话后收起 / Esc 关闭） ---------- */
(function initSidebarDrawer() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggle = document.getElementById('sidebarToggle');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  if (!sidebar || !backdrop || !toggle) return;

  function open() { sidebar.classList.add('open'); backdrop.classList.add('show'); }
  function close() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }

  toggle.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // 选中会话 / 切换配置后自动收起（移动端体验；桌面端抽屉不存在，无副作用）
  document.getElementById('convList') && document.getElementById('convList').addEventListener('click', (e) => {
    if (e.target.closest('.conv-item') || e.target.closest('.conv-del')) close();
  });
  document.getElementById('configSelect') && document.getElementById('configSelect').addEventListener('change', close);
})();

/* ---------- 初始化 ---------- */
loadConfigs();
initWorkbenchAuth();
initTeamAuth();