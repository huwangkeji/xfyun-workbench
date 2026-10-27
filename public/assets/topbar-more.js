/* 顶栏「⋯ 更多」下拉（移动端 ≤720px 生效；桌面端顶栏动作区始终展开，本逻辑无副作用）
   工作台 / 后台管理 / 员工中心 三个页面共用 */
(function initTopMoreMenu() {
  function bind() {
    const btn = document.getElementById('topMoreBtn');
    const menu = document.querySelector('.topbar .top-actions');
    if (!btn || !menu) return;

    function close() {
      menu.classList.remove('show');
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('show');
      menu.classList.toggle('show', willOpen);
      btn.classList.toggle('active', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    // 点菜单外部 / Esc / 任一菜单项 后收起
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('show') && !menu.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    menu.addEventListener('click', (e) => { if (e.target.closest('.btn')) close(); });
    // 回到桌面宽度时复位，避免残留展开态
    window.addEventListener('resize', () => { if (window.innerWidth > 720) close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
