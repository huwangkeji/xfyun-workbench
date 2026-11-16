'use strict';

/* ============ 应用对外分享页（/a/:token）============
 * 流程：解析 token → GET /api/app-share/:token
 *  → 密码门（needPassword）→ 参数变量表单（agent.variables）
 *  → 对话（POST /api/app-share/:token/chat，历史最多 12 条由服务端规整）。
 * 服务端注入角色设定 / 模型 / 知识库，本页不接触任何内部配置。
 */

const TOKEN = (/^\/a\/([A-Za-z0-9_-]{8,64})$/.exec(location.pathname) || [])[1] || '';

const els = {
  emoji: document.getElementById('asEmoji'),
  name: document.getElementById('asName'),
  qpm: document.getElementById('asQpm'),
  title: document.getElementById('asTitle'),
  desc: document.getElementById('asDesc'),
  messages: document.getElementById('asMessages'),
  suggests: document.getElementById('asSuggests'),
  vars: document.getElementById('asVars'),
  input: document.getElementById('asInput'),
  send: document.getElementById('asSend'),
  gate: document.getElementById('asGate'),
  gateBtn: document.getElementById('asGateBtn'),
  pwd: document.getElementById('asPwd'),
  toastWrap: document.getElementById('toastWrap')
};

let agentInfo = null;
let shareKey = '';   // 访问密码（有则每次请求携带）
let history = [];    // [{role, content}]
let busy = false;

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  els.toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 消息渲染 ---------- */
function addMessage(role, text, opts) {
  const o = opts || {};
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'msg-user' : 'msg-ai');
  if (role === 'user') {
    div.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  } else if (o.typing) {
    div.innerHTML = '<div class="bubble as-typing"><i></i><i></i><i></i></div>';
  } else {
    div.innerHTML = `<div class="bubble md">${window.MD ? MD.render(text) : esc(text)}</div>`;
  }
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function removeTyping(el) {
  if (el && el.parentNode) el.remove();
}

/* ---------- 参数变量表单 ---------- */
function renderVars(vars) {
  if (!Array.isArray(vars) || !vars.length) return;
  els.vars.innerHTML = vars.map((v) => {
    const req = v.required ? ' <b class="as-req">*</b>' : '';
    if (v.type === 'select') {
      const opts = (v.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      return `<label class="field"><span>${esc(v.label || v.key)}${req}</span>
        <select class="select as-var" data-key="${esc(v.key)}"><option value="">请选择</option>${opts}</select></label>`;
    }
    if (v.type === 'paragraph') {
      return `<label class="field"><span>${esc(v.label || v.key)}${req}</span>
        <textarea class="as-var" rows="2" data-key="${esc(v.key)}" placeholder="请输入"></textarea></label>`;
    }
    return `<label class="field"><span>${esc(v.label || v.key)}${req}</span>
      <input class="input as-var" data-key="${esc(v.key)}" placeholder="请输入" /></label>`;
  }).join('');
  els.vars.style.display = '';
}

function collectVars() {
  const out = {};
  let missing = [];
  document.querySelectorAll('.as-var').forEach((el) => {
    const key = el.dataset.key;
    const val = (el.value || '').trim();
    out[key] = val;
    const def = (agentInfo.variables || []).find((v) => v.key === key);
    if (def && def.required && !val) missing.push(def.label || def.key);
  });
  return { values: out, missing };
}

/* ---------- 对话 ---------- */
async function send(text) {
  if (busy || !text.trim()) return;
  const v = collectVars();
  if (v.missing.length) {
    toast('请先填写必填参数：' + v.missing.join('、'), 'error');
    return;
  }
  busy = true;
  els.send.disabled = true;
  els.input.disabled = true;
  addMessage('user', text.trim());
  history.push({ role: 'user', content: text.trim() });
  const typing = addMessage('ai', '', { typing: true });

  try {
    const r = await fetch(`/api/app-share/${TOKEN}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, variables: v.values, key: shareKey })
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) {
      toast('访问密码不正确', 'error');
      els.gate.style.display = 'grid';
      history.pop();
      throw new Error('gate');
    }
    if (r.status === 429) {
      toast(d.error || '请求过于频繁，请稍后再试', 'error');
      history.pop();
      throw new Error(d.error || 'rate');
    }
    if (!d.ok) throw new Error(d.error || '请求失败');

    const answer = (d.result && d.result.content) || '（模型未返回内容）';
    removeTyping(typing);
    addMessage('ai', answer);
    history.push({ role: 'assistant', content: answer });
  } catch (e) {
    removeTyping(typing);
    const err = e && e.message === 'gate' ? null : e;
    if (err) {
      addMessage('ai', '⚠️ ' + (err.message || '请求失败，请稍后重试'));
      // 失败的这条用户消息回滚（不进入历史），方便重发
      if (history.length && history[history.length - 1].role === 'user') history.pop();
      const last = els.messages.querySelector('.msg:last-child');
      if (last && last.classList.contains('msg-user')) last.remove();
      if (e.message === 'gate') { /* 密码门已弹出 */ }
    }
  } finally {
    busy = false;
    els.send.disabled = false;
    els.input.disabled = false;
    els.input.focus();
  }
}

/* ---------- 初始化 ---------- */
async function boot(afterGate) {
  try {
    const r = await fetch(`/api/app-share/${TOKEN}`);
    const d = await r.json().catch(() => ({}));
    if (r.status === 410 || r.status === 404) {
      els.name.textContent = '链接已失效';
      els.title.textContent = '分享链接不存在或已过期';
      addMessage('ai', '⚠️ 该分享链接不存在、已过期或已被管理员撤销。请联系分享者重新获取链接。');
      return;
    }
    if (!d.ok) throw new Error(d.error || '加载失败');
    const info = d.data;
    agentInfo = info.agent;
    els.emoji.textContent = agentInfo.emoji || '🤖';
    els.name.textContent = agentInfo.name;
    els.title.textContent = agentInfo.name;
    els.desc.textContent = agentInfo.desc || '';
    els.qpm.textContent = info.qpm ? `限流 ${info.qpm} 次/分钟` : '内容由 AI 生成，仅供参考';
    if (info.expiresAt) {
      els.qpm.title = '链接到期时间：' + info.expiresAt.slice(0, 16).replace('T', ' ');
    }

    if (info.needPassword && !afterGate) {
      els.gate.style.display = 'grid';
      els.pwd.focus();
      return;
    }
    // 解锁输入
    els.input.disabled = false;
    els.send.disabled = false;
    renderVars(agentInfo.variables);

    // 开场白 + 预设问题
    if (agentInfo.welcome) addMessage('ai', agentInfo.welcome);
    const sug = document.getElementById('asSuggests');
    (agentInfo.suggests || []).slice(0, 4).forEach((s) => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm as-sug';
      b.textContent = s;
      b.addEventListener('click', () => send(s));
      sug.appendChild(b);
    });
  } catch (e) {
    els.name.textContent = '加载失败';
    addMessage('ai', '⚠️ ' + (e.message || '加载失败，请刷新重试'));
  }
}

els.send.addEventListener('click', () => send(els.input.value));
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const t = els.input.value;
    els.input.value = '';
    send(t);
  }
});

els.gateBtn.addEventListener('click', () => {
  const p = els.pwd.value.trim();
  if (!p) { toast('请输入访问密码', 'error'); return; }
  shareKey = p;
  els.gate.style.display = 'none';
  boot(true);
});
els.pwd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.gateBtn.click();
});

boot(false);
