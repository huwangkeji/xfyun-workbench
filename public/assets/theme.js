/* 主题切换（夜间 / 日间）：html[data-theme] 驱动，localStorage 记忆。
 * 页面 <head> 内联过早初始化防闪烁；本脚本负责绑定 [data-theme-toggle] 按钮并同步按钮文案。
 */
(function initThemeToggle() {
  function cur() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }
  function apply(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('wb_theme', t); } catch (_) { /* 隐私模式忽略 */ }
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      if (b.classList.contains('rail-item')) {
        // 图标栏主题按钮：只更新 title 与内部提示，不覆盖 SVG 结构
        b.title = t === 'dark' ? '切换日间模式' : '切换夜间模式';
        var lbl = b.querySelector('span');
        if (lbl) lbl.textContent = t === 'dark' ? '日间' : '夜间';
        return;
      }
      b.textContent = t === 'dark' ? '☀️ 切换日间模式' : '🌙 切换夜间模式';
    });
  }
  // 绑定所有切换按钮（点击任意一个全站生效，跨页保持）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    apply(cur() === 'dark' ? 'light' : 'dark');
  });
  // 初始同步按钮文案
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(cur()); });
  } else {
    apply(cur());
  }
})();
