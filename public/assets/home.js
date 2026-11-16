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
        ['navMeBtn', 'navEnterBtn', 'heroEnterBtn', 'ctaEnterBtn'].forEach((id) => {
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

  /* ---------- 导航滚动投影 ---------- */
  const nav = document.querySelector('.lp-nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 滚动渐显（尊重系统"减弱动效"设置） ---------- */
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll(
    '.lp-section-head, .lp-grid > .lp-card, .lp-strip-item, .lp-faq details, .lp-hero-visual'
  );
  if (reduceMotion || !('IntersectionObserver' in window)) return; // CSS 已兜底为静态可见
  targets.forEach((el, i) => {
    el.classList.add('reveal');
    // 同一网格内的卡片按序错开 60ms，形成渐次入场
    el.style.setProperty('--reveal-delay', `${(i % 4) * 0.06}s`);
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('reveal-in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach((el) => io.observe(el));
})();
