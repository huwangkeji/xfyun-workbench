'use strict';

/* ============ 门户首页：登录态自适应 / 注册开关 / 移动导航 ============ */

(function () {
  const $ = (s) => document.querySelector(s);

  /* ---------- 登录态自适应 ---------- */
  // 已登录员工：显示「进入工作台 / 员工中心」，隐藏「登录 / 注册」
  fetch('/api/auth/me', { headers: { 'Content-Type': 'application/json' } })
    .then((r) => r.json().catch(() => ({})))
    .then((d) => {
      if (d && d.ok && d.data && d.data.user) {
        ['navLoginBtn', 'navRegisterBtn', 'heroLoginBtn', 'heroRegisterBtn', 'ctaLoginBtn', 'ctaRegisterBtn'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
        ['navMeBtn', 'navEnterBtn'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = '';
        });
        const note = $('#lpRegisterNote');
        if (note) note.style.display = 'none';
      }
    })
    .catch(() => { /* 服务异常时保持默认（未登录态） */ });

  /* ---------- 注册开关适配 ---------- */
  // 未开放自助注册时：保留按钮（点击仍去登录页并给出提示），同时在 Hero 下显示说明
  fetch('/api/auth/setup-status')
    .then((r) => r.json().catch(() => ({})))
    .then((d) => {
      if (d && d.ok && d.data && !d.data.selfRegisterEnabled) {
        const note = $('#lpRegisterNote');
        if (note) note.style.display = '';
      }
    })
    .catch(() => { /* 静默 */ });

  /* ---------- 移动端导航 ---------- */
  const toggle = $('#lpNavToggle');
  const links = $('#lpNavLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
    });
    // 点击链接后收起
    links.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => links.classList.remove('open'));
    });
  }
})();
