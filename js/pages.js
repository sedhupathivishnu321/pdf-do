/* PDF Do — page organizer (grid), page operations, merge workspace, split, bookmarks */
(function () {
  'use strict';
  const PD = window.PD;
  const L = window.PDFLib;
  const { h } = PD;
  const Pg = (PD.pages = { sel: new Set(), last: -1, thumb: 170 });

  /* ---------- range parsing ---------- */
  PD.parseRange = function (str, n) {
    str = String(str || '').trim().toLowerCase();
    if (!str || str === 'all') return Array.from({ length: n }, (_, i) => i);
    const out = [];
    str.split(/[,;]+/).forEach((part) => {
      part = part.trim(); if (!part) return;
      if (part === 'odd') { for (let i = 0; i < n; i += 2) out.push(i); return; }
      if (part === 'even') { for (let i = 1; i < n; i += 2) out.push(i); return; }
      const m = part.match(/^(\d+|last)?\s*-\s*(\d+|last)?$/);
      if (m) { const a = m[1] ? (m[1] === 'last' ? n : +m[1]) : 1, b = m[2] ? (m[2] === 'last' ? n : +m[2]) : n; const s = Math.max(1, Math.min(a, b)), e = Math.min(n, Math.max(a, b)); const rev = a > b; const seg = []; for (let k = s; k <= e; k++) seg.push(k - 1); out.push(...(rev ? seg.reverse() : seg)); return; }
      const v = part === 'last' ? n : parseInt(part, 10); if (v >= 1 && v <= n) out.push(v - 1);
    });
    return out;
  };

  /* ---------- outline writer ---------- */
  PD.writeOutline = function (pdf, entries) {
    const ctx = pdf.context; const pages = pdf.getPages();
    function build(list, parentRef) {
      const refs = list.map(() => ctx.nextRef()); let total = list.length;
      list.forEach((e, k) => {
        const dict = { Title: L.PDFHexString.fromText(e.title || 'Untitled'), Parent: parentRef, Dest: [pages[Math.max(0, Math.min(pages.length - 1, e.page))].ref, L.PDFName.of('Fit')] };
        if (k > 0) dict.Prev = refs[k - 1]; if (k < list.length - 1) dict.Next = refs[k + 1];
        if (e.children && e.children.length) { const r = build(e.children, refs[k]); dict.First = r.first; dict.Last = r.last; dict.Count = r.count; total += r.count; }
        ctx.assign(refs[k], ctx.obj(dict));
      });
      return { first: refs[0], last: refs[refs.length - 1], count: total };
    }
    if (!entries.length) { pdf.catalog.delete(L.PDFName.of('Outlines')); return; }
    const rootRef = ctx.nextRef(); const r = build(entries, rootRef);
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: r.first, Last: r.last, Count: r.count }));
    pdf.catalog.set(L.PDFName.of('Outlines'), rootRef);
  };

  /* ---------- page operations ---------- */
  const need = () => { if (!PD.cur) { PD.toast('Open a PDF first', 'info'); return null; } return PD.cur; };

  Pg.rotate = async (idx, delta) => { const d = need(); if (!d) return; idx = idx && idx.length ? idx : d.info.map((_, i) => i);
    await PD.pdf.edit(d, 'Rotate pages', (pdf) => { const ps = pdf.getPages(); idx.forEach((i) => ps[i].setRotation(L.degrees((((ps[i].getRotation().angle + delta) % 360) + 360) % 360))); }); };

  Pg.remove = async (idx) => { const d = need(); if (!d) return; if (!idx.length) return;
    if (idx.length >= d.n) { PD.toast('A document needs at least one page', 'error'); return; }
    await PD.pdf.edit(d, 'Delete pages', (pdf) => { idx.slice().sort((a, b) => b - a).forEach((i) => pdf.removePage(i)); }); };

  Pg.duplicate = async (idx) => { const d = need(); if (!d) return;
    await PD.pdf.edit(d, 'Duplicate pages', async (pdf) => { for (const i of idx.slice().sort((a, b) => b - a)) { const [cp] = await pdf.copyPages(pdf, [i]); pdf.insertPage(i + 1, cp); } }); };

  // order: array of original indices in their new order (may drop / repeat)
  Pg.rebuild = async (order, label) => { const d = need(); if (!d) return;
    await PD.pdf.edit(d, label || 'Reorder pages', async (pdf) => {
      const src = pdf.getPages(); const copies = {};
      const out = [];
      for (const i of order) { if (!copies[i]) { copies[i] = true; out.push(src[i]); } else { const [c] = await pdf.copyPages(pdf, [i]); out.push(c); } }
      for (let i = pdf.getPageCount() - 1; i >= 0; i--) pdf.removePage(i);
      out.forEach((p, k) => pdf.insertPage(k, p));
    }); };

  Pg.move = async (idx, before) => {
    const d = need(); if (!d) return; idx = idx.slice().sort((a, b) => a - b);
    const rest = []; for (let i = 0; i < d.n; i++) if (!idx.includes(i)) rest.push(i);
    const pos = rest.filter((i) => i < before).length;
    const order = rest.slice(0, pos).concat(idx, rest.slice(pos));
    if (order.every((v, k) => v === k)) return;
    await Pg.rebuild(order, 'Move pages');
    Pg.sel = new Set(idx.map((_, k) => pos + k)); Pg.render();
  };
  Pg.reverse = async () => { const d = need(); if (!d) return; await Pg.rebuild(Array.from({ length: d.n }, (_, i) => d.n - 1 - i), 'Reverse pages'); };
  Pg.sortInterleave = async () => {
    const d = need(); if (!d) return;
    // for double-sided scans: odd pages in order, even pages in reverse → collated order
    const half = Math.ceil(d.n / 2); const order = []; for (let k = 0; k < half; k++) { order.push(k); const j = d.n - 1 - k; if (j !== k && j >= half) order.push(j); }
    await Pg.rebuild(order, 'Collate duplex scan');
  };
  Pg.insertBlank = async (afterIdx, size) => {
    const d = need(); if (!d) return; const ref = d.info[Math.min(Math.max(afterIdx, 0), d.n - 1)];
    const sz = size || [ref.w, ref.h];
    await PD.pdf.edit(d, 'Insert blank page', (pdf) => { pdf.insertPage(afterIdx + 1, sz); });
    Pg.sel = new Set([afterIdx + 1]); Pg.render();
  };
  Pg.insertFrom = async (afterIdx) => {
    const d = need(); if (!d) return;
    const files = await PD.pickFiles({ accept: '.pdf,application/pdf', desc: 'PDF documents' }); if (!files.length) return;
    const src = await PD.readFile(files[0].file);
    let sdoc; try { sdoc = await L.PDFDocument.load(src); } catch (e) { PD.toast('Could not read that PDF (it may be encrypted)', 'error'); return; }
    const n = sdoc.getPageCount();
    const rangeIn = h('input', { class: 'input', value: 'all', placeholder: 'e.g. 1-3, 5' });
    const ok = await PD.modal({ title: 'Insert pages from "' + files[0].file.name + '"', icon: 'plus', content: h('div', null, h('p', { class: 'muted' }, n + ' pages available. They will be inserted after page ' + (afterIdx + 1) + '.'), h('label', { class: 'field' }, h('span', null, 'Pages to insert'), rangeIn)),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Insert', kind: 'primary', value: true }] });
    if (!ok) return; const idx = PD.parseRange(rangeIn.value, n); if (!idx.length) { PD.toast('No valid pages in that range', 'error'); return; }
    await PD.withBusy('Inserting pages…', () => PD.pdf.edit(d, 'Insert pages', async (pdf) => { const cps = await pdf.copyPages(sdoc, idx); cps.forEach((p, k) => pdf.insertPage(afterIdx + 1 + k, p)); }));
    Pg.sel = new Set(idx.map((_, k) => afterIdx + 1 + k)); Pg.render();
  };

  Pg.extractBytes = async (idx) => {
    const d = need(); const bytes = await PD.pdf.bake(d);
    const src = await PD.pdf.load(bytes); const out = await L.PDFDocument.create();
    const cps = await out.copyPages(src, idx); cps.forEach((p) => out.addPage(p));
    return await out.save();
  };
  Pg.extract = async (idx, openNew) => {
    const d = need(); if (!d || !idx.length) return;
    await PD.withBusy('Extracting…', async () => {
      const bytes = await Pg.extractBytes(idx); const name = PD.baseName(d.name) + ' – pages ' + (idx.length === 1 ? idx[0] + 1 : (idx[0] + 1) + '-' + (idx[idx.length - 1] + 1)) + '.pdf';
      if (openNew) { await PD.openBytes(bytes, name, null, { dirty: true }); PD.toast('Extracted ' + idx.length + ' page(s) into a new tab', 'ok'); }
      else await PD.saveAs(bytes, name, { mime: 'application/pdf', desc: 'PDF document' });
    });
  };

  /* ---------- split ---------- */
  Pg.splitDialog = async () => {
    const d = need(); if (!d) return;
    let mode = 'every', every = 1, ranges = '1-' + Math.max(1, Math.ceil(d.n / 2)) + ', ' + (Math.ceil(d.n / 2) + 1) + '-' + d.n, size = 5;
    const body = h('div', { class: 'stack' });
    const modes = [{ v: 'every', label: 'Every N pages' }, { v: 'ranges', label: 'Custom ranges' }, { v: 'single', label: 'One page each' }, { v: 'bookmarks', label: 'By bookmarks' }];
    const area = h('div');
    const draw = () => {
      area.innerHTML = '';
      if (mode === 'every') area.appendChild(h('label', { class: 'field' }, h('span', null, 'Pages per file'), PD.ui.num(every, (v) => (every = Math.max(1, Math.round(v))), { min: 1, max: d.n })));
      else if (mode === 'ranges') { const i = h('input', { class: 'input', value: ranges }); i.addEventListener('input', () => (ranges = i.value)); area.appendChild(h('label', { class: 'field' }, h('span', null, 'Ranges — each comma-separated range becomes one file'), i)); }
      else if (mode === 'single') area.appendChild(h('p', { class: 'muted' }, 'Creates ' + d.n + ' one-page files.'));
      else area.appendChild(h('p', { class: 'muted' }, 'Starts a new file at each top-level bookmark' + (d.outline && d.outline.length ? ' (' + d.outline.length + ' found).' : ' — this document has none.')));
    };
    body.append(PD.ui.seg(modes, mode, (v) => { mode = v; draw(); }), area, h('p', { class: 'muted small' }, 'Result is saved as a single .zip file containing the split PDFs.'));
    draw();
    const ok = await PD.modal({ title: 'Split document', icon: 'split', content: body, wide: true, buttons: [{ label: 'Cancel', value: false }, { label: 'Split & download', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Splitting…', async (b) => {
      let groups = [];
      if (mode === 'every') for (let s = 0; s < d.n; s += every) groups.push(Array.from({ length: Math.min(every, d.n - s) }, (_, k) => s + k));
      else if (mode === 'single') groups = Array.from({ length: d.n }, (_, i) => [i]);
      else if (mode === 'ranges') groups = ranges.split(',').map((r) => PD.parseRange(r, d.n)).filter((g) => g.length);
      else {
        const starts = [];
        for (const it of d.outline || []) { try { let dest = it.dest; if (typeof dest === 'string') dest = await d.pdf.getDestination(dest); if (dest) starts.push({ i: await d.pdf.getPageIndex(dest[0]), t: it.title }); } catch (e) { /* skip */ } }
        starts.sort((a, b) => a.i - b.i); const uniq = starts.filter((s, k) => !k || s.i !== starts[k - 1].i);
        if (!uniq.length) throw new Error('No bookmarks to split by');
        if (uniq[0].i > 0) uniq.unshift({ i: 0, t: 'Front matter' });
        groups = uniq.map((s, k) => { const e = k < uniq.length - 1 ? uniq[k + 1].i : d.n; return Object.assign(Array.from({ length: e - s.i }, (_, q) => s.i + q), { title: s.t }); });
      }
      if (!groups.length) throw new Error('Nothing to split');
      const baked = await PD.pdf.bake(d); const src = await PD.pdf.load(baked); const files = [];
      const pad = String(groups.length).length;
      for (let g = 0; g < groups.length; g++) {
        b.set(g / groups.length, 'Building part ' + (g + 1) + ' of ' + groups.length);
        const out = await L.PDFDocument.create(); (await out.copyPages(src, groups[g])).forEach((p) => out.addPage(p));
        const nm = PD.baseName(d.name) + ' - ' + String(g + 1).padStart(pad, '0') + (groups[g].title ? ' ' + String(groups[g].title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) : ' (p' + (groups[g][0] + 1) + (groups[g].length > 1 ? '-' + (groups[g][groups[g].length - 1] + 1) : '') + ')') + '.pdf';
        files.push({ name: nm, data: await out.save() });
      }
      await PD.saveAs(PD.zip(files), PD.baseName(d.name) + ' (split).zip', { mime: 'application/zip', desc: 'ZIP archive' });
      PD.toast('Created ' + files.length + ' files', 'ok');
    });
  };

  /* ---------- sort / bookmark dialogs ---------- */
  Pg.sortDialog = async () => {
    const d = need(); if (!d) return;
    const opts = [
      ['reverse', 'reverse', 'Reverse order', 'Last page becomes first'],
      ['interleave', 'interleave', 'Collate duplex scan', 'Fronts then reversed backs (double-sided scanner fix)'],
      ['odd', 'sortaz', 'Odd pages first', 'All odd pages, then all even'],
      ['even', 'sortaz', 'Even pages first', 'All even pages, then all odd'],
      ['size', 'sortaz', 'Group by page size', 'Portrait & landscape grouped'],
    ];
    const list = h('div', { class: 'choice-list' }, opts.map(([k, ic, t, s]) => h('button', { class: 'choice', onclick: () => close(k) }, h('span', { html: PD.ic(ic, 20) }), h('div', null, h('b', null, t), h('small', null, s)))));
    let close; const p = PD.modal({ title: 'Sort & arrange pages', icon: 'sortaz', content: list, buttons: [{ label: 'Close', value: null }], onOpen: (card, c) => (close = c) });
    const k = await p; if (!k) return;
    const n = d.n; let order;
    if (k === 'reverse') return Pg.reverse();
    if (k === 'interleave') return Pg.sortInterleave();
    if (k === 'odd') order = [...Array(n).keys()].filter((i) => i % 2 === 0).concat([...Array(n).keys()].filter((i) => i % 2 === 1));
    if (k === 'even') order = [...Array(n).keys()].filter((i) => i % 2 === 1).concat([...Array(n).keys()].filter((i) => i % 2 === 0));
    if (k === 'size') { const key = (i) => (d.info[i].w > d.info[i].h ? 1 : 0); order = [...Array(n).keys()].sort((a, b) => key(a) - key(b) || a - b); }
    await Pg.rebuild(order, 'Sort pages');
  };

  PD.tools = PD.tools || {};
  PD.tools.bookmarks = async function () {
    const d = need(); if (!d) return;
    let rows = [];
    const flat = async (items, lvl) => { for (const it of items || []) { let pg = 0; try { let dest = it.dest; if (typeof dest === 'string') dest = await d.pdf.getDestination(dest); if (dest) pg = typeof dest[0] === 'object' ? await d.pdf.getPageIndex(dest[0]) : dest[0]; } catch (e) { /* ignore */ } rows.push({ title: it.title, page: pg, level: lvl }); await flat(it.items, lvl + 1); } };
    await flat(d.outline, 0);
    const box = h('div', { class: 'bm-table' });
    const draw = () => {
      box.innerHTML = '';
      if (!rows.length) box.appendChild(h('div', { class: 'empty-note' }, h('b', null, 'No bookmarks yet'), h('small', null, 'Add one for the current page below.')));
      rows.forEach((r, k) => {
        const t = h('input', { class: 'input', value: r.title }); t.addEventListener('input', () => (r.title = t.value));
        box.appendChild(h('div', { class: 'bm-row', style: 'padding-left:' + r.level * 22 + 'px' },
          t, PD.ui.num(r.page + 1, (v) => (r.page = Math.max(0, Math.min(d.n - 1, v - 1))), { min: 1, max: d.n }),
          h('button', { class: 'icon-btn', title: 'Outdent', html: PD.ic('left', 14), onclick: () => { r.level = Math.max(0, r.level - 1); draw(); } }),
          h('button', { class: 'icon-btn', title: 'Indent', html: PD.ic('right', 14), onclick: () => { r.level = Math.min((rows[k - 1] ? rows[k - 1].level + 1 : 0), r.level + 1); draw(); } }),
          h('button', { class: 'icon-btn', title: 'Move up', html: PD.ic('up', 14), onclick: () => { if (k) { [rows[k - 1], rows[k]] = [rows[k], rows[k - 1]]; draw(); } } }),
          h('button', { class: 'icon-btn', title: 'Delete', html: PD.ic('trash', 14), onclick: () => { rows.splice(k, 1); draw(); } })));
      });
    };
    draw();
    const addBtn = h('button', { class: 'btn small', html: PD.ic('plus', 14) + '<span>Add bookmark for page ' + (d.cur + 1) + '</span>', onclick: () => { rows.push({ title: 'Page ' + (d.cur + 1), page: d.cur, level: 0 }); draw(); box.scrollTop = 1e6; } });
    const ok = await PD.modal({ title: 'Bookmarks', icon: 'bookmark', wide: true, content: h('div', null, box, addBtn),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Save bookmarks', kind: 'primary', value: true }] });
    if (!ok) return;
    const tree = []; const stack = [{ level: -1, children: tree }];
    rows.forEach((r) => { const node = { title: r.title, page: r.page, children: [] }; while (stack[stack.length - 1].level >= r.level) stack.pop(); stack[stack.length - 1].children.push(node); stack.push({ level: r.level, children: node.children }); });
    await PD.pdf.edit(d, 'Edit bookmarks', (pdf) => PD.writeOutline(pdf, tree));
    PD.toast('Bookmarks updated', 'ok');
  };

  /* ---------- organizer grid ---------- */
  let io = null, dragIdx = null;
  Pg.render = function () {
    const root = PD.$('#pagegrid'); if (!root) return;
    const d = PD.cur; root.innerHTML = '';
    if (io) io.disconnect();
    PD.$$('.pg-count').forEach((e) => (e.textContent = d ? Pg.sel.size + ' of ' + d.n + ' selected' : ''));
    if (!d) return;
    Pg.sel = new Set(Array.from(Pg.sel).filter((i) => i < d.n));
    root.style.setProperty('--tw', Pg.thumb + 'px');
    io = new IntersectionObserver((ens) => ens.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); fill(d, en.target); } }), { root: PD.$('#gridscroll'), rootMargin: '400px' });
    d.info.forEach((inf, i) => {
      const hasOv = (d.ov[i] || []).length;
      const card = h('div', { class: 'pcard' + (Pg.sel.has(i) ? ' sel' : ''), 'data-i': i, draggable: 'true' },
        h('div', { class: 'pc-thumb', style: 'aspect-ratio:' + inf.w + '/' + inf.h }, h('canvas'), hasOv ? h('span', { class: 'pc-badge', title: hasOv + ' edits on this page' }, '✎ ' + hasOv) : null),
        h('div', { class: 'pc-foot' }, h('span', { class: 'pc-n' }, String(i + 1)),
          h('div', { class: 'pc-acts' },
            h('button', { class: 'icon-btn', 'data-tip': 'Rotate', html: PD.ic('rotcw', 14), onclick: (e) => { e.stopPropagation(); Pg.rotate([i], 90); } }),
            h('button', { class: 'icon-btn', 'data-tip': 'Duplicate', html: PD.ic('copy', 14), onclick: (e) => { e.stopPropagation(); Pg.duplicate([i]); } }),
            h('button', { class: 'icon-btn', 'data-tip': 'Delete', html: PD.ic('trash', 14), onclick: (e) => { e.stopPropagation(); Pg.remove([i]); } }))));
      card.addEventListener('click', (e) => select(i, e));
      card.addEventListener('dblclick', () => { d.cur = i; PD.setMode('read'); setTimeout(() => PD.viewer.goto(i), 50); });
      card.addEventListener('dragstart', (e) => { dragIdx = Pg.sel.has(i) ? Array.from(Pg.sel) : [i]; if (!Pg.sel.has(i)) { Pg.sel = new Set([i]); } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages'); setTimeout(() => dragIdx.forEach((k) => root.children[k] && root.children[k].classList.add('dragging')), 0); });
      card.addEventListener('dragend', () => { dragIdx = null; PD.$$('.pcard').forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after')); });
      card.addEventListener('dragover', (e) => { if (!dragIdx) return; e.preventDefault(); const r = card.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; PD.$$('.pcard').forEach((c) => c.classList.remove('drop-before', 'drop-after')); card.classList.add(after ? 'drop-after' : 'drop-before'); });
      card.addEventListener('drop', (e) => { if (!dragIdx) return; e.preventDefault(); const r = card.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; const moving = dragIdx; dragIdx = null; Pg.move(moving, after ? i + 1 : i); });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!Pg.sel.has(i)) { Pg.sel = new Set([i]); mark(); } const idx = Array.from(Pg.sel).sort((a, b) => a - b);
        PD.ui.menu([{ label: 'Rotate right', icon: 'rotcw', run: () => Pg.rotate(idx, 90) }, { label: 'Rotate left', icon: 'rotccw', run: () => Pg.rotate(idx, -90) }, { label: 'Duplicate', icon: 'copy', run: () => Pg.duplicate(idx) }, { label: 'Extract to new tab', icon: 'scissors', run: () => Pg.extract(idx, true) }, '-', { label: 'Insert blank page after', icon: 'blank', run: () => Pg.insertBlank(idx[idx.length - 1]) }, { label: 'Insert pages from PDF…', icon: 'plus', run: () => Pg.insertFrom(idx[idx.length - 1]) }, '-', { label: 'Delete', icon: 'trash', danger: true, run: () => Pg.remove(idx) }], e.clientX, e.clientY); });
      root.appendChild(card); io.observe(card);
    });
  };
  async function fill(d, card) {
    const i = +card.dataset.i;
    try { const c = await PD.viewer.thumbCanvas(d, i, 240); if (d !== PD.cur) return; const cv = card.querySelector('canvas'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); cv.style.opacity = 1; } catch (e) { /* ignore */ }
  }
  function select(i, e) {
    if (e.shiftKey && Pg.last >= 0) { const a = Math.min(Pg.last, i), b = Math.max(Pg.last, i); if (!e.ctrlKey) Pg.sel = new Set(); for (let k = a; k <= b; k++) Pg.sel.add(k); }
    else if (e.ctrlKey || e.metaKey) { if (Pg.sel.has(i)) Pg.sel.delete(i); else Pg.sel.add(i); Pg.last = i; }
    else { Pg.sel = new Set([i]); Pg.last = i; }
    mark();
  }
  function mark() {
    PD.$$('.pcard').forEach((c) => c.classList.toggle('sel', Pg.sel.has(+c.dataset.i)));
    PD.$$('.pg-count').forEach((e) => (e.textContent = Pg.sel.size + ' of ' + (PD.cur ? PD.cur.n : 0) + ' selected'));
    PD.$$('[data-needsel]').forEach((b) => (b.disabled = !Pg.sel.size));
  }
  Pg.mark = mark;
  Pg.selected = () => Array.from(Pg.sel).sort((a, b) => a - b);
  Pg.selectWhere = (fn) => { const d = PD.cur; if (!d) return; Pg.sel = new Set(d.info.map((_, i) => i).filter(fn)); mark(); };

  /* ---------- merge workspace ---------- */
  const M = (PD.merge = { items: [] });
  M.addFiles = async function (items) {
    const b = PD.busy('Reading files…');
    try {
      for (const it of items) {
        const f = it.file; const isImg = /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
        const bytes = await PD.readFile(f);
        const rec = { id: PD.uid('m'), name: f.name, size: f.size, mtime: f.lastModified, bytes, range: 'all', kind: isImg ? 'image' : 'pdf', pages: 1 };
        if (isImg) { rec.url = URL.createObjectURL(new Blob([bytes], { type: f.type || 'image/png' })); }
        else {
          try {
            const t = pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: '' }); const pd = await t.promise; rec.pages = pd.numPages;
            const pg = await pd.getPage(1); const vp = pg.getViewport({ scale: 140 / pg.getViewport({ scale: 1 }).width }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#fff' }).promise; rec.thumb = c.toDataURL('image/jpeg', 0.7); pd.destroy();
          } catch (e) { PD.toast('"' + f.name + '" could not be read (damaged or password-protected)', 'error'); continue; }
        }
        M.items.push(rec);
      }
    } finally { b.done(); }
    M.render();
  };
  M.addOpen = () => {
    const docs = PD.docs; if (!docs.length) { PD.toast('No documents are open', 'info'); return; }
    PD.modal({ title: 'Add open documents', icon: 'layers', content: h('div', { class: 'choice-list' }, docs.map((d) => h('button', { class: 'choice', onclick: async (e) => { const bytes = await PD.pdf.bake(d); await M.addFiles([{ file: new File([bytes], d.name, { type: 'application/pdf' }) }]); e.currentTarget.classList.add('done'); } }, h('span', { html: PD.ic('file', 20) }), h('div', null, h('b', null, d.name), h('small', null, d.n + ' pages'))))),
      buttons: [{ label: 'Done', kind: 'primary', value: true }] });
  };
  M.sort = (how) => {
    const it = M.items;
    if (how === 'az') it.sort((a, b) => PD.natSort(a.name, b.name)); else if (how === 'za') it.sort((a, b) => PD.natSort(b.name, a.name));
    else if (how === 'new') it.sort((a, b) => b.mtime - a.mtime); else if (how === 'old') it.sort((a, b) => a.mtime - b.mtime);
    else if (how === 'big') it.sort((a, b) => b.size - a.size); else if (how === 'small') it.sort((a, b) => a.size - b.size); else if (how === 'rev') it.reverse();
    M.render();
  };
  M.render = function () {
    const root = PD.$('#mergelist'); if (!root) return; root.innerHTML = '';
    const total = M.items.reduce((s, it) => s + (it.kind === 'image' ? 1 : PD.parseRange(it.range, it.pages).length), 0);
    PD.$('#merge-summary').textContent = M.items.length ? M.items.length + ' file' + (M.items.length > 1 ? 's' : '') + ' · ' + total + ' pages in result' : 'Nothing added yet';
    PD.$('#merge-go').disabled = M.items.length < 1;
    if (!M.items.length) { root.appendChild(h('div', { class: 'merge-empty' }, h('span', { html: PD.ic('merge', 44, 1.3) }), h('b', null, 'Drop PDFs or images here'), h('small', null, 'Combine any number of files into one document. Drag cards to reorder.'))); return; }
    let drag = null;
    M.items.forEach((it, k) => {
      const rng = h('input', { class: 'input mini', value: it.range, title: 'Pages to include: all, 1-3, 5, odd, even', disabled: it.kind === 'image' }); rng.addEventListener('input', () => { it.range = rng.value; PD.$('#merge-summary').textContent = M.items.length + ' files · ' + M.items.reduce((s, x) => s + (x.kind === 'image' ? 1 : PD.parseRange(x.range, x.pages).length), 0) + ' pages in result'; });
      const card = h('div', { class: 'mcard', draggable: 'true' },
        h('div', { class: 'mc-idx' }, String(k + 1)),
        h('div', { class: 'mc-thumb' }, it.kind === 'image' ? h('img', { src: it.url }) : h('img', { src: it.thumb })),
        h('div', { class: 'mc-info' }, h('b', { title: it.name }, it.name), h('small', null, (it.kind === 'image' ? 'Image' : it.pages + ' pages') + ' · ' + PD.fmtBytes(it.size)), h('label', { class: 'mc-range' }, h('span', null, 'Pages'), rng)),
        h('div', { class: 'mc-acts' },
          h('button', { class: 'icon-btn', title: 'Move up', html: PD.ic('up', 15), onclick: () => { if (k) { [M.items[k - 1], M.items[k]] = [M.items[k], M.items[k - 1]]; M.render(); } } }),
          h('button', { class: 'icon-btn', title: 'Move down', html: PD.ic('down', 15), onclick: () => { if (k < M.items.length - 1) { [M.items[k + 1], M.items[k]] = [M.items[k], M.items[k + 1]]; M.render(); } } }),
          h('button', { class: 'icon-btn', title: 'Remove', html: PD.ic('x', 15), onclick: () => { M.items.splice(k, 1); M.render(); } })));
      card.addEventListener('dragstart', (e) => { drag = k; e.dataTransfer.setData('text/plain', 'merge'); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { drag = null; PD.$$('.mcard').forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after')); });
      card.addEventListener('dragover', (e) => { if (drag == null) return; e.preventDefault(); const r = card.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; PD.$$('.mcard').forEach((c) => c.classList.remove('drop-before', 'drop-after')); card.classList.add(after ? 'drop-after' : 'drop-before'); });
      card.addEventListener('drop', (e) => { if (drag == null) return; e.preventDefault(); e.stopPropagation(); const r = card.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; const [it2] = M.items.splice(drag, 1); let to = k + (after ? 1 : 0); if (drag < to) to--; M.items.splice(to, 0, it2); drag = null; M.render(); });
      root.appendChild(card);
    });
  };
  M.run = async function () {
    if (!M.items.length) return;
    const opts = { bm: PD.$('#merge-bm').checked, open: true, name: PD.$('#merge-name').value.trim() || 'Merged document' };
    const entries = [];
    await PD.withBusy('Merging…', async (b) => {
      const out = await L.PDFDocument.create(); out.registerFontkit && 0;
      let pageNo = 0;
      for (let k = 0; k < M.items.length; k++) {
        const it = M.items[k]; b.set(k / M.items.length, 'Adding ' + it.name);
        const start = pageNo;
        if (it.kind === 'image') {
          const isPng = /\.png$/i.test(it.name) || /png/.test(it.url || '');
          let img; try { img = isPng ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes); } catch (e) { const im = await PD.loadImage(it.url); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); img = await out.embedPng(await PD.canvasToBytes(c)); }
          let w = img.width * 0.75, hh = img.height * 0.75; const mx = Math.max(w, hh); if (mx > 1200) { w *= 1200 / mx; hh *= 1200 / mx; }
          const pg = out.addPage([w, hh]); pg.drawImage(img, { x: 0, y: 0, width: w, height: hh }); pageNo++;
        } else {
          let src; try { src = await L.PDFDocument.load(it.bytes, { ignoreEncryption: false }); } catch (e) { throw new Error('"' + it.name + '" is encrypted or damaged and cannot be merged'); }
          const idx = PD.parseRange(it.range, src.getPageCount()); if (!idx.length) continue;
          const cps = await out.copyPages(src, idx); cps.forEach((p) => out.addPage(p)); pageNo += idx.length;
        }
        entries.push({ title: PD.baseName(it.name), page: start });
      }
      if (!pageNo) throw new Error('No pages selected to merge');
      if (opts.bm) PD.writeOutline(out, entries);
      out.setTitle(opts.name); out.setProducer('PDF Do'); out.setCreator('PDF Do');
      const bytes = await out.save();
      const doc = await PD.openBytes(bytes, opts.name + '.pdf', null, { dirty: true });
      PD.setMode('read'); PD.toast('Merged ' + M.items.length + ' files into ' + pageNo + ' pages', 'ok');
    });
  };
})();
