'use strict';

/* ============ 工作台：多会话文本对话 ============ */

const els = {
  configSelect: document.getElementById('configSelect'),
  curConfigName: document.getElementById('curConfigName'),
  statusLine: document.getElementById('statusLine'),
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  sendBtn: document.getElementById('sendBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  newConvBtn: document.getElementById('newConvBtn'),
  delConvBtn: document.getElementById('delConvBtn'),
  convList: document.getElementById('convList'),
  wbLogoutBtn: document.getElementById('wbLogoutBtn'),
  toastWrap: document.getElementById('toastWrap'),
  webSearchBtn: document.getElementById('webSearchBtn'),
  chatInput: document.getElementById('chatInput'),
  attachRow: document.getElementById('attachRow'),
  attachBtn: document.getElementById('attachBtn'),
  fileInput: document.getElementById('fileInput')
};

let configs = [];
let currentConfigId = null;
let conversations = [];   // 会话元信息列表
let currentConv = null;   // 当前会话 {id, title, messages}
let sending = false;
let webSearchEnabled = false; // 联网搜索开关（localStorage 持久化，随每次请求发给后端）

/* ================= 联网搜索开关 ================= */
function loadWebSearchPref() {
  try { webSearchEnabled = localStorage.getItem('wb_websearch') === '1'; } catch (_) { webSearchEnabled = false; }
  renderWebSearchBtn();
}
function renderWebSearchBtn() {
  if (!els.webSearchBtn) return;
  els.webSearchBtn.classList.toggle('active', webSearchEnabled);
  els.webSearchBtn.title = webSearchEnabled
    ? '联网搜索已开启：本次对话允许模型调用 web_search 获取实时信息（点击关闭）'
    : '联网搜索已关闭：点击开启后，模型可调用 web_search 获取实时信息';
}
els.webSearchBtn && els.webSearchBtn.addEventListener('click', () => {
  webSearchEnabled = !webSearchEnabled;
  try { localStorage.setItem('wb_websearch', webSearchEnabled ? '1' : '0'); } catch (_) { /* 隐私模式忽略 */ }
  renderWebSearchBtn();
  toast(webSearchEnabled ? '已开启联网搜索' : '已关闭联网搜索', 'success');
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
function renderMessages() {
  els.messages.innerHTML = '';
  const list = (currentConv && currentConv.messages) || [];
  if (!list.length) {
    els.messages.innerHTML = '<div class="empty">开始新的对话：在下方输入消息。系统提示/参数可在后台管理配置。</div>';
    return;
  }
  for (const m of list) {
    if (m.role === 'system') continue;
    addMsg(m.role === 'user' ? 'user' : 'assistant', m.content);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addMsg(role, content, extra = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}${extra.error ? ' error' : ''}`;
  const avatar = role === 'user' ? '我' : 'AI';
  const meta = extra.meta ? `<div class="meta">${extra.meta}</div>` : '';
  // 兼容纯文本与多模态数组 content（[{type:'text'},{type:'image_url',...}]）
  const { text, images } = contentParts(content);
  const textHtml = text ? `<div class="bubble">${esc(text)}</div>` : '';
  const imgsHtml = images
    .map((src) => `<div class="inline-img"><img src="${esc(src)}" alt="消息图片" loading="lazy" /></div>`)
    .join('');
  const bubbleHtml = textHtml || imgsHtml ? `<div>${textHtml}${imgsHtml}</div>` : `<div><div class="bubble"></div></div>`;
  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    ${bubbleHtml}
    ${meta}`;
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
}

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
    const meta = conversations.find((c) => c.id === currentConv.id);
    if (meta) { meta.count = currentConv.messages.length; meta.updatedAt = currentConv.updatedAt; }
    renderConvList();
  } catch (e) {
    toast('消息保存失败：' + e.message, 'error');
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
        webSearch: webSearchEnabled // 联网搜索开关随请求显式传递
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
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
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

/* ---------- 初始化 ---------- */
loadWebSearchPref();
loadConfigs();
initWorkbenchAuth();