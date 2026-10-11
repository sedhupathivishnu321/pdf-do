/* PDF Do — application shell: modes, tabs, island toolbar, dock, panels, home, command palette, settings */
(function () {
  'use strict';
  const PD = window.PD;
  const { h, $, $$ } = PD;
  const V = PD.viewer, A = PD.annot, Pg = PD.pages, T = PD.tools, Cv = PD.convert;

  /* ================= modes ================= */
  PD.MODES = [
    { id: 'home', label: 'Home', icon: 'home', view: 'home', left: false, insp: false },
    { id: 'read', label: 'Read', icon: 'read', view: 'viewer', left: true, insp: true, tools: ['select', 'hand'] },
    { id: 'annotate', label: 'Annotate', icon: 'pen', view: 'viewer', left: true, insp: true, tools: ['select', 'hand', '|', 'hl', 'ul', 'st', 'sq', 'area', '|', 'pen', 'rect', 'ellipse', 'line', 'arrow', 'measure', '|', 'text', 'note', 'stamp', '|', 'eraser'] },
    { id: 'edit', label: 'Edit', icon: 'text', view: 'viewer', left: true, insp: true, tools: ['select', 'hand', '|', 'edittext', 'text', '|', 'image', 'sign', 'stamp', '|', 'whiteout', 'link'] },
    { id: 'pages', label: 'Pages', icon: 'layers', view: 'grid', left: false, insp: false },
    { id: 'merge', label: 'Merge', icon: 'merge', view: 'merge', left: false, insp: false },
    { id: 'compare', label: 'Compare', icon: 'compare', view: 'compare', left: false, insp: false },
    { id: 'convert', label: 'Convert', icon: 'convert', view: 'cards', left: false, insp: false },
    { id: 'protect', label: 'Protect', icon: 'shield', view: 'viewer', left: true, insp: true, tools: ['select', 'hand', '|', 'redact', 'whiteout'] },
    { id: 'forms', label: 'Forms', icon: 'form', view: 'viewer', left: true, insp: true, tools: ['select', 'hand', '|', 'ftext', 'fcheck', 'fdrop'] },
  ];
  PD.mode = 'home';
  PD.leftTab = 'pages';
  const modeCfg = (id) => PD.MODES.find((m) => m.id === id);
  PD.availableTools = () => (modeCfg(PD.mode).tools || []).filter((t) => t !== '|');
  PD.shortcuts = {};
  Object.keys(A.TOOLS).forEach((k) => { if (A.TOOLS[k].key) PD.shortcuts[A.TOOLS[k].key] = k; });
  const NEEDS_DOC = ['read', 'annotate', 'edit', 'pages', 'protect', 'forms'];
  let viewerDoc = null, viewerStale = false;

  PD.setMode = function (id, opts) {
    const cfg = modeCfg(id); if (!cfg) return;
    if (NEEDS_DOC.includes(id) && !PD.cur) { PD.toast('Open a PDF first to use ' + cfg.label, 'info'); id = 'home'; }
    const prevDoc = PD.cur;
    if (prevDoc && modeCfg(PD.mode).view === 'viewer') prevDoc._st = V.scroller.scrollTop;
    PD.mode = id; document.body.dataset.mode = id;
    const c = modeCfg(id); document.body.dataset.view = c.view;
    $$('#views > section').forEach((s) => s.classList.toggle('on', s.dataset.view === c.view));
    document.body.classList.toggle('has-left', !!c.left && PD.leftOpen !== false);
    document.body.classList.toggle('has-insp', !!c.insp && PD.inspOpen !== false);
    // default tool for the mode
    const avail = PD.availableTools();
    if (c.view === 'viewer') {
      if (!avail.includes(PD.tool)) A.setTool(id === 'forms' ? 'select' : 'select');
      if (opts && opts.tool) A.setTool(opts.tool);
      else if (id === 'edit' && (PD.tool === 'select' || PD.tool === 'hand')) A.setTool('edittext');
    } else if (PD.tool !== 'select') A.setTool('select');
    buildIsland(); renderRail(); refreshViews(); updateChrome();
    if (id === 'home') renderHome();
    if (id === 'merge') { PD.merge.render(); }
    if (id === 'compare') PD.compare.enter();
    if (id === 'convert') renderConvert();
    PD.emit('mode:changed', id);
  };

  function refreshViews() {
    const d = PD.cur; const c = modeCfg(PD.mode);
    if (c.view === 'viewer') {
      if (viewerDoc !== d || viewerStale) {
        const st = d && d._st;
        V.build(d); viewerDoc = d; viewerStale = false;
        if (d && st) V.scroller.scrollTop = st;
        A.renderAll();
      }
      V.applyFit(true);
      PD.inspector.render(); renderLeft();
    } else if (c.view === 'grid') Pg.render();
  }

  /* ================= rail ================= */
  function renderRail() {
    const rail = $('#rail'); rail.innerHTML = '';
    PD.MODES.forEach((m) => {
      const b = h('button', { class: 'rail-btn' + (PD.mode === m.id ? ' on' : ''), 'data-mode': m.id, 'data-tip': m.label, 'data-side': 'right', onclick: () => PD.setMode(m.id), html: PD.ic(m.icon, 22, 1.7) + '<span>' + m.label + '</span>' });
      if (m.id === 'compare' || m.id === 'protect') rail.appendChild(h('i', { class: 'rail-sep' }));
      rail.appendChild(b);
    });
    rail.appendChild(h('div', { class: 'rail-spacer' }));
    rail.appendChild(h('button', { class: 'rail-btn small', 'data-tip': 'Settings', 'data-side': 'right', onclick: openSettings, html: PD.ic('gear', 20, 1.7) + '<span>Settings</span>' }));
  }

  /* ================= tabs / titlebar ================= */
  function renderTabs() {
    const box = $('#tabs'); box.innerHTML = '';
    PD.docs.forEach((d) => {
      const t = h('div', { class: 'tab' + (d === PD.cur ? ' on' : ''), title: d.name },
        h('span', { class: 'tab-ic', html: PD.ic('file', 15) }), h('span', { class: 'tab-name' }, d.name), d.dirty ? h('i', { class: 'tab-dot', title: 'Unsaved changes' }) : null,
        h('button', { class: 'tab-x', title: 'Close', html: PD.ic('x', 13, 2.2), onclick: (e) => { e.stopPropagation(); PD.closeDoc(d); } }));
      t.addEventListener('click', () => { if (d !== PD.cur) PD.setCurrent(d); if (PD.mode === 'home') PD.setMode('read'); });
      t.addEventListener('auxclick', (e) => { if (e.button === 1) PD.closeDoc(d); });
      box.appendChild(t);
    });
    box.appendChild(h('button', { class: 'tab-new', 'data-tip': 'Open PDF', html: PD.ic('plus', 16, 2), onclick: () => PD.openDialog() }));
  }
  function updateChrome() {
    renderTabs();
    const d = PD.cur;
    document.title = d ? (d.dirty ? '• ' : '') + d.name + ' — PDF Do' : 'PDF Do';
    $('#btn-undo').disabled = !d || d.hi <= 0; $('#btn-redo').disabled = !d || d.hi >= d.hist.length - 1;
    $('#btn-save').disabled = !d; $('#btn-save').classList.toggle('dirty', !!(d && d.dirty));
    updateDock();
  }
  PD.updateChrome = updateChrome;

  /* ================= island toolbar ================= */
  function buildIsland() {
    const box = $('#island'); box.innerHTML = '';
    const c = modeCfg(PD.mode);
    if (c.view !== 'viewer') { box.classList.remove('on'); return; }
    box.classList.add('on');
    (c.tools || []).forEach((t) => {
      if (t === '|') { box.appendChild(h('i', { class: 'isl-sep' })); return; }
      const T0 = A.TOOLS[t];
      const b = h('button', { class: 'tool' + (PD.tool === t ? ' on' : ''), 'data-tool': t, 'data-tip': T0.label, 'data-key': T0.key || '', onclick: () => A.setTool(t), html: PD.ic(T0.icon, 19, 1.8) });
      box.appendChild(b);
    });
    // mode-specific actions
    const act = (icon, label, fn, tip) => h('button', { class: 'isl-act', 'data-tip': tip || label, onclick: fn, html: PD.ic(icon, 17, 1.8) + '<span>' + label + '</span>' });
    if (PD.mode === 'edit') { box.appendChild(h('i', { class: 'isl-sep' })); box.appendChild(act('font', 'Fonts', openFontManager, 'Manage fonts: add files, use installed fonts')); }
    if (PD.mode === 'protect') {
      box.appendChild(h('i', { class: 'isl-sep' }));
      box.append(act('eyeoff', 'Apply redactions', () => T.applyRedactions()), act('key', 'Password', () => T.protectDialog(), 'Protect with a password (AES-256)'), act('unlock', 'Unlock', () => T.unlock(), 'Remove password / restrictions'), act('info', 'Properties', () => T.metadata()), act('water', 'Watermark', () => T.watermark()), act('flatten', 'Flatten', () => T.flattenDialog()), act('zip', 'Compress', () => T.compressDialog()), act('shield', 'Sanitize', () => T.sanitize()));
    }
    if (PD.mode === 'forms') { box.appendChild(h('i', { class: 'isl-sep' })); box.appendChild(act('flatten', 'Flatten form', () => T.flattenForms())); }
    if (PD.mode === 'read') { box.appendChild(h('i', { class: 'isl-sep' })); box.appendChild(act('search', 'Find', () => openLeft('search'), 'Search text (Ctrl+F)')); box.appendChild(act('speaker', 'Read aloud', () => T.readAloud(), 'Read the document aloud')); box.appendChild(act('play', 'Present', () => V.present(), 'Full-screen presentation (F5)')); }
  }
  PD.on('tool:changed', (t) => { $$('#island .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); });

  /* ================= dock ================= */
  function buildDock() {
    const dock = $('#dock'); dock.innerHTML = '';
    const pg = h('input', { class: 'dk-page', id: 'dk-page', type: 'text', value: '1', 'aria-label': 'Page number' });
    pg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = parseInt(pg.value, 10); if (v) V.goto(v - 1, true); pg.blur(); } });
    pg.addEventListener('focus', () => pg.select());
    const btn = (icon, tip, fn, id) => h('button', { class: 'dk-btn', id, 'data-tip': tip, 'data-side': 'top', onclick: fn, html: PD.ic(icon, 17, 1.9) });
    dock.append(
      btn('left', 'Previous page', () => V.prev()), h('div', { class: 'dk-pg' }, pg, h('span', { id: 'dk-total' }, '/ 1')), btn('right', 'Next page', () => V.next()),
      h('i', { class: 'dk-sep' }),
      btn('minus', 'Zoom out', () => V.zoomBy(1 / 1.15)), h('button', { class: 'dk-zoom', id: 'dk-zoom', 'data-tip': 'Reset to 100%', 'data-side': 'top', onclick: () => V.setZoom(1) }, '100%'), btn('plus', 'Zoom in', () => V.zoomBy(1.15)),
      h('i', { class: 'dk-sep' }),
      btn('fit', 'Fit width', () => V.setZoom(1, 'width'), 'dk-fitw'), btn('full', 'Fit whole page', () => V.setZoom(1, 'page'), 'dk-fitp'),
      h('i', { class: 'dk-sep' }),
      btn('list', 'Continuous scroll', () => V.setLayout('continuous'), 'dk-l1'), btn('file', 'Single page', () => V.setLayout('single'), 'dk-l2'), btn('columns', 'Two pages', () => V.setLayout('two'), 'dk-l3'), btn('book', 'Book view (cover alone)', () => V.setLayout('book'), 'dk-l4'),
      h('i', { class: 'dk-sep' }),
      btn('speaker', 'Read aloud (click again to stop)', () => T.readAloud(), 'dk-read'), btn('rotcw', 'Rotate pages 90°', () => T && PD.pages.rotate([PD.cur.cur], 90), 'dk-rot'), btn('play', 'Present full screen', () => V.present(), 'dk-pres'));
  }
  function updateDock() {
    const d = PD.cur; if (!d) return;
    const pg = $('#dk-page'); if (pg && document.activeElement !== pg) pg.value = d.cur + 1;
    const tot = $('#dk-total'); if (tot) tot.textContent = '/ ' + d.n;
    const z = $('#dk-zoom'); if (z) z.textContent = Math.round(d.zoom * 100) + '%';
    $('#dk-fitw') && $('#dk-fitw').classList.toggle('on', d.fit === 'width'); $('#dk-fitp') && $('#dk-fitp').classList.toggle('on', d.fit === 'page');
    ['continuous', 'single', 'two', 'book'].forEach((l, k) => $('#dk-l' + (k + 1)) && $('#dk-l' + (k + 1)).classList.toggle('on', d.layout === l));
  }
  PD.on('page:changed', updateDock); PD.on('view:zoom', updateDock);

  /* ================= left panel ================= */
  function buildLeft() {
    const lp = $('#leftpanel');
    const tabs = [['pages', 'Pages', 'grid'], ['outline', 'Bookmarks', 'bookmark'], ['search', 'Search', 'search'], ['notes', 'Markups', 'note']];
    lp.innerHTML = '';
    lp.appendChild(h('div', { class: 'lp-tabs' }, tabs.map(([id, label, ic]) => h('button', { class: 'lp-tab' + (PD.leftTab === id ? ' on' : ''), 'data-tab': id, 'data-tip': label, onclick: () => openLeft(id), html: PD.ic(ic, 17) }))));
    const search = h('div', { class: 'lp-pane', 'data-pane': 'search' },
      h('div', { class: 'srch' }, h('span', { html: PD.ic('search', 16) }), h('input', { id: 'search-input', class: 'input', type: 'text', placeholder: 'Search in document…', 'aria-label': 'Search' })),
      h('div', { class: 'srch-opts' }, PD.ui.check('Match case', false, (v) => { PD.searchOpts.matchCase = v; runSearch(); }), PD.ui.check('Whole word', false, (v) => { PD.searchOpts.whole = v; runSearch(); })),
      h('div', { class: 'srch-nav' }, h('span', { id: 'srch-count', class: 'muted small' }, ''), h('div', null, h('button', { class: 'icon-btn', html: PD.ic('up', 15), onclick: () => stepSearch(-1) }), h('button', { class: 'icon-btn', html: PD.ic('down', 15), onclick: () => stepSearch(1) }))),
      h('div', { id: 'search-results', class: 'srch-list' }));
    lp.append(
      h('div', { class: 'lp-pane', 'data-pane': 'pages' }, h('div', { id: 'thumbs' })),
      h('div', { class: 'lp-pane', 'data-pane': 'outline' }, h('div', { id: 'outline' })),
      search,
      h('div', { class: 'lp-pane', 'data-pane': 'notes' }, h('div', { id: 'notes-list' })));
    const inp = $('#search-input');
    inp.addEventListener('input', PD.debounce(runSearch, 300));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); } });
    setLeftTab(PD.leftTab);
  }
  function setLeftTab(id) { PD.leftTab = id; $$('#leftpanel .lp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id)); $$('#leftpanel .lp-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === id)); if (id === 'notes') renderNotes(); }
  function openLeft(id) { PD.leftOpen = true; if (modeCfg(PD.mode).left) document.body.classList.add('has-left'); setLeftTab(id); if (id === 'search') setTimeout(() => { const i = $('#search-input'); i.focus(); i.select(); }, 40); setTimeout(() => V.applyFit(), 220); }
  function renderLeft() { if (PD.leftTab === 'notes') renderNotes(); }

  PD.searchOpts = { matchCase: false, whole: false };
  let hits = [], hitIdx = -1, searchTok = 0;
  async function runSearch() {
    const q = $('#search-input').value; const d = PD.cur; const tok = ++searchTok; const list = $('#search-results'); const cnt = $('#srch-count');
    if (!d || !q) { hits = []; hitIdx = -1; list.innerHTML = ''; cnt.textContent = ''; V.showHits([], -1); return; }
    cnt.textContent = 'Searching…';
    const res = await V.search(q, PD.searchOpts, null); if (tok !== searchTok) return;
    hits = res; hitIdx = res.length ? 0 : -1; list.innerHTML = '';
    cnt.textContent = res.length ? res.length + (res.length >= 3000 ? '+' : '') + ' matches' : 'No matches';
    let lastPage = -1; const frag = document.createDocumentFragment();
    res.slice(0, 400).forEach((m, k) => {
      if (m.page !== lastPage) { lastPage = m.page; frag.appendChild(h('div', { class: 'srch-page' }, 'Page ' + (m.page + 1))); }
      frag.appendChild(h('button', { class: 'srch-item', 'data-k': k, onclick: () => { hitIdx = k; showHit(); } }, h('span', null, m.pre), h('mark', null, m.hit), h('span', null, m.post)));
    });
    list.appendChild(frag); showHit();
  }
  function showHit() {
    if (!hits.length) return; V.showHits(hits, hitIdx); const m = hits[hitIdx];
    $$('#search-results .srch-item').forEach((b) => b.classList.toggle('on', +b.dataset.k === hitIdx));
    const cur = $('#search-results .srch-item.on'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    $('#srch-count').textContent = 'Match ' + (hitIdx + 1) + ' of ' + hits.length;
    V.goto(m.page, false);
    setTimeout(() => { const el = V.pageEl(m.page); const r = m.rects[0]; if (el && r) { const s = V.scale(); const sc = V.scroller; sc.scrollTo({ top: el.offsetTop + r.y * s - sc.clientHeight / 3, behavior: 'smooth' }); } }, 30);
  }
  function stepSearch(dir) { if (!hits.length) return; hitIdx = (hitIdx + dir + hits.length) % hits.length; showHit(); }
  PD.on('view:built', () => { if ($('#search-input') && $('#search-input').value) runSearch(); });

  const ICON_OF = { measure: 'ruler', rect: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'arrow', ink: 'pen', markup: 'highlight', text: 'text', image: 'image', stamp: 'stamp', note: 'note', whiteout: 'eraser', redact: 'eyeoff', link: 'link', field: 'checkbox', area: 'highlight' };
  function renderNotes() {
    const box = $('#notes-list'); if (!box) return; box.innerHTML = ''; const d = PD.cur; if (!d) return;
    const rows = []; Object.keys(d.ov).map(Number).sort((a, b) => a - b).forEach((i) => d.ov[i].forEach((o) => rows.push([i, o])));
    if (!rows.length) { box.appendChild(h('div', { class: 'empty-note' }, h('span', { html: PD.ic('note', 28, 1.4) }), h('b', null, 'No markups yet'), h('small', null, 'Highlights, shapes, text and notes you add show up here.'))); return; }
    rows.forEach(([i, o]) => {
      const lab = o.t === 'text' ? o.text.slice(0, 40) : o.t === 'note' ? o.text || 'Note' : o.t === 'markup' ? o.kind : o.t === 'stamp' ? o.text : o.t;
      box.appendChild(h('button', { class: 'note-row', onclick: () => { V.goto(i, true); setTimeout(() => A.select(i, o.id), 250); } }, h('span', { class: 'nr-ic', html: PD.ic(ICON_OF[o.t] || 'file', 15) }), h('span', { class: 'nr-t' }, lab || o.t), h('small', null, 'p.' + (i + 1))));
    });
  }
  PD.on('doc:history', () => { updateChrome(); if (PD.leftTab === 'notes') renderNotes(); });
  PD.on('doc:overlay', () => { if (PD.leftTab === 'notes') renderNotes(); });

  /* ================= events from document model ================= */
  PD.on('docs:changed', () => { updateChrome(); if (PD.mode === 'home') renderHome(); });
  PD.on('doc:switch', (d) => {
    PD.annot.sel = null;
    if (!d) { if (PD.mode !== 'home' && PD.mode !== 'merge' && PD.mode !== 'compare' && PD.mode !== 'convert') PD.setMode('home'); viewerDoc = null; V.build(null); updateChrome(); return; }
    d.fit = d.fit || 'width';
    if (PD.mode === 'home') PD.setMode('read'); else { refreshViews(); updateChrome(); }
  });
  PD.on('doc:reload', (d) => {
    if (d !== PD.cur) return; viewerStale = true;
    const st = V.scroller.scrollTop; d._st = st;
    if (modeCfg(PD.mode).view === 'viewer') refreshViews(); else if (PD.mode === 'pages') Pg.render();
    updateChrome(); if (PD.mode === 'forms') PD.emit('forms:refresh');
  });
  PD.on('doc:overlay', () => { if (PD.mode === 'pages') Pg.render(); });
  PD.on('doc:history', () => { if (PD.mode === 'pages') { /* badges refresh handled on reload */ } });

  // forms panel hook
  const origRender = PD.inspector.render;
  PD.inspector.render = function () {
    if (PD.mode === 'forms' && PD.cur && !A.getSel() && A.TOOLS[PD.tool].kind === 'select') { const box = $('#inspector-body'); box.innerHTML = ''; T.renderFormPanel(box); return; }
    origRender();
  };
  PD.on('forms:refresh', () => { if (PD.mode === 'forms') PD.inspector.render(); });

  /* ================= home ================= */
  function requireDoc(fn) { return async () => { if (!PD.cur) { await PD.openDialog(); if (!PD.cur) return; } fn(); }; }
  PD.commands = [];
  const cmd = (group, title, icon, run, o) => PD.commands.push(Object.assign({ group, title, icon, run }, o || {}));
  function defineCommands() {
    const D = (fn) => requireDoc(fn);
    cmd('File', 'Open PDF…', 'open', () => PD.openDialog(), { key: 'Ctrl+O', kw: 'browse file' });
    cmd('File', 'New blank PDF', 'blank', () => Cv.blank());
    cmd('File', 'Save', 'save', () => PD.save(), { key: 'Ctrl+S', need: true });
    cmd('File', 'Save as…', 'save', () => PD.save(null, true), { key: 'Ctrl+Shift+S', need: true, kw: 'copy' });
    cmd('File', 'Print', 'print', () => T.print(), { key: 'Ctrl+P', need: true });
    cmd('File', 'Document properties', 'info', () => T.metadata(), { need: true, kw: 'metadata title author' });
    cmd('File', 'Duplicate document', 'copy', () => T.duplicateDoc(), { need: true });
    cmd('File', 'Rename document', 'tag', () => T.rename(), { need: true });
    cmd('File', 'Close document', 'x', () => PD.cur && PD.closeDoc(PD.cur), { key: 'Ctrl+W', need: true });
    cmd('View', 'Go to Home', 'home', () => PD.setMode('home'));
    PD.MODES.filter((m) => m.id !== 'home').forEach((m) => cmd('View', 'Switch to ' + m.label, m.icon, () => PD.setMode(m.id)));
    cmd('View', 'Fit width', 'fit', () => V.setZoom(1, 'width'), { need: true }); cmd('View', 'Fit page', 'full', () => V.setZoom(1, 'page'), { need: true });
    cmd('View', 'Actual size (100%)', 'search', () => V.setZoom(1), { need: true, key: 'Ctrl+0' });
    cmd('View', 'Zoom in', 'zoomin', () => V.zoomBy(1.15), { need: true, key: 'Ctrl++' }); cmd('View', 'Zoom out', 'zoomout', () => V.zoomBy(1 / 1.15), { need: true, key: 'Ctrl+−' });
    cmd('View', 'Single page layout', 'file', () => V.setLayout('single'), { need: true }); cmd('View', 'Continuous layout', 'list', () => V.setLayout('continuous'), { need: true }); cmd('View', 'Two-page layout', 'columns', () => V.setLayout('two'), { need: true });
    cmd('View', 'Night reading mode', 'moon', () => V.setReadMode('dark'), { need: true }); cmd('View', 'Sepia reading mode', 'sun', () => V.setReadMode('sepia'), { need: true }); cmd('View', 'Normal reading mode', 'file', () => V.setReadMode('normal'), { need: true });
    cmd('View', 'Presentation mode', 'play', () => V.present(), { need: true, key: 'F5' });
    cmd('View', 'Find in document', 'search', () => { if (!modeCfg(PD.mode).left) PD.setMode('read'); openLeft('search'); }, { key: 'Ctrl+F', need: true });
    cmd('Edit', 'Undo', 'undo', () => PD.cur && PD.cur.undo(), { key: 'Ctrl+Z', need: true }); cmd('Edit', 'Redo', 'redo', () => PD.cur && PD.cur.redo(), { key: 'Ctrl+Y', need: true });
    cmd('Edit', 'Manage fonts', 'font', () => openFontManager(), { kw: 'add font ttf otf installed typeface' });
    const toolCmd = (mode, tool, title, kw) => cmd('Tools', title, A.TOOLS[tool].icon, () => PD.setMode(mode, { tool }), { need: true, kw });
    toolCmd('annotate', 'hl', 'Highlight text', 'mark yellow'); toolCmd('annotate', 'ul', 'Underline text'); toolCmd('annotate', 'st', 'Strikethrough text'); toolCmd('annotate', 'sq', 'Squiggly underline'); toolCmd('annotate', 'pen', 'Freehand pen', 'draw ink'); toolCmd('annotate', 'rect', 'Draw rectangle'); toolCmd('annotate', 'ellipse', 'Draw ellipse circle'); toolCmd('annotate', 'line', 'Draw line'); toolCmd('annotate', 'arrow', 'Draw arrow'); toolCmd('annotate', 'measure', 'Measure distance', 'ruler length scale'); toolCmd('annotate', 'note', 'Sticky note comment'); toolCmd('annotate', 'stamp', 'Stamp approved draft'); toolCmd('annotate', 'text', 'Add text box', 'type');
    toolCmd('edit', 'edittext', 'Edit existing text', 'change rewrite font'); toolCmd('edit', 'image', 'Insert image', 'picture photo logo'); toolCmd('edit', 'sign', 'Sign document', 'signature'); toolCmd('edit', 'whiteout', 'Whiteout / cover content', 'erase blank'); toolCmd('edit', 'link', 'Add hyperlink', 'url');
    toolCmd('protect', 'redact', 'Redact (mark areas)', 'black out hide sensitive');
    toolCmd('forms', 'ftext', 'Add form text field'); toolCmd('forms', 'fcheck', 'Add form checkbox'); toolCmd('forms', 'fdrop', 'Add form dropdown');
    cmd('Pages', 'Rotate page right', 'rotcw', () => Pg.rotate([PD.cur.cur], 90), { need: true }); cmd('Pages', 'Rotate all pages right', 'rotcw', () => Pg.rotate(null, 90), { need: true }); cmd('Pages', 'Rotate all pages left', 'rotccw', () => Pg.rotate(null, -90), { need: true });
    cmd('Pages', 'Delete current page', 'trash', () => Pg.remove([PD.cur.cur]), { need: true }); cmd('Pages', 'Insert blank page after current', 'blank', () => Pg.insertBlank(PD.cur.cur), { need: true });
    cmd('Pages', 'Insert pages from another PDF', 'plus', () => Pg.insertFrom(PD.cur.cur), { need: true });
    cmd('Pages', 'Extract current page', 'scissors', () => Pg.extract([PD.cur.cur], true), { need: true }); cmd('Pages', 'Split document', 'split', () => Pg.splitDialog(), { need: true, kw: 'divide separate' });
    cmd('Pages', 'Sort / reverse / collate pages', 'sortaz', () => Pg.sortDialog(), { need: true, kw: 'arrange order duplex' }); cmd('Pages', 'Crop pages', 'crop', () => T.crop(), { need: true, kw: 'trim margins' }); cmd('Pages', 'Change page size', 'full', () => T.resize(), { need: true, kw: 'a4 letter scale' });
    cmd('Pages', 'Edit bookmarks', 'bookmark', () => T.bookmarks(), { need: true, kw: 'outline table of contents' });
    cmd('Pages', 'Add page numbers', 'pagenum', () => T.headerFooter('numbers'), { need: true }); cmd('Pages', 'Headers, footers & Bates numbering', 'hash', () => T.headerFooter(), { need: true });
    cmd('Pages', 'Add watermark', 'water', () => T.watermark(), { need: true, kw: 'draft confidential' });
    cmd('Combine', 'Merge PDFs', 'merge', () => PD.setMode('merge'), { kw: 'combine join' }); cmd('Combine', 'Compare two PDFs', 'compare', () => PD.setMode('compare'), { kw: 'diff difference' });
    cmd('Convert', 'PDF to images (PNG / JPG)', 'image', D(() => Cv.pdfToImages())); cmd('Convert', 'Extract embedded images', 'image', D(() => Cv.extractImages()), { kw: 'pictures photos assets' }); cmd('Convert', 'Images to PDF', 'image', () => Cv.imagesToPdf(), { kw: 'jpg png photo scan' });
    cmd('Convert', 'Export as Word (.docx)', 'file', D(() => Cv.textExport('docx'))); cmd('Convert', 'Export as text (.txt)', 'file', D(() => Cv.textExport('txt'))); cmd('Convert', 'Export as Markdown', 'file', D(() => Cv.textExport('md'))); cmd('Convert', 'Export as HTML', 'file', D(() => Cv.textExport('html')));
    cmd('Convert', 'Text file to PDF', 'file', () => Cv.textToPdf()); cmd('Convert', 'OCR — recognize text in scans', 'scan', D(() => Cv.ocr()), { kw: 'scanned searchable' });
    cmd('Protect', 'Apply redactions', 'eyeoff', () => T.applyRedactions(), { need: true }); cmd('Protect', 'Protect with password (AES-256)', 'key', () => T.protectDialog(), { need: true, kw: 'encrypt lock secure restrict permissions' }); cmd('Protect', 'Remove password / restrictions', 'unlock', () => T.unlock(), { need: true, kw: 'decrypt unlock' }); cmd('Edit', 'Flatten annotations into the page', 'flatten', () => T.flattenAnnotations(), { need: true, kw: 'merge burn' }); cmd('View', 'Read aloud (start / stop)', 'speaker', () => T.readAloud(), { need: true, kw: 'speech listen tts' }); cmd('View', 'Book view', 'book', () => V.setLayout('book'), { need: true }); cmd('View', 'Go back', 'left', () => V.back(), { need: true, key: 'Alt+←' }); cmd('View', 'Go forward', 'right', () => V.forward(), { need: true, key: 'Alt+→' }); cmd('Protect', 'Flatten to images', 'flatten', () => T.flattenDialog(), { need: true, kw: 'unlock password' });
    cmd('Protect', 'Compress PDF', 'zip', () => T.compressDialog(), { need: true, kw: 'reduce size smaller' }); cmd('Protect', 'Remove hidden data (sanitize)', 'shield', () => T.sanitize(), { need: true });
    cmd('Protect', 'Remove metadata', 'info', () => T.metadata(), { need: true });
    cmd('App', 'Settings', 'gear', () => openSettings()); cmd('App', 'Keyboard shortcuts', 'keyboard', () => showShortcuts(), { key: 'F1' }); cmd('App', 'About PDF Do', 'info', () => showAbout());
    cmd('App', 'Theme: Ink (dark)', 'moon', () => setTheme('ink')); cmd('App', 'Theme: Paper (light)', 'sun', () => setTheme('paper'));
  }

  const TILES = [
    ['Open a PDF', 'Read, annotate and edit', 'open', ['#7b5cff', '#4a2fe0'], () => PD.openDialog()],
    ['Merge PDFs', 'Combine files & images', 'merge', ['#ff7a45', '#ff4d6d'], () => PD.setMode('merge')],
    ['Compare', 'See what changed', 'compare', ['#22d3ee', '#3b82f6'], () => PD.setMode('compare')],
    ['Organize pages', 'Reorder, rotate, delete', 'layers', ['#a3e635', '#22c55e'], D2(() => PD.setMode('pages'))],
    ['Edit text', 'Any font, any style', 'text', ['#f472b6', '#a855f7'], D2(() => PD.setMode('edit', { tool: 'edittext' }))],
    ['Sign', 'Draw, type or upload', 'sign', ['#fbbf24', '#f97316'], D2(() => PD.setMode('edit', { tool: 'sign' }))],
    ['Split', 'Cut into parts', 'split', ['#34d399', '#06b6d4'], D2(() => Pg.splitDialog())],
    ['Images → PDF', 'Photos & scans', 'image', ['#60a5fa', '#6366f1'], () => Cv.imagesToPdf()],
    ['Recognize text', 'OCR for scans', 'scan', ['#c084fc', '#7c3aed'], D2(() => Cv.ocr())],
    ['Redact', 'Black out sensitive info', 'eyeoff', ['#fb7185', '#e11d48'], D2(() => PD.setMode('protect', { tool: 'redact' }))],
    ['Compress', 'Make files smaller', 'zip', ['#2dd4bf', '#0ea5e9'], D2(() => T.compressDialog())],
    ['Watermark', 'Stamp every page', 'water', ['#facc15', '#fb923c'], D2(() => T.watermark())],
  ];
  function D2(fn) { return async () => { if (!PD.cur) { await PD.openDialog(); if (!PD.cur) return; } fn(); }; }

  function ago(t) { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago'; return new Date(t).toLocaleDateString(); }
  function renderHome() {
    const root = $('#home'); root.innerHTML = '';
    const hr = new Date().getHours(); const greet = hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const hero = h('div', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('span', { class: 'eyebrow' }, greet),
        h('h1', null, 'What do you want to ', h('em', null, 'do'), ' with a PDF?'),
        h('p', null, 'Read, mark up, rewrite, merge, split, compare and convert — everything happens on this computer. No accounts, no uploads, no cloud.'),
        h('div', { class: 'hero-cta' }, h('button', { class: 'btn primary big', onclick: () => PD.openDialog(), html: PD.ic('open', 20) + '<span>Open a PDF</span>' }), h('button', { class: 'btn big', onclick: () => Cv.blank(), html: PD.ic('blank', 20) + '<span>New blank</span>' }), h('button', { class: 'btn ghost big', onclick: () => PD.commandPalette(), html: PD.ic('cmd', 18) + '<span>Search tools <kbd>Ctrl K</kbd></span>' }))),
      h('div', { class: 'hero-drop', id: 'hero-drop' }, h('div', { class: 'drop-ring' }, h('img', { src: 'assets/logo.svg', alt: '' })), h('b', null, 'Drop PDFs anywhere'), h('small', null, 'or press Ctrl+O')));
    hero.querySelector('#hero-drop').addEventListener('click', () => PD.openDialog());
    const tiles = h('div', { class: 'tiles' }, TILES.map(([t, s, ic, g, fn], k) => h('button', { class: 'tile', style: '--g1:' + g[0] + ';--g2:' + g[1] + ';--k:' + k, onclick: fn }, h('span', { class: 'tile-ic', html: PD.ic(ic, 24, 1.8) }), h('b', null, t), h('small', null, s))));
    const recent = PD.recent.list();
    const rec = h('div', { class: 'recent' }, h('div', { class: 'sec-h' }, h('h2', null, 'Recent'), recent.length ? h('button', { class: 'link', onclick: () => { PD.recent.clear(); } }, 'Clear') : null),
      recent.length ? h('div', { class: 'rec-grid' }, recent.map((r) => h('div', { class: 'rcard' + (r.pinned ? ' pinned' : ''), onclick: () => PD.recent.open(r.id) },
        h('div', { class: 'rc-ic' }, h('span', { html: PD.ic('file', 26, 1.5) }), h('i', null, 'PDF')),
        h('div', { class: 'rc-t' }, h('b', { title: r.name }, r.name), h('small', null, r.pages + ' pages · ' + PD.fmtBytes(r.size) + ' · ' + ago(r.at))),
        h('div', { class: 'rc-a' }, h('button', { class: 'icon-btn' + (r.pinned ? ' on' : ''), 'data-tip': r.pinned ? 'Unpin' : 'Pin', html: PD.ic('pin', 15), onclick: (e) => { e.stopPropagation(); PD.recent.pin(r.id); } }), h('button', { class: 'icon-btn', 'data-tip': 'Remove from list', html: PD.ic('x', 15), onclick: (e) => { e.stopPropagation(); PD.recent.remove(r.id); } })))))
        : h('div', { class: 'rec-empty' }, h('span', { html: PD.ic('clock', 22, 1.5) }), 'Files you open will appear here — only the names are remembered, on this computer.'));
    root.append(hero, h('div', { class: 'sec-h' }, h('h2', null, 'Quick actions')), tiles, rec, h('div', { class: 'home-foot' }, h('span', { html: PD.ic('lock', 14) }), 'Private by design — PDF Do never connects to the internet.'));
  }
  PD.on('recent:changed', () => { if (PD.mode === 'home') renderHome(); });

  /* ================= convert view ================= */
  function renderConvert() {
    const root = $('#cardsview'); root.innerHTML = '';
    const grp = (title, sub, cards) => h('section', { class: 'cgroup' }, h('div', { class: 'sec-h' }, h('h2', null, title), h('small', null, sub)), h('div', { class: 'cards' }, cards.map(([t, s, ic, g, fn]) => h('button', { class: 'ccard', style: '--g1:' + g[0] + ';--g2:' + g[1], onclick: D2(fn) }, h('span', { class: 'tile-ic', html: PD.ic(ic, 24, 1.8) }), h('div', null, h('b', null, t), h('small', null, s))))));
    root.append(h('div', { class: 'view-head' }, h('h1', null, 'Convert'), h('p', null, 'Turn PDFs into other formats — and other files into PDFs.')),
      grp('From this PDF', PD.cur ? PD.cur.name : 'Open a PDF to enable these', [
        ['Images', 'PNG or JPG per page', 'image', ['#60a5fa', '#6366f1'], () => Cv.pdfToImages()],
        ['Extract pictures', 'Embedded images as PNG', 'image', ['#f472b6', '#e11d48'], () => Cv.extractImages()],
        ['Word document', '.docx with headings', 'file', ['#3b82f6', '#1d4ed8'], () => Cv.textExport('docx')],
        ['Plain text', '.txt', 'file', ['#94a3b8', '#64748b'], () => Cv.textExport('txt')],
        ['Markdown', '.md with headings', 'file', ['#a78bfa', '#7c3aed'], () => Cv.textExport('md')],
        ['Web page', '.html', 'file', ['#fb923c', '#ea580c'], () => Cv.textExport('html')],
        ['Recognize text (OCR)', 'Make scans searchable', 'scan', ['#c084fc', '#7c3aed'], () => Cv.ocr()],
        ['Print', 'Send to a printer or PDF', 'print', ['#34d399', '#059669'], () => T.print()],
      ]),
      grp('Into a PDF', 'No document needed', [
        ['Images to PDF', 'JPG, PNG, WebP, BMP', 'image', ['#f472b6', '#e11d48'], () => Cv.imagesToPdf()],
        ['Text file to PDF', '.txt, .md, .csv, .log', 'file', ['#fbbf24', '#f97316'], () => Cv.textToPdf()],
        ['Blank document', 'Choose size & pages', 'blank', ['#2dd4bf', '#0ea5e9'], () => Cv.blank()],
        ['Merge files', 'PDFs and images together', 'merge', ['#ff7a45', '#ff4d6d'], () => PD.setMode('merge')],
      ]));
    $$('.ccard', root).forEach((c, k) => { /* ensure cards that don't need a doc work */ });
    // cards in the second group must not require a doc
    const second = root.querySelectorAll('.cgroup')[1].querySelectorAll('.ccard');
    const fns = [() => Cv.imagesToPdf(), () => Cv.textToPdf(), () => Cv.blank(), () => PD.setMode('merge')];
    second.forEach((c, k) => { c.onclick = fns[k]; });
  }
  PD.on('doc:switch', () => { if (PD.mode === 'convert') renderConvert(); });

  /* ================= command palette ================= */
  PD.commandPalette = function () {
    const root = $('#palette'); root.innerHTML = ''; root.classList.add('on');
    const inp = h('input', { class: 'pal-in', type: 'text', placeholder: 'Type a tool or command…  e.g. “merge”, “watermark”, “rotate”', 'aria-label': 'Command search' });
    const list = h('div', { class: 'pal-list' });
    const card = h('div', { class: 'pal-card' }, h('div', { class: 'pal-head' }, h('span', { html: PD.ic('search', 20) }), inp, h('kbd', null, 'Esc')), list);
    root.appendChild(card);
    let items = [], sel = 0;
    const score = (c, q) => { if (!q) return 1; const s = (c.title + ' ' + c.group + ' ' + (c.kw || '')).toLowerCase(); const w = q.toLowerCase().split(/\s+/).filter(Boolean); let sc = 0; for (const t of w) { const i = s.indexOf(t); if (i < 0) { // subsequence (short queries only)
        if (t.length > 2) return 0; let p = 0; for (const ch of t) { p = s.indexOf(ch, p); if (p < 0) return 0; p++; } sc += 0.3; } else sc += 2 - Math.min(i, 40) / 50 + (c.title.toLowerCase().startsWith(t) ? 1 : 0); } return sc; };
    const draw = () => {
      const q = inp.value.trim(); items = PD.commands.map((c) => [c, score(c, q)]).filter((x) => x[1] > 0 && !(x[0].need && !PD.cur && false)).sort((a, b) => b[1] - a[1]).slice(0, 40).map((x) => x[0]);
      sel = 0; list.innerHTML = ''; let grp = '';
      items.forEach((c, k) => {
        if (!q && c.group !== grp) { grp = c.group; list.appendChild(h('div', { class: 'pal-grp' }, grp)); }
        const dis = c.need && !PD.cur;
        list.appendChild(h('button', { class: 'pal-item' + (k === 0 ? ' sel' : '') + (dis ? ' dis' : ''), 'data-k': k, onmousemove: () => { sel = k; mark(); }, onclick: () => run(c), html: '<span class="pi-ic">' + PD.ic(c.icon, 18) + '</span><span class="pi-t">' + PD.esc(c.title) + '</span><small>' + c.group + '</small>' + (c.key ? '<kbd>' + c.key + '</kbd>' : '') }));
      });
      if (!items.length) list.appendChild(h('div', { class: 'pal-empty' }, 'No matching commands'));
    };
    const mark = () => { $$('.pal-item', list).forEach((e) => e.classList.toggle('sel', +e.dataset.k === sel)); const e = $('.pal-item.sel', list); if (e) e.scrollIntoView({ block: 'nearest' }); };
    const close = () => { root.classList.remove('on'); root.innerHTML = ''; document.removeEventListener('keydown', key, true); };
    const run = async (c) => { close(); if (c.need && !PD.cur) { PD.toast('Open a PDF first', 'info'); return; } try { await c.run(); } catch (e) { if (e && e.message !== 'Cancelled') { console.error(e); PD.toast(e.message || String(e), 'error'); } } };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); } else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); } };
    document.addEventListener('keydown', key, true);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); }, { once: true });
    inp.addEventListener('input', draw); draw(); setTimeout(() => inp.focus(), 10);
  };

  /* ================= settings, fonts, shortcuts, about ================= */
  const cfg = () => PD.store.get('settings', { theme: 'ink', accent: 'violet', zoom: 100, fit: 'width' });
  function applyTheme() {
    const s = cfg(); let th = s.theme; if (th === 'auto') th = matchMedia('(prefers-color-scheme: light)').matches ? 'paper' : 'ink';
    document.documentElement.dataset.theme = th; document.documentElement.dataset.accent = s.accent; document.documentElement.style.zoom = s.zoom === 100 ? '' : s.zoom / 100;
  }
  function setTheme(t) { const s = cfg(); s.theme = t; PD.store.set('settings', s); applyTheme(); }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  function openSettings() {
    const s = cfg(); const set = (k, v) => { s[k] = v; PD.store.set('settings', s); applyTheme(); setTimeout(() => V.applyFit(), 60); };
    const acc = h('div', { class: 'accents' }, [['violet', '#7b5cff'], ['coral', '#ff6b4a'], ['lime', '#9be22d'], ['cyan', '#22d3ee'], ['rose', '#f43f8e']].map(([k, c]) => h('button', { class: 'acc' + (s.accent === k ? ' on' : ''), style: 'background:' + c, title: k, onclick: (e) => { set('accent', k); $$('.acc', acc).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
    PD.modal({ title: 'Settings', icon: 'gear', wide: true,
      content: h('div', { class: 'stack' },
        PD.ui.row('Appearance', PD.ui.seg([{ v: 'ink', icon: 'moon', label: 'Ink' }, { v: 'paper', icon: 'sun', label: 'Paper' }, { v: 'auto', label: 'Match system' }], s.theme, (v) => set('theme', v))),
        PD.ui.row('Accent color', acc),
        PD.ui.row('Interface size', PD.ui.seg([{ v: 90, label: '90%' }, { v: 100, label: '100%' }, { v: 110, label: '110%' }, { v: 125, label: '125%' }], s.zoom, (v) => set('zoom', v))),
        PD.ui.row('Fonts', h('button', { class: 'btn small', onclick: openFontManager, html: PD.ic('font', 14) + '<span>Manage fonts…</span>' })),
        PD.ui.row('Shortcuts', h('button', { class: 'btn small', onclick: showShortcuts, html: PD.ic('keyboard', 14) + '<span>View all</span>' })),
        PD.ui.row('Conversion engine', h('span', { class: PD.svc.ready ? 'ok' : 'muted' }, PD.svc.ready ? 'Connected — PyMuPDF layout engine' + (PD.svc.ocr ? ' + Tesseract OCR' : '') : 'Not running (built-in exporter is used). Start PDF Do with PDFDo.exe to enable it.')),
        h('p', { class: 'muted small' }, 'PDF Do keeps recent file names and your preferences on this computer only. Nothing is ever sent anywhere.')),
      buttons: [{ label: 'Done', kind: 'primary', value: true }] });
  }
  function openFontManager() {
    const F = PD.fonts; const box = h('div', { class: 'fm' });
    const sample = h('input', { class: 'input', value: 'The quick brown fox jumps over the lazy dog 0123456789' });
    const list = h('div', { class: 'fm-list' });
    const draw = () => {
      list.innerHTML = ''; let cat = '';
      F.families().forEach((f) => { if (f.cat !== cat) { cat = f.cat; list.appendChild(h('div', { class: 'fp-cat' }, cat)); } list.appendChild(h('div', { class: 'fm-row' }, h('small', null, f.name), h('div', { class: 'fm-sample', style: F.cssStyle({ family: f.name }) }, sample.value), f.kind === 'upload' ? h('button', { class: 'icon-btn', title: 'Remove', html: PD.ic('trash', 14), onclick: async () => { await F.removeUploaded(f.name); draw(); } }) : null)); });
    };
    sample.addEventListener('input', draw);
    box.append(h('div', { class: 'btnrow' },
      h('button', { class: 'btn primary', html: PD.ic('upload', 16) + '<span>Add font files…</span>', onclick: async () => { const fl = await PD.pickFiles({ accept: '.ttf,.otf,.woff,.woff2,.ttc', multiple: true, desc: 'Fonts', legacy: true }); if (!fl.length) return; try { const fams = await F.addFiles(fl.map((x) => x.file)); PD.toast('Added: ' + fams.join(', '), 'ok'); draw(); } catch (e) { PD.toast(e.message, 'error'); } } }),
      h('button', { class: 'btn', html: PD.ic('font', 16) + '<span>Use installed fonts</span>', onclick: async () => { if (await F.loadSystem()) { PD.toast(Object.keys(F.system).length + ' installed fonts available', 'ok'); draw(); } } })),
      h('p', { class: 'muted small' }, 'Fonts you add are remembered and embedded into the PDF when you save. Bold, italic, underline and strikethrough work with every font. You can also drag font files onto the window.'),
      sample, list);
    draw();
    PD.modal({ title: 'Fonts', icon: 'font', xwide: true, content: box, buttons: [{ label: 'Done', kind: 'primary', value: true }] });
  }
  function showShortcuts() {
    const rows = [['Ctrl + K', 'Command palette'], ['Ctrl + O', 'Open PDF'], ['Ctrl + S', 'Save'], ['Ctrl + Shift + S', 'Save a copy'], ['Ctrl + Z / Y', 'Undo / Redo'], ['Ctrl + F', 'Find in document'], ['Ctrl + P', 'Print'], ['Ctrl + W', 'Close tab'], ['Ctrl + Tab', 'Next tab'], ['Ctrl + wheel', 'Zoom'], ['PgUp / PgDn', 'Previous / next page'], ['F5', 'Present'],
      ['V', 'Select tool'], ['H', 'Hand tool'], ['T', 'Text'], ['E', 'Edit existing text'], ['U', 'Highlight'], ['P', 'Pen'], ['R / O / L / A', 'Rectangle / Ellipse / Line / Arrow'], ['N', 'Sticky note'], ['Del', 'Delete selection'], ['Ctrl + D', 'Duplicate'], ['Arrows', 'Nudge (Shift = ×10)'], ['Shift (drag)', 'Constrain proportions / angle'], ['Esc', 'Deselect / back to select tool']];
    PD.modal({ title: 'Keyboard shortcuts', icon: 'keyboard', wide: true, content: h('div', { class: 'kbd-grid' }, rows.map(([k, d]) => h('div', null, h('kbd', null, k), h('span', null, d)))), buttons: [{ label: 'Close', kind: 'primary', value: true }] });
  }
  function showAbout() {
    PD.modal({ title: 'About PDF Do', content: h('div', { class: 'about' }, h('img', { src: 'assets/logo.svg' }), h('h2', null, 'PDF', h('b', null, 'Do')), h('p', null, 'Version 1.0 — a private, offline PDF studio.'), h('p', { class: 'muted small' }, 'Built on pdf.js, pdf-lib, fontkit and Tesseract (all bundled). No accounts. No cloud. Your files never leave this computer.')), buttons: [{ label: 'Close', kind: 'primary', value: true }] });
  }

  /* ================= file menu ================= */
  function fileMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(); const d = PD.cur;
    const rec = PD.recent.list().slice(0, 5);
    PD.ui.menu([
      { label: 'Open…', icon: 'open', key: 'Ctrl+O', run: () => PD.openDialog() }, { label: 'New blank PDF', icon: 'blank', run: () => Cv.blank() },
      ...(rec.length ? ['-', ...rec.map((x) => ({ label: x.name, icon: 'clock', run: () => PD.recent.open(x.id) }))] : []), '-',
      { label: 'Save', icon: 'save', key: 'Ctrl+S', run: () => PD.save(), disabled: !d }, { label: 'Save a copy…', icon: 'save', key: 'Ctrl+Shift+S', run: () => PD.save(null, true), disabled: !d },
      { label: 'Print…', icon: 'print', key: 'Ctrl+P', run: () => T.print(), disabled: !d }, { label: 'Properties…', icon: 'info', run: () => T.metadata(), disabled: !d }, '-',
      { label: 'Settings', icon: 'gear', run: openSettings }, { label: 'Keyboard shortcuts', icon: 'keyboard', key: 'F1', run: showShortcuts }, { label: 'About PDF Do', icon: 'info', run: showAbout },
    ], r.left, r.bottom + 6);
  }

  /* ================= global keys & drag-drop ================= */
  function onKeys(e) {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    const typing = e.target && (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable);
    if (mod && k === 'k') { e.preventDefault(); PD.commandPalette(); return; }
    if (e.altKey && e.key === 'ArrowLeft' && PD.cur) { e.preventDefault(); V.back(); return; }
    if (e.altKey && e.key === 'ArrowRight' && PD.cur) { e.preventDefault(); V.forward(); return; }
    if (mod && k === 'o') { e.preventDefault(); PD.openDialog(); return; }
    if (mod && k === 's') { e.preventDefault(); if (PD.cur) PD.save(null, e.shiftKey); return; }
    if (mod && k === 'p') { e.preventDefault(); if (PD.cur) T.print(); return; }
    if (mod && k === 'w') { e.preventDefault(); if (PD.cur) PD.closeDoc(PD.cur); return; }
    if (mod && k === 'f') { e.preventDefault(); if (PD.cur) { if (!modeCfg(PD.mode).left) PD.setMode('read'); openLeft('search'); } return; }
    if (e.key === 'F1') { e.preventDefault(); showShortcuts(); return; }
    if (e.key === 'F5') { e.preventDefault(); if (PD.cur) V.present(); return; }
    if (mod && e.key === 'Tab') { e.preventDefault(); if (PD.docs.length > 1) { const i = PD.docs.indexOf(PD.cur); PD.setCurrent(PD.docs[(i + (e.shiftKey ? -1 : 1) + PD.docs.length) % PD.docs.length]); } return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); if (PD.cur) { if (e.shiftKey) PD.cur.redo(); else PD.cur.undo(); } return; }
    if (mod && k === 'y') { e.preventDefault(); if (PD.cur) PD.cur.redo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); V.zoomBy(1.15); return; }
    if (mod && e.key === '-') { e.preventDefault(); V.zoomBy(1 / 1.15); return; }
    if (mod && e.key === '0') { e.preventDefault(); V.setZoom(1, 'width'); return; }
    if (mod && k === 'a' && PD.mode === 'pages') { e.preventDefault(); Pg.selectWhere(() => true); return; }
    if (PD.mode === 'pages' && PD.cur) {
      if (e.key === 'Delete') { const s = Pg.selected(); if (s.length) Pg.remove(s); }
      else if (k === 'r' && !mod) { const s = Pg.selected(); Pg.rotate(s.length ? s : null, e.shiftKey ? -90 : 90); }
      return;
    }
    if (modeCfg(PD.mode).view === 'viewer' && PD.cur && !A.sel) {
      const doc = PD.cur;
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && doc.layout !== 'continuous')) { e.preventDefault(); V.next(); }
      else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && doc.layout !== 'continuous')) { e.preventDefault(); V.prev(); }
      else if (e.key === 'Home') { e.preventDefault(); V.goto(0, true); } else if (e.key === 'End') { e.preventDefault(); V.goto(doc.n - 1, true); }
      else if (document.body.classList.contains('presenting')) { if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); V.next(); } else if (e.key === 'ArrowUp') { e.preventDefault(); V.prev(); } }
    }
  }

  function initDrop() {
    const veil = $('#dropveil'); let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; veil.classList.add('on'); } });
    window.addEventListener('dragleave', (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('on'); } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      depth = 0; veil.classList.remove('on'); if (!hasFiles(e)) return; e.preventDefault();
      const items = [];
      const dtItems = Array.from(e.dataTransfer.items || []);
      for (const it of dtItems) { if (it.kind !== 'file') continue; let handle = null; try { if (it.getAsFileSystemHandle) { handle = await it.getAsFileSystemHandle(); if (handle && handle.kind !== 'file') handle = null; } } catch (err) { handle = null; } const f = handle ? await handle.getFile() : it.getAsFile(); if (f) items.push({ file: f, handle }); }
      if (!items.length) Array.from(e.dataTransfer.files).forEach((f) => items.push({ file: f, handle: null }));
      const fonts = items.filter((x) => /\.(ttf|otf|woff2?|ttc)$/i.test(x.file.name)); const imgs = items.filter((x) => /^image\//.test(x.file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(x.file.name)); const pdfs = items.filter((x) => /\.pdf$/i.test(x.file.name) || x.file.type === 'application/pdf');
      if (fonts.length) { try { const f = await PD.fonts.addFiles(fonts.map((x) => x.file)); PD.toast('Added font' + (f.length > 1 ? 's' : '') + ': ' + f.join(', '), 'ok'); } catch (err) { PD.toast(err.message, 'error'); } }
      if (PD.mode === 'merge') { await PD.merge.addFiles(pdfs.concat(imgs)); return; }
      if (PD.mode === 'compare' && pdfs.length) { const d = await PD.openFiles(pdfs.slice(0, 1)); if (d) { if (!PD.compare.A) PD.compare.A = d; else PD.compare.B = d; PD.setMode('compare'); } return; }
      if (pdfs.length) await PD.openFiles(pdfs);
      if (imgs.length) { if (PD.cur && PD.mode === 'edit') { for (const im of imgs) { const id = await A.storeImageFile(im.file); await A.placeImage(id); } } else await Cv.imagesToPdf(imgs); }
    });
  }

  /* ================= init ================= */
  async function init() {
    applyTheme(); PD.ui.initTips(); PD.hydrate();
    await PD.fonts.init();
    V.init(); A.init(); buildLeft(); buildDock(); defineCommands(); renderRail(); renderTabs(); initDrop();
    $('#btn-undo').onclick = () => PD.cur && PD.cur.undo(); $('#btn-redo').onclick = () => PD.cur && PD.cur.redo();
    $('#btn-save').onclick = () => PD.save(); $('#btn-menu').onclick = fileMenu; $('#btn-cmdk').onclick = () => PD.commandPalette(); $('#btn-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'ink' ? 'paper' : 'ink');
    $('#btn-left').onclick = () => { PD.leftOpen = !document.body.classList.contains('has-left'); document.body.classList.toggle('has-left', PD.leftOpen && !!modeCfg(PD.mode).left); setTimeout(() => V.applyFit(), 230); };
    $('#btn-insp').onclick = () => { PD.inspOpen = !document.body.classList.contains('has-insp'); document.body.classList.toggle('has-insp', PD.inspOpen && !!modeCfg(PD.mode).insp); setTimeout(() => V.applyFit(), 230); };
    $('#merge-add').onclick = async () => { const f = await PD.pickFiles({ accept: '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*', multiple: true, desc: 'PDFs and images', legacy: true }); if (f.length) PD.merge.addFiles(f); };
    $('#merge-open').onclick = () => PD.merge.addOpen(); $('#merge-go').onclick = () => PD.merge.run();
    $$('[data-msort]').forEach((b) => b.addEventListener('click', () => PD.merge.sort(b.dataset.msort)));
    $('#merge-clear').onclick = () => { PD.merge.items = []; PD.merge.render(); };
    document.addEventListener('keydown', onKeys);
    window.addEventListener('contextmenu', (e) => { if (!e.target.closest('input,textarea,[contenteditable]')) e.preventDefault(); });
    buildPagesToolbar();
    PD.on('mode:changed', () => PD.hydrate());
    PD.setMode('home');
    const q = new URLSearchParams(location.search).get('open');
    if (q) { try { const r = await fetch('file:///' + encodeURI(q.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')); const b = new Uint8Array(await r.arrayBuffer()); await PD.openBytes(b, q.split(/[\\/]/).pop()); } catch (e) { PD.toast('Could not open ' + q + ' — use Ctrl+O', 'error'); } }
    PD.svc.check().then((ok) => { if (ok) PD.toast('High-fidelity Word export and OCR are ready', 'ok', 2200); });
    setTimeout(() => PD.recover.offer(), 600);
    document.body.classList.add('ready');
  }

  function buildPagesToolbar() {
    const bar = $('#pagesbar'); bar.innerHTML = '';
    const b = (icon, label, fn, needsel, tip) => h('button', { class: 'pb-btn', 'data-needsel': needsel ? '1' : null, 'data-tip': tip || label, onclick: fn, html: PD.ic(icon, 17, 1.8) + '<span>' + label + '</span>' });
    const sel = () => Pg.selected();
    const sep = () => h('i', { class: 'isl-sep' });
    bar.append(
      b('rotccw', 'Left', () => Pg.rotate(sel().length ? sel() : null, -90), false, 'Rotate left (selected or all)'), b('rotcw', 'Right', () => Pg.rotate(sel().length ? sel() : null, 90), false, 'Rotate right (selected or all)'), sep(),
      b('trash', 'Delete', () => Pg.remove(sel()), true), b('copy', 'Duplicate', () => Pg.duplicate(sel()), true), b('scissors', 'Extract', () => Pg.extract(sel(), true), true, 'Extract selected pages into a new tab'), sep(),
      b('blank', 'Blank', () => Pg.insertBlank(sel().length ? sel()[sel().length - 1] : PD.cur.n - 1), false, 'Insert blank page'), b('plus', 'Insert PDF', () => Pg.insertFrom(sel().length ? sel()[sel().length - 1] : PD.cur.n - 1), false, 'Insert pages from another PDF'), sep(),
      b('sortaz', 'Sort', () => Pg.sortDialog()), b('split', 'Split', () => Pg.splitDialog()), b('crop', 'Crop', () => T.crop(sel().length ? sel() : null)), b('full', 'Size', () => T.resize()), sep(),
      b('bookmark', 'Bookmarks', () => T.bookmarks()), b('pagenum', 'Numbers', () => T.headerFooter('numbers'), false, 'Page numbers'), b('hash', 'Header/Footer', () => T.headerFooter()), b('water', 'Watermark', () => T.watermark()));
    const right = h('div', { class: 'pb-right' },
      h('span', { class: 'pg-count muted small' }, ''), h('button', { class: 'pb-btn mini', onclick: () => Pg.selectWhere(() => true) }, 'All'), h('button', { class: 'pb-btn mini', onclick: () => Pg.selectWhere((i) => i % 2 === 0) }, 'Odd'), h('button', { class: 'pb-btn mini', onclick: () => Pg.selectWhere((i) => i % 2 === 1) }, 'Even'), h('button', { class: 'pb-btn mini', onclick: () => Pg.selectWhere(() => false) }, 'None'),
      h('input', { type: 'range', class: 'range', min: 110, max: 320, value: Pg.thumb, 'aria-label': 'Thumbnail size', oninput: (e) => { Pg.thumb = +e.target.value; $('#pagegrid').style.setProperty('--tw', Pg.thumb + 'px'); } }));
    bar.appendChild(right);
  }

  window.addEventListener('DOMContentLoaded', () => { init().catch((e) => { console.error(e); document.body.classList.add('ready'); PD.toast('Startup problem: ' + e.message, 'error'); }); });
})();
