/* PDF Do — viewer: page rendering, zoom/fit/layout, thumbnails, outline, search, text extraction */
(function () {
  'use strict';
  const PD = window.PD;
  const { h, $ } = PD;
  const V = (PD.viewer = { readMode: PD.store.get('readMode', 'normal') });
  let doc = null, io = null, thumbIO = null;
  const tasks = new Map();
  let scroller, pagesEl;

  V.init = function () {
    scroller = $('#scroll'); pagesEl = $('#pages');
    V.scroller = scroller; V.pagesEl = pagesEl;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', (e) => {
      if (e.ctrlKey && doc && PD.mode !== 'pages') { e.preventDefault(); V.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }
    }, { passive: false });
    window.addEventListener('resize', PD.debounce(() => { if (doc && doc.fit !== 'custom') V.applyFit(); }, 120));
    new ResizeObserver(PD.debounce(() => { if (doc && doc.fit !== 'custom' && PD.mode !== 'pages') V.applyFit(); }, 100)).observe(scroller);
    // hand tool panning
    let pan = null;
    scroller.addEventListener('mousedown', (e) => {
      if (PD.tool === 'hand' && e.button === 0) { pan = { x: e.clientX, y: e.clientY, sx: scroller.scrollLeft, sy: scroller.scrollTop }; scroller.classList.add('panning'); e.preventDefault(); }
    });
    window.addEventListener('mousemove', (e) => { if (pan) { scroller.scrollLeft = pan.sx - (e.clientX - pan.x); scroller.scrollTop = pan.sy - (e.clientY - pan.y); } });
    window.addEventListener('mouseup', () => { if (pan) { pan = null; scroller.classList.remove('panning'); } });
  };

  const layoutClass = (l) => 'pages ' + (l === 'book' ? 'two book' : l);
  V.scale = () => (doc ? doc.zoom * PD.K : PD.K);
  V.pageEl = (i) => pagesEl.querySelector('.page[data-i="' + i + '"]');
  V.doc = () => doc;

  /* ---------- build ---------- */
  V.build = function (d) {
    doc = d;
    tasks.forEach((t) => { try { t.cancel(); } catch (e) { /* ignore */ } }); tasks.clear();
    if (io) io.disconnect();
    pagesEl.innerHTML = '';
    if (!d || !d.pdf) { V.buildThumbs(null); return; }
    pagesEl.className = layoutClass(d.layout);
    pagesEl.dataset.read = V.readMode;
    io = new IntersectionObserver(onIntersect, { root: scroller, rootMargin: '1400px 0px 1400px 0px' });
    d.info.forEach((inf, i) => {
      const el = h('div', { class: 'page', 'data-i': i },
        h('canvas', { class: 'pcanvas' }),
        h('div', { class: 'ptl textLayer' }),
        h('div', { class: 'ptl hl' }),
        h('div', { class: 'ptl lnk' }),
        h('div', { class: 'ptl ov' }),
        h('div', { class: 'pbadge' }, String(i + 1)));
      pagesEl.appendChild(el);
      io.observe(el);
    });
    V.applyFit(true);
    V.buildThumbs(d);
    V.buildOutline(d);
    setCur(d.cur, true);
    if (d.layout === 'single') showSingle();
    PD.emit('view:built', d);
  };

  function sizePage(el, i) {
    const inf = doc.info[i]; const s = V.scale();
    el.style.width = inf.w * s + 'px'; el.style.height = inf.h * s + 'px';
    el.querySelectorAll('.ptl.hl,.ptl.lnk,.ptl.ov').forEach((l) => { l.style.width = inf.w + 'px'; l.style.height = inf.h + 'px'; l.style.transform = 'scale(' + s + ')'; });
    const tl = el.querySelector('.textLayer'); tl.style.width = inf.w * s + 'px'; tl.style.height = inf.h * s + 'px'; tl.style.setProperty('--scale-factor', s);
  }

  V.applyZoomLayout = function () {
    if (!doc) return;
    const ratio = scroller.scrollHeight ? (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight : 0;
    pagesEl.querySelectorAll('.page').forEach((el) => { sizePage(el, +el.dataset.i); el.dataset.sz = ''; });
    scroller.scrollTop = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
    // re-render visible after layout
    pagesEl.querySelectorAll('.page').forEach((el) => { if (el.dataset.vis === '1') queueRender(+el.dataset.i); });
    PD.emit('view:zoom', doc);
  };

  V.applyFit = function (noRerender) {
    if (!doc || !doc.info.length) return;
    if (doc.fit === 'custom') { if (!noRerender) V.applyZoomLayout(); else pagesEl.querySelectorAll('.page').forEach((el) => sizePage(el, +el.dataset.i)); return; }
    const cols = doc.layout === 'two' || doc.layout === 'book' ? 2 : 1;
    const availW = Math.max(200, scroller.clientWidth - (PD.mode === 'read' || true ? 64 : 0));
    const availH = Math.max(200, scroller.clientHeight - 56);
    const maxW = Math.max(...doc.info.map((p) => p.w)), maxH = Math.max(...doc.info.map((p) => p.h));
    const zw = (availW / cols - (cols > 1 ? 10 : 0)) / (maxW * PD.K);
    const zp = Math.min(zw, availH / (maxH * PD.K));
    const z = doc.fit === 'page' ? zp : zw;
    doc.zoom = PD.clamp(z, 0.1, 6);
    pagesEl.querySelectorAll('.page').forEach((el) => sizePage(el, +el.dataset.i));
    pagesEl.querySelectorAll('.page').forEach((el) => { el.dataset.sz = ''; if (el.dataset.vis === '1') queueRender(+el.dataset.i); });
    PD.emit('view:zoom', doc);
  };

  V.setZoom = function (z, fit) {
    if (!doc) return;
    doc.fit = fit || 'custom';
    if (fit) { V.applyFit(); return; }
    doc.zoom = PD.clamp(z, 0.1, 6);
    V.applyZoomLayout();
  };
  V.zoomBy = (f) => { if (doc) { doc.fit = 'custom'; doc.zoom = PD.clamp(doc.zoom * f, 0.1, 6); V.applyZoomLayout(); } };
  V.setLayout = function (l) {
    if (!doc) return;
    doc.layout = l; pagesEl.className = layoutClass(l);
    if (l === 'single') showSingle(); else pagesEl.querySelectorAll('.page').forEach((e) => e.classList.remove('hide'));
    V.applyFit();
    if (l !== 'single') V.goto(doc.cur, false);
    PD.emit('view:zoom', doc);
  };
  function showSingle() {
    pagesEl.querySelectorAll('.page').forEach((e) => e.classList.toggle('hide', +e.dataset.i !== doc.cur));
    scroller.scrollTop = 0;
  }
  V.setReadMode = function (m) {
    V.readMode = m; PD.store.set('readMode', m); pagesEl.dataset.read = m; scroller.dataset.read = m;
  };

  /* ---------- rendering ---------- */
  const queue = [];
  let working = 0;
  function queueRender(i) { if (!queue.includes(i)) queue.push(i); pump(); }
  function pump() {
    while (working < 2 && queue.length) {
      const i = queue.shift(); working++;
      renderPage(i).catch((e) => { if (!(e && e.name === 'RenderingCancelledException')) if (!/sendWithPromise|destroyed|Worker was/.test((e && e.message) || '')) console.warn('render', i, e); }).finally(() => { working--; pump(); });
    }
  }
  function onIntersect(entries) {
    entries.forEach((en) => {
      const el = en.target; const i = +el.dataset.i;
      if (en.isIntersecting) { el.dataset.vis = '1'; if (!el.dataset.sz || el.dataset.sz !== String(sizeKey(i))) queueRender(i); }
      else { el.dataset.vis = '0'; releasePage(el); }
    });
  }
  const sizeKey = (i) => Math.round(V.scale() * doc.info[i].w) + 'x' + doc.zoom.toFixed(3) + V.readMode;
  function releasePage(el) {
    const c = el.querySelector('canvas'); if (c.width > 1) { const t = tasks.get(+el.dataset.i); if (t) { try { t.cancel(); } catch (e) { /* ignore */ } } c.width = 1; c.height = 1; el.dataset.sz = ''; el.querySelector('.textLayer').innerHTML = ''; }
  }
  async function renderPage(i) {
    const d = doc; const el = V.pageEl(i); if (!el || !d) return;
    const pdfRef = d.pdf; const key = String(sizeKey(i));
    if (el.dataset.sz === key) return;
    const page = await d.page(i);
    if (d !== doc || d.pdf !== pdfRef) return;
    const s = V.scale(); const vp = page.getViewport({ scale: s });
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (vp.width * dpr * vp.height * dpr > 40e6 && dpr > 0.5) dpr -= 0.25;
    const canvas = el.querySelector('canvas');
    const prev = tasks.get(i); if (prev) { try { prev.cancel(); } catch (e) { /* ignore */ } }
    const off = document.createElement('canvas'); off.width = Math.max(1, Math.floor(vp.width * dpr)); off.height = Math.max(1, Math.floor(vp.height * dpr));
    const task = page.render({ canvasContext: off.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, background: 'rgba(255,255,255,1)' });
    tasks.set(i, task);
    await task.promise;
    tasks.delete(i);
    if (d !== doc || d.pdf !== pdfRef) return;
    canvas.width = off.width; canvas.height = off.height; canvas.getContext('2d').drawImage(off, 0, 0);
    canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
    el.dataset.sz = key;
    // text layer
    try {
      const tl = el.querySelector('.textLayer'); tl.innerHTML = ''; tl.style.setProperty('--scale-factor', vp.scale);
      const tc = await page.getTextContent();
      if (d !== doc) return;
      pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] });
    } catch (e) { /* text layer is optional */ }
    renderLinks(el, i, page);
    PD.emit('page:rendered', i);
  }
  async function renderLinks(el, i, page) {
    const lay = el.querySelector('.lnk'); lay.innerHTML = '';
    try {
      const anns = await page.getAnnotations();
      const vp = page.getViewport({ scale: 1 });
      anns.forEach((a) => {
        if (a.subtype !== 'Link' || !(a.url || a.dest || a.unsafeUrl)) return;
        const r = vp.convertToViewportRectangle(a.rect);
        const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
        const a1 = h('a', { class: 'lnkbox', style: { left: x + 'px', top: y + 'px', width: Math.abs(r[2] - r[0]) + 'px', height: Math.abs(r[3] - r[1]) + 'px' }, title: a.url || 'Go to page' });
        a1.addEventListener('click', (e) => { e.preventDefault(); if (a.url) window.open(a.url, '_blank'); else if (a.dest) V.goDest(a.dest); });
        lay.appendChild(a1);
      });
    } catch (e) { /* ignore */ }
  }
  V.goDest = async function (dest) {
    try {
      let arr = dest; if (typeof dest === 'string') arr = await doc.pdf.getDestination(dest);
      if (!arr) return;
      const ref = arr[0]; const idx = typeof ref === 'object' ? await doc.pdf.getPageIndex(ref) : ref;
      V.mark(); V.goto(idx, true);
    } catch (e) { /* ignore */ }
  };

  /* ---------- navigation ---------- */
  function onScroll() {
    if (!doc || doc.layout === 'single' || PD.mode === 'pages') return;
    if (V._raf) return;
    V._raf = requestAnimationFrame(() => {
      V._raf = 0;
      const mid = scroller.scrollTop + scroller.clientHeight * 0.4;
      const els = pagesEl.children; let best = 0;
      for (let k = 0; k < els.length; k++) { const e = els[k]; if (e.offsetTop <= mid) best = k; else break; }
      if (best !== doc.cur) setCur(best);
    });
  }
  function setCur(i, silent) {
    doc.cur = i;
    $('#thumbs') && $('#thumbs').querySelectorAll('.thumb.cur').forEach((t) => t.classList.remove('cur'));
    const t = $('#thumbs') && $('#thumbs').querySelector('.thumb[data-i="' + i + '"]');
    if (t) { t.classList.add('cur'); if (!silent && PD.leftTab === 'pages') { const r = t.getBoundingClientRect(), pr = t.parentElement.getBoundingClientRect(); if (r.top < pr.top || r.bottom > pr.bottom) t.scrollIntoView({ block: 'nearest' }); } }
    PD.emit('page:changed', i);
  }
  V.goto = function (i, smooth) {
    if (!doc) return;
    i = PD.clamp(i, 0, doc.n - 1);
    if (doc.layout === 'single') { doc.cur = i; showSingle(); setCur(i); const el = V.pageEl(i); if (el && el.dataset.vis !== '1') queueRender(i); return; }
    const el = V.pageEl(i); if (!el) return;
    scroller.scrollTo({ top: el.offsetTop - 80, behavior: smooth ? 'smooth' : 'auto' });
    setCur(i);
  };
  const spread = () => (doc.layout === 'two' || doc.layout === 'book' ? 2 : 1);
  V.next = () => doc && V.goto(doc.cur + spread(), true);
  V.prev = () => doc && V.goto(doc.cur - spread(), true);
  // back / forward history for link jumps and search results
  V.hist = { back: [], fwd: [] };
  V.mark = () => { if (doc) { V.hist.back.push(doc.cur); if (V.hist.back.length > 50) V.hist.back.shift(); V.hist.fwd = []; } };
  V.back = () => { if (doc && V.hist.back.length) { V.hist.fwd.push(doc.cur); V.goto(V.hist.back.pop(), true); } };
  V.forward = () => { if (doc && V.hist.fwd.length) { V.hist.back.push(doc.cur); V.goto(V.hist.fwd.pop(), true); } };

  V.refreshPage = function (i) { const el = V.pageEl(i); if (el) { el.dataset.sz = ''; queueRender(i); } };

  /* ---------- thumbnails ---------- */
  V.buildThumbs = function (d) {
    const box = $('#thumbs'); if (!box) return;
    box.innerHTML = '';
    if (thumbIO) thumbIO.disconnect();
    if (!d || !d.pdf) return;
    thumbIO = new IntersectionObserver((ens) => ens.forEach((en) => { if (en.isIntersecting) { thumbIO.unobserve(en.target); drawThumb(d, en.target); } }), { root: box.parentElement, rootMargin: '300px' });
    d.info.forEach((inf, i) => {
      const t = h('div', { class: 'thumb', 'data-i': i, draggable: 'false' },
        h('div', { class: 'tcv', style: { aspectRatio: inf.w + '/' + inf.h } }, h('canvas')),
        h('div', { class: 'tlb' }, String(i + 1)));
      t.addEventListener('click', () => V.goto(i, true));
      box.appendChild(t); thumbIO.observe(t);
    });
  };
  V.thumbCanvas = async function (d, i, width) {
    const page = await d.page(i); const vp0 = page.getViewport({ scale: 1 }); const s = width / vp0.width;
    const vp = page.getViewport({ scale: s * (window.devicePixelRatio > 1 ? 2 : 1) });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(255,255,255,1)' }).promise;
    return c;
  };
  async function drawThumb(d, t) {
    const i = +t.dataset.i;
    try { const c = await V.thumbCanvas(d, i, 150); if (d !== doc) return; const cv = t.querySelector('canvas'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); cv.style.opacity = 1; } catch (e) { /* ignore */ }
  }

  /* ---------- outline ---------- */
  V.buildOutline = async function (d) {
    const box = $('#outline'); if (!box) return;
    box.innerHTML = '';
    let out = null; try { out = await d.pdf.getOutline(); } catch (e) { /* ignore */ }
    d.outline = out;
    if (!out || !out.length) { box.appendChild(h('div', { class: 'empty-note' }, h('span', { html: PD.ic('bookmark', 28, 1.4) }), h('b', null, 'No bookmarks'), h('small', null, 'This document has no outline. Add bookmarks from Pages → Bookmarks.'))); return; }
    const render = (items, depth) => items.map((it) => {
      const row = h('div', { class: 'ol-row', style: 'padding-left:' + (8 + depth * 14) + 'px' }, h('span', { class: 'ol-t' }, it.title || '(untitled)'));
      row.addEventListener('click', () => V.goDest(it.dest || (it.url ? null : null)));
      return h('div', { class: 'ol-node' }, row, it.items && it.items.length ? h('div', null, render(it.items, depth + 1)) : null);
    });
    box.appendChild(h('div', null, render(out, 0)));
  };

  /* ---------- text extraction ---------- */
  V.pageText = async function (d, i) {
    if (d.textCache.has(i)) return d.textCache.get(i);
    const page = await d.page(i); const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = []; let text = '';
    for (const it of tc.items) {
      if (it.str == null) continue;
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]) || it.height || 10;
      const ang = Math.atan2(tx[1], tx[0]);
      const w = it.width * vp.scale;
      const ax = Math.cos(ang) * w, ay = Math.sin(ang) * w;
      const xs = [tx[4], tx[4] + ax, tx[4] + tx[2], tx[4] + ax + tx[2]], ys = [tx[5], tx[5] + ay, tx[5] + tx[3], tx[5] + ay + tx[3]];
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      items.push({ str: it.str, rect, fs: fh, start: text.length, ang, font: it.fontName, base: [tx[4], tx[5]] });
      text += it.str + (it.hasEOL ? '\n' : '');
    }
    const r = { items, text, styles: tc.styles };
    d.textCache.set(i, r); return r;
  };

  /* ---------- search ---------- */
  V.search = async function (q, opts, onProgress) {
    const d = doc; opts = opts || {};
    const res = []; if (!q) return res;
    let flags = opts.matchCase ? 'g' : 'gi';
    let src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (opts.whole) src = '\\b' + src + '\\b';
    const re = new RegExp(src, flags);
    for (let i = 0; i < d.n; i++) {
      const pt = await V.pageText(d, i);
      re.lastIndex = 0; let m;
      while ((m = re.exec(pt.text))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        const s = m.index, e = s + m[0].length;
        const rects = [];
        pt.items.forEach((it) => {
          const a = it.start, b = it.start + it.str.length;
          if (b <= s || a >= e || !it.str.length) return;
          const f0 = (Math.max(s, a) - a) / it.str.length, f1 = (Math.min(e, b) - a) / it.str.length;
          const r = it.rect;
          if (Math.abs(it.ang) < 0.01) rects.push({ x: r.x + r.w * f0, y: r.y, w: r.w * (f1 - f0), h: r.h });
          else rects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        });
        const ctxA = Math.max(0, s - 28), ctxB = Math.min(pt.text.length, e + 40);
        res.push({ page: i, rects, pre: pt.text.slice(ctxA, s).replace(/\s+/g, ' '), hit: m[0], post: pt.text.slice(e, ctxB).replace(/\s+/g, ' ') });
        if (res.length > 3000) break;
      }
      if (onProgress && i % 5 === 0) onProgress((i + 1) / d.n);
      if (res.length > 3000) break;
    }
    return res;
  };
  V.showHits = function (list, activeIdx) {
    pagesEl.querySelectorAll('.hl').forEach((l) => (l.innerHTML = ''));
    list.forEach((m, k) => {
      const el = V.pageEl(m.page); if (!el) return;
      const lay = el.querySelector('.hl');
      m.rects.forEach((r) => lay.appendChild(h('div', { class: 'hit' + (k === activeIdx ? ' active' : ''), style: { left: r.x - 1 + 'px', top: r.y - 1 + 'px', width: r.w + 2 + 'px', height: r.h + 2 + 'px' } })));
    });
  };

  V.pointFromEvent = function (e, i) {
    const el = V.pageEl(i); const r = el.getBoundingClientRect(); const s = r.width / doc.info[i].w;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, s };
  };
  V.pageIndexAt = function (cx, cy) {
    const els = document.elementsFromPoint(cx, cy);
    for (const e of els) { const p = e.closest && e.closest('.page'); if (p) return +p.dataset.i; }
    return -1;
  };

  /* ---------- presentation ---------- */
  V.present = async function () {
    if (!doc) return;
    document.body.classList.add('presenting');
    V._prev = { layout: doc.layout, fit: doc.fit };
    doc.layout = 'single'; doc.fit = 'page'; pagesEl.className = 'pages single';
    try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
    showSingle(); V.applyFit();
    const exit = () => {
      if (document.fullscreenElement) return;
      document.removeEventListener('fullscreenchange', exit);
      document.body.classList.remove('presenting');
      doc.layout = V._prev.layout; doc.fit = V._prev.fit; V.setLayout(doc.layout); V.applyFit();
    };
    document.addEventListener('fullscreenchange', exit);
  };
})();
