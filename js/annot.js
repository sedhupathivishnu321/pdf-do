/* PDF Do — annotation & edit engine: overlay objects, rendering, selection, drawing tools */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;
  const A = (PD.annot = {});
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const e = document.createElementNS(NS, tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const rad = (d) => (d * Math.PI) / 180;

  PD.tool = 'select';
  PD.style = {
    color: '#ef4444', stroke: '#ef4444', fill: '', sw: 3, op: 1, dash: false, rad: 0,
    hl: '#ffe14a', hlOp: 0.45, ul: '#ef4444', penColor: '#2563eb', penW: 3, penOp: 1,
    font: { family: 'Inter', bold: false, italic: false, underline: false, strike: false },
    size: 18, textColor: '#111827', bg: '', align: 'left', lh: 1.25, ls: 0,
    stamp: 'APPROVED', stampColor: '#16a34a', stampOp: 0.9,
    noteColor: '#fbbf24', whiteColor: '#ffffff', unit: 'mm', mscale: 1,
  };
  A.sel = null; // {i,id}
  A.clip = null;
  A.pending = null; // object template for placement tools (image / signature / stamp)

  const TOOLS = {
    select: { label: 'Select', icon: 'cursor', key: 'V', kind: 'select' },
    hand: { label: 'Hand / Pan', icon: 'hand', key: 'H', kind: 'select' },
    hl: { label: 'Highlight text', icon: 'highlight', key: 'U', kind: 'markup', mk: 'highlight' },
    ul: { label: 'Underline text', icon: 'underline', kind: 'markup', mk: 'underline' },
    st: { label: 'Strikethrough text', icon: 'strike', kind: 'markup', mk: 'strike' },
    sq: { label: 'Squiggly underline', icon: 'squiggle', kind: 'markup', mk: 'squiggly' },
    area: { label: 'Highlight area', icon: 'rect', kind: 'drag', t: 'area' },
    pen: { label: 'Freehand pen', icon: 'pen', key: 'P', kind: 'ink' },
    rect: { label: 'Rectangle', icon: 'rect', key: 'R', kind: 'drag', t: 'rect' },
    ellipse: { label: 'Ellipse', icon: 'ellipse', key: 'O', kind: 'drag', t: 'ellipse' },
    line: { label: 'Line', icon: 'line', key: 'L', kind: 'line', t: 'line' },
    arrow: { label: 'Arrow', icon: 'arrow', key: 'A', kind: 'line', t: 'arrow' },
    measure: { label: 'Measure distance', icon: 'ruler', key: 'M', kind: 'line', t: 'measure' },
    text: { label: 'Add text', icon: 'text', key: 'T', kind: 'text' },
    edittext: { label: 'Edit existing text', icon: 'textcursor', key: 'E', kind: 'edittext' },
    note: { label: 'Sticky note', icon: 'note', key: 'N', kind: 'note' },
    stamp: { label: 'Stamp', icon: 'stamp', kind: 'place' },
    image: { label: 'Add image', icon: 'image', kind: 'place' },
    sign: { label: 'Signature', icon: 'sign', kind: 'place' },
    whiteout: { label: 'Whiteout / cover', icon: 'eraser', kind: 'drag', t: 'whiteout' },
    redact: { label: 'Mark for redaction', icon: 'eyeoff', kind: 'drag', t: 'redact' },
    link: { label: 'Add link', icon: 'link', kind: 'drag', t: 'link' },
    eraser: { label: 'Eraser (remove annotation)', icon: 'trash', kind: 'eraser' },
    ftext: { label: 'Text field', icon: 'textcursor', kind: 'drag', t: 'field', fk: 'text' },
    fcheck: { label: 'Checkbox', icon: 'checkbox', kind: 'drag', t: 'field', fk: 'check' },
    fdrop: { label: 'Dropdown', icon: 'dropdown', kind: 'drag', t: 'field', fk: 'drop' },
  };
  A.TOOLS = TOOLS;

  const doc = () => PD.cur;
  const objs = (i) => { const d = doc(); return (d.ov[i] = d.ov[i] || []); };
  A.find = (i, id) => (doc() && doc().ov[i] ? doc().ov[i].find((o) => o.id === id) : null);
  A.getSel = () => (A.sel ? A.find(A.sel.i, A.sel.id) : null);

  /* ---------- geometry ---------- */
  const ROT_TYPES = ['text', 'image', 'stamp'];
  const BOX_TYPES = ['rect', 'ellipse', 'image', 'stamp', 'whiteout', 'redact', 'link', 'field', 'area'];
  A.bbox = function (o, i) {
    switch (o.t) {
      case 'line': case 'arrow': case 'measure': { const [a, b, c, d] = o.p; const pad = (o.sw || 2) * 1.5 + (o.t === 'measure' ? 14 : 0); return { x: Math.min(a, c) - pad, y: Math.min(b, d) - pad, w: Math.abs(c - a) + pad * 2, h: Math.abs(d - b) + pad * 2 }; }
      case 'ink': { const xs = o.pts.map((p) => p[0]), ys = o.pts.map((p) => p[1]); const pad = (o.sw || 2) / 2 + 1; return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 }; }
      case 'markup': { const xs = [], ys = []; o.rects.forEach((r) => { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      case 'note': return { x: o.x, y: o.y, w: 26, h: 26 };
      case 'text': { const el = i != null ? layerEl(i, o.id) : null; return { x: o.x, y: o.y, w: el ? el.offsetWidth : o.w || 80, h: el ? el.offsetHeight : o.h || o.size * 1.3 }; }
      default: return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
  };
  function layerEl(i, id) { const p = PD.viewer.pageEl(i); return p ? p.querySelector('[data-id="' + id + '"]') : null; }

  /* ---------- rendering ---------- */
  A.renderAll = function () {
    const d = doc(); if (!d) return;
    PD.viewer.pagesEl.querySelectorAll('.page').forEach((el) => A.renderLayer(+el.dataset.i));
  };
  A.renderLayer = function (i) {
    const d = doc(); const pe = PD.viewer.pageEl(i); if (!d || !pe) return;
    const ov = pe.querySelector('.ov');
    // preserve a text element being edited
    const editing = ov.querySelector('[contenteditable="true"]');
    ov.innerHTML = '';
    const list = d.ov[i] || [];
    const vec = sv('svg', { class: 'vec', width: d.info[i].w, height: d.info[i].h, viewBox: '0 0 ' + d.info[i].w + ' ' + d.info[i].h });
    ov.appendChild(vec);
    list.forEach((o) => {
      if (editing && editing.dataset.id === o.id) return;
      const node = renderObj(o, i);
      if (!node) return;
      if (node instanceof SVGElement) vec.appendChild(node); else ov.appendChild(node);
    });
    if (editing) { ov.appendChild(editing); }
    if (A.sel && A.sel.i === i) drawSelection(i);
  };

  const dashAttr = (o) => (o.dash ? String(Math.max(3, (o.sw || 2) * 3)) + ' ' + String(Math.max(3, (o.sw || 2) * 2)) : null);

  function renderObj(o, i) {
    switch (o.t) {
      case 'rect': case 'area': case 'whiteout': case 'redact': case 'link': case 'field': return renderBox(o);
      case 'ellipse': {
        const g = sv('g', { class: 'obj', 'data-id': o.id, opacity: o.op != null ? o.op : 1 });
        const e = sv('ellipse', { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.max(0.5, o.w / 2), ry: Math.max(0.5, o.h / 2), fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.sw || 0 });
        if (dashAttr(o)) e.setAttribute('stroke-dasharray', dashAttr(o));
        if (!o.fill) g.appendChild(sv('ellipse', { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.max(0.5, o.w / 2), ry: Math.max(0.5, o.h / 2), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, (o.sw || 0) + 8), 'pointer-events': 'stroke' }));
        g.appendChild(e); return g;
      }
      case 'measure': return renderMeasure(o);
      case 'line': case 'arrow': {
        const [x1, y1, x2, y2] = o.p; const g = sv('g', { class: 'obj', 'data-id': o.id, opacity: o.op != null ? o.op : 1 });
        const hit = sv('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': Math.max(10, (o.sw || 2) + 8) }); g.appendChild(hit);
        const l = sv('line', { x1, y1, x2, y2, stroke: o.stroke, 'stroke-width': o.sw, 'stroke-linecap': 'round' });
        if (dashAttr(o)) l.setAttribute('stroke-dasharray', dashAttr(o));
        g.appendChild(l);
        if (o.t === 'arrow') {
          const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(9, o.sw * 4.2), sp = rad(26);
          const pts = [[x2, y2], [x2 - hl * Math.cos(ang - sp), y2 - hl * Math.sin(ang - sp)], [x2 - hl * Math.cos(ang + sp), y2 - hl * Math.sin(ang + sp)]];
          g.appendChild(sv('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: o.stroke, stroke: o.stroke, 'stroke-width': o.sw * 0.4, 'stroke-linejoin': 'round' }));
        }
        return g;
      }
      case 'ink': {
        const g = sv('g', { class: 'obj', 'data-id': o.id, opacity: o.op != null ? o.op : 1 });
        const d = inkPath(o.pts);
        g.appendChild(sv('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(10, o.sw + 8), 'stroke-linecap': 'round' }));
        g.appendChild(sv('path', { d, fill: 'none', stroke: o.stroke, 'stroke-width': o.sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        return g;
      }
      case 'markup': {
        const g = sv('g', { class: 'obj markup ' + o.kind, 'data-id': o.id });
        o.rects.forEach((r) => {
          if (o.kind === 'highlight') g.appendChild(sv('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: o.color, opacity: o.op != null ? o.op : 0.45, style: 'mix-blend-mode:multiply', rx: 1.5 }));
          else {
            g.appendChild(sv('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'transparent' }));
            const lw = Math.max(1, r.h * 0.07);
            if (o.kind === 'underline') g.appendChild(sv('line', { x1: r.x, x2: r.x + r.w, y1: r.y + r.h - lw, y2: r.y + r.h - lw, stroke: o.color, 'stroke-width': lw * 1.4 }));
            else if (o.kind === 'strike') g.appendChild(sv('line', { x1: r.x, x2: r.x + r.w, y1: r.y + r.h * 0.55, y2: r.y + r.h * 0.55, stroke: o.color, 'stroke-width': lw * 1.4 }));
            else g.appendChild(sv('path', { d: squigglePath(r), fill: 'none', stroke: o.color, 'stroke-width': lw * 1.3, 'stroke-linecap': 'round' }));
          }
        });
        return g;
      }
      case 'text': return renderText(o, i);
      case 'image': {
        const el = h('div', { class: 'obj img', 'data-id': o.id, style: boxStyle(o) + 'opacity:' + (o.op != null ? o.op : 1) });
        el.appendChild(h('img', { src: PD.imgs[o.img] || '', draggable: 'false' })); return el;
      }
      case 'stamp': {
        const fs = Math.max(6, Math.min(o.h * 0.5, (o.w * 0.86) / Math.max(3, o.text.length * 0.62)));
        const el = h('div', { class: 'obj stamp', 'data-id': o.id, style: boxStyle(o) + 'opacity:' + (o.op != null ? o.op : 1) + ';color:' + o.color + ';border:' + Math.max(1.5, o.h * 0.06) + 'px solid ' + o.color + ';border-radius:' + o.h * 0.14 + 'px;font-size:' + fs + 'px;' }, h('span', null, o.text));
        return el;
      }
      case 'note': {
        const el = h('div', { class: 'obj note', 'data-id': o.id, style: 'left:' + o.x + 'px;top:' + o.y + 'px;--nc:' + (o.color || '#fbbf24'), title: o.text || 'Note', html: PD.ic('note', 15, 2) });
        return el;
      }
    }
    return null;
  }
  function boxStyle(o) {
    return 'left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px;height:' + o.h + 'px;' + (o.rot ? 'transform:rotate(' + o.rot + 'deg);' : '');
  }
  function renderBox(o) {
    const g = sv('g', { class: 'obj ' + o.t, 'data-id': o.id });
    const base = { x: o.x, y: o.y, width: Math.max(0.5, o.w), height: Math.max(0.5, o.h) };
    if (o.t === 'rect') {
      g.setAttribute('opacity', o.op != null ? o.op : 1);
      const r = sv('rect', Object.assign({ fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.sw || 0, rx: o.rad || 0 }, base));
      if (!o.fill) g.appendChild(sv('rect', Object.assign({ fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, (o.sw || 0) + 8), 'pointer-events': 'stroke' }, base)));
      if (dashAttr(o)) r.setAttribute('stroke-dasharray', dashAttr(o)); g.appendChild(r);
    } else if (o.t === 'area') {
      g.appendChild(sv('rect', Object.assign({ fill: o.color, opacity: o.op != null ? o.op : 0.4, style: 'mix-blend-mode:multiply' }, base)));
    } else if (o.t === 'whiteout') {
      g.appendChild(sv('rect', Object.assign({ fill: o.color || '#fff' }, base)));
    } else if (o.t === 'redact') {
      g.appendChild(sv('rect', Object.assign({ fill: 'rgba(239,68,68,.22)', stroke: '#ef4444', 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }, base)));
      const t = sv('text', { x: o.x + 5, y: o.y + 13, fill: '#ef4444', 'font-size': 9, 'font-family': 'Inter,Arial', 'font-weight': 700 }); t.textContent = 'REDACT'; if (o.h > 16 && o.w > 44) g.appendChild(t);
    } else if (o.t === 'link') {
      g.appendChild(sv('rect', Object.assign({ fill: 'rgba(59,130,246,.15)', stroke: '#3b82f6', 'stroke-width': 1, 'stroke-dasharray': '4 2' }, base)));
    } else if (o.t === 'field') {
      g.appendChild(sv('rect', Object.assign({ fill: 'rgba(124,92,255,.10)', stroke: '#7c5cff', 'stroke-width': 1.2 }, base)));
      const t = sv('text', { x: o.x + 4, y: o.y + Math.min(o.h - 3, 12), fill: '#7c5cff', 'font-size': Math.min(10, o.h - 3), 'font-family': 'Inter,Arial', 'font-weight': 600 });
      t.textContent = (o.fk === 'check' ? '☐ ' : '') + (o.name || 'field'); g.appendChild(t);
    }
    return g;
  }
  const UNIT_PT = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1, m: 72 / 0.0254 };
  A.measureLabel = function (o) {
    const d = Math.hypot(o.p[2] - o.p[0], o.p[3] - o.p[1]);
    const v = (d / UNIT_PT[o.unit || 'mm']) * (o.mscale || 1);
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + (o.unit || 'mm');
  };
  function renderMeasure(o) {
    const [x1, y1, x2, y2] = o.p; const g = sv('g', { class: 'obj', 'data-id': o.id, opacity: o.op != null ? o.op : 1 });
    const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang), ny = Math.cos(ang), t = 6;
    g.appendChild(sv('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 12 }));
    g.appendChild(sv('line', { x1, y1, x2, y2, stroke: o.stroke, 'stroke-width': o.sw }));
    [[x1, y1], [x2, y2]].forEach(([x, y]) => g.appendChild(sv('line', { x1: x - nx * t, y1: y - ny * t, x2: x + nx * t, y2: y + ny * t, stroke: o.stroke, 'stroke-width': o.sw })));
    const lab = A.measureLabel(o); const mx = (x1 + x2) / 2 - nx * 11, my = (y1 + y2) / 2 - ny * 11;
    const w = lab.length * 6.4 + 10;
    g.appendChild(sv('rect', { x: mx - w / 2, y: my - 8, width: w, height: 16, rx: 5, fill: o.stroke }));
    const tx = sv('text', { x: mx, y: my + 4, fill: '#fff', 'font-size': 11, 'font-weight': 700, 'font-family': 'Inter,Arial', 'text-anchor': 'middle' }); tx.textContent = lab; g.appendChild(tx);
    return g;
  }
  function inkPath(pts) {
    if (pts.length < 2) return 'M' + pts[0][0] + ',' + pts[0][1] + 'l0.01,0';
    let d = 'M' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
    for (let k = 1; k < pts.length - 1; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; d += ' Q' + pts[k][0].toFixed(2) + ',' + pts[k][1].toFixed(2) + ' ' + mx.toFixed(2) + ',' + my.toFixed(2); }
    const l = pts[pts.length - 1]; d += ' L' + l[0].toFixed(2) + ',' + l[1].toFixed(2); return d;
  }
  A.inkPath = inkPath;
  function squigglePath(r) {
    const y = r.y + r.h - Math.max(1.5, r.h * 0.1), amp = Math.max(1, r.h * 0.07), step = Math.max(2.5, r.h * 0.18);
    let d = 'M' + r.x + ',' + y, up = true;
    for (let x = r.x + step; x <= r.x + r.w + step; x += step) { d += ' L' + Math.min(x, r.x + r.w) + ',' + (y + (up ? -amp : amp)); up = !up; }
    return d;
  }
  A.squigglePath = squigglePath;

  function textStyle(o) {
    const f = o.font || {};
    const deco = (f.underline ? 'underline ' : '') + (f.strike ? 'line-through' : '');
    return boxPos(o) + 'font-size:' + o.size + 'px;color:' + o.color + ';text-align:' + (o.align || 'left') + ';line-height:' + (o.lh || 1.25) + ';letter-spacing:' + (o.ls || 0) + 'px;opacity:' + (o.op != null ? o.op : 1) +
      ';background:' + (o.bg || 'transparent') + ';text-decoration:' + (deco || 'none') + ';' + PD.fonts.cssStyle(f) + (o.w ? 'width:' + o.w + 'px;' : 'width:max-content;max-width:' + 1400 + 'px;');
  }
  const boxPos = (o) => 'left:' + o.x + 'px;top:' + o.y + 'px;' + (o.rot ? 'transform:rotate(' + o.rot + 'deg);' : '');
  function renderText(o, i) {
    const wrap = document.createDocumentFragment();
    const el = h('div', { class: 'obj txt', 'data-id': o.id, style: textStyle(o) });
    el.textContent = o.text;
    if (o.rep) {
      const c = h('div', { class: 'obj cover', 'data-id': o.id + '-c', style: 'left:' + o.rep.x + 'px;top:' + o.rep.y + 'px;width:' + o.rep.w + 'px;height:' + o.rep.h + 'px;background:' + (o.rep.color || '#fff') });
      const f = document.createElement('div'); f.style.display = 'contents'; f.appendChild(c); f.appendChild(el); return f;
    }
    return el;
  }

  /* ---------- selection UI ---------- */
  function drawSelection(i) {
    const d = doc(); const o = A.getSel(); const pe = PD.viewer.pageEl(i); if (!o || !pe) return;
    const ov = pe.querySelector('.ov'); ov.querySelectorAll('.selbox,.linehandle').forEach((n) => n.remove());
    if (o.t === 'line' || o.t === 'arrow' || o.t === 'measure') {
      [0, 2].forEach((k) => ov.appendChild(h('div', { class: 'linehandle', 'data-h': 'p' + k, style: 'left:' + o.p[k] + 'px;top:' + o.p[k + 1] + 'px' })));
      return;
    }
    const b = A.bbox(o, i); const rot = ROT_TYPES.includes(o.t) ? o.rot || 0 : 0;
    const box = h('div', { class: 'selbox' + (ROT_TYPES.includes(o.t) ? ' rotatable' : ''), style: 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;' + (rot ? 'transform:rotate(' + rot + 'deg);' : '') });
    const resizable = BOX_TYPES.includes(o.t) || o.t === 'text';
    if (resizable) ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((hd) => {
      if (o.t === 'text' && (hd === 'n' || hd === 's')) return;
      box.appendChild(h('i', { class: 'hd ' + hd, 'data-h': hd }));
    });
    if (ROT_TYPES.includes(o.t)) box.appendChild(h('i', { class: 'hd rot', 'data-h': 'rot' }));
    ov.appendChild(box);
  }
  A.select = function (i, id, noInspect) {
    const prev = A.sel;
    if (prev && id && prev.i === i && prev.id === id) return;
    if (!prev && !id) return;
    A.sel = id ? { i, id } : null;
    if (prev && (!A.sel || prev.i !== A.sel.i)) A.renderLayer(prev.i);
    if (A.sel) A.renderLayer(i);
    else if (prev) A.renderLayer(prev.i);
    if (!noInspect) PD.emit('sel:changed', A.getSel());
  };
  A.deselect = () => A.select(null, null);

  /* ---------- history helpers ---------- */
  let commitT = null;
  A.commitSoon = function (label) {
    clearTimeout(commitT);
    commitT = setTimeout(() => { const d = doc(); if (d) d.snapshot(label || 'Edit'); }, 350);
  };
  A.commitNow = function (label) { clearTimeout(commitT); const d = doc(); if (d) d.snapshot(label || 'Edit'); };
  A.update = function (o, patch, label, i) {
    Object.assign(o, patch);
    const pi = i != null ? i : A.sel ? A.sel.i : findPage(o);
    A.renderLayer(pi); A.commitSoon(label);
  };
  function findPage(o) { const d = doc(); for (const k in d.ov) if (d.ov[k].includes(o)) return +k; return 0; }
  A.add = function (i, o, label, noSnap) {
    o.id = o.id || PD.uid('o'); objs(i).push(o);
    A.renderLayer(i); if (!noSnap) A.commitNow(label || 'Add ' + o.t); return o;
  };
  A.remove = function (i, id, noSnap) {
    const d = doc(); const l = d.ov[i]; if (!l) return; const k = l.findIndex((o) => o.id === id); if (k < 0) return;
    l.splice(k, 1); if (!l.length) delete d.ov[i];
    if (A.sel && A.sel.id === id) A.sel = null;
    A.renderLayer(i); PD.emit('sel:changed', A.getSel()); if (!noSnap) A.commitNow('Delete');
  };
  A.deleteSelected = function () { if (A.sel) A.remove(A.sel.i, A.sel.id); };
  A.duplicate = function () {
    const o = A.getSel(); if (!o) return; const c = PD.clone(o); c.id = PD.uid('o');
    shift(c, 14, 14); objs(A.sel.i).push(c); A.select(A.sel.i, c.id); A.commitNow('Duplicate');
  };
  A.order = function (dir) {
    const o = A.getSel(); if (!o) return; const l = objs(A.sel.i); const k = l.indexOf(o);
    l.splice(k, 1); if (dir === 'front') l.push(o); else if (dir === 'back') l.unshift(o); else if (dir === 'up') l.splice(Math.min(l.length, k + 1), 0, o); else l.splice(Math.max(0, k - 1), 0, o);
    A.renderLayer(A.sel.i); A.commitNow('Reorder');
  };
  function shift(o, dx, dy) {
    if (o.p) { o.p = [o.p[0] + dx, o.p[1] + dy, o.p[2] + dx, o.p[3] + dy]; }
    else if (o.pts) o.pts = o.pts.map((p) => [p[0] + dx, p[1] + dy]);
    else if (o.rects) o.rects = o.rects.map((r) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
    else { o.x += dx; o.y += dy; if (o.rep) { o.rep = Object.assign({}, o.rep, { x: o.rep.x + dx, y: o.rep.y + dy }); } }
  }
  A.copy = function () { const o = A.getSel(); if (o) { A.clip = PD.clone(o); return true; } return false; };
  A.paste = function () {
    const d = doc(); if (!A.clip || !d) return; const i = d.cur; const c = PD.clone(A.clip); c.id = PD.uid('o'); delete c.rep;
    const pe = PD.viewer.pageEl(i); const vis = pe.getBoundingClientRect();
    shift(c, 20, 20); objs(i).push(c); A.select(i, c.id); A.commitNow('Paste');
  };

  /* ---------- text editing ---------- */
  A.editText = function (i, id, selectAll) {
    const o = A.find(i, id); if (!o) return;
    const el = layerEl(i, id); if (!el) return;
    el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('editing'); el.spellcheck = true;
    if (!o.text) el.style.minWidth = '60px';
    el.focus();
    const rg = document.createRange(); rg.selectNodeContents(el); if (!selectAll) rg.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
    let done = false;
    const finish = (cancel) => {
      if (done) return; done = true;
      el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey);
      el.removeAttribute('contenteditable'); el.classList.remove('editing');
      let txt = el.innerText.replace(/ /g, ' ').replace(/\n$/, '');
      if (cancel && o._new) txt = '';
      if (o.rep && o._created && txt === o._orig) { A.remove(i, id, true); PD.emit('sel:changed', null); return; }
      if (!txt.trim() && !o.rep) { A.remove(i, id, true); if (!o._new) A.commitNow('Delete text'); PD.emit('sel:changed', null); return; }
      const changed = txt !== o.text; o.text = txt; delete o._new;
      if (o.rep && !txt.trim()) { /* keep a blank cover: acts as deletion of the original text */ }
      A.renderLayer(i); if (A.sel && A.sel.id === id) drawSelection(i);
      if (changed || o._created) { A.commitNow(o._created ? 'Add text' : 'Edit text'); delete o._created; }
    };
    const onBlur = () => finish(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(true); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(false); } e.stopPropagation(); };
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey);
    el.addEventListener('input', () => { if (A.sel && A.sel.id === id) drawSelection(i); });
  };

  /* ---------- text line grouping (for “edit existing text”) ---------- */
  A.textLines = async function (d, i) {
    const pt = await PD.viewer.pageText(d, i);
    if (pt._lines) return pt._lines;
    const items = pt.items.filter((it) => it.str.length && Math.abs(it.ang) < 0.06 && it.rect.w > 0);
    items.sort((a, b) => (Math.abs(a.base[1] - b.base[1]) < 2 ? a.rect.x - b.rect.x : a.base[1] - b.base[1]));
    const lines = [];
    items.forEach((it) => {
      const ln = lines.find((l) => Math.abs(l.baseY - it.base[1]) < it.fs * 0.3 && it.rect.x >= l.x1 - it.fs * 0.5 && it.rect.x - l.x1 < it.fs * 1.2);
      if (ln) { ln.str += (it.rect.x - ln.x1 > it.fs * 0.15 && !/\s$/.test(ln.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str; ln.x1 = Math.max(ln.x1, it.rect.x + it.rect.w); ln.y0 = Math.min(ln.y0, it.rect.y); ln.y1 = Math.max(ln.y1, it.rect.y + it.rect.h); ln.items.push(it); ln.fs = Math.max(ln.fs, it.fs); }
      else lines.push({ str: it.str, x0: it.rect.x, x1: it.rect.x + it.rect.w, y0: it.rect.y, y1: it.rect.y + it.rect.h, baseY: it.base[1], fs: it.fs, font: it.font, items: [it] });
    });
    pt._lines = lines; return lines;
  };
  function guessFont(d, i, ln, pt) {
    let name = '';
    try { const page = d.pageCache.get(i); const fo = page.commonObjs.get(ln.font); name = (fo && (fo.name || fo.loadedName)) || ''; } catch (e) { /* ignore */ }
    const st = pt.styles && pt.styles[ln.font]; const generic = (st && st.fontFamily) || 'sans-serif';
    const nm = name.replace(/^[A-Z]{6}\+/, '');
    const bold = /bold|black|heavy|semibold/i.test(nm), italic = /italic|oblique/i.test(nm);
    let family = generic === 'serif' ? 'Times Roman' : generic === 'monospace' ? 'Courier' : 'Helvetica';
    if (/times|georgia|garamond|palatino|serif(?!.*sans)|cambria|minion/i.test(nm)) family = 'Times Roman';
    else if (/courier|mono|consolas|lucida console/i.test(nm)) family = 'Courier';
    else if (/arial|helvetica|calibri|verdana|tahoma|segoe/i.test(nm)) family = 'Helvetica';
    for (const sfam of Object.keys(PD.fonts.system || {})) { if (nm && nm.toLowerCase().replace(/[-_ ]/g, '').startsWith(sfam.toLowerCase().replace(/[-_ ]/g, '')) && sfam.length > 3) { family = sfam; break; } }
    return { family, bold, italic, underline: false, strike: false };
  }
  A.sampleColors = function (i, rect) {
    // sample background (just outside the line) and text color (darkest pixel) from the rendered canvas
    const pe = PD.viewer.pageEl(i); const cv = pe && pe.querySelector('canvas'); const d = doc();
    const out = { bg: '#ffffff', fg: '#111111' };
    if (!cv || cv.width < 8) return out;
    try {
      const k = cv.width / d.info[i].w; const ctx = cv.getContext('2d', { willReadFrequently: true });
      const px = (x, y) => ctx.getImageData(Math.max(0, Math.min(cv.width - 1, Math.round(x * k))), Math.max(0, Math.min(cv.height - 1, Math.round(y * k))), 1, 1).data;
      const pts = [[rect.x - 2, rect.y + rect.h / 2], [rect.x + rect.w + 2, rect.y + rect.h / 2], [rect.x + rect.w / 2, rect.y - 2], [rect.x + rect.w / 2, rect.y + rect.h + 2]];
      const cols = pts.map((p) => px(p[0], p[1])); cols.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const m = cols[2]; out.bg = '#' + [m[0], m[1], m[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      const x0 = Math.max(0, Math.floor(rect.x * k)), y0 = Math.max(0, Math.floor(rect.y * k)), w = Math.max(1, Math.min(cv.width - x0, Math.ceil(rect.w * k))), hh = Math.max(1, Math.min(cv.height - y0, Math.ceil(rect.h * k)));
      const data = ctx.getImageData(x0, y0, w, hh).data; let best = 1e9, bi = 0;
      for (let p = 0; p < data.length; p += 4) { const l = data[p] + data[p + 1] + data[p + 2]; if (l < best) { best = l; bi = p; } }
      out.fg = '#' + [data[bi], data[bi + 1], data[bi + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      if (Math.abs(best / 3 - (m[0] + m[1] + m[2]) / 3) < 40) out.fg = '#111111';
    } catch (e) { /* ignore */ }
    return out;
  };
  // Gather the paragraph (consecutive, similarly styled lines) around a line
  function paragraphOf(lines, ln) {
    const near = (a, b) => Math.abs(a.fs - b.fs) < Math.max(1, a.fs * 0.14);
    const para = [ln]; const alignLeft = (a, b) => Math.abs(a.x0 - b.x0) < a.fs * 1.6;
    const centered = (a, b) => Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < a.fs * 0.8;
    const ok = (a, b) => near(a, b) && (alignLeft(a, b) || centered(a, b)) && Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;
    for (let guard = 0; guard < 200; guard++) {
      const last = para[para.length - 1], first = para[0];
      const dn = lines.filter((l) => !para.includes(l) && l.baseY > last.baseY + last.fs * 0.8 && l.baseY - last.baseY < last.fs * 2.0 && ok(last, l)).sort((a, b) => a.baseY - b.baseY)[0];
      if (dn) { para.push(dn); continue; }
      const up = lines.filter((l) => !para.includes(l) && l.baseY < first.baseY - first.fs * 0.8 && first.baseY - l.baseY < first.fs * 2.0 && ok(first, l)).sort((a, b) => b.baseY - a.baseY)[0];
      if (up) { para.unshift(up); continue; }
      break;
    }
    return para;
  }
  const textW = (font, size, str) => { mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = (font.italic ? 'italic ' : '') + (font.bold ? '700 ' : '400 ') + size + 'px ' + PD.fonts.cssStack(font); return mctx.measureText(str).width; };

  async function startEditExisting(i, p, single) {
    const d = doc(); const lines = await A.textLines(d, i);
    let ln = lines.find((l) => p.x >= l.x0 - 3 && p.x <= l.x1 + 3 && p.y >= l.y0 - 2 && p.y <= l.y1 + 2);
    if (!ln) { let best = 1e9; lines.forEach((l) => { const dx = Math.max(l.x0 - p.x, 0, p.x - l.x1), dy = Math.max(l.y0 - p.y, 0, p.y - l.y1); const dist = Math.hypot(dx, dy); if (dist < best) { best = dist; ln = l; } }); if (best > 10) ln = null; }
    if (!ln) { PD.toast('No editable text here — click directly on a line of text', 'info'); return; }
    // already replaced by an earlier edit? edit that instead of stacking a second one
    const prior = (d.ov[i] || []).find((o) => o.rep && p.x >= o.rep.x && p.x <= o.rep.x + o.rep.w && p.y >= o.rep.y && p.y <= o.rep.y + o.rep.h);
    if (prior) { A.select(i, prior.id); A.editText(i, prior.id, false); return; }
    const para = single ? [ln] : paragraphOf(lines, ln);
    const pt = await PD.viewer.pageText(d, i);
    const font = guessFont(d, i, ln, pt);
    const x0 = Math.min(...para.map((l) => l.x0)), x1 = Math.max(...para.map((l) => l.x1));
    const y0 = Math.min(...para.map((l) => l.y0)), y1 = Math.max(...para.map((l) => l.y1));
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const cols = A.sampleColors(i, { x: ln.x0, y: ln.y0, w: ln.x1 - ln.x0, h: ln.y1 - ln.y0 });
    const size = Math.round(ln.fs * 10) / 10;
    let lh = 1.25;
    if (para.length > 1) { const pitch = (para[para.length - 1].baseY - para[0].baseY) / (para.length - 1); lh = Math.max(1, Math.min(2.2, pitch / size)); }
    const m = A.fontAscent(font, size, lh);
    // join lines: keep a line break where the original line stopped short of the right edge
    let text = '';
    para.forEach((l, k) => { if (k) { const prev = para[k - 1]; text += (prev.x1 < x1 - size * 1.5 ? '\n' : (/-$/.test(prev.str) ? '' : ' ')); } text += l.str.replace(/\s+$/, ''); });
    const centered = para.length > 1 && para.every((l) => Math.abs((l.x0 + l.x1) / 2 - (x0 + x1) / 2) < size * 0.8) && para.some((l) => l.x0 - x0 > size);
    // nudge letter spacing so the rewritten text matches the original width in the nearest browser font
    let ls = 0; const longest = para.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a), para[0]);
    const mw = textW(font, size, longest.str); const ow = longest.x1 - longest.x0;
    if (mw > 0 && ow / mw > 0.8 && ow / mw < 1.25 && longest.str.length > 3) ls = Math.max(-1.2, Math.min(1.2, (ow - mw) / longest.str.length));
    const o = { id: PD.uid('o'), t: 'text', x: x0, y: para[0].baseY - m, w: para.length > 1 ? Math.ceil(rect.w + size * 0.5) : 0, text, font, size, color: cols.fg, bg: '', align: centered ? 'center' : 'left', lh, ls: Math.round(ls * 100) / 100, rot: 0, op: 1,
      rep: { x: rect.x - 2, y: rect.y - size * 0.1, w: rect.w + 4, h: rect.h + size * 0.34, color: cols.bg }, _created: true, _orig: text };
    objs(i).push(o); A.select(i, o.id); A.renderLayer(i); A.editText(i, o.id, false);
  }
  // distance from the top of a text box to its baseline for a given CSS font (uses browser metrics)
  let mctx;
  A.fontAscent = function (font, size, lh) {
    mctx = mctx || document.createElement('canvas').getContext('2d');
    mctx.font = (font.italic ? 'italic ' : '') + (font.bold ? '700 ' : '400 ') + size + 'px ' + PD.fonts.cssStack(font);
    const m = mctx.measureText('Hxg'); const asc = m.fontBoundingBoxAscent || size * 0.9, desc = m.fontBoundingBoxDescent || size * 0.25;
    return (size * lh - (asc + desc)) / 2 + asc;
  };

  /* ---------- pointer interaction ---------- */
  let drag = null;
  A.init = function () {
    const pagesEl = PD.viewer.pagesEl;
    pagesEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    pagesEl.addEventListener('dblclick', onDbl);
    pagesEl.addEventListener('contextmenu', onCtx);
    document.addEventListener('mouseup', onTextSelectionEnd);
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', async (e) => {
      if (/INPUT|TEXTAREA/.test((e.target || {}).tagName) || (e.target && e.target.isContentEditable)) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) if (it.type.startsWith('image/') && doc()) { const f = it.getAsFile(); const id = await A.storeImageFile(f); await A.placeImage(id); e.preventDefault(); return; }
      if (A.clip) { A.paste(); e.preventDefault(); }
    });
    PD.on('view:built', () => A.renderAll());
    PD.on('doc:overlay', () => { A.sel = null; A.renderAll(); PD.emit('sel:changed', null); });
  };
  A.setTool = function (t) {
    if (!TOOLS[t]) t = 'select';
    PD.tool = t;
    const pe = PD.viewer.pagesEl; const k = TOOLS[t].kind;
    pe.dataset.tool = t; pe.dataset.kind = k;
    PD.viewer.scroller.dataset.tool = t;
    if (k !== 'select') A.deselect();
    if (t === 'image') A.pickImage();
    else if (t === 'sign') PD.sign.open();
    else if (t === 'stamp') { A.pending = null; PD.toast('Choose a stamp in the panel, then click the page', 'info'); }
    PD.emit('tool:changed', t);
  };

  function onDown(e) {
    const d = doc(); if (!d) return;
    const pageEl = e.target.closest('.page'); if (!pageEl) return;
    const i = +pageEl.dataset.i; const tool = PD.tool; const T = TOOLS[tool];
    if (e.button === 2) return;
    // transform handles
    const hd = e.target.closest('[data-h]');
    if (hd && A.sel) { startTransform(e, hd.dataset.h); return; }
    const objEl = e.target.closest('.obj[data-id], .obj [data-id]');
    if (T.kind === 'select' && tool === 'select') {
      const idEl = e.target.closest('[data-id]');
      if (idEl && !idEl.classList.contains('cover') && !(idEl.dataset.id || '').endsWith('-c')) {
        const o = A.find(i, idEl.dataset.id);
        if (o) {
          if (idEl.classList.contains('editing')) return;
          A.select(i, o.id); startMove(e, i, o); return;
        }
      }
      if (!e.target.closest('.selbox')) A.deselect();
      return;
    }
    if (!['markup', 'select'].includes(T.kind) && e.target.closest('.ov,.page')) {
      if (e.target.closest('.editing')) return;
      if (T.kind === 'eraser') { startErase(e, i); return; }
      e.preventDefault();
      const p = PD.viewer.pointFromEvent(e, i);
      beginCreate(e, i, p, T, tool);
    }
  }

  function beginCreate(e, i, p, T, tool) {
    const S = PD.style; const d = doc();
    if (T.kind === 'ink') {
      const o = { id: PD.uid('o'), t: 'ink', pts: [[p.x, p.y]], stroke: S.penColor, sw: S.penW, op: S.penOp };
      objs(i).push(o); drag = { type: 'ink', i, o }; A.renderLayer(i);
    } else if (T.kind === 'drag') {
      const o = { id: PD.uid('o'), t: T.t, x: p.x, y: p.y, w: 1, h: 1 };
      if (T.t === 'rect') Object.assign(o, { stroke: S.stroke, fill: S.fill, sw: S.sw, op: S.op, dash: S.dash, rad: S.rad });
      else if (T.t === 'area') Object.assign(o, { color: S.hl, op: S.hlOp });
      else if (T.t === 'whiteout') o.color = S.whiteColor;
      else if (T.t === 'link') Object.assign(o, { url: 'https://', page: 0, mode: 'url' });
      else if (T.t === 'field') Object.assign(o, { fk: T.fk, name: nextFieldName(T.fk), opts: 'Option 1, Option 2' });
      else if (T.t === 'ellipse') Object.assign(o, { stroke: S.stroke, fill: S.fill, sw: S.sw, op: S.op, dash: S.dash });
      objs(i).push(o); drag = { type: 'box', i, o, sx: p.x, sy: p.y, tool }; A.renderLayer(i);
    } else if (T.kind === 'line') {
      const o = { id: PD.uid('o'), t: T.t, p: [p.x, p.y, p.x, p.y], stroke: S.stroke, sw: S.sw, op: S.op, dash: S.dash };
      if (T.t === 'measure') Object.assign(o, { unit: S.unit, mscale: S.mscale, sw: Math.min(S.sw, 2), dash: false });
      objs(i).push(o); drag = { type: 'line', i, o }; A.renderLayer(i);
    } else if (T.kind === 'text') {
      const o = { id: PD.uid('o'), t: 'text', x: p.x, y: p.y, w: 0, text: '', font: PD.clone(S.font), size: S.size, color: S.textColor, bg: S.bg, align: S.align, lh: S.lh, ls: S.ls, rot: 0, op: 1, _new: true, _created: true };
      objs(i).push(o); drag = { type: 'text', i, o, sx: p.x, sy: p.y };
    } else if (T.kind === 'note') {
      const o = { id: PD.uid('o'), t: 'note', x: p.x, y: p.y, text: '', color: S.noteColor };
      objs(i).push(o); A.renderLayer(i); A.select(i, o.id); A.commitNow('Add note'); A.noteEditor(i, o.id); A.setTool('select');
    } else if (T.kind === 'edittext') {
      startEditExisting(i, p, e.shiftKey);
    } else if (T.kind === 'place') {
      placeAt(i, p, e);
    }
  }
  function nextFieldName(fk) {
    const d = doc(); let n = 1; const names = new Set(); Object.values(d.ov).forEach((l) => l.forEach((o) => o.t === 'field' && names.add(o.name)));
    const base = fk === 'check' ? 'Checkbox' : fk === 'drop' ? 'Dropdown' : 'Text'; while (names.has(base + n)) n++; return base + n;
  }

  function placeAt(i, p, e) {
    const S = PD.style; let tpl = A.pending;
    if (PD.tool === 'stamp') {
      const w = Math.max(90, S.stamp.length * 15), hh = 40; tpl = { t: 'stamp', text: S.stamp, color: S.stampColor, w, h: hh, rot: -8, op: S.stampOp };
    }
    if (!tpl) { PD.toast(PD.tool === 'sign' ? 'Create a signature first' : 'Pick an image first', 'info'); return; }
    const o = Object.assign({ id: PD.uid('o'), rot: 0, op: 1 }, PD.clone(tpl));
    o.x = p.x - o.w / 2; o.y = p.y - o.h / 2;
    const natW = o.w; drag = { type: 'place', i, o, sx: p.x, sy: p.y, ratio: o.w / o.h, moved: false, natW };
    objs(i).push(o); A.renderLayer(i);
  }

  function startMove(e, i, o) {
    e.preventDefault();
    const p = PD.viewer.pointFromEvent(e, i);
    drag = { type: 'move', i, o, sx: p.x, sy: p.y, snap: PD.clone(o), moved: false };
  }
  function startErase(e, i) {
    e.preventDefault(); drag = { type: 'erase', i }; eraseAt(e);
  }
  function eraseAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY); const t = el && el.closest && el.closest('.obj[data-id]'); if (!t) return;
    const pe = t.closest('.page'); const i = +pe.dataset.i; const id = t.dataset.id; if (id.endsWith('-c')) return;
    if (A.find(i, id)) { A.remove(i, id, true); drag.erased = true; }
  }
  function startTransform(e, which) {
    e.preventDefault(); e.stopPropagation();
    const i = A.sel.i; const o = A.getSel(); const p = PD.viewer.pointFromEvent(e, i);
    const b = A.bbox(o, i);
    drag = { type: 'xform', i, o, which, snap: PD.clone(o), b, sx: p.x, sy: p.y, moved: false };
  }

  function onMove(e) {
    if (!drag) return;
    const d = doc(); const i = drag.i; const p = PD.viewer.pointFromEvent(e, i); const o = drag.o;
    switch (drag.type) {
      case 'ink': { const last = o.pts[o.pts.length - 1]; if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.6 / p.s * PD.K) { o.pts.push([p.x, p.y]); const g = PD.viewer.pageEl(i).querySelector('[data-id="' + o.id + '"]'); if (g) { g.querySelectorAll('path').forEach((pa) => pa.setAttribute('d', inkPath(o.pts))); } else A.renderLayer(i); } break; }
      case 'box': {
        let x0 = drag.sx, y0 = drag.sy, x1 = p.x, y1 = p.y;
        if (e.shiftKey && (drag.tool === 'rect' || drag.tool === 'ellipse')) { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
        o.x = Math.min(x0, x1); o.y = Math.min(y0, y1); o.w = Math.abs(x1 - x0); o.h = Math.abs(y1 - y0); A.renderLayer(i); break;
      }
      case 'line': { let x = p.x, y = p.y; if (e.shiftKey) { const dx = x - o.p[0], dy = y - o.p[1]; const a = Math.round(Math.atan2(dy, dx) / rad(15)) * rad(15), r = Math.hypot(dx, dy); x = o.p[0] + r * Math.cos(a); y = o.p[1] + r * Math.sin(a); } o.p[2] = x; o.p[3] = y; A.renderLayer(i); break; }
      case 'text': { const w = p.x - drag.sx; if (Math.abs(w) > 12) { o.w = Math.max(30, w); } break; }
      case 'place': {
        const dx = p.x - drag.sx, dy = p.y - drag.sy;
        if (Math.hypot(dx, dy) > 4) { drag.moved = true; const w = Math.max(20, Math.abs(dx) * 2), hh = w / drag.ratio; o.w = w; o.h = hh; o.x = drag.sx - w / 2; o.y = drag.sy - hh / 2; A.renderLayer(i); }
        break;
      }
      case 'move': {
        let dx = p.x - drag.sx, dy = p.y - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 2) return; drag.moved = true;
        const s = drag.snap; Object.keys(s).forEach((k) => { o[k] = PD.clone(s[k]); }); shift(o, dx, dy); A.renderLayer(i); break;
      }
      case 'erase': eraseAt(e); break;
      case 'xform': doTransform(e, p); break;
    }
  }

  function doTransform(e, p) {
    const o = drag.o; const i = drag.i; const hd = drag.which; const s = drag.snap;
    drag.moved = true;
    if (hd === 'p0' || hd === 'p2') {
      const k = hd === 'p0' ? 0 : 2; let x = p.x, y = p.y;
      if (e.shiftKey) { const ox = o.p[2 - k], oy = o.p[3 - k]; const dx = x - ox, dy = y - oy; const a = Math.round(Math.atan2(dy, dx) / rad(15)) * rad(15), r = Math.hypot(dx, dy); x = ox + r * Math.cos(a); y = oy + r * Math.sin(a); }
      o.p[k] = x; o.p[k + 1] = y; A.renderLayer(i); return;
    }
    if (hd === 'rot') {
      const b = drag.b; const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90; if (e.shiftKey) a = Math.round(a / 15) * 15;
      o.rot = Math.round(a * 10) / 10; A.renderLayer(i); PD.emit('sel:update', o); return;
    }
    const b0 = drag.b; const a = rad(s.rot || 0);
    const cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const lx = Math.cos(a) * dx + Math.sin(a) * dy, ly = -Math.sin(a) * dx + Math.cos(a) * dy;
    let l = -b0.w / 2, r = b0.w / 2, t = -b0.h / 2, bt = b0.h / 2;
    if (hd.includes('w')) l = lx; if (hd.includes('e')) r = lx; if (hd.includes('n')) t = ly; if (hd.includes('s')) bt = ly;
    const MIN = 6;
    if (r - l < MIN) { if (hd.includes('w')) l = r - MIN; else r = l + MIN; }
    if (bt - t < MIN) { if (hd.includes('n')) t = bt - MIN; else bt = t + MIN; }
    const corner = hd.length === 2;
    const keep = corner && (o.t === 'image' || o.t === 'stamp' || o.t === 'text' || e.shiftKey);
    if (keep) {
      const f = Math.max((r - l) / b0.w, (bt - t) / b0.h);
      const nw = b0.w * f, nh = b0.h * f;
      if (hd.includes('w')) l = r - nw; else r = l + nw; if (hd.includes('n')) t = bt - nh; else bt = t + nh;
    }
    const nw = r - l, nh = bt - t, ncx = (l + r) / 2, ncy = (t + bt) / 2;
    const pcx = cx + Math.cos(a) * ncx - Math.sin(a) * ncy, pcy = cy + Math.sin(a) * ncx + Math.cos(a) * ncy;
    if (o.t === 'text') {
      if (corner) { const f = nw / b0.w; o.size = Math.max(4, Math.round(s.size * f * 10) / 10); if (s.w) o.w = Math.max(20, s.w * f); }
      else o.w = Math.max(20, nw);
      o.x = pcx - nw / 2; o.y = pcy - (corner ? nh : b0.h) / 2;
      if (!corner) o.y = s.y; // width changes keep the top edge
      if (!corner) { o.x = pcx - nw / 2; }
    } else { o.x = pcx - nw / 2; o.y = pcy - nh / 2; o.w = nw; o.h = nh; }
    A.renderLayer(i); PD.emit('sel:update', o);
  }

  function onUp(e) {
    if (!drag) return; const d = drag; drag = null;
    const i = d.i; const o = d.o;
    switch (d.type) {
      case 'ink': if (o.pts.length < 2) o.pts.push([o.pts[0][0] + 0.1, o.pts[0][1]]); A.renderLayer(i); A.commitNow('Pen stroke'); break;
      case 'box': {
        const tiny = o.w < 4 && o.h < 4;
        if (tiny) { if (d.tool === 'ftext' || d.tool === 'fcheck' || d.tool === 'fdrop' || d.tool === 'link') { o.w = d.tool === 'fcheck' ? 16 : 140; o.h = d.tool === 'fcheck' ? 16 : 24; } else { A.remove(i, o.id, true); return; } }
        if (o.t === 'field' && o.fk === 'check') { o.h = o.w = Math.max(12, Math.min(o.w, o.h)); }
        A.renderLayer(i); A.commitNow('Add ' + o.t);
        if (['rect', 'ellipse', 'whiteout', 'link', 'field', 'redact', 'area'].includes(o.t)) { if (o.t !== 'redact' && o.t !== 'whiteout' && o.t !== 'area') { A.select(i, o.id); A.setTool(o.t === 'field' ? PD.tool : 'select'); } }
        break;
      }
      case 'line': if (Math.hypot(o.p[2] - o.p[0], o.p[3] - o.p[1]) < 4) { A.remove(i, o.id, true); } else { A.renderLayer(i); A.commitNow('Add ' + o.t); A.select(i, o.id); A.setTool('select'); } break;
      case 'text': A.renderLayer(i); A.select(i, o.id); A.editText(i, o.id, false); A.setTool('select'); break;
      case 'place': { A.renderLayer(i); A.commitNow('Place ' + o.t); A.select(i, o.id); if (PD.tool === 'image' || PD.tool === 'sign') { A.pending = null; } A.setTool('select'); break; }
      case 'move': if (d.moved) { A.renderLayer(i); A.commitNow('Move'); } break;
      case 'erase': if (d.erased) A.commitNow('Erase'); break;
      case 'xform': if (d.moved) { A.renderLayer(i); A.commitNow('Transform'); } break;
    }
  }

  A.editExistingAt = (i, p, single) => startEditExisting(i, p, single);
  function onDbl(e) {
    if (PD.tool !== 'select' && PD.tool !== 'edittext') return;
    const t = e.target.closest('.obj.txt');
    if (!t) {
      const pe0 = e.target.closest('.page');
      if (pe0 && PD.mode === 'edit' && !e.target.closest('.obj')) { const i0 = +pe0.dataset.i; startEditExisting(i0, PD.viewer.pointFromEvent(e, i0)); }
      return;
    }
    const pe = t.closest('.page'); const i = +pe.dataset.i; const o = A.find(i, t.dataset.id); if (!o) return;
    A.select(i, o.id); A.editText(i, o.id, false);
  }
  function onCtx(e) {
    const t = e.target.closest('[data-id]'); const pe = e.target.closest('.page'); if (!t || !pe) return;
    const i = +pe.dataset.i; const o = A.find(i, t.dataset.id); if (!o) return;
    e.preventDefault(); A.select(i, o.id);
    PD.ui.menu([
      { label: 'Duplicate', icon: 'copy', key: 'Ctrl+D', run: A.duplicate },
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', run: A.copy },
      '-',
      { label: 'Bring to front', icon: 'up', run: () => A.order('front') },
      { label: 'Send to back', icon: 'down', run: () => A.order('back') },
      '-',
      { label: 'Delete', icon: 'trash', key: 'Del', danger: true, run: A.deleteSelected },
    ], e.clientX, e.clientY);
  }

  /* ---------- markup from text selection ---------- */
  function onTextSelectionEnd(e) {
    const T = TOOLS[PD.tool]; if (!T || T.kind !== 'markup') return;
    const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const d = doc(); if (!d) return;
    const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 1 && r.height > 2);
    if (!rects.length) return;
    const med = rects.map((r) => r.height).sort((a, b) => a - b)[Math.floor(rects.length / 2)];
    const byPage = {};
    rects.forEach((r) => {
      if (r.height > med * 2.6) return;
      const els = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2); const pe = els.map((x) => x.closest && x.closest('.page')).find(Boolean); if (!pe) return;
      const i = +pe.dataset.i; const pr = pe.getBoundingClientRect(); const s = pr.width / d.info[i].w;
      (byPage[i] = byPage[i] || []).push({ x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, w: r.width / s, h: r.height / s });
    });
    const S = PD.style; let made = false;
    Object.keys(byPage).forEach((k) => {
      // merge rects on the same line
      const list = byPage[k].sort((a, b) => a.y - b.y || a.x - b.x); const merged = [];
      list.forEach((r) => { const m = merged.find((q) => Math.abs(q.y - r.y) < q.h * 0.4 && Math.abs(q.h - r.h) < q.h * 0.5 && r.x <= q.x + q.w + 2 && r.x + r.w >= q.x - 2); if (m) { const x2 = Math.max(m.x + m.w, r.x + r.w); m.x = Math.min(m.x, r.x); m.w = x2 - m.x; m.y = Math.min(m.y, r.y); m.h = Math.max(m.h, r.h); } else merged.push(Object.assign({}, r)); });
      const o = { id: PD.uid('o'), t: 'markup', kind: T.mk, rects: merged, color: T.mk === 'highlight' ? S.hl : S.ul, op: T.mk === 'highlight' ? S.hlOp : 1 };
      objs(+k).push(o); A.renderLayer(+k); made = true;
    });
    sel.removeAllRanges(); if (made) A.commitNow('Markup');
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    const tg = e.target; const typing = tg && (/INPUT|TEXTAREA|SELECT/.test(tg.tagName) || tg.isContentEditable);
    if (typing) return;
    const d = doc(); if (!d || PD.mode === 'home') return;
    const mod = e.ctrlKey || e.metaKey;
    if (A.sel) {
      const o = A.getSel();
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A.deleteSelected(); return; }
      if (e.key.startsWith('Arrow') && !mod) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; shift(o, e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0); A.renderLayer(A.sel.i); A.commitSoon('Nudge'); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); A.duplicate(); return; }
      if (mod && e.key.toLowerCase() === 'c') { if (A.copy()) e.preventDefault(); return; }
      if (mod && e.key.toLowerCase() === 'x') { if (A.copy()) { e.preventDefault(); A.deleteSelected(); } return; }
      if (e.key === 'Enter' && o.t === 'text') { e.preventDefault(); A.editText(A.sel.i, o.id, false); return; }
      if (e.key === 'Escape') { A.deselect(); return; }
    }
    if (mod && e.key.toLowerCase() === 'v' && A.clip && !A.sel) { e.preventDefault(); A.paste(); return; }
    if (e.key === 'Escape' && PD.tool !== 'select') { A.setTool('select'); return; }
    if (!mod && !e.altKey && PD.shortcuts) { const t = PD.shortcuts[e.key.toUpperCase()]; if (t && PD.availableTools().includes(t)) { A.setTool(t); } }
  }

  /* ---------- note editor popover ---------- */
  A.noteEditor = function (i, id) {
    const o = A.find(i, id); if (!o) return;
    const el = layerEl(i, id); if (!el) return;
    document.querySelectorAll('.notepop').forEach((n) => n.remove());
    const ta = h('textarea', { class: 'input', rows: 5, placeholder: 'Write a comment…' }); ta.value = o.text || '';
    const col = PD.ui.color(o.color, (c) => { o.color = c; A.renderLayer(i); }, { palette: ['#fbbf24', '#fb7185', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'] });
    const pop = h('div', { class: 'notepop' }, h('div', { class: 'np-h' }, 'Note', col, h('button', { class: 'icon-btn', title: 'Delete note', html: PD.ic('trash', 15), onclick: () => { pop.remove(); A.remove(i, id); } })), ta);
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect(); pop.style.left = Math.min(r.right + 8, innerWidth - 270) + 'px'; pop.style.top = Math.min(r.top, innerHeight - 220) + 'px';
    setTimeout(() => ta.focus(), 30);
    const close = () => { o.text = ta.value; pop.remove(); document.removeEventListener('mousedown', away, true); A.renderLayer(i); A.commitNow('Edit note'); };
    const away = (ev) => { if (!pop.contains(ev.target) && !ev.target.closest('.colorpop')) close(); };
    setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  };

  /* ---------- images ---------- */
  A.storeImageFile = async function (file) {
    let url = await PD.blobToDataUrl(file);
    if (!/^data:image\/(png|jpeg)/.test(url)) { const im = await PD.loadImage(url); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); url = c.toDataURL('image/png'); }
    const id = PD.uid('img'); PD.imgs[id] = url; return id;
  };
  A.placeImage = async function (imgId, kind) {
    const im = await PD.loadImage(PD.imgs[imgId]); const d = doc();
    let w = Math.min(im.naturalWidth * 0.75, 260), hh = (w * im.naturalHeight) / im.naturalWidth;
    if (hh > 220) { hh = 220; w = (hh * im.naturalWidth) / im.naturalHeight; }
    A.pending = { t: 'image', img: imgId, w, h: hh, kind: kind || 'image' };
    PD.tool = 'image'; A.setToolSilent('image');
    PD.toast('Click on the page to place — or drag to size it', 'info');
  };
  A.setToolSilent = function (t) { PD.tool = t; const pe = PD.viewer.pagesEl; pe.dataset.tool = t; pe.dataset.kind = TOOLS[t].kind; PD.viewer.scroller.dataset.tool = t; PD.emit('tool:changed', t); };
  A.pickImage = async function () {
    const files = await PD.pickFiles({ accept: '.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,image/*', desc: 'Images', legacy: true });
    if (!files.length) { A.setTool('select'); return; }
    try { const id = await A.storeImageFile(files[0].file); await A.placeImage(id); } catch (e) { PD.toast(e.message, 'error'); A.setTool('select'); }
  };
})();
