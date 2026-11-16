/* 全站动态品牌（后台「系统设置」维护站点名称与底部版权）
 * 页面在带 data-brand 属性的元素上自动填充：
 *   data-brand="siteName"   → 站点名称（text）
 *   data-brand="footerText" → 底部版权（text）
 *   data-brand="siteTitle"  → 页面标题（document.title 前缀替换「 · 」后缀之前的部分）
 * 拉取自 /api/notice（公开只读）；失败时静默保留页面默认文案。
 */
(function applyBranding() {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function bind() {
    fetch('/api/notice')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.data || !d.data.branding) return;
        paint(d.data.branding);
      })
      .catch(function () { /* 静默：保留默认品牌文案 */ });
  }
  function paint(b) {
    if (b.siteName) {
      document.querySelectorAll('[data-brand="siteName"]').forEach(function (el) {
        el.textContent = b.siteName;
      });
      // 页面标题模板：data-template 中 {site} 占位符替换为站点名（改名多次也正确）
      var t = document.querySelector('[data-brand="siteTitle"]');
      if (t) {
        var tpl = t.getAttribute('data-template') || '{site}';
        document.title = tpl.replace('{site}', b.siteName);
      }
    }
    if (b.footerText) {
      document.querySelectorAll('[data-brand="footerText"]').forEach(function (el) {
        el.textContent = b.footerText;
      });
    }
    // 门户首页文案（后台「系统设置」维护；空值保留页面内置默认）
    var textKeys = ['heroBadge', 'heroTitle', 'heroTitleHl', 'heroDesc'];
    for (var i = 0; i < textKeys.length; i++) {
      var k = textKeys[i];
      if (b[k]) {
        document.querySelectorAll('[data-brand="' + k + '"]').forEach(function (el) {
          el.textContent = b[k];
        });
      }
    }
    // 页脚附加信息：联系邮箱 / ICP 备案号（值为空则整段隐藏）
    if (b.contactEmail !== undefined) {
      document.querySelectorAll('[data-brand="contactEmail"]').forEach(function (el) {
        el.textContent = b.contactEmail ? '联系邮箱：' + b.contactEmail : '';
        el.style.display = b.contactEmail ? '' : 'none';
      });
    }
    if (b.icpBeian !== undefined) {
      document.querySelectorAll('[data-brand="icpBeian"]').forEach(function (el) {
        if (!b.icpBeian) {
          el.style.display = 'none';
          return;
        }
        el.style.display = '';
        el.innerHTML = '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">' + esc(b.icpBeian) + '</a>';
      });
    }
    // 公安备案：链接到全国互联网安全管理服务平台查询页（自动提取备案号中的数字作为 code）
    if (b.policeBeian !== undefined) {
      document.querySelectorAll('[data-brand="policeBeian"]').forEach(function (el) {
        if (!b.policeBeian) {
          el.style.display = 'none';
          return;
        }
        el.style.display = '';
        var digits = (String(b.policeBeian).match(/\d{6,}/) || [''])[0];
        var href = digits
          ? 'https://beian.mps.gov.cn/#/query/webSearch?code=' + digits
          : 'https://beian.mps.gov.cn/';
        el.innerHTML = '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + esc(b.policeBeian) + '</a>';
      });
    }
    // 默认主题：仅对无本地偏好的访客生效（用户手动切换过主题则尊重其选择）
    if (b.defaultTheme === 'dark' || b.defaultTheme === 'light') {
      try {
        if (!localStorage.getItem('wb_theme')) {
          document.documentElement.dataset.theme = b.defaultTheme;
          localStorage.setItem('wb_theme', b.defaultTheme);
        }
      } catch (_) { /* 隐私模式忽略 */ }
    }
  }
  // 后台保存后可立即重绘（admin.js 调用）
  window.applyBranding = function () {
    fetch('/api/notice').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.data && d.data.branding) paint(d.data.branding);
    }).catch(function () {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
