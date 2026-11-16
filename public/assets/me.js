'use strict';

/* ============ 员工中心：基本信息 / 我的数据 / 登录记录 / 改密 / 壁纸 ============ */

const $ = (sel) => document.querySelector(sel);

const ROLE_LABELS = { owner: '超级管理员', admin: '管理员', member: '成员', viewer: '只读成员' };
const AUDIT_LABELS = {
  'auth.login_ok': '登录成功', 'auth.login_fail': '登录失败', 'auth.logout': '退出登录',
  'auth.password_change': '修改密码', 'auth.register': '注册账号'
};

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtTime(iso) {
  return iso ? String(iso).slice(0, 19).replace('T', ' ') : '-';
}

async function api(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  } catch (e) {
    throw new Error('无法连接后端服务，请确认服务已启动');
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    toast('登录已失效，请重新登录', 'error');
    setTimeout(() => { location.href = '/team-login?next=' + encodeURIComponent(location.pathname); }, 900);
    const err = new Error('未登录');
    err.status = 401;
    throw err;
  }
  if (!resp.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data.data;
}

/* ---------- 基本信息（含头像） ---------- */
function renderAvatar(url) {
  const box = $('#meAvatar');
  $('#avatarClearBtn').style.display = url ? '' : 'none';
  if (url) {
    box.innerHTML = `<img src="${esc(url)}" alt="头像" />`;
  } else {
    box.textContent = '👤';
  }
}

function chooseAvatar() {
  if (!window.FileReader) { toast('当前浏览器不支持 FileReader，请更换浏览器', 'error'); return; }
  $('#avatarInput').click();
}

$('#meAvatar').addEventListener('click', chooseAvatar);
$('#avatarUpBtn').addEventListener('click', chooseAvatar);
$('#avatarInput').addEventListener('change', () => {
  const file = ($('#avatarInput').files || [])[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('头像不能超过 2MB', 'error'); $('#avatarInput').value = ''; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await api('/api/auth/avatar', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: reader.result })
      });
      renderAvatar(r.avatarUrl);
      toast('头像已更新', 'success');
    } catch (e) {
      if (e.status === 401) return;
      toast('上传失败：' + e.message, 'error');
    } finally {
      $('#avatarInput').value = '';
    }
  };
  reader.onerror = () => { toast('读取文件失败，请重试', 'error'); $('#avatarInput').value = ''; };
  reader.readAsDataURL(file);
});

$('#avatarClearBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/auth/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: '' }) });
    renderAvatar(r.avatarUrl);
    toast('已恢复默认头像', 'success');
  } catch (e) {
    if (e.status === 401) return;
    toast('操作失败：' + e.message, 'error');
  }
});

