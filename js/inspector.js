/* PDF Do — inspector panel (object & tool properties), signature & stamp tools */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;
  const A = PD.annot, U = PD.ui;
  const Ins = (PD.inspector = {});

  const STAMPS = [
    ['APPROVED', '#16a34a'], ['REJECTED', '#dc2626'], ['DRAFT', '#6b7280'], ['CONFIDENTIAL', '#b91c1c'], ['FINAL', '#2563eb'], ['VOID', '#dc2626'],
    ['PAID', '#16a34a'], ['COPY', '#7c3aed'], ['URGENT', '#ea580c'], ['REVIEWED', '#0891b2'], ['SIGN HERE', '#d97706'], ['NOT APPROVED', '#dc2626'],
  ];

  Ins.render = function () {
    const box = PD.$('#inspector-body'); if (!box) return;
    box.innerHTML = '';
    const d = PD.cur;
    if (!d) { box.appendChild(h('div', { class: 'empty-note' }, h('span', { html: PD.ic('sliders', 28, 1.4) }), h('b', null, 'Nothing selected'), h('small', null, 'Open a PDF to see properties here.'))); return; }
    const o = A.getSel();
    if (o) { box.appendChild(objPanel(o)); return; }
    box.appendChild(toolPanel());
  };

  const label = (o) => ({ measure: 'Measurement', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', ink: 'Pen stroke', markup: { highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', squiggly: 'Squiggly' }[o.kind] || 'Markup', text: o.rep ? 'Edited text' : 'Text', image: o.kind === 'signature' ? 'Signature' : 'Image', stamp: 'Stamp', note: 'Sticky note', whiteout: 'Whiteout', redact: 'Redaction mark', link: 'Link', field: 'Form field', area: 'Area highlight' }[o.t] || o.t);

  function numRow(l, o, key, opts, label2) {
    return U.row(l, U.num(o[key], (v) => A.update(o, { [key]: v }, label2 || 'Edit'), opts));
  }

  function textControls(o, setter, defaults) {
    const f = o.font || (o.font = {});
    const set = (patch) => { setter(patch); };
    const setFont = (patch) => { const nf = Object.assign({}, o.font, patch); setter({ font: nf }); };
    const fp = PD.fonts.picker(f.family, (fam) => setFont({ family: fam }));
    const tg = U.toggles([
      { id: 'bold', icon: 'bold', title: 'Bold', on: f.bold }, { id: 'italic', icon: 'italic', title: 'Italic', on: f.italic },
      { id: 'underline', icon: 'underline', title: 'Underline', on: f.underline }, { id: 'strike', icon: 'strike', title: 'Strikethrough', on: f.strike },
    ], (id, on) => setFont({ [id]: on }));
    return h('div', null,
      U.row('Font', fp, 'full'),
      U.row('Size', U.num(o.size, (v) => set({ size: Math.max(2, v) }), { min: 2, max: 400, unit: 'pt' })),
      U.row('Style', tg),
      U.row('Align', U.seg([{ v: 'left', icon: 'alignl', title: 'Left' }, { v: 'center', icon: 'alignc', title: 'Center' }, { v: 'right', icon: 'alignr', title: 'Right' }], o.align || 'left', (v) => set({ align: v }))),
      U.row('Text color', U.color(o.color, (c) => set({ color: c }))),
      U.row('Background', U.color(o.bg, (c) => set({ bg: c }), { none: true })),
      U.row('Line height', U.range(0.8, 3, 0.05, o.lh || 1.25, (v) => set({ lh: v }), (v) => v.toFixed(2))),
      U.row('Letter spacing', U.range(-2, 20, 0.5, o.ls || 0, (v) => set({ ls: v }), (v) => v + ' pt')),
      U.row('Opacity', U.range(0.05, 1, 0.05, o.op != null ? o.op : 1, (v) => set({ op: v }), (v) => Math.round(v * 100) + '%')));
  }

  function objPanel(o) {
    const root = h('div', { class: 'insp' });
    root.appendChild(h('div', { class: 'insp-title' }, h('span', { class: 'chip' }, label(o)), h('span', { class: 'muted small' }, 'Page ' + (A.sel.i + 1))));
    const up = (patch, l) => A.update(o, patch, l || 'Edit ' + o.t);
    const s = PD.style;
    switch (o.t) {
      case 'text': {
        const setter = (patch) => {
          A.update(o, patch, 'Format text');
          if (patch.font) Object.assign(s.font, patch.font);
          ['size', 'align', 'lh', 'ls'].forEach((k) => { if (patch[k] != null) s[k] = patch[k]; });
          if (patch.color) s.textColor = patch.color; if ('bg' in patch) s.bg = patch.bg;
        };
        if (o.rep) root.appendChild(h('div', { class: 'note-box' }, h('b', null, 'Replacing original text'), h('span', null, 'The original line is covered and your edited text sits on top. Use Redact to remove text permanently.')));
        root.appendChild(U.section('Text', textControls(o, setter)));
        root.appendChild(U.section('Box', U.row('Wrap width', h('div', { class: 'inline' }, U.num(o.w || 0, (v) => up({ w: v > 0 ? Math.max(20, v) : 0 }, 'Resize'), { min: 0, unit: 'pt' }), h('small', { class: 'muted' }, '0 = auto'))), U.row('Rotation', U.num(o.rot || 0, (v) => up({ rot: v }, 'Rotate'), { unit: '°' }))));
        break;
      }
      case 'rect': case 'ellipse':
        root.appendChild(U.section('Appearance',
          U.row('Stroke', U.color(o.stroke, (c) => { s.stroke = c; up({ stroke: c }); }, { none: true })),
          U.row('Fill', U.color(o.fill, (c) => { s.fill = c; up({ fill: c }); }, { none: true })),
          U.row('Width', U.range(0, 24, 0.5, o.sw, (v) => { s.sw = v; up({ sw: v }); }, (v) => v + ' pt')),
          o.t === 'rect' ? U.row('Corner radius', U.range(0, 60, 1, o.rad || 0, (v) => up({ rad: v }), (v) => v + ' pt')) : null,
          U.row('Opacity', U.range(0.05, 1, 0.05, o.op, (v) => up({ op: v }), (v) => Math.round(v * 100) + '%')),
          U.row('Dashed', U.check('Dashed outline', o.dash, (v) => up({ dash: v })))));
        break;
      case 'line': case 'arrow':
        root.appendChild(U.section('Appearance',
          U.row('Color', U.color(o.stroke, (c) => { s.stroke = c; up({ stroke: c }); })),
          U.row('Width', U.range(0.5, 24, 0.5, o.sw, (v) => { s.sw = v; up({ sw: v }); }, (v) => v + ' pt')),
          U.row('Opacity', U.range(0.05, 1, 0.05, o.op, (v) => up({ op: v }), (v) => Math.round(v * 100) + '%')),
          U.row('Dashed', U.check('Dashed line', o.dash, (v) => up({ dash: v })))));
        break;
      case 'measure':
        root.appendChild(U.section('Measurement',
          U.row('Reads', h('b', { class: 'big-read' }, A.measureLabel(o))),
          U.row('Unit', U.seg([{ v: 'mm', label: 'mm' }, { v: 'cm', label: 'cm' }, { v: 'in', label: 'in' }, { v: 'pt', label: 'pt' }], o.unit || 'mm', (v) => { s.unit = v; up({ unit: v }); Ins.render(); })),
          U.row('Scale', U.num(o.mscale || 1, (v) => { s.mscale = v > 0 ? v : 1; up({ mscale: v > 0 ? v : 1 }); Ins.render(); }, { min: 0.0001, step: 0.1, unit: '×' })),
          U.row('Color', U.color(o.stroke, (c) => { s.stroke = c; up({ stroke: c }); })),
          h('p', { class: 'muted small' }, 'Scale multiplies the measured length — e.g. 100 for a 1:100 drawing.')));
        break;
      case 'ink':
        root.appendChild(U.section('Appearance',
          U.row('Color', U.color(o.stroke, (c) => { s.penColor = c; up({ stroke: c }); })),
          U.row('Width', U.range(0.5, 30, 0.5, o.sw, (v) => { s.penW = v; up({ sw: v }); }, (v) => v + ' pt')),
          U.row('Opacity', U.range(0.05, 1, 0.05, o.op, (v) => { s.penOp = v; up({ op: v }); }, (v) => Math.round(v * 100) + '%'))));
        break;
      case 'markup':
        root.appendChild(U.section('Appearance',
          U.row('Color', U.color(o.color, (c) => { if (o.kind === 'highlight') s.hl = c; else s.ul = c; up({ color: c }); }, { palette: o.kind === 'highlight' ? U.HL_PALETTE : U.PALETTE })),
          o.kind === 'highlight' ? U.row('Opacity', U.range(0.1, 1, 0.05, o.op, (v) => { s.hlOp = v; up({ op: v }); }, (v) => Math.round(v * 100) + '%')) : null,
          U.row('Style', U.seg([{ v: 'highlight', label: 'Hi' }, { v: 'underline', label: 'Ul' }, { v: 'strike', label: 'St' }, { v: 'squiggly', label: '~' }], o.kind, (v) => up({ kind: v, op: v === 'highlight' ? s.hlOp : 1 })))));
        break;
      case 'area':
        root.appendChild(U.section('Appearance', U.row('Color', U.color(o.color, (c) => up({ color: c }), { palette: U.HL_PALETTE })), U.row('Opacity', U.range(0.1, 1, 0.05, o.op, (v) => up({ op: v }), (v) => Math.round(v * 100) + '%'))));
        break;
      case 'whiteout':
        root.appendChild(U.section('Appearance', U.row('Fill', U.color(o.color, (c) => { s.whiteColor = c; up({ color: c }); }, { palette: ['#ffffff', '#f8fafc', '#fef3c7', '#e2e8f0', '#111827'] }))));
        break;
      case 'redact':
        root.appendChild(h('div', { class: 'note-box warn' }, h('b', null, 'Marked for redaction'), h('span', null, 'Nothing is removed until you choose “Apply redactions” in Protect. Applying permanently flattens affected pages.')));
        root.appendChild(h('button', { class: 'btn primary block', html: PD.ic('eyeoff', 16) + '<span>Apply all redactions…</span>', onclick: () => PD.tools.applyRedactions() }));
        break;
      case 'image':
        root.appendChild(U.section('Appearance', U.row('Opacity', U.range(0.05, 1, 0.05, o.op != null ? o.op : 1, (v) => up({ op: v }), (v) => Math.round(v * 100) + '%')), U.row('Rotation', U.num(o.rot || 0, (v) => up({ rot: v }, 'Rotate'), { unit: '°' }))));
        break;
      case 'stamp':
        root.appendChild(U.section('Stamp',
          U.row('Text', (() => { const i = h('input', { class: 'input', value: o.text }); i.addEventListener('input', () => up({ text: i.value.toUpperCase() })); return i; })()),
          U.row('Color', U.color(o.color, (c) => up({ color: c }))),
          U.row('Opacity', U.range(0.1, 1, 0.05, o.op != null ? o.op : 1, (v) => up({ op: v }), (v) => Math.round(v * 100) + '%')),
          U.row('Rotation', U.num(o.rot || 0, (v) => up({ rot: v }, 'Rotate'), { unit: '°' }))));
        break;
      case 'note': {
        const ta = h('textarea', { class: 'input', rows: 5 }); ta.value = o.text || ''; ta.addEventListener('input', () => { o.text = ta.value; A.commitSoon('Edit note'); });
        root.appendChild(U.section('Note', ta, U.row('Color', U.color(o.color, (c) => up({ color: c }), { palette: ['#fbbf24', '#fb7185', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'] }))));
        break;
      }
      case 'link': {
        const url = h('input', { class: 'input', value: o.url || '', placeholder: 'https://…' }); url.addEventListener('input', () => { o.url = url.value; A.commitSoon('Edit link'); });
        const pg = U.num((o.page || 0) + 1, (v) => up({ page: Math.max(0, Math.min(PD.cur.n - 1, v - 1)) }), { min: 1, max: PD.cur.n });
        root.appendChild(U.section('Link target', U.row('Type', U.seg([{ v: 'url', label: 'Web address' }, { v: 'page', label: 'Page' }], o.mode || 'url', (v) => { up({ mode: v }); Ins.render(); })), o.mode === 'page' ? U.row('Go to page', pg) : U.row('URL', url)));
        break;
      }
      case 'field': {
        const nm = h('input', { class: 'input', value: o.name }); nm.addEventListener('input', () => { o.name = nm.value.replace(/\s+/g, '_'); A.commitSoon('Rename field'); A.renderLayer(A.sel.i); });
        const parts = [U.row('Name', nm), U.row('Type', h('b', null, { text: 'Text field', check: 'Checkbox', drop: 'Dropdown' }[o.fk]))];
        if (o.fk === 'drop') { const op = h('textarea', { class: 'input', rows: 3 }); op.value = o.opts || ''; op.addEventListener('input', () => { o.opts = op.value; A.commitSoon('Edit field'); }); parts.push(U.row('Options', op)); }
        if (o.fk === 'text') parts.push(U.row('Multi-line', U.check('Allow several lines', o.multi, (v) => up({ multi: v }))));
        root.appendChild(U.section('Form field', ...parts));
        break;
      }
    }
    // geometry
    if (['rect', 'ellipse', 'image', 'stamp', 'whiteout', 'redact', 'link', 'field', 'area'].includes(o.t)) {
      root.appendChild(U.section('Position & size', h('div', { class: 'grid2' },
        U.row('X', U.num(o.x, (v) => up({ x: v }, 'Move'), { unit: 'pt' })), U.row('Y', U.num(o.y, (v) => up({ y: v }, 'Move'), { unit: 'pt' })),
        U.row('W', U.num(o.w, (v) => up({ w: Math.max(2, v) }, 'Resize'), { unit: 'pt' })), U.row('H', U.num(o.h, (v) => up({ h: Math.max(2, v) }, 'Resize'), { unit: 'pt' })))));
    }
    root.appendChild(U.section('Arrange', h('div', { class: 'btnrow' },
      h('button', { class: 'btn small', onclick: () => A.order('front'), html: PD.ic('up', 14) + '<span>Front</span>' }),
      h('button', { class: 'btn small', onclick: () => A.order('back'), html: PD.ic('down', 14) + '<span>Back</span>' }),
      h('button', { class: 'btn small', onclick: A.duplicate, html: PD.ic('copy', 14) + '<span>Duplicate</span>' }),
      h('button', { class: 'btn small danger', onclick: A.deleteSelected, html: PD.ic('trash', 14) + '<span>Delete</span>' }))));
    return root;
  }

  function toolPanel() {
    const t = PD.tool; const s = PD.style; const d = PD.cur;
    const root = h('div', { class: 'insp' });
    const T = A.TOOLS[t];
    const sec = (title, ...k) => root.appendChild(U.section(title, ...k));
    const head = (txt, hint) => root.appendChild(h('div', { class: 'tool-head' }, h('span', { class: 'th-ic', html: PD.ic(T.icon, 20) }), h('div', null, h('b', null, txt || T.label), h('small', null, hint || ''))));
    switch (t) {
      case 'hl': head('Highlight', 'Select text on the page to highlight it.'); sec('Appearance', U.row('Color', U.color(s.hl, (c) => (s.hl = c), { palette: U.HL_PALETTE })), U.row('Opacity', U.range(0.1, 1, 0.05, s.hlOp, (v) => (s.hlOp = v), (v) => Math.round(v * 100) + '%'))); break;
      case 'ul': case 'st': case 'sq': head(T.label, 'Select text on the page to mark it.'); sec('Appearance', U.row('Color', U.color(s.ul, (c) => (s.ul = c)))); break;
      case 'area': head('Highlight area', 'Drag a box — handy for scanned pages.'); sec('Appearance', U.row('Color', U.color(s.hl, (c) => (s.hl = c), { palette: U.HL_PALETTE })), U.row('Opacity', U.range(0.1, 1, 0.05, s.hlOp, (v) => (s.hlOp = v), (v) => Math.round(v * 100) + '%'))); break;
      case 'pen': head('Freehand pen', 'Draw anywhere on the page.'); sec('Pen', U.row('Color', U.color(s.penColor, (c) => (s.penColor = c))), U.row('Width', U.range(0.5, 30, 0.5, s.penW, (v) => (s.penW = v), (v) => v + ' pt')), U.row('Opacity', U.range(0.05, 1, 0.05, s.penOp, (v) => (s.penOp = v), (v) => Math.round(v * 100) + '%'))); break;
      case 'rect': case 'ellipse': case 'line': case 'arrow':
        head(T.label, 'Drag on the page. Hold Shift to constrain.');
        sec('Appearance', U.row('Stroke', U.color(s.stroke, (c) => (s.stroke = c))), t === 'rect' || t === 'ellipse' ? U.row('Fill', U.color(s.fill, (c) => (s.fill = c), { none: true })) : null, U.row('Width', U.range(0.5, 24, 0.5, s.sw, (v) => (s.sw = v), (v) => v + ' pt')), U.row('Opacity', U.range(0.05, 1, 0.05, s.op, (v) => (s.op = v), (v) => Math.round(v * 100) + '%')), U.row('Dashed', U.check('Dashed', s.dash, (v) => (s.dash = v)))); break;
      case 'text': case 'edittext': {
        head(t === 'text' ? 'Add text' : 'Edit existing text', t === 'text' ? 'Click to type, or drag to set a wrap width.' : 'Click a line of text to rewrite it. Pick any font and style.');
        const proxy = { font: s.font, size: s.size, color: s.textColor, bg: s.bg, align: s.align, lh: s.lh, ls: s.ls, op: 1 };
        sec('Text defaults', textControls(proxy, (patch) => { if (patch.font) Object.assign(s.font, patch.font); ['size', 'align', 'lh', 'ls'].forEach((k) => { if (patch[k] != null) s[k] = patch[k]; }); if (patch.color) s.textColor = patch.color; if ('bg' in patch) s.bg = patch.bg; Object.assign(proxy, patch); }));
        break;
      }
      case 'note': head('Sticky note', 'Click the page to drop a comment.'); sec('Appearance', U.row('Color', U.color(s.noteColor, (c) => (s.noteColor = c), { palette: ['#fbbf24', '#fb7185', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'] }))); break;
      case 'stamp': {
        head('Stamp', 'Choose a stamp, then click the page.');
        const grid = h('div', { class: 'stamp-grid' });
        STAMPS.forEach(([txt, col]) => { const b = h('button', { class: 'stamp-chip' + (s.stamp === txt ? ' on' : ''), style: 'color:' + col + ';border-color:' + col, onclick: () => { s.stamp = txt; s.stampColor = col; Ins.render(); } }, txt); grid.appendChild(b); });
        const custom = h('input', { class: 'input', placeholder: 'Custom text…', value: STAMPS.some((x) => x[0] === s.stamp) ? '' : s.stamp }); custom.addEventListener('input', () => { s.stamp = custom.value.toUpperCase() || 'APPROVED'; });
        const dateBtn = h('button', { class: 'btn small', html: PD.ic('clock', 14) + '<span>Date stamp</span>', onclick: () => { s.stamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase(); custom.value = s.stamp; } });
        sec('Presets', grid); sec('Custom', custom, dateBtn, U.row('Color', U.color(s.stampColor, (c) => (s.stampColor = c))), U.row('Opacity', U.range(0.1, 1, 0.05, s.stampOp, (v) => (s.stampOp = v), (v) => Math.round(v * 100) + '%')));
        break;
      }
      case 'sign': head('Signature', 'Create or pick a saved signature, then click the page to place it.'); root.appendChild(h('button', { class: 'btn primary block', onclick: () => PD.sign.open(), html: PD.ic('sign', 16) + '<span>Create or choose signature…</span>' })); break;
      case 'image': head('Add image', 'Pick a picture, then click the page to place it.'); root.appendChild(h('button', { class: 'btn primary block', onclick: () => A.pickImage(), html: PD.ic('image', 16) + '<span>Choose image…</span>' })); break;
      case 'whiteout': head('Whiteout', 'Drag over anything to cover it with a solid color.'); sec('Fill', U.row('Color', U.color(s.whiteColor, (c) => (s.whiteColor = c), { palette: ['#ffffff', '#f8fafc', '#fef3c7', '#e2e8f0', '#111827'] }))); break;
      case 'redact': head('Redaction marks', 'Drag over sensitive content, then apply.'); root.appendChild(h('button', { class: 'btn primary block', onclick: () => PD.tools.applyRedactions(), html: PD.ic('eyeoff', 16) + '<span>Apply all redactions…</span>' })); break;
      case 'link': head('Link', 'Drag a box, then set where it points.'); break;
      case 'measure': head('Measure', 'Drag between two points to read a distance.'); sec('Units', U.row('Unit', U.seg([{ v: 'mm', label: 'mm' }, { v: 'cm', label: 'cm' }, { v: 'in', label: 'in' }, { v: 'pt', label: 'pt' }], s.unit, (v) => (s.unit = v))), U.row('Scale', U.num(s.mscale, (v) => (s.mscale = v > 0 ? v : 1), { min: 0.0001, step: 0.1, unit: '×' })), U.row('Color', U.color(s.stroke, (c) => (s.stroke = c)))); break;
      case 'eraser': head('Eraser', 'Click or drag over annotations to remove them.'); break;
      case 'ftext': case 'fcheck': case 'fdrop': head(T.label, 'Drag on the page to place a fillable field.'); break;
      case 'hand': head('Hand', 'Drag to pan around the page.'); break;
      default: return docPanel(root);
    }
    return root;
  }

  function docPanel(root) {
    const d = PD.cur; const vb = PD.viewer;
    const info = h('div', { class: 'docinfo' },
      h('div', { class: 'di-name' }, h('span', { html: PD.ic('file', 20) }), h('b', null, d.name)),
      h('div', { class: 'di-grid' },
        h('div', null, h('small', null, 'Pages'), h('b', null, String(d.n))),
        h('div', null, h('small', null, 'Size'), h('b', null, PD.fmtBytes(d.bytes.length))),
        h('div', null, h('small', null, 'Page'), h('b', null, d.info.length ? Math.round(d.info[Math.min(d.cur, d.n - 1)].w) + '×' + Math.round(d.info[Math.min(d.cur, d.n - 1)].h) + ' pt' : '—')),
        h('div', null, h('small', null, 'Edits'), h('b', null, String(d.objCount())))));
    root.appendChild(info);
    root.appendChild(U.section('Reading',
      U.row('Page color', U.seg([{ v: 'normal', label: 'Paper' }, { v: 'sepia', label: 'Sepia' }, { v: 'dark', label: 'Night' }], vb.readMode, (v) => vb.setReadMode(v))),
      U.row('Layout', U.seg([{ v: 'continuous', icon: 'list', title: 'Continuous' }, { v: 'single', icon: 'file', title: 'Single page' }, { v: 'two', icon: 'columns', title: 'Two pages' }, { v: 'book', icon: 'book', title: 'Book view' }], d.layout, (v) => vb.setLayout(v)))));
    root.appendChild(h('div', { class: 'note-box' }, h('b', null, 'Tip'), h('span', null, 'Press Ctrl+K to search every tool and command. Double-click text you added to edit it.')));
    return root;
  }

  PD.on('sel:changed', () => Ins.render());
  PD.on('tool:changed', () => Ins.render());
  PD.on('doc:switch', () => Ins.render());
  PD.on('doc:history', PD.debounce(() => { if (!A.getSel() && PD.tool === 'select' && PD.mode !== 'forms') Ins.render(); }, 250));
  PD.on('page:changed', PD.debounce(() => { if (!A.getSel() && !['pen', 'rect'].includes(PD.tool) && PD.tool === 'select') Ins.render(); }, 200));
  PD.on('sel:update', () => {
    const o = A.getSel(); if (!o) return;
    // light refresh of numeric geometry fields
    const nums = PD.$$('#inspector-body .numfield');
    if (nums.length === 0) return;
  });

  /* ---------- signature creator ---------- */
  PD.sign = {
    async saved() { return (await PD.idb.get('sigs', 'list')) || []; },
    async open() {
      const saved = await PD.sign.saved();
      let tab = 'draw', color = '#1d4ed8', typed = '', typedFont = 'Dancing Script', uploaded = null;
      const cv = h('canvas', { class: 'sig-canvas', width: 720, height: 260 });
      const ctx = cv.getContext('2d'); let strokes = [], cur = null;
      const redraw = () => { ctx.clearRect(0, 0, cv.width, cv.height); ctx.strokeStyle = color; ctx.lineWidth = 4.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; strokes.forEach((s) => { ctx.beginPath(); s.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]); ctx.stroke(); }); };
      const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); redraw(); });
      cv.addEventListener('pointermove', (e) => { if (cur) { cur.push(pt(e)); redraw(); } });
      cv.addEventListener('pointerup', () => (cur = null));
      const typedPrev = h('div', { class: 'sig-typed' }, 'Your name');
      const typedIn = h('input', { class: 'input', placeholder: 'Type your name', type: 'text' });
      const fonts = ['Dancing Script', 'Great Vibes', 'Caveat', 'Pacifico'];
      const fontRow = h('div', { class: 'sig-fonts' }, fonts.map((f) => h('button', { class: 'sig-font' + (f === typedFont ? ' on' : ''), style: 'font-family:"' + f + '"', onclick: (e) => { typedFont = f; Array.from(fontRow.children).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); paintTyped(); } }, 'Signature')));
      const paintTyped = () => { typedPrev.textContent = typed || 'Your name'; typedPrev.style.fontFamily = '"' + typedFont + '"'; typedPrev.style.color = color; };
      typedIn.addEventListener('input', () => { typed = typedIn.value; paintTyped(); });
      const upBtn = h('button', { class: 'btn', html: PD.ic('upload', 16) + '<span>Choose image of your signature…</span>', onclick: async () => { const f = await PD.pickFiles({ accept: '.png,.jpg,.jpeg,.webp', legacy: true, desc: 'Images' }); if (f.length) { uploaded = await PD.blobToDataUrl(f[0].file); upPrev.src = uploaded; upPrev.style.display = 'block'; } } });
      const upPrev = h('img', { class: 'sig-up', style: 'display:none' });
      const panes = {
        draw: h('div', null, h('div', { class: 'sig-pad' }, cv, h('div', { class: 'sig-line' }, 'Sign here')), h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { strokes = []; redraw(); }, html: PD.ic('eraser', 14) + '<span>Clear</span>' }), h('button', { class: 'btn small', onclick: () => { strokes.pop(); redraw(); }, html: PD.ic('undo', 14) + '<span>Undo stroke</span>' }))),
        type: h('div', null, typedIn, typedPrev, fontRow),
        image: h('div', null, upBtn, upPrev),
      };
      const tabs = h('div', { class: 'seg wide' });
      const show = () => { Object.keys(panes).forEach((k) => (panes[k].style.display = k === tab ? '' : 'none')); Array.from(tabs.children).forEach((b) => b.classList.toggle('on', b._v === tab)); };
      [['draw', 'Draw'], ['type', 'Type'], ['image', 'Image']].forEach(([v, l]) => { const b = h('button', { type: 'button' }, l); b._v = v; b.addEventListener('click', () => { tab = v; show(); }); tabs.appendChild(b); });
      const colorRow = h('div', { class: 'sig-opts' }, h('span', null, 'Ink'), U.color(color, (c) => { color = c; redraw(); paintTyped(); }, { palette: ['#111827', '#1d4ed8', '#0f766e', '#7c3aed', '#b91c1c'] }));
      const remember = { v: true }; const rem = U.check('Remember this signature on this computer', true, (v) => (remember.v = v));
      const savedBox = h('div', { class: 'sig-saved' });
      const drawSaved = () => { savedBox.innerHTML = ''; if (!saved.length) return; savedBox.appendChild(h('div', { class: 'cp-lbl' }, 'Saved signatures')); const row = h('div', { class: 'sig-saved-row' }); saved.forEach((s, k) => { row.appendChild(h('div', { class: 'sig-thumb' }, h('img', { src: s.url, onclick: () => use(s.url, true) }), h('button', { class: 'icon-btn', title: 'Remove', html: PD.ic('x', 12), onclick: async () => { saved.splice(k, 1); await PD.idb.set('sigs', 'list', saved); drawSaved(); } }))); }); savedBox.appendChild(row); };
      drawSaved();
      paintTyped(); const content = h('div', { class: 'sig-wrap' }, tabs, ...Object.values(panes), colorRow, rem, savedBox);
      show();
      async function use(url, fromSaved) {
        const im = await PD.loadImage(url);
        const id = PD.uid('img'); PD.imgs[id] = url;
        const w = 150, hh = (150 * im.naturalHeight) / im.naturalWidth;
        A.pending = { t: 'image', img: id, w, h: hh, kind: 'signature' };
        A.setToolSilent('sign'); PD.toast('Click on the page where the signature goes', 'info');
        return true;
      }
      const res = await PD.modal({ title: 'Your signature', icon: 'sign', xwide: false, wide: true, content,
        buttons: [{ label: 'Cancel', value: false }, { label: 'Use signature', kind: 'primary', icon: 'check', run: async () => {
          let url = null;
          if (tab === 'draw') {
            if (!strokes.length) { PD.toast('Draw your signature first', 'error'); return false; }
            url = trim(cv);
          } else if (tab === 'type') {
            if (!typed.trim()) { PD.toast('Type your name first', 'error'); return false; }
            await document.fonts.load('80px "' + typedFont + '"');
            const c = document.createElement('canvas'); const cx = c.getContext('2d'); cx.font = '90px "' + typedFont + '"'; const w = Math.ceil(cx.measureText(typed).width) + 40; c.width = w; c.height = 170; cx.font = '90px "' + typedFont + '"'; cx.fillStyle = color; cx.textBaseline = 'middle'; cx.fillText(typed, 20, 90); url = trim(c);
          } else { if (!uploaded) { PD.toast('Choose an image first', 'error'); return false; } url = await whiteToAlpha(uploaded); }
          if (remember.v) { saved.unshift({ url }); await PD.idb.set('sigs', 'list', saved.slice(0, 6)); }
          await use(url);
          return true;
        } }] });
      if (!res && PD.tool === 'sign' && !A.pending) A.setTool('select');
    },
  };
  function trim(c) {
    const ctx = c.getContext('2d'); const w = c.width, hh = c.height; const data = ctx.getImageData(0, 0, w, hh).data;
    let x0 = w, y0 = hh, x1 = 0, y1 = 0;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return c.toDataURL('image/png');
    const pad = 10; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(hh, y1 + pad);
    const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o.toDataURL('image/png');
  }
  async function whiteToAlpha(url) {
    const im = await PD.loadImage(url); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height); const d = id.data;
    for (let k = 0; k < d.length; k += 4) { const lum = (d[k] + d[k + 1] + d[k + 2]) / 3; if (lum > 225) d[k + 3] = 0; else if (lum > 170) d[k + 3] = Math.round(((225 - lum) / 55) * 255); }
    x.putImageData(id, 0, 0); return trim(c);
  }
})();
