'use strict';

/* ============ 后台管理：API 配置 + 运行日志 ============ */

const $ = (sel) => document.querySelector(sel);

const els = {
  tabs: document.querySelectorAll('.tab-btn'),
  panes: {
    api: $('#pane-api'),
    logs: $('#pane-logs'),
    network: $('#pane-network'),
    memory: $('#pane-memory')
  },
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
  toastWrap: $('#toastWrap')
};

const page = { limit: 50, offset: 0, total: 0 };
const memPage = { limit: 20, offset: 0, total: 0, keyword: '' };
let editingId = null;
let memoryCurrent = null; // 当前查看的会话记录

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
    // 后台会话失效：提示并跳登录页
    toast('登录已失效，请重新登录', 'error');
    setTimeout(() => { location.href = '/admin/login'; }, 900);
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

/* ================= TABS ================= */
els.tabs.forEach((btn) => {
  btn.addEventListener('click', () => {
    els.tabs.forEach((b) => b.classList.toggle('active', b === btn));
    const name = btn.dataset.tab;
    for (const k in els.panes) els.panes[k].classList.toggle('active', k === name);
    if (name === 'logs') loadLogs();
    if (name === 'network') loadPing(true);
    if (name === 'memory') loadMemory();
  });
});

/* ================= API 配置 ================= */
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
    els.configRows.innerHTML = '<tr><td colspan="13" class="empty">暂无配置，点击「+ 新增配置」添加</td></tr>';
    return;
  }
  for (const c of list) {
    const schedBadge = c.enabled === false
      ? '<span class="badge">停用</span>'
      : (c.priority == null || c.priority === 100 ? '<span class="badge">参与 · 默</span>' : `<span class="badge ok">参与 · ${c.priority}</span>`);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${esc(c.name)}</b></td>
      <td>${c.active ? '<span class="badge active">默认</span>' : '<span class="badge">备用</span>'}</td>
      <td>${schedBadge}</td>
      <td>${esc(c.baseUrl)}</td>
      <td>${esc(c.model)}</td>
      <td><code>${esc(c.apiKey)}</code></td>
      <td>${c.temperature ?? '-'}</td>
      <td>${c.topP ?? '-'}</td>
      <td>${c.maxTokens ?? '-'}</td>
      <td>${c.enableThinking ? '是' : '否'}</td>
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
      const c = await api(`/api/configs/${id}`);
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
      setTimeout(() => { location.href = '/admin/login'; }, 900);
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
  $('#f_name').value = c ? c.name : '';
  $('#f_baseUrl').value = c ? c.baseUrl : 'https://maas-api.cn-huabei-1.xf-yun.com';
  $('#f_apiKey').value = '';
  $('#f_model').value = c ? c.model : '';
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
  $('#configModal').style.display = 'grid';
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $(`#${btn.dataset.close}`).style.display = 'none';
  });
});

$('#addConfigBtn').addEventListener('click', () => openModal(null));

$('#saveConfigBtn').addEventListener('click', async () => {
  const payload = {
    name: $('#f_name').value.trim(),
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
    const data = await api(`/api/logs?${q.toString()}`);
    page.total = data.total;
    renderLogs(data.items);
    els.logCountBadge.textContent = data.total;
    renderPageInfo();
  } catch (e) {
    toast('加载日志失败：' + e.message, 'error');
  }
}

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
  } catch (e) {
    toast('加载调度设置失败：' + e.message, 'error');
  }
}

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
    els.memRows.innerHTML = `<tr><td colspan="6" class="empty">${memPage.keyword ? '没有匹配的会话记录' : '暂无会话记录'}</td></tr>`;
    return;
  }
  items.forEach((c) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${esc(c.title || '新对话')}</b><div class="note-text" style="color:var(--text-dim)">${esc(c.preview || '')}</div></td>
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
  memPage.keyword = '';
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
  if (n1.length < 4) { toast('新密码至少 4 位', 'error'); return; }
  if (n1 !== n2) { toast('两次输入的新密码不一致', 'error'); return; }
  try {
    await api('/api/admin/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: oldPwd, newPassword: n1 })
    });
    toast('密码已修改，请使用新密码重新登录', 'success');
    setTimeout(() => { location.href = '/admin/login'; }, 1200);
  } catch (e) {
    if (e.status === 401) return;
    toast('修改失败：' + e.message, 'error');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
  } catch (_) { /* 即使请求失败也跳登录页 */ }
  location.href = '/admin/login';
});

/* ---------- 初始化 ---------- */
loadConfigs();
loadSettings();