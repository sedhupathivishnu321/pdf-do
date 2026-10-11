/* PDF Do — reusable UI controls: color, range, number, toggles, segmented, context menu, tooltips */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;
  const U = (PD.ui = {});

  U.PALETTE = ['#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
  U.HL_PALETTE = ['#ffe14a', '#a3e635', '#5eead4', '#7dd3fc', '#f9a8d4', '#fdba74', '#c4b5fd', '#fca5a5'];

  U.row = (label, ctl, cls) => h('div', { class: 'prop ' + (cls || '') }, h('label', null, label), h('div', { class: 'pc' }, ctl));
  U.section = (title, ...kids) => h('div', { class: 'insp-sec' }, title ? h('div', { class: 'insp-h' }, title) : null, ...kids);

  U.color = function (value, onInput, opts) {
    opts = opts || {};
    const pal = opts.palette || U.PALETTE;
    const wrap = h('div', { class: 'colorfield' });
    const sw = h('button', { class: 'cf-sw', type: 'button', title: 'Choose color' });
    const paint = () => { sw.style.background = value || 'transparent'; sw.classList.toggle('none', !value); };
    paint();
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = h('div', { class: 'colorpop' });
      const grid = h('div', { class: 'cp-grid' });
      const pick = (c) => { value = c; paint(); onInput(c); sync(); };
      pal.forEach((c) => grid.appendChild(h('button', { class: 'cp-c', type: 'button', style: 'background:' + c, title: c, onclick: () => pick(c) })));
      if (opts.none) grid.appendChild(h('button', { class: 'cp-c none', type: 'button', title: 'No color', onclick: () => pick('') }));
      const native = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000', class: 'cp-native' });
      native.addEventListener('input', () => pick(native.value));
      const hex = h('input', { type: 'text', class: 'input cp-hex', value: value || '', placeholder: '#rrggbb', maxlength: 7 });
      hex.addEventListener('change', () => { const v = hex.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) pick(v.startsWith('#') ? v : '#' + v); });
      const recent = (PD.store.get('recentColors', []) || []);
      const rec = h('div', { class: 'cp-grid' }, recent.map((c) => h('button', { class: 'cp-c', type: 'button', style: 'background:' + c, onclick: () => pick(c) })));
      function sync() { native.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'; hex.value = value || ''; }
      pop.append(grid, h('div', { class: 'cp-row' }, native, hex), recent.length ? h('div', { class: 'cp-lbl' }, 'Recent') : null, recent.length ? rec : null);
      document.body.appendChild(pop);
      const r = sw.getBoundingClientRect();
      pop.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
      pop.style.top = (r.bottom + 6 + 200 > window.innerHeight ? r.top - 206 : r.bottom + 6) + 'px';
      const close = () => {
        pop.remove(); document.removeEventListener('mousedown', away, true);
        if (value) { const l = [value].concat(PD.store.get('recentColors', []).filter((x) => x !== value)).slice(0, 8); PD.store.set('recentColors', l); }
      };
      const away = (ev) => { if (!pop.contains(ev.target) && ev.target !== sw) close(); };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
    });
    wrap.append(sw);
    wrap.setValue = (v) => { value = v; paint(); };
    return wrap;
  };

  U.range = function (min, max, step, value, onInput, fmt) {
    const val = h('span', { class: 'rg-v' });
    const inp = h('input', { type: 'range', min, max, step, value, class: 'range' });
    const upd = () => { val.textContent = fmt ? fmt(+inp.value) : inp.value; const p = ((inp.value - min) / (max - min)) * 100; inp.style.setProperty('--p', p + '%'); };
    inp.addEventListener('input', () => { upd(); onInput(+inp.value); });
    upd();
    const w = h('div', { class: 'rangefield' }, inp, val);
    w.setValue = (v) => { inp.value = v; upd(); };
    return w;
  };

  U.num = function (value, onChange, o) {
    o = o || {};
    const inp = h('input', { type: 'number', class: 'input num', value: value == null ? '' : Math.round(value * 100) / 100, step: o.step || 1, min: o.min, max: o.max });
    inp.addEventListener('change', () => { let v = parseFloat(inp.value); if (isNaN(v)) return; if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); onChange(v); });
    const w = h('div', { class: 'numfield' }, inp, o.unit ? h('span', { class: 'nf-u' }, o.unit) : null);
    w.setValue = (v) => { inp.value = Math.round(v * 100) / 100; };
    return w;
  };

  U.toggles = function (items, onToggle) {
    const w = h('div', { class: 'toggles' });
    items.forEach((it) => {
      const b = h('button', { class: 'tg' + (it.on ? ' on' : ''), type: 'button', title: it.title || it.id, html: it.icon ? PD.ic(it.icon, 16) : '<b>' + it.label + '</b>' });
      b.addEventListener('click', () => { it.on = !it.on; b.classList.toggle('on', it.on); onToggle(it.id, it.on); });
      b._it = it; w.appendChild(b);
    });
    w.setStates = (m) => Array.from(w.children).forEach((b) => { b.classList.toggle('on', !!m[b._it.id]); b._it.on = !!m[b._it.id]; });
    return w;
  };

  U.seg = function (items, value, onChange) {
    const w = h('div', { class: 'seg' });
    const draw = () => { Array.from(w.children).forEach((b) => b.classList.toggle('on', b._v === value)); };
    items.forEach((it) => {
      const b = h('button', { type: 'button', title: it.title || it.label || '', html: (it.icon ? PD.ic(it.icon, 16) : '') + (it.label ? '<span>' + PD.esc(it.label) + '</span>' : '') });
      b._v = it.v; b.addEventListener('click', () => { value = it.v; draw(); onChange(it.v); }); w.appendChild(b);
    });
    draw(); w.setValue = (v) => { value = v; draw(); };
    return w;
  };

  U.select = function (options, value, onChange) {
    const s = h('select', { class: 'input select' }, options.map((o) => h('option', { value: o.v != null ? o.v : o, selected: (o.v != null ? o.v : o) == value }, o.label || o)));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  };

  U.check = function (label, checked, onChange) {
    const i = h('input', { type: 'checkbox', checked: !!checked });
    i.addEventListener('change', () => onChange(i.checked));
    return h('label', { class: 'checkrow' }, i, h('span', { class: 'cbox' }), h('span', null, label));
  };

  /* context menu */
  U.menu = function (items, x, y) {
    document.querySelectorAll('.ctxmenu').forEach((m) => m.remove());
    const m = h('div', { class: 'ctxmenu' });
    items.forEach((it) => {
      if (it === '-') { m.appendChild(h('div', { class: 'cm-sep' })); return; }
      const b = h('button', { class: 'cm-i' + (it.danger ? ' danger' : ''), type: 'button', disabled: it.disabled, html: (it.icon ? PD.ic(it.icon, 15) : '<i class="sp"></i>') + '<span>' + PD.esc(it.label) + '</span>' + (it.key ? '<kbd>' + it.key + '</kbd>' : '') });
      b.addEventListener('click', () => { m.remove(); it.run(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    const away = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', away, true); } };
    setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  };

  /* tooltip (data-tip) */
  U.initTips = function () {
    let tip = null, t;
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      clearTimeout(t); if (tip) { tip.remove(); tip = null; }
      if (!el) return;
      t = setTimeout(() => {
        tip = h('div', { class: 'tip' }, el.dataset.tip, el.dataset.key ? h('kbd', null, el.dataset.key) : null);
        document.body.appendChild(tip);
        const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
        const side = el.dataset.side || 'bottom';
        if (side === 'right') { tip.style.left = r.right + 10 + 'px'; tip.style.top = r.top + r.height / 2 - tr.height / 2 + 'px'; }
        else if (side === 'top') { tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, innerWidth - tr.width - 6)) + 'px'; tip.style.top = r.top - tr.height - 8 + 'px'; }
        else { tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, innerWidth - tr.width - 6)) + 'px'; tip.style.top = r.bottom + 8 + 'px'; }
        tip.classList.add('in');
      }, 420);
    });
    document.addEventListener('mousedown', () => { clearTimeout(t); if (tip) { tip.remove(); tip = null; } });
  };
})();
