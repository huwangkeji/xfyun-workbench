'use strict';

/* ============ 对话分享页（公开只读） ============
 * 从 /s/<token> 提取 token → GET /api/share/<token>（公开接口，无守卫）
 * → 渲染快照消息（Markdown，只读，仅保留复制功能）。
 * 错误态：404 链接不存在/已撤销；410 链接已过期；网络错误。
 */

const els = {
  card: document.getElementById('shareCard'),
  title: document.getElementById('shareTitle'),
  sub: document.getElementById('shareSub'),
  messages: document.getElementById('shareMessages'),
  toastWrap: document.getElementById('toastWrap')
};

const token = /^\/s\/([A-Za-z0-9_-]{8,64})$/.exec(location.pathname);
const TOKEN = token ? token[1] : '';

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

function shortTime(iso) {
  if (!iso) return '';
  return String(iso).slice(5, 16).replace('T', ' ');
}

async function copyText(text, label) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
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

function closeAllCopyMenus() {
  document.querySelectorAll('.copy-group.open').forEach((g) => g.classList.remove('open'));
}
document.addEventListener('click', closeAllCopyMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllCopyMenus(); });

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

function renderState(icon, title, sub) {
  els.card.innerHTML = `
    <div class="share-state">
      <div class="icon">${icon}</div>
      <div class="t">${esc(title)}</div>
      <div class="s">${esc(sub)}</div>
    </div>`;
}

function addShareMsg(role, content, time) {
  const { text, images } = contentParts(content);
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const avatar = role === 'user' ? '我' : 'AI';
  const bodyHtml = text
    ? `<div class="bubble md">${window.MD ? MD.render(text) : esc(text)}</div>
       <div class="bubble md-src" hidden><pre>${esc(text)}</pre></div>`
    : '<div class="bubble"></div>';
  const imgsHtml = images
    .map((src) => `<div class="inline-img"><img src="${esc(src)}" alt="消息图片" loading="lazy" /></div>`)
    .join('');
  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="msg-main">
      <div class="msg-tools">
        <div class="copy-group">
          <button class="tool-btn" data-act="copy" title="复制">⧉ 复制</button>
          <div class="copy-menu">
            <button data-copy="text">复制纯文本</button>
            <button data-copy="md">复制 Markdown</button>
          </div>
        </div>
        <button class="tool-btn" data-act="source" title="查看 / 还原 Markdown 原文">&lt;/&gt;</button>
      </div>
      <div class="msg-body">${bodyHtml}${imgsHtml}</div>
      <div class="meta">${esc(shortTime(time))}</div>
    </div>`;

  const group = wrap.querySelector('.copy-group');
  const copyBtn = wrap.querySelector('[data-act="copy"]');
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
      if (!text || !text.trim()) { toast('该消息没有文本内容', 'error'); return; }
      copyText(btn.dataset.copy === 'md' ? text : MD.toPlain(text),
        btn.dataset.copy === 'md' ? 'Markdown' : '纯文本');
    });
  });
  const srcBtn = wrap.querySelector('[data-act="source"]');
  srcBtn.addEventListener('click', () => {
    const mdB = wrap.querySelector('.bubble.md');
    const srcB = wrap.querySelector('.bubble.md-src');
    if (!mdB || !srcB) return;
    const showSrc = srcB.hasAttribute('hidden');
    srcB.toggleAttribute('hidden', !showSrc);
    mdB.toggleAttribute('hidden', showSrc);
    srcBtn.classList.toggle('active', showSrc);
  });
  els.messages.appendChild(wrap);
}

async function load() {
  if (!TOKEN) {
    renderState('🔗', '链接无效', '分享链接格式不正确，请向分享者索取完整链接');
    return;
  }
  let resp;
  try {
    resp = await fetch(`/api/share/${encodeURIComponent(TOKEN)}`, { headers: { 'Content-Type': 'application/json' } });
  } catch (_) {
    renderState('📡', '无法连接服务', '请确认工作台服务已启动后重试');
    return;
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 410 || (data && data.code === 'SHARE_EXPIRED')) {
    renderState('⏰', '链接已过期', '该分享链接已超过有效期，请联系分享者重新生成');
    return;
  }
  if (!resp.ok || !data.ok || !data.data) {
    renderState('🚫', '链接不存在或已被撤销', '请确认链接完整，或联系分享者获取新链接');
    return;
  }
  const d = data.data;
  els.title.textContent = d.title || '对话分享';
  els.sub.textContent = `分享于 ${shortTime(d.sharedAt)} · ${d.messageCount} 条消息 · 只读快照`;
  const list = Array.isArray(d.messages) ? d.messages : [];
  if (!list.length) {
    els.messages.innerHTML = '<div class="empty">该分享没有消息内容</div>';
    return;
  }
  for (const m of list) addShareMsg(m.role === 'user' ? 'user' : 'assistant', m.content, m.time);
}

load();
