/* PDF Do — compare two PDFs: visual diff (side-by-side / overlay / swipe) + text diff + change summary */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;
  const C = (PD.compare = { A: null, B: null, mode: 'side', page: 0, thr: 40, results: [], busyTok: 0, built: false });

  /* ---------- word diff (Myers) ---------- */
  function diffTokens(a, b) {
    // trim common prefix/suffix
    let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb); const N = A.length, M = B.length;
    const ops = []; for (let i = 0; i < s; i++) ops.push(['=', a[i]]);
    if (N * M === 0) { A.forEach((t) => ops.push(['-', t])); B.forEach((t) => ops.push(['+', t])); }
    else if (N + M > 9000) { A.forEach((t) => ops.push(['-', t])); B.forEach((t) => ops.push(['+', t])); }
    else {
      const max = N + M, off = max; let v = new Int32Array(2 * max + 2); const trace = []; let found = false;
      for (let d = 0; d <= max && !found; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1; let y = x - k;
          while (x < N && y < M && A[x] === B[y]) { x++; y++; }
          v[off + k] = x; if (x >= N && y >= M) { found = true; break; }
        }
        if (trace.length > 3000 && !found) { break; }
      }
      if (!found) { A.forEach((t) => ops.push(['-', t])); B.forEach((t) => ops.push(['+', t])); }
      else {
        let x = N, y = M; const rev = [];
        for (let d = trace.length - 1; d >= 0; d--) {
          const vv = trace[d]; const k = x - y;
          const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
          const px = vv[off + prevK], py = px - prevK;
          while (x > px && y > py) { rev.push(['=', A[x - 1]]); x--; y--; }
          if (d > 0) { if (x === px) rev.push(['+', B[y - 1]]); else rev.push(['-', A[x - 1]]); }
          x = px; y = py;
        }
        rev.reverse().forEach((o) => ops.push(o));
      }
    }
    for (let i = ea; i < a.length; i++) ops.push(['=', a[i]]);
    return ops;
  }
  const tokenize = (t) => t.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

  async function pageWords(doc, i) { if (i >= doc.n) return []; const pt = await PD.viewer.pageText(doc, i); return tokenize(pt.text); }

  /* ---------- pixel diff ---------- */
  function drawFit(src, w, hh) { const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(src, 0, 0, w, hh); return c; }
  function diffMask(ca, cb, thr) {
    const w = ca.width, hh = ca.height; const da = ca.getContext('2d').getImageData(0, 0, w, hh).data, db = cb.getContext('2d').getImageData(0, 0, w, hh).data;
    const mask = new Uint8Array(w * hh); let count = 0;
    for (let p = 0, q = 0; p < da.length; p += 4, q++) { const d = Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2])); if (d > thr) { mask[q] = 1; count++; } }
    return { mask, count, w, h: hh };
  }
  function regions(m, cell) {
    const cw = Math.ceil(m.w / cell), ch = Math.ceil(m.h / cell); const grid = new Uint8Array(cw * ch);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) grid[Math.floor(y / cell) * cw + Math.floor(x / cell)]++;
    const seen = new Uint8Array(cw * ch); const boxes = [];
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] || seen[i]) continue;
      const st = [i]; seen[i] = 1; let x0 = cw, y0 = ch, x1 = 0, y1 = 0, sum = 0;
      while (st.length) {
        const c = st.pop(); const cx = c % cw, cy = (c / cw) | 0; sum += grid[c];
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue; const n = ny * cw + nx; if (grid[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      }
      if (sum >= 3) boxes.push({ x: x0 * cell, y: y0 * cell, w: (x1 - x0 + 1) * cell, h: (y1 - y0 + 1) * cell });
    }
    return boxes;
  }

  /* ---------- UI ---------- */
  C.build = function () {
    const root = PD.$('#compareview'); if (C.built) return; C.built = true;
    root.innerHTML = '';
    C.selA = h('select', { class: 'input select', onchange: () => { C.A = PD.docs.find((d) => d.id === C.selA.value) || null; C.changed(); } });
    C.selB = h('select', { class: 'input select', onchange: () => { C.B = PD.docs.find((d) => d.id === C.selB.value) || null; C.changed(); } });
    C.modeSeg = PD.ui.seg([{ v: 'side', icon: 'columns', label: 'Side by side' }, { v: 'overlay', icon: 'layers', label: 'Overlay' }, { v: 'swipe', icon: 'diff', label: 'Swipe' }, { v: 'text', icon: 'text', label: 'Text' }], C.mode, (v) => { C.mode = v; C.render(); });
    C.thrR = PD.ui.range(8, 120, 2, 128 - C.thr, (v) => { C.thr = 128 - v; clearTimeout(C._t); C._t = setTimeout(() => { C.analyze(); C.render(); }, 250); }, (v) => (v > 80 ? 'High' : v > 50 ? 'Medium' : 'Low'));
    C.pageLbl = h('span', { class: 'cmp-page' }, '—');
    const bar = h('div', { class: 'cmp-bar' },
      h('div', { class: 'cmp-slot a' }, h('span', { class: 'cmp-tag' }, 'A'), C.selA, h('button', { class: 'icon-btn', 'data-tip': 'Open a PDF as A', html: PD.ic('open', 16), onclick: () => C.openInto('A') })),
      h('button', { class: 'icon-btn swap', 'data-tip': 'Swap A and B', html: PD.ic('convert', 16), onclick: () => { [C.A, C.B] = [C.B, C.A]; C.changed(); } }),
      h('div', { class: 'cmp-slot b' }, h('span', { class: 'cmp-tag' }, 'B'), C.selB, h('button', { class: 'icon-btn', 'data-tip': 'Open a PDF as B', html: PD.ic('open', 16), onclick: () => C.openInto('B') })),
      h('div', { class: 'cmp-sep' }), C.modeSeg,
      h('div', { class: 'cmp-sens', 'data-tip': 'How small a pixel change counts as a difference' }, h('span', null, 'Sensitivity'), C.thrR),
      h('div', { class: 'cmp-nav' }, h('button', { class: 'icon-btn', html: PD.ic('left', 16), onclick: () => C.go(C.page - 1) }), C.pageLbl, h('button', { class: 'icon-btn', html: PD.ic('right', 16), onclick: () => C.go(C.page + 1) })),
      h('button', { class: 'btn small', html: PD.ic('download', 14) + '<span>Report</span>', onclick: () => C.report() }));
    C.list = h('div', { class: 'cmp-list' });
    C.sumEl = h('div', { class: 'cmp-sum' });
    C.stage = h('div', { class: 'cmp-stage' });
    root.append(bar, h('div', { class: 'cmp-body' }, h('aside', { class: 'cmp-side' }, C.sumEl, C.list), C.stage));
    new ResizeObserver(PD.debounce(() => { if (PD.mode === 'compare') C.render(); }, 150)).observe(C.stage);
  };
  C.openInto = async function (slot) {
    const f = await PD.pickFiles({ accept: '.pdf,application/pdf', desc: 'PDF documents' }); if (!f.length) return;
    const prevCur = PD.cur; const d = await PD.openFiles(f); if (!d) return;
    if (slot === 'A') C.A = d; else C.B = d; PD.setMode('compare'); C.changed();
  };
  C.refreshSelects = function () {
    if (!C.built) return;
    [[C.selA, C.A], [C.selB, C.B]].forEach(([sel, cur]) => {
      sel.innerHTML = ''; sel.appendChild(h('option', { value: '' }, '— choose a document —'));
      PD.docs.forEach((d) => sel.appendChild(h('option', { value: d.id, selected: cur === d }, d.name)));
    });
  };
  C.enter = function () {
    C.build();
    if (!C.A || !PD.docs.includes(C.A)) C.A = PD.cur || PD.docs[0] || null;
    if (!C.B || !PD.docs.includes(C.B) || C.B === C.A) C.B = PD.docs.find((d) => d !== C.A) || null;
    C.changed();
  };
  C.changed = function () { C.refreshSelects(); C.page = 0; C.analyze(); C.render(); };
  C.go = (i) => { const n = Math.max(C.A ? C.A.n : 0, C.B ? C.B.n : 0); C.page = PD.clamp(i, 0, Math.max(0, n - 1)); C.render(); markList(); };

  function empty(msg, sub) {
    C.stage.innerHTML = ''; C.stage.appendChild(h('div', { class: 'cmp-empty' }, h('span', { html: PD.ic('compare', 48, 1.2) }), h('b', null, msg), h('small', null, sub || ''),
      h('div', { class: 'btnrow center' }, h('button', { class: 'btn primary', onclick: () => C.openInto('A'), html: PD.ic('open', 16) + '<span>Open document A…</span>' }), h('button', { class: 'btn', onclick: () => C.openInto('B'), html: PD.ic('open', 16) + '<span>Open document B…</span>' }))));
  }

  /* ---------- analysis (all pages, low-res) ---------- */
  C.analyze = async function () {
    const tok = ++C.busyTok; C.results = []; C.list.innerHTML = ''; C.sumEl.innerHTML = '';
    if (!C.A || !C.B) return;
    const A = C.A, B = C.B; const n = Math.max(A.n, B.n);
    C.sumEl.appendChild(h('div', { class: 'cmp-prog' }, h('i')));
    for (let i = 0; i < n; i++) {
      if (tok !== C.busyTok) return;
      const r = { i, state: 'same', pct: 0, boxes: 0, add: 0, del: 0 };
      if (i >= A.n) r.state = 'onlyB'; else if (i >= B.n) r.state = 'onlyA';
      else {
        try {
          const [ca, cb] = await Promise.all([PD.tools.renderToCanvas(A.pdf, i, 0.5), PD.tools.renderToCanvas(B.pdf, i, 0.5)]);
          const w = ca.width, hh = ca.height; const cb2 = drawFit(cb, w, hh); const m = diffMask(ca, cb2, C.thr);
          r.pct = (m.count / (w * hh)) * 100; r.boxes = regions(m, 8).length; r.sizeDiff = Math.abs(A.info[i].w - B.info[i].w) > 2 || Math.abs(A.info[i].h - B.info[i].h) > 2;
          const [wa, wb] = [await pageWords(A, i), await pageWords(B, i)];
          const ops = diffTokens(wa, wb); r.add = ops.filter((o) => o[0] === '+').length; r.del = ops.filter((o) => o[0] === '-').length;
          if (r.add || r.del || r.boxes) r.state = 'changed';
        } catch (e) { r.state = 'changed'; }
      }
      C.results.push(r); addRow(r);
      const bar = C.sumEl.querySelector('.cmp-prog i'); if (bar) bar.style.width = ((i + 1) / n) * 100 + '%';
      await PD.frame();
    }
    if (tok !== C.busyTok) return;
    const ch = C.results.filter((r) => r.state !== 'same').length;
    C.sumEl.innerHTML = '';
    C.sumEl.appendChild(h('div', { class: 'cmp-score ' + (ch ? 'diff' : 'same') }, h('span', { html: PD.ic(ch ? 'diff' : 'check', 22, 2) }), h('div', null, h('b', null, ch ? ch + ' of ' + n + ' pages differ' : 'Documents match'), h('small', null, ch ? C.results.reduce((s, r) => s + r.add, 0) + ' words added · ' + C.results.reduce((s, r) => s + r.del, 0) + ' removed' : 'No visual or text differences found'))));
    markList();
  };
  function addRow(r) {
    const lab = r.state === 'same' ? 'Identical' : r.state === 'onlyA' ? 'Only in A' : r.state === 'onlyB' ? 'Only in B' : (r.add || r.del ? '+' + r.add + ' −' + r.del + ' words' : r.pct.toFixed(1) + '% changed');
    const row = h('button', { class: 'cmp-row ' + r.state, 'data-i': r.i, onclick: () => C.go(r.i) }, h('span', { class: 'dot' }), h('b', null, 'Page ' + (r.i + 1)), h('small', null, lab));
    C.list.appendChild(row);
  }
  function markList() { PD.$$('.cmp-row', C.list).forEach((r) => r.classList.toggle('cur', +r.dataset.i === C.page)); const c = C.list.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest' }); }

  /* ---------- rendering ---------- */
  C.render = async function () {
    if (!C.built) return;
    if (!C.A || !C.B) { empty('Pick two documents to compare', 'Open two PDFs, then choose them as A and B above.'); C.pageLbl.textContent = '—'; return; }
    const tok = ++C.renderTok || (C.renderTok = 1); C.renderTok = tok;
    const n = Math.max(C.A.n, C.B.n); C.pageLbl.textContent = 'Page ' + (C.page + 1) + ' / ' + n;
    const i = C.page; const A = C.A, B = C.B;
    if (C.mode === 'text') return renderText(i, tok);
    const sw = C.stage.clientWidth - 40, sh = C.stage.clientHeight - 40;
    const inA = i < A.n, inB = i < B.n;
    const ref = inA ? A.info[i] : B.info[i];
    const cols = C.mode === 'side' ? 2 : 1;
    const wMax = (sw - (cols - 1) * 16) / cols;
    const scale = Math.max(0.2, Math.min(wMax / ref.w, sh / ref.h > 0.3 ? (C.mode === 'side' ? 3 : (sh) / ref.h * 1) : 3));
    const sc = Math.min(wMax / ref.w, 2.2);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let ca = null, cb = null;
    try {
      if (inA) ca = await PD.tools.renderToCanvas(A.pdf, i, sc * dpr);
      if (inB) cb = await PD.tools.renderToCanvas(B.pdf, i, sc * dpr);
    } catch (e) { return; }
    if (tok !== C.renderTok) return;
    const W = (ca || cb).width, H = (ca || cb).height;
    const ca2 = ca ? drawFit(ca, W, H) : null, cb2 = cb ? drawFit(cb, W, H) : null;
    let boxes = [];
    if (ca2 && cb2) { const m = diffMask(ca2, cb2, C.thr); boxes = regions(m, Math.max(6, Math.round(10 * dpr))); C.lastMask = m; }
    C.stage.innerHTML = '';
    const cssW = W / dpr;
    const mkPanel = (cv, label, cls, showBoxes) => {
      const wrap = h('div', { class: 'cmp-panel ' + cls }, h('div', { class: 'cmp-plabel' }, h('span', { class: 'cmp-tag ' + cls }, label), h('b', null, label === 'A' ? A.name : B.name)));
      if (!cv) { wrap.appendChild(h('div', { class: 'cmp-missing', style: 'width:' + cssW + 'px;height:' + H / dpr + 'px' }, 'No page ' + (i + 1) + ' in this document')); return wrap; }
      const pg = h('div', { class: 'cmp-pg', style: 'width:' + cssW + 'px;height:' + H / dpr + 'px' }); cv.style.cssText = 'width:100%;height:100%;display:block'; pg.appendChild(cv);
      if (showBoxes) boxes.forEach((b) => pg.appendChild(h('div', { class: 'cmp-box ' + cls, style: 'left:' + (b.x / W) * 100 + '%;top:' + (b.y / H) * 100 + '%;width:' + (b.w / W) * 100 + '%;height:' + (b.h / H) * 100 + '%' })));
      wrap.appendChild(pg); return wrap;
    };
    if (C.mode === 'side') {
      C.stage.appendChild(h('div', { class: 'cmp-cols' }, mkPanel(ca2, 'A', 'a', true), mkPanel(cb2, 'B', 'b', true)));
    } else if (C.mode === 'overlay') {
      if (!ca2 || !cb2) { C.stage.appendChild(h('div', { class: 'cmp-cols' }, mkPanel(ca2, 'A', 'a'), mkPanel(cb2, 'B', 'b'))); return; }
      const out = document.createElement('canvas'); out.width = W; out.height = H; const x = out.getContext('2d');
      const da = ca2.getContext('2d').getImageData(0, 0, W, H), db = cb2.getContext('2d').getImageData(0, 0, W, H); const o = x.createImageData(W, H);
      for (let p = 0; p < da.data.length; p += 4) { const ga = (da.data[p] + da.data[p + 1] + da.data[p + 2]) / 3, gb = (db.data[p] + db.data[p + 1] + db.data[p + 2]) / 3; o.data[p] = gb; o.data[p + 1] = ga; o.data[p + 2] = ga; o.data[p + 3] = 255; }
      x.putImageData(o, 0, 0);
      const pg = h('div', { class: 'cmp-pg', style: 'width:' + cssW + 'px;height:' + H / dpr + 'px' }, out); out.style.cssText = 'width:100%;height:100%;display:block';
      C.stage.appendChild(h('div', { class: 'cmp-single' }, h('div', { class: 'cmp-legend' }, h('span', { class: 'lg a' }, 'Only in A'), h('span', { class: 'lg b' }, 'Only in B'), h('span', { class: 'lg s' }, 'Same')), pg));
    } else {
      if (!ca2 || !cb2) { C.stage.appendChild(h('div', { class: 'cmp-cols' }, mkPanel(ca2, 'A', 'a'), mkPanel(cb2, 'B', 'b'))); return; }
      const pg = h('div', { class: 'cmp-pg swipe', style: 'width:' + cssW + 'px;height:' + H / dpr + 'px' }); ca2.style.cssText = 'width:100%;height:100%;display:block'; cb2.style.cssText = 'width:100%;height:100%;display:block;';
      const top = h('div', { class: 'swipe-top' }, cb2); top.style.width = '50%'; cb2.style.width = cssW + 'px'; cb2.style.maxWidth = 'none';
      const handle = h('div', { class: 'swipe-handle', style: 'left:50%' }, h('i', { html: PD.ic('columns', 16) }));
      pg.append(ca2, top, handle, h('span', { class: 'cmp-tag a swl' }, 'A'), h('span', { class: 'cmp-tag b swr' }, 'B'));
      const move = (e) => { const r = pg.getBoundingClientRect(); const p = PD.clamp(((e.clientX - r.left) / r.width) * 100, 0, 100); top.style.width = p + '%'; handle.style.left = p + '%'; };
      handle.addEventListener('pointerdown', (e) => { handle.setPointerCapture(e.pointerId); const mv = (ev) => move(ev); const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); }; handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); });
      pg.addEventListener('click', move);
      C.stage.appendChild(h('div', { class: 'cmp-single' }, h('div', { class: 'cmp-legend' }, h('span', { class: 'lg' }, 'Drag the handle (or click) to reveal A ◀ ▶ B')), pg));
    }
  };

  async function renderText(i, tok) {
    const A = C.A, B = C.B; const wa = await pageWords(A, i), wb = await pageWords(B, i); if (tok !== C.renderTok) return;
    const ops = diffTokens(wa, wb); let add = 0, del = 0;
    const colA = h('div', { class: 'tx-col' }), colB = h('div', { class: 'tx-col' });
    const frag = (list, kind) => { let buf = '', cur = null; const out = []; list.forEach(([t, w]) => { if (t === cur) buf += ' ' + w; else { if (buf) out.push([cur, buf]); cur = t; buf = w; } }); if (buf) out.push([cur, buf]); return out; };
    frag(ops.filter((o) => o[0] !== '+'), 'a').forEach(([t, s]) => colA.appendChild(t === '-' ? h('del', null, s + ' ') : document.createTextNode(s + ' ')));
    frag(ops.filter((o) => o[0] !== '-'), 'b').forEach(([t, s]) => colB.appendChild(t === '+' ? h('ins', null, s + ' ') : document.createTextNode(s + ' ')));
    ops.forEach((o) => { if (o[0] === '+') add++; else if (o[0] === '-') del++; });
    if (!wa.length && !wb.length) { colA.appendChild(h('em', { class: 'muted' }, 'No selectable text on this page (scanned?). Run OCR from Convert for a text comparison.')); }
    C.stage.innerHTML = '';
    C.stage.appendChild(h('div', { class: 'tx-wrap' },
      h('div', { class: 'tx-sum' }, h('span', { class: 'chip' }, 'Page ' + (i + 1)), h('span', { class: 'add' }, '+' + add + ' added'), h('span', { class: 'del' }, '−' + del + ' removed'), add + del === 0 ? h('span', { class: 'muted' }, 'Text is identical on this page') : null),
      h('div', { class: 'tx-grid' }, h('div', null, h('div', { class: 'tx-h' }, h('span', { class: 'cmp-tag a' }, 'A'), A.name), colA), h('div', null, h('div', { class: 'tx-h' }, h('span', { class: 'cmp-tag b' }, 'B'), B.name), colB))));
  }

  C.report = function () {
    if (!C.A || !C.B || !C.results.length) { PD.toast('Run a comparison first', 'info'); return; }
    const rows = C.results.map((r) => '<tr class="' + r.state + '"><td>' + (r.i + 1) + '</td><td>' + ({ same: 'Identical', changed: 'Changed', onlyA: 'Only in A', onlyB: 'Only in B' }[r.state]) + '</td><td>' + r.pct.toFixed(2) + '%</td><td>+' + r.add + ' / −' + r.del + '</td></tr>').join('');
    const html = '<!doctype html><meta charset="utf-8"><title>Comparison report</title><style>body{font:14px system-ui;margin:40px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}tr.changed{background:#fff4f4}tr.onlyA,tr.onlyB{background:#fff9e6}h1{margin:0 0 4px}</style><h1>PDF comparison report</h1><p>A: <b>' + PD.esc(C.A.name) + '</b> (' + C.A.n + ' pages)<br>B: <b>' + PD.esc(C.B.name) + '</b> (' + C.B.n + ' pages)<br>Generated by PDF Do on ' + new Date().toLocaleString() + '</p><table><tr><th>Page</th><th>Status</th><th>Pixels changed</th><th>Words (added / removed)</th></tr>' + rows + '</table>';
    PD.saveAs(new Blob([html], { type: 'text/html' }), 'Comparison report.html', { mime: 'text/html', desc: 'HTML report' });
  };

  PD.on('docs:changed', () => { if (C.built) { if (C.A && !PD.docs.includes(C.A)) C.A = null; if (C.B && !PD.docs.includes(C.B)) C.B = null; C.refreshSelects(); } });
})();
