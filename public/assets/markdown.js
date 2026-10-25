/* ============================================================
 * markdown.js —— 零依赖 Markdown 渲染器（浏览器 / Node 双端可用）
 *
 * 安全模型（重要）：
 *   1) 进入行内解析前对全文做 HTML 转义 —— 消息中的原始 HTML / <script>
 *      只会作为文本显示，不会被执行；
 *   2) 只生成白名单标签（h1-h6/p/ul/ol/li/blockquote/pre/code/hr/a/img/
 *      strong/em/del/table 系列/br）；
 *   3) 链接与图片 URL 过协议白名单（http/https/mailto/锚点/相对路径/
 *      data:image），javascript: 等一律丢弃降级为纯文本。
 *
 * 覆盖语法（聊天场景 95%）：标题 / 围栏代码块（带语言标签）/ 无序·有序列表
 * （按缩进嵌套）/ 表格（含对齐）/ 引用（可嵌套渲染）/ 水平线 / 段落（软换行
 * 转 <br>）/ 链接 / 图片 / 粗体 / 斜体 / 删除线 / 行内代码。
 * 明确不做：语法高亮、脚注、任务列表、HTML 直通（安全考虑）。
 *
 * 导出（浏览器挂 window.MD，Node 走 module.exports）：
 *   MD.render(md)   → HTML 字符串
 *   MD.toPlain(md)  → 纯文本（剥离语法，供「复制纯文本」）
 *   MD.escapeHtml(s)→ HTML 转义
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MD = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ---------- 基础工具 ---------- */

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** URL 白名单：http/https/mailto/锚点/相对路径/data:image(base64)；其余协议屏蔽 */
  function safeUrl(url) {
    const u = String(url ?? '').trim().replace(/[\u0000-\u001f\s]/g, '');
    if (!u) return '';
    if (/^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u;
    return ''; // javascript: / vbscript: / file: / 其它 → 丢弃
  }

  /* ---------- 块级解析 ---------- */

  const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+.#-]*)\s*$/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/;
  const RE_QUOTE = /^\s{0,3}>/;
  const RE_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const RE_TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

  /** 该行是否是某个块级元素的起点（用于终止段落收集） */
  function isBlockStart(line, next) {
    return RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line)
      || RE_QUOTE.test(line) || RE_ITEM.test(line)
      || (next != null && line.includes('|') && RE_TABLE_SEP.test(next));
  }

  function renderCodeBlock(lang, code) {
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code-block">${label}<pre><code>${escapeHtml(code)}</code></pre></div>`;
  }

  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function renderTable(header, aligns, rows) {
    const cols = header.length;
    const th = header.map((c, i) => {
      const style = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
      return `<th${style}>${inline(c)}</th>`;
    }).join('');
    const body = rows.map((r) => {
      const tds = [];
      for (let i = 0; i < cols; i++) {
        const style = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
        tds.push(`<td${style}>${inline(r[i] ?? '')}</td>`);
      }
      return `<tr>${tds.join('')}</tr>`;
    }).join('');
    return `<div class="table-wrap-md"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /**
   * 列表块：收集同级列表项（含缩进嵌套与惰性延续），递归渲染每项内容。
   * 返回 [html, 下一行下标]。
   */
  function parseList(lines, i) {
    const first = RE_ITEM.exec(lines[i]);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = []; // 每项：字符串数组（第一项内容 + 后续延续/嵌套行，缩进已相对化）
    let cur = null;

    while (i < lines.length) {
      const line = lines[i];
      const m = RE_ITEM.exec(line);
      if (m) {
        const indent = m[1].length;
        if (indent < baseIndent) break; // 回到更上层列表
        if (indent === baseIndent) {
          if (/\d/.test(m[2]) !== ordered) break; // 有序/无序互换 → 新列表
          cur = [m[3]];
          items.push(cur);
          i++;
          continue;
        }
        // indent > baseIndent：嵌套内容，保留相对缩进并入当前项
        if (cur) { cur.push(line.slice(baseIndent)); i++; continue; }
        break;
      }
      if (!line.trim()) {
        // 空行：仅当下一行仍是「同类型」列表项（同级或更深）时才属于本列表（松散列表）
        const next = lines[i + 1];
        if (next != null) {
          const nm = RE_ITEM.exec(next);
          if (nm && nm[1].length >= baseIndent && (/\d/.test(nm[2]) === ordered)) {
            if (cur) cur.push('');
            i++;
            continue;
          }
        }
        break;
      }
      // 惰性延续行（列表项的段落延续）
      if (cur) { cur.push(line.trim()); i++; continue; }
      break;
    }

    const tag = ordered ? 'ol' : 'ul';
    const lis = items.map((rawLines) => {
      // 去掉项尾空行（松散列表分隔产生的空串）
      const lines_ = rawLines.slice();
      while (lines_.length && lines_[lines_.length - 1] === '') lines_.pop();
      const hasBlock = lines_.some((l, idx) =>
        idx > 0 && (RE_FENCE.test(l) || RE_HEADING.test(l) || RE_QUOTE.test(l) || RE_HR.test(l)));
      // 首个嵌套列表行之前的部分按行内渲染（紧凑列表不包 <p>）
      const nestedIdx = lines_.findIndex((l) => RE_ITEM.test(l));
      if (nestedIdx > 0 && !hasBlock) {
        const lead = lines_.slice(0, nestedIdx).join('\n');
        const rest = lines_.slice(nestedIdx).join('\n');
        return `<li>${inline(lead).replace(/\n/g, '<br>')}${render(rest)}</li>`;
      }
      const inner = (hasBlock || nestedIdx >= 0)
        ? render(lines_.join('\n'))
        : inline(lines_.join('\n')).replace(/\n/g, '<br>');
      return `<li>${inner}</li>`;
    }).join('');
    return [`<${tag}>${lis}</${tag}>`, i];
  }

  function render(md) {
    const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      // 围栏代码块
      const fence = RE_FENCE.exec(line);
      if (fence) {
        const marker = fence[1][0].repeat(3);
        const lang = fence[2] || '';
        const buf = [];
        i++;
        const closeRe = new RegExp('^\\s{0,3}' + marker + '{3,}\\s*$');
        while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过收尾行（缺失则越界即结束）
        out.push(renderCodeBlock(lang, buf.join('\n')));
        continue;
      }

      // 标题
      const h = RE_HEADING.exec(line);
      if (h) {
        const lv = h[1].length;
        out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
        i++;
        continue;
      }

      // 水平线
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用块（连续 > 行合并后递归渲染，支持嵌套）
      if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // 表格（当前行含 | 且下一行是分隔行）
      if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
        const header = splitTableRow(line);
        const aligns = splitTableRow(lines[i + 1]).map((c) => {
          const t = c.trim();
          if (/^:-+:$/.test(t)) return 'center';
          if (/^:-+$/.test(t)) return 'left';
          if (/^-+:$/.test(t)) return 'right';
          return '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !RE_TABLE_SEP.test(lines[i])) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        out.push(renderTable(header, aligns, rows));
        continue;
      }

      // 列表
      if (RE_ITEM.test(line)) {
        const [html, next] = parseList(lines, i);
        out.push(html);
        i = next;
        continue;
      }

      // 段落：收集到空行或下一个块级起点
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    return out.join('\n');
  }

  /* ---------- 行内解析（输入必须先转义） ---------- */

  function inline(s) {
    let t = escapeHtml(s);

    // 行内代码：先占位，避免内容被后续规则误伤
    const codes = [];
    t = t.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(c);
      return `\u0000C${codes.length - 1}\u0000`;
    });

    // 图片 ![alt](url)（须先于链接）
    t = t.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (m, alt, url) => {
      const u = safeUrl(url);
      return u ? `<img src="${u}" alt="${alt}" loading="lazy">` : alt;
    });

    // 链接 [text](url)
    t = t.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (m, txt, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
    });

    // 粗体 / 斜体 / 删除线
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    t = t.replace(/(^|[^\w`])_([^_\n]+)_(?![\w])/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 还原行内代码
    t = t.replace(/\u0000C(\d+)\u0000/g, (m, idx) => `<code>${codes[+idx]}</code>`);
    return t;
  }

  /* ---------- Markdown → 纯文本（复制纯文本用） ---------- */

  function toPlain(md) {
    const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inCode = false;

    for (const raw of lines) {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(raw)) { inCode = !inCode; continue; }
      let line = raw;
      if (!inCode) {
        line = line
          .replace(/^\s{0,3}#{1,6}\s+/, '')                       // 标题
          .replace(/^\s{0,3}>\s?/, '')                            // 引用
          .replace(/^\s{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/, '———') // 水平线
          .replace(/^(\s*)([-*+])\s+/, '$1- ')                    // 无序列表
          .replace(/^(\s*)(\d{1,9})[.)]\s+/, '$1$2. ')            // 有序列表
          .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')               // 图片 → alt
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                // 链接 → 文本
          .replace(/`([^`]+)`/g, '$1')                            // 行内代码
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/__([^_]+)__/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/(^|[^\w])_([^_]+)_(?![\w])/g, '$1$2')
          .replace(/~~([^~]+)~~/g, '$1');
        if (/^\s*\|.*\|\s*$/.test(raw)) {                         // 表格行 → 单元格以 " | " 连接
          line = line.trim().replace(/^\|/, '').replace(/\|$/, '')
            .split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 1 && /^:?-+:?$/.test(c)))
            .join(' | ');
        }
      }
      out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return { render, toPlain, escapeHtml, safeUrl };
});
