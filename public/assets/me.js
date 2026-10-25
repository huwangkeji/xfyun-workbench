'use strict';

/* ============ 员工中心：基本信息 / 我的数据 / 登录记录 / 改密 ============ */

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
    setTimeout(() => { location.href = '/team-login'; }, 900);
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

/* ---------- 基本信息 ---------- */
async function loadProfile() {
  try {
    const me = await api('/api/auth/me');
    const u = me.user;
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

/* ---------- 初始化 ---------- */
loadProfile();
loadMyOverview();
loadMyLogins();
