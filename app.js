/* Retina — paste text, read it comfortably. No dependencies, no build step. */
(function () {
  'use strict';

  const STORAGE_KEY = 'retina:doc';
  const SCROLL_KEY = 'retina:scroll';
  const MAX_STORE = 4_000_000; // chars; larger pastes are simply not remembered across reloads

  const body = document.body;
  const reader = document.getElementById('reader');
  const hint = document.getElementById('hint');
  const keyEl = document.getElementById('key');
  const pasteBtn = document.getElementById('paste');
  const clearBtn = document.getElementById('clear');

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  keyEl.textContent = isMac ? '⌘V' : 'Ctrl+V';

  /* ======================================================================
     Plain text → HTML. Understands the everyday subset of Markdown and
     degrades gracefully for text that isn't Markdown at all.
     ====================================================================== */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linkTag(href, label) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function inline(text) {
    let s = esc(text);
    const tokens = [];
    const stash = (html) => { tokens.push(html); return '\u0000' + (tokens.length - 1) + '\u0000'; };

    // Code spans and links are stashed first so their contents are never touched by emphasis rules.
    s = s.replace(/`([^`\n]+)`/g, (m, c) => stash('<code>' + c + '</code>'));
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images: keep alt text only
    s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (m, t, u) => stash(linkTag(u, t)));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)'"”’])/g, (m, pre, u) => pre + stash(linkTag(u, u)));

    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[i]);
  }

  const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;

  function parseList(lines, i) {
    const items = [];
    const n = lines.length;
    while (i < n) {
      const line = lines[i];
      const m = LIST_RE.exec(line);
      if (m) {
        items.push({
          indent: m[1].replace(/\t/g, '    ').length,
          ordered: /\d/.test(m[2]),
          start: parseInt(m[2], 10),
          text: [m[3]],
        });
        i++;
      } else if (!line.trim()) {
        let j = i;
        while (j < n && !lines[j].trim()) j++;
        if (j < n && LIST_RE.test(lines[j])) i = j; else break;
      } else if (/^\s+\S/.test(line)) {
        items[items.length - 1].text.push(line.trim());
        i++;
      } else {
        break;
      }
    }

    let html = '';
    const stack = [];
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        html += '</li></' + stack.pop().tag + '>';
      }
      const top = stack[stack.length - 1];
      const tag = it.ordered ? 'ol' : 'ul';
      if (!top || it.indent > top.indent) {
        html += '<' + tag + (it.ordered && it.start > 1 ? ' start="' + it.start + '"' : '') + '>';
        stack.push({ indent: it.indent, tag });
      } else {
        html += '</li>';
        if (tag !== top.tag) { html += '</' + top.tag + '><' + tag + '>'; top.tag = tag; }
      }
      html += '<li>' + inline(it.text.join(' '));
    }
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return { html, next: i };
  }

  function textToHtml(text) {
    const lines = text.split('\n');
    const n = lines.length;
    const hasBlankLines = /\n[ \t]*\n/.test(text);
    const out = [];
    let para = [];

    // Hard-wrapped prose (email, PDF) is joined back into paragraphs. Text where
    // most lines already end in punctuation is treated as one paragraph per line.
    function flushPara() {
      if (!para.length) return;
      let perLine = !hasBlankLines;
      if (!perLine && para.length > 1) {
        const ended = para.slice(0, -1).filter((l) => /[.!?:;"”’)]$/.test(l)).length;
        perLine = ended / (para.length - 1) >= 0.6;
      }
      if (perLine) {
        for (const l of para) out.push('<p>' + inline(l) + '</p>');
      } else {
        const joined = para.map((l) => (/ {2,}$/.test(l) ? l.trimEnd() + '<br>' : l)).join('\n');
        out.push('<p>' + inline(joined).replace(/<br>\n/g, '<br>').replace(/\n/g, ' ') + '</p>');
      }
      para = [];
    }

    let i = 0;
    while (i < n) {
      const line = lines[i];
      let m;

      if ((m = /^\s{0,3}(`{3,}|~{3,})/.exec(line))) {
        flushPara();
        const fence = m[1];
        const buf = [];
        i++;
        while (i < n && !(lines[i].trim().startsWith(fence[0].repeat(3)) && /^\s{0,3}[`~]+\s*$/.test(lines[i]))) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { flushPara(); i++; continue; }

      if ((m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))) {
        flushPara();
        const lvl = Math.min(m[1].length, 4);
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        i++; continue;
      }
      if (!para.length && i + 1 < n && /^\s{0,3}(=+|-+)\s*$/.test(lines[i + 1]) && !LIST_RE.test(line)) {
        const lvl = lines[i + 1].trim()[0] === '=' ? 1 : 2;
        out.push('<h' + lvl + '>' + inline(line.trim()) + '</h' + lvl + '>');
        i += 2; continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }

      if (/^\s{0,3}>/.test(line)) {
        flushPara();
        const buf = [];
        while (i < n && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push('<blockquote>' + textToHtml(buf.join('\n')) + '</blockquote>');
        continue;
      }
      if (LIST_RE.test(line)) {
        flushPara();
        const r = parseList(lines, i);
        out.push(r.html);
        i = r.next; continue;
      }

      para.push(line.trim());
      i++;
    }
    flushPara();
    return out.join('\n');
  }

  function fromText(text) {
    const tpl = document.createElement('template');
    tpl.innerHTML = textToHtml(text);
    return tpl.content;
  }

  function codeFragment(text) {
    const frag = document.createDocumentFragment();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = text.replace(/^\n+|\s+$/g, '');
    pre.appendChild(code);
    frag.appendChild(pre);
    return frag;
  }

  /* ======================================================================
     Rich clipboard HTML → a small, safe subset of elements.
     Everything is rebuilt with createElement; nothing from the clipboard
     is ever injected as markup.
     ====================================================================== */

  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME',
    'OBJECT', 'EMBED', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'SOURCE', 'INPUT', 'TEXTAREA',
    'SELECT', 'BUTTON', 'FORM', 'MAP', 'AREA']);
  const HEADINGS = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h4', H6: 'h4' };
  const BLOCK = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'FIGURE',
    'FIGCAPTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY', 'ADDRESS',
    'CENTER', 'FIELDSET', 'LEGEND', 'BODY', 'HTML']);
  const CODE_TAGS = new Set(['CODE', 'KBD', 'SAMP', 'TT', 'VAR']);

  function styleOf(el) {
    const s = el.getAttribute('style');
    return s ? s.toLowerCase() : '';
  }

  function emphasisFor(el, tag, ctx) {
    const st = styleOf(el);
    let bold = tag === 'STRONG' || tag === 'B';
    let italic = tag === 'EM' || tag === 'I';
    let underline = tag === 'U';
    let m;
    if ((m = /font-weight\s*:\s*([^;]+)/.exec(st))) {
      const v = m[1].trim();
      bold = v === 'bold' || v === 'bolder' || parseInt(v, 10) >= 600;
    }
    if ((m = /font-style\s*:\s*([^;]+)/.exec(st))) italic = /italic|oblique/.test(m[1]);
    if ((m = /text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(st))) underline = /underline/.test(m[1]);
    if (ctx.inLink || tag === 'A') underline = false;
    if (ctx.inHeading) bold = false;
    const wraps = [];
    if (bold) wraps.push('strong');
    if (italic) wraps.push('em');
    if (underline) wraps.push('u');
    return wraps;
  }

  function safeHref(el) {
    const href = (el.getAttribute('href') || '').trim();
    return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
  }

  function preText(node) {
    let out = '';
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === Node.TEXT_NODE) { out += c.nodeValue; continue; }
        if (c.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = c.nodeName.toUpperCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'BR') { out += '\n'; continue; }
        const block = BLOCK.has(tag) || tag === 'P';
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(c);
        if (block && !out.endsWith('\n')) out += '\n';
      }
    })(node);
    return out.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  }

  function lastMeaningful(el) {
    let n = el.lastChild;
    while (n && n.nodeType === Node.TEXT_NODE && !n.nodeValue.trim()) n = n.previousSibling;
    return n;
  }

  function appendIfText(dest, el) {
    if (el.textContent.trim()) dest.appendChild(el);
  }

  // Converts the children of `src` into `dest`. With ctx.wrap, loose inline
  // content gets collected into <p> elements; otherwise it goes straight into dest.
  function convertChildren(src, dest, ctx) {
    let p = null;
    const target = () => {
      if (!ctx.wrap) return dest;
      if (!p) { p = document.createElement('p'); dest.appendChild(p); }
      return p;
    };
    const close = () => { p = null; };
    const isOpen = () => !ctx.wrap || !!p;
    for (let n = src.firstChild; n; n = n.nextSibling) walk(n, target, close, isOpen, dest, ctx);
  }

  function walk(node, target, close, isOpen, dest, ctx) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.nodeValue;
      if (!ctx.pre) {
        text = text.replace(/\s+/g, ' ');
        if (text === ' ' && !isOpen()) return;
      }
      if (text) target().appendChild(document.createTextNode(text));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.nodeName.toUpperCase();
    if (SKIP.has(tag)) return;

    if (tag === 'BR') {
      const t = target();
      const last = lastMeaningful(t);
      if (ctx.wrap && last && last.nodeName === 'BR') { last.remove(); close(); }   // <br><br> → paragraph break
      else t.appendChild(document.createElement('br'));
      return;
    }
    if (tag === 'HR') { close(); dest.appendChild(document.createElement('hr')); return; }

    if (HEADINGS[tag]) {
      close();
      const h = document.createElement(HEADINGS[tag]);
      convertChildren(node, h, { ...ctx, wrap: false, inHeading: true });
      appendIfText(dest, h);
      return;
    }
    if (tag === 'P') {
      close();
      const p = document.createElement('p');
      convertChildren(node, p, { ...ctx, wrap: false });
      appendIfText(dest, p);
      return;
    }
    if (tag === 'PRE') {
      close();
      const text = preText(node);
      if (text) dest.appendChild(codeFragment(text));
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      close();
      const bq = document.createElement('blockquote');
      convertChildren(node, bq, { ...ctx, wrap: true });
      appendIfText(dest, bq);
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      close();
      const list = document.createElement(tag.toLowerCase());
      const start = parseInt(node.getAttribute('start'), 10);
      if (tag === 'OL' && start > 1) list.setAttribute('start', String(start));
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === Node.TEXT_NODE) { continue; }
        if (c.nodeType !== Node.ELEMENT_NODE) continue;
        const ct = c.nodeName.toUpperCase();
        if (ct === 'LI') { walk(c, () => list, () => {}, () => true, list, ctx); continue; }
        if (ct === 'UL' || ct === 'OL') {
          const li = list.lastElementChild || list.appendChild(document.createElement('li'));
          walk(c, () => li, () => {}, () => true, li, ctx);
          continue;
        }
        if (SKIP.has(ct)) continue;
        const li = document.createElement('li');
        convertChildren(c, li, { ...ctx, wrap: false });
        appendIfText(list, li);
      }
      if (list.children.length) dest.appendChild(list);
      return;
    }
    if (tag === 'LI') {
      close();
      const li = document.createElement('li');
      convertChildren(node, li, { ...ctx, wrap: false });
      if (!li.textContent.trim()) return;
      let list = dest;
      if (list.nodeName !== 'UL' && list.nodeName !== 'OL') {
        list = dest.lastElementChild && dest.lastElementChild.nodeName === 'UL' ? dest.lastElementChild : dest.appendChild(document.createElement('ul'));
      }
      list.appendChild(li);
      return;
    }
    if (tag === 'TD' || tag === 'TH') {
      const t = target();
      if (t.textContent.trim()) t.appendChild(document.createTextNode(' · '));
      convertChildren(node, t, { ...ctx, wrap: false });
      return;
    }
    if (BLOCK.has(tag)) {
      close();
      convertChildren(node, dest, { ...ctx, wrap: true });
      close();
      return;
    }

    // Inline element.
    const wraps = emphasisFor(node, tag, ctx);
    const isLink = tag === 'A' && !ctx.inLink && safeHref(node);
    const isCode = CODE_TAGS.has(tag) && !ctx.pre;
    if (!wraps.length && !isLink && !isCode) {
      // Transparent wrapper (span, font, a without href…): treat its children as siblings.
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, target, close, isOpen, dest, ctx);
      return;
    }
    const parent = target();
    let inner = parent;
    if (isLink) {
      const a = document.createElement('a');
      a.href = safeHref(node);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      inner.appendChild(a);
      inner = a;
    }
    for (const w of wraps) inner = inner.appendChild(document.createElement(w));
    if (isCode) inner = inner.appendChild(document.createElement('code'));
    convertChildren(node, inner, { ...ctx, wrap: false, inLink: ctx.inLink || !!isLink });
    hoistEdgeSpace(parent.lastChild, parent);
  }

  // Moves leading/trailing whitespace out of an inline wrapper so underlines and
  // code backgrounds don't start with a space.
  function hoistEdgeSpace(wrapper, parent) {
    if (!wrapper || wrapper.nodeType !== Node.ELEMENT_NODE) return;
    let deepFirst = wrapper;
    while (deepFirst.firstChild && deepFirst.firstChild.nodeType === Node.ELEMENT_NODE && deepFirst.firstChild.nodeName !== 'BR') deepFirst = deepFirst.firstChild;
    const f = deepFirst.firstChild;
    if (f && f.nodeType === Node.TEXT_NODE && /^\s/.test(f.nodeValue)) {
      f.nodeValue = f.nodeValue.replace(/^\s+/, '');
      parent.insertBefore(document.createTextNode(' '), wrapper);
      if (!f.nodeValue) f.remove();
    }
    let deepLast = wrapper;
    while (deepLast.lastChild && deepLast.lastChild.nodeType === Node.ELEMENT_NODE && deepLast.lastChild.nodeName !== 'BR') deepLast = deepLast.lastChild;
    const l = deepLast.lastChild;
    if (l && l.nodeType === Node.TEXT_NODE && /\s$/.test(l.nodeValue)) {
      l.nodeValue = l.nodeValue.replace(/\s+$/, '');
      parent.appendChild(document.createTextNode(' '));
      if (!l.nodeValue) l.remove();
    }
    if (!wrapper.textContent && !wrapper.querySelector('br')) wrapper.remove();
  }

  function trimEdges(el) {
    const f = el.firstChild;
    if (f && f.nodeType === Node.TEXT_NODE) { f.nodeValue = f.nodeValue.replace(/^\s+/, ''); if (!f.nodeValue) f.remove(); }
    const l = el.lastChild;
    if (l && l.nodeType === Node.TEXT_NODE) { l.nodeValue = l.nodeValue.replace(/\s+$/, ''); if (!l.nodeValue) l.remove(); }
    if (el.lastChild && el.lastChild.nodeName === 'BR') el.lastChild.remove();
  }

  function cleanup(root) {
    for (const el of root.querySelectorAll('p, h1, h2, h3, h4, li, blockquote')) {
      trimEdges(el);
      if (!el.textContent.trim() && !el.querySelector('pre')) el.remove();
    }
    for (const el of root.querySelectorAll('ul, ol')) if (!el.children.length) el.remove();
  }

  function fromDom(bodyEl) {
    const frag = document.createDocumentFragment();
    convertChildren(bodyEl, frag, { wrap: true, pre: false, inLink: false, inHeading: false });
    cleanup(frag);
    return frag;
  }

  // Text copied out of a code editor arrives as styled <div>s in a monospace font.
  function looksLikeEditorCopy(doc) {
    const el = doc.body.querySelector('[style*="font-family"]');
    if (!el) return false;
    const m = /font-family\s*:\s*([^;]+)/.exec(styleOf(el));
    if (!m || !/mono|menlo|monaco|consolas|courier|fira code|jetbrains|source code|cascadia|inconsolata|hack/.test(m[1])) return false;
    return el.textContent.length >= doc.body.textContent.length * 0.9;
  }

  /* ======================================================================
     Putting it together.
     ====================================================================== */

  function build(html, text) {
    text = (text || '').replace(/\r\n?/g, '\n');
    let frag = null;
    if (html && html.trim()) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (looksLikeEditorCopy(doc) && text.trim()) {
        frag = codeFragment(text);
      } else {
        frag = fromDom(doc.body);
        // If the HTML carried no real structure, or dropped content, prefer the plain text.
        const blocks = frag.querySelectorAll('p, h1, h2, h3, h4, ul, ol, pre, blockquote').length;
        const got = frag.textContent.replace(/\s+/g, ' ').trim().length;
        const want = text.replace(/\s+/g, ' ').trim().length;
        const flat = blocks <= 1 && !frag.querySelector('pre') && /\n\s*\S/.test(text.trim());
        if (text.trim() && (got < want * 0.8 || flat)) frag = null;
      }
    }
    if (!frag) {
      if (!text.trim()) return null;
      frag = fromText(text);
    }
    return frag.childNodes.length ? frag : null;
  }

  function show(frag) {
    reader.replaceChildren(frag);
    body.dataset.state = 'reading';
  }

  function load(source, restoring) {
    const frag = build(source.html, source.text);
    if (!frag) return false;
    show(frag);
    if (!restoring) {
      window.scrollTo(0, 0);
      remember(source);
    }
    return true;
  }

  function clear() {
    reader.replaceChildren();
    body.dataset.state = 'empty';
    window.scrollTo(0, 0);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SCROLL_KEY); } catch (e) { /* ignore */ }
  }

  function remember(source) {
    try {
      const html = source.html || '';
      const text = source.text || '';
      if (html.length + text.length > MAX_STORE) { localStorage.removeItem(STORAGE_KEY); return; }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ h: html, t: text }));
      localStorage.removeItem(SCROLL_KEY);
    } catch (e) { /* storage unavailable or full: reading still works, it just won't survive a reload */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!saved || !load({ html: saved.h, text: saved.t }, true)) return;
    let y = 0;
    try { y = parseInt(localStorage.getItem(SCROLL_KEY), 10) || 0; } catch (e) { /* ignore */ }
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
  }

  /* ---------- Input ---------- */

  document.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    if (!html && !text.trim()) return;
    e.preventDefault();
    load({ html, text });
  });

  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    const file = dt.files && dt.files[0];
    if (file) {
      if (file.type && !/^text\/|json|xml|javascript/.test(file.type)) return;
      file.text().then((text) => load({ html: '', text }));
      return;
    }
    load({ html: dt.getData('text/html'), text: dt.getData('text/plain') });
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        let html = '', text = '';
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
        if (html || text.trim()) { load({ html, text }); return; }
      } else if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text.trim()) { load({ html: '', text }); return; }
      }
      hint.textContent = 'The clipboard is empty. Copy some text, then press ' + keyEl.textContent + '.';
    } catch (e) {
      hint.textContent = 'Clipboard access was blocked. Press ' + keyEl.textContent + ' to paste instead.';
    }
  });

  clearBtn.addEventListener('click', clear);

  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    if (scrollTimer || body.dataset.state !== 'reading') return;
    scrollTimer = setTimeout(() => {
      scrollTimer = 0;
      try { localStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY))); } catch (e) { /* ignore */ }
    }, 400);
  }, { passive: true });

  restore();

  // Exposed for tests only.
  window.__retina = { textToHtml, build, load, clear };
})();