async function loadProfile() {
  try {
    const me = await api('/api/auth/me');
    const u = me.user;
    renderAvatar(u.avatarUrl);
    $('#meProfile').innerHTML = `
      <div class="me-row"><span>用户名</span><b>${esc(u.username)}</b></div>
      <div class="me-row"><span>昵称</span><b>${esc(u.displayName || '-')}</b></div>
      <div class="me-row"><span>角色</span><b>${ROLE_LABELS[u.role] || esc(u.role)}</b></div>
      <div class="me-row"><span>状态</span><b>${u.status === 'active' ? '正常' : '已停用'}</b></div>
      <div class="me-row"><span>注册时间</span><b>${esc(fmtTime(u.createdAt))}</b></div>
      <div class="me-row"><span>最近登录</span><b>${esc(fmtTime(u.lastLoginAt))}</b></div>`;
    // 管理员显示后台入口
    if (u.role === 'owner' || u.role === 'admin') {
      $('#adminEntry').style.display = '';
    }
    // 回填壁纸设置
    fillWallpaper(u.wallpaper, u.wallpaperBlur);
  } catch (e) {
    if (e.status === 401) return;
    $('#meProfile').innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

/* ---------- 我的数据（近 7 天） ---------- */
async function loadMyOverview() {
  try {
    const d = await api('/api/auth/my-overview');
    const cards = [
      ['请求数', d.totalRequests ?? 0],
      ['成功率', d.successRate === null ? '-' : `${d.successRate}%`],
      ['Token 消耗', d.totalTokens ?? 0],
      ['平均耗时', d.avgLatencyMs === null ? '-' : `${d.avgLatencyMs}ms`],
      ['失败数', d.errorRequests ?? 0]
    ];
    $('#myOverview').innerHTML = cards
      .map(([label, v]) => `<div class="ov-card"><b>${esc(v)}</b><span>${label}</span></div>`)
      .join('');
  } catch (e) {
    if (e.status === 401) return;
    $('#myOverview').innerHTML = '<div class="hint">加载失败</div>';
  }
}

/* ---------- 我的登录记录 ---------- */
async function loadMyLogins() {
  try {
    const list = await api('/api/auth/my-logins');
    $('#myLoginRows').innerHTML = list.length
      ? list.map((l) => `
          <tr>
            <td>${esc(fmtTime(l.time))}</td>
            <td>${esc(AUDIT_LABELS[l.action] || l.action)}${l.detail ? ` · ${esc(l.detail)}` : ''}</td>
            <td>${esc((l.ip || '').replace('::ffff:', '') || '-')}</td>
          </tr>`).join('')
      : '<tr><td colspan="3" class="empty">暂无记录</td></tr>';
  } catch (e) {
    if (e.status === 401) return;
    $('#myLoginRows').innerHTML = '<tr><td colspan="3" class="empty">加载失败</td></tr>';
  }
}

/* ---------- 我的使用记录 ---------- */
async function loadMyUsage() {
  try {
    const d = await api('/api/auth/my-usage?limit=30');
    $('#myUsageRows').innerHTML = (d.items || []).length
      ? d.items.map((l) => `
          <tr>
            <td>${esc(fmtTime(l.time))}</td>
            <td>${esc(l.model || '-')}</td>
            <td>${l.status === 'ok' ? '<span class="badge ok">成功</span>' : '<span class="badge err">失败</span>'}</td>
            <td>${l.latencyMs ? `${l.latencyMs}ms` : '-'}</td>
            <td>${l.totalTokens || '-'}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="empty">暂无使用记录</td></tr>';
  } catch (e) {
    if (e.status === 401) return;
    $('#myUsageRows').innerHTML = '<tr><td colspan="5" class="empty">加载失败</td></tr>';
  }
}

/* ---------- 改密 / 退出 ---------- */
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
    toast('密码已修改，请重新登录', 'success');
    setTimeout(() => { location.href = '/team-login'; }, 1200);
  } catch (e) {
    if (e.status === 401) return;
    toast('修改失败：' + e.message, 'error');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch (_) { /* 即使失败也跳登录页 */ }
  location.href = '/team-login';
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => { $(`#${btn.dataset.close}`).style.display = 'none'; });
});

/* ---------- 左侧菜单切换 ---------- */
function switchMeTab(name) {
  document.querySelectorAll('[data-metab]').forEach((b) => b.classList.toggle('active', b.dataset.metab === name));
  document.querySelectorAll('#mePane-profile, #mePane-overview, #mePane-usage, #mePane-logins, #mePane-security, #mePane-theme')
    .forEach((p) => { p.classList.toggle('active', p.id === `mePane-${name}`); });
}
document.querySelectorAll('[data-metab]').forEach((btn) => {
  btn.addEventListener('click', () => switchMeTab(btn.dataset.metab));
});

/* ---------- 壁纸设置 ---------- */
let wallpaperDirty = false; // 是否有未保存的本地修改
let currentWallpaper = { wallpaper: '', wallpaperBlur: false };

function fillWallpaper(wallpaper, blur) {
  currentWallpaper = { wallpaper: wallpaper || '', wallpaperBlur: !!blur };
  $('#wallpaperUrl').value = wallpaper && /^https?:\/\//i.test(wallpaper) ? wallpaper : '';
  $('#wallpaperBlur').checked = !!blur;
  $('#wallpaperClearBtn').style.display = wallpaper ? '' : 'none';
  renderWallpaperPreview(wallpaper, blur);
}

function renderWallpaperPreview(wallpaper, blur) {
  const box = $('#wallpaperPreviewInner');
  const wrap = $('#wallpaperPreview');
  if (wallpaper) {
    box.style.backgroundImage = `url("${esc(wallpaper)}")`;
    box.textContent = '';
  } else {
    box.style.backgroundImage = 'none';
    box.textContent = '未设置壁纸';
  }
  if (blur && wallpaper) {
    box.style.filter = 'blur(6px)';
    box.style.transform = 'scale(1.08)';
  } else {
    box.style.filter = 'none';
    box.style.transform = 'none';
  }
  wrap.dataset.hasWallpaper = wallpaper ? '1' : '0';
}

// 上传壁纸
$('#wallpaperUploadBtn').addEventListener('click', () => {
  if (!window.FileReader) { toast('当前浏览器不支持 FileReader', 'error'); return; }
  $('#wallpaperInput').click();
});
$('#wallpaperInput').addEventListener('change', () => {
  const file = ($('#wallpaperInput').files || [])[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('壁纸不能超过 8MB', 'error'); $('#wallpaperInput').value = ''; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await api('/api/auth/wallpaper', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: reader.result, blur: $('#wallpaperBlur').checked })
      });
      fillWallpaper(r.wallpaper, r.wallpaperBlur);
      toast('壁纸已上传', 'success');
    } catch (e) {
      if (e.status === 401) return;
      toast('上传失败：' + e.message, 'error');
    } finally {
      $('#wallpaperInput').value = '';
    }
  };
  reader.onerror = () => { toast('读取文件失败，请重试', 'error'); $('#wallpaperInput').value = ''; };
  reader.readAsDataURL(file);
});

// URL 壁纸应用
$('#wallpaperUrlApplyBtn').addEventListener('click', async () => {
  const url = $('#wallpaperUrl').value.trim();
  if (!url) { toast('请输入壁纸 URL', 'error'); return; }
  try {
    const r = await api('/api/auth/wallpaper', {
      method: 'POST',
      body: JSON.stringify({ wallpaper: url, blur: $('#wallpaperBlur').checked })
    });
    fillWallpaper(r.wallpaper, r.wallpaperBlur);
    toast('URL 壁纸已应用', 'success');
  } catch (e) {
    if (e.status === 401) return;
    toast('应用失败：' + e.message, 'error');
  }
});

// 清除壁纸
$('#wallpaperClearBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/auth/wallpaper', {
      method: 'POST',
      body: JSON.stringify({ clear: true, blur: $('#wallpaperBlur').checked })
    });
    fillWallpaper(r.wallpaper, r.wallpaperBlur);
    toast('壁纸已清除', 'success');
  } catch (e) {
    if (e.status === 401) return;
    toast('清除失败：' + e.message, 'error');
  }
});

// 保存毛玻璃开关
$('#wallpaperSaveBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/auth/wallpaper', {
      method: 'POST',
      body: JSON.stringify({ blur: $('#wallpaperBlur').checked })
    });
    fillWallpaper(r.wallpaper, r.wallpaperBlur);
    toast('毛玻璃设置已保存', 'success');
  } catch (e) {
    if (e.status === 401) return;
    toast('保存失败：' + e.message, 'error');
  }
});

/* ---------- 初始化 ---------- */
loadProfile();
loadMyOverview();
loadMyLogins();
loadMyUsage();
