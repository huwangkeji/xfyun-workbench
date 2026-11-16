/* 应用图标选择器（后台 admin.html 与工作台 index.html 共用）
 * 依赖：页面上存在 #a_emojiGrid / #a_iconPreview / #a_iconFile /
 *       #a_uploadIconBtn / #a_clearIconBtn / #a_emoji / #a_icon
 * 以及全局 api()（返回 json）与 toast()（提示）。
 */
(function () {
  'use strict';

  // 系统内置 emoji 图标库（数字员工 / 提效工具 / 通用）
  const BUILTIN_EMOJIS = [
    '💼', '🛎️', '📣', '🧑‍💼', '🗂️', '📊', '💻', '⚖️', '🖥️',
    '📝', '📄', '✍️', '📑', '🗒️', '🤖', '💡', '🔧', '📚',
    '🎯', '🚀', '⭐', '📞', '✉️', '🗨️', '🧠', '🌐', '🛡️', '📈'
  ];

  const grid = document.getElementById('a_emojiGrid');
  const preview = document.getElementById('a_iconPreview');
  const fileInput = document.getElementById('a_iconFile');
  const uploadBtn = document.getElementById('a_uploadIconBtn');
  const clearBtn = document.getElementById('a_clearIconBtn');
  const emojiField = document.getElementById('a_emoji');
  const iconField = document.getElementById('a_icon');

  if (!grid || !preview) return; // 非相关页面静默退出

  // 渲染内置 emoji 图标网格
  BUILTIN_EMOJIS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-emoji-item';
    b.textContent = e;
    b.dataset.emoji = e;
    b.addEventListener('click', () => setEmoji(e));
    grid.appendChild(b);
  });

  // 选中 emoji：清除自定义图片，预览显示 emoji
  function setEmoji(e) {
    if (emojiField) emojiField.value = e;
    if (iconField) iconField.value = '';
    preview.innerHTML = '';
    preview.textContent = e;
    preview.classList.remove('has-img');
    markSelected();
  }

  // 预览显示图片
  function setImage(url) {
    if (iconField) iconField.value = url;
    if (emojiField) emojiField.value = '';
    preview.textContent = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    preview.appendChild(img);
    preview.classList.add('has-img');
    markSelected();
  }

  // 高亮当前选中的 emoji 项
  function markSelected() {
    const cur = emojiField ? emojiField.value : '';
    grid.querySelectorAll('.icon-emoji-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.emoji === cur && !(iconField && iconField.value));
    });
  }

  // 上传自定义图片（base64 → /api/upload）
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (!f.type || !f.type.startsWith('image/')) { if (typeof toast === 'function') toast('请选择图片文件', 'error'); return; }
      if (f.size > 2 * 1024 * 1024) { if (typeof toast === 'function') toast('图片不能超过 2MB', 'error'); return; }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('读取失败'));
          r.readAsDataURL(f);
        });
        const res = await api('/api/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
        const file = res.files && res.files[0];
        if (!file || !file.url) throw new Error('上传返回异常');
        setImage(file.url);
        if (typeof toast === 'function') toast('图标已上传', 'success');
      } catch (e) {
        if (typeof toast === 'function') toast('上传失败：' + e.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });
  }

  // 清除自定义图片
  if (clearBtn) {
    clearBtn.addEventListener('click', () => setEmoji(emojiField && emojiField.value ? emojiField.value : '🤖'));
  }

  // 暴露给打开弹窗时回填
  window.iconPickerSet = function (agent) {
    const icon = agent && agent.icon;
    const emoji = agent && agent.emoji;
    if (icon && (icon.startsWith('/') || /^https?:\/\//i.test(icon))) {
      setImage(icon);
    } else {
      setEmoji(emoji || '🤖');
    }
  };
})();
