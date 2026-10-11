/* PDF Do — core helpers: DOM, icons, dialogs, toasts, file I/O, zip, storage */
(function () {
  'use strict';
  const PD = (window.PD = window.PD || {});
  PD.SUPPORT_URL = 'https://buymeacoffee.com/vishnu_535r';
  PD.docs = [];
  PD.cur = null;
  PD.K = 96 / 72; // CSS px per PDF point at 100%

  /* ---------- DOM helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  PD.$ = $; PD.$$ = $$;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  }
  PD.h = h;
  PD.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  PD.uid = (p) => (p || 'id') + Math.random().toString(36).slice(2, 9);
  PD.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  PD.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  PD.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  PD.fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB');
  PD.baseName = (n) => String(n || 'document').replace(/\.[^.]+$/, '');
  PD.natSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  PD.clone = (o) => JSON.parse(JSON.stringify(o));
  PD.frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  PD.hexToRgb = (hex) => {
    hex = String(hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* ---------- Icons (24px stroke set) ---------- */
  const I = {
    home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    read: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    text: 'M4 7V4h16v3M9 20h6M12 4v16',
    layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
    merge: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-3 5.2M9 18l-3 3-3-3',
    compare: 'M12 3v18M3 5h6v14H3zM15 5h6v14h-6z',
    convert: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    form: 'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 12h8M8 16h5',
    open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 8zM3 18l4-8h16l-4 8a2 2 0 0 1-2 1H5a2 2 0 0 1-2-1z',
    save: 'M5 3h11l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7',
    download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
    upload: 'M12 17V5M7 10l5-5 5 5M4 20h16',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    undo: 'M3 8h11a6 6 0 0 1 0 12H8M3 8l4-4M3 8l4 4',
    redo: 'M21 8H10a6 6 0 0 0 0 12h6M21 8l-4-4M21 8l-4 4',
    zoomin: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
    zoomout: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6',
    x: 'M18 6L6 18M6 6l12 12', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    check: 'M20 6L9 17l-5-5',
    trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
    rotcw: 'M21 3v6h-6M21 9a9 9 0 1 0 2 6',
    rotccw: 'M3 3v6h6M3 9a9 9 0 1 1-2 6',
    copy: 'M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1',
    scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
    image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
    link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    rect: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    ellipse: 'M12 4c5 0 9 3.6 9 8s-4 8-9 8-9-3.6-9-8 4-8 9-8z',
    line: 'M5 19L19 5',
    arrow: 'M5 19L19 5M9 5h10v10',
    note: 'M4 4h16v12l-5 5H4zM15 21v-5h5M8 9h8M8 13h4',
    stamp: 'M5 21h14M6 17h12v-3a3 3 0 0 0-3-3h-1V7a2 2 0 1 0-4 0v4H9a3 3 0 0 0-3 3z',
    sign: 'M3 17c3-6 4-9 6-9s0 6 2 6 2-4 4-4 1 3 3 3M3 21h18',
    highlight: 'M9 11l-6 6v4h4l6-6M22 5l-4-3-9 9 4 4zM13 15l-2-2',
    underline: 'M6 4v7a6 6 0 0 0 12 0V4M4 21h16',
    strike: 'M16 4H9a3 3 0 0 0-3 3c0 5 12 3 12 8a3 3 0 0 1-3 3H7M4 12h16',
    squiggle: 'M3 17c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0 3 3 4.5 0M7 4v7a5 5 0 0 0 10 0V4',
    eraser: 'M20 20H9L3.6 14.6a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L12 20M7 11l6 6',
    cursor: 'M5 3l14 7-6 2-2 6zM13 12l6 6',
    hand: 'M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V3.5a1.5 1.5 0 0 1 3 0V10M15 10V5.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L9 14',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
    lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
    eyeoff: 'M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
    drop: 'M12 2.7s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z',
    hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
    crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
    full: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
    cmd: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6z',
    play: 'M6 4l14 8-14 8z',
    scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    panel: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 4v16',
    panelr: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM15 4v16',
    columns: 'M3 4h18v16H3zM12 4v16',
    bold: 'M6 4h7a4 4 0 0 1 0 8H6zM6 12h8a4 4 0 0 1 0 8H6z',
    italic: 'M19 4h-9M14 20H5M15 4L9 20',
    alignl: 'M3 6h18M3 12h12M3 18h16', alignc: 'M3 6h18M6 12h12M4 18h16', alignr: 'M3 6h18M9 12h12M5 18h16',
    move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
    fit: 'M4 14v6h6M20 10V4h-6M14 10l6-6M10 14l-6 6',
    split: 'M16 3h5v5M8 3H3v5M21 3l-7.5 7.5M3 3l7.5 7.5M12 12v9',
    reverse: 'M7 16V4M3 8l4-4 4 4M17 8v12M13 16l4 4 4-4',
    sortaz: 'M3 8h6M3 16h10M3 12h8M17 5v14M14 16l3 3 3-3',
    interleave: 'M4 6h16M4 12h10M4 18h16',
    water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9 15a3 3 0 0 0 3 3',
    star: 'M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5L9 8.9z',
    cut: 'M3 12h18M12 3v18',
    wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
    font: 'M4 20L10 4h2l6 16M7 14h8M20 20h-3',
    ruler: 'M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
    eyedrop: 'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z',
    flatten: 'M3 9l9-5 9 5-9 5zM3 15l9 5 9-5',
    zip: 'M12 3v2M12 7v2M12 11v2M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 15h4v4h-4z',
    keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    pagenum: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 17h4M12 17v-6l-1.5 1',
    blank: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 9v6M9 12h6',
    textcursor: 'M9 3h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9M15 3h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h1M7 12h10',
    checkbox: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 12l3 3 5-6',
    dropdown: 'M3 6h18v12H3zM15 11l2 2 2-2',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    moonsun: 'M12 3a9 9 0 1 0 0 18zM12 3v18',
    newtab: 'M12 5v14M5 12h14',
    tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
    pin: 'M12 17v5M9 3h6l-1 7 3 3v2H7v-2l3-3z',
    diff: 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 2v20',
    magic: 'M15 4l5 5L9 20l-5-5zM12 7l5 5',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    menu: 'M3 6h18M3 12h18M3 18h18',
    dots: 'M12 5h.01M12 12h.01M12 19h.01',
    book: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z',
    speaker: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
    key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
    unlock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 7.5-2',
  };
  PD.icons = I;
  PD.ic = (name, size, sw) =>
    '<svg class="ic" viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="' +
    (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round"><path d="' + (I[name] || I.file) + '"/></svg>';
  PD.icon = (name, size, sw) => { const s = h('span', { class: 'ico', html: PD.ic(name, size, sw) }); return s; };
  // hydrate declarative icons: <i data-ic="name" data-s="18">
  PD.hydrate = (root) => {
    $$('[data-ic]', root || document).forEach((n) => {
      if (n.dataset.done) return;
      n.innerHTML = PD.ic(n.dataset.ic, +n.dataset.s || 18);
      n.dataset.done = '1';
    });
  };

  /* ---------- Toasts ---------- */
  PD.toast = function (msg, kind, ms) {
    const root = $('#toasts');
    const t = h('div', { class: 'toast ' + (kind || 'info') }, h('span', { class: 'ti', html: PD.ic(kind === 'error' ? 'x' : kind === 'ok' ? 'check' : 'info', 16, 2.4) }), h('span', null, msg));
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms || (kind === 'error' ? 5200 : 2800));
  };

  /* ---------- Modal dialogs ---------- */
  PD.modal = function (opts) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      const body = h('div', { class: 'm-body' });
      if (opts.content instanceof Node) body.appendChild(opts.content);
      else if (opts.content) body.innerHTML = opts.content;
      const foot = h('div', { class: 'm-foot' });
      const card = h('div', { class: 'm-card' + (opts.wide ? ' wide' : '') + (opts.xwide ? ' xwide' : ''), role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'm-head' },
          opts.icon ? h('span', { class: 'm-ico', html: PD.ic(opts.icon, 20) }) : null,
          h('div', { class: 'm-title' }, h('h3', null, opts.title || ''), opts.sub ? h('p', null, opts.sub) : null),
          h('button', { class: 'icon-btn', title: 'Close', onclick: () => close(undefined), html: PD.ic('x', 18) })),
        body, foot);
      const back = h('div', { class: 'm-back' }, card);
      let closed = false;
      function close(v) {
        if (closed) return; closed = true;
        document.removeEventListener('keydown', onKey, true);
        back.classList.remove('in');
        setTimeout(() => back.remove(), 200);
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
        else if (e.key === 'Enter' && !(e.target && /TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) && opts.enter !== false) {
          const p = foot.querySelector('.btn.primary'); if (p) { e.preventDefault(); p.click(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      (opts.buttons || [{ label: 'Close', value: true }]).forEach((b) => {
        const btn = h('button', { class: 'btn ' + (b.kind || 'ghost'), html: (b.icon ? PD.ic(b.icon, 16) : '') + '<span>' + PD.esc(b.label) + '</span>' });
        btn.addEventListener('click', async () => {
          if (b.run) {
            btn.disabled = true;
            try { const r = await b.run(card); if (r === false) { btn.disabled = false; return; } close(r === undefined ? b.value : r); }
            catch (e) { console.error(e); PD.toast(e.message || String(e), 'error'); btn.disabled = false; }
          } else close(b.value);
        });
        if (b.left) btn.style.marginRight = 'auto';
        foot.appendChild(btn);
      });
      back.addEventListener('mousedown', (e) => { if (e.target === back && opts.dismiss !== false) close(undefined); });
      root.appendChild(back);
      requestAnimationFrame(() => back.classList.add('in'));
      if (opts.onOpen) opts.onOpen(card, close);
      const first = card.querySelector('[autofocus],input[type=text],input[type=password],input[type=number]');
      if (first) setTimeout(() => first.focus(), 60);
    });
  };
  PD.confirm = (title, msg, okLabel, danger) =>
    PD.modal({ title, content: h('p', { class: 'muted' }, msg), icon: danger ? 'trash' : 'info',
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', kind: danger ? 'danger' : 'primary', value: true }] }).then((v) => !!v);
  PD.prompt = (title, label, value, type) =>
    new Promise((res) => {
      const inp = h('input', { type: type || 'text', class: 'input', value: value || '', autofocus: true });
      PD.modal({ title, content: h('label', { class: 'field' }, h('span', null, label), inp),
        buttons: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'primary', run: () => inp.value }] }).then((v) => res(v === undefined ? null : v));
    });

  /* ---------- Busy overlay ---------- */
  PD.busy = function (label) {
    const root = $('#busy');
    const bar = h('i');
    const txt = h('span', null, label || 'Working…');
    const sub = h('small', null, '');
    const box = h('div', { class: 'busy-card' }, h('div', { class: 'spinner' }), h('div', { class: 'busy-t' }, txt, sub), h('div', { class: 'busy-bar' }, bar));
    root.appendChild(box); root.classList.add('on');
    return {
      set(p, t, s) { if (p != null) bar.style.width = Math.round(PD.clamp(p, 0, 1) * 100) + '%'; if (t) txt.textContent = t; if (s != null) sub.textContent = s; },
      done() { box.remove(); if (!root.children.length) root.classList.remove('on'); },
    };
  };
  PD.withBusy = async function (label, fn) {
    const b = PD.busy(label);
    try { await PD.frame(); await PD.frame(); return await fn(b); }
    catch (e) { console.error(e); PD.toast((e && e.message) || String(e), 'error'); throw e; }
    finally { b.done(); }
  };

  /* ---------- Storage ---------- */
  PD.store = {
    get(k, d) { try { const v = localStorage.getItem('pdfdo.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pdfdo.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  let _db;
  function db() {
    if (_db) return _db;
    _db = new Promise((res, rej) => {
      const r = indexedDB.open('pdfdo', 1);
      r.onupgradeneeded = () => { const d = r.result; ['fonts', 'recover', 'sigs', 'handles'].forEach((s) => d.createObjectStore(s)); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return _db;
  }
  PD.idb = {
    async get(s, k) { try { const d = await db(); return await new Promise((res) => { const q = d.transaction(s).objectStore(s).get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch (e) { return undefined; } },
    async set(s, k, v) { try { const d = await db(); return await new Promise((res) => { const t = d.transaction(s, 'readwrite'); t.objectStore(s).put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); } catch (e) { return false; } },
    async del(s, k) { try { const d = await db(); return await new Promise((res) => { const t = d.transaction(s, 'readwrite'); t.objectStore(s).delete(k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); } catch (e) { return false; } },
    async all(s) { try { const d = await db(); return await new Promise((res) => { const out = []; const q = d.transaction(s).objectStore(s).openCursor(); q.onsuccess = () => { const c = q.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else res(out); }; q.onerror = () => res([]); }); } catch (e) { return []; } },
  };

  /* ---------- File I/O ---------- */
  PD.pickFiles = async function (o) {
    o = o || {};
    const accept = o.accept || '.pdf,application/pdf';
    if (window.showOpenFilePicker && !o.legacy) {
      try {
        const exts = accept.split(',').filter((a) => a.startsWith('.'));
        const mimes = accept.split(',').filter((a) => !a.startsWith('.'));
        const types = [{ description: o.desc || 'Files', accept: Object.fromEntries((mimes.length ? mimes : ['application/octet-stream']).map((m) => [m, exts])) }];
        const handles = await window.showOpenFilePicker({ multiple: !!o.multiple, types, excludeAcceptAllOption: false });
        const out = [];
        for (const hd of handles) { const f = await hd.getFile(); out.push({ file: f, handle: hd }); }
        return out;
      } catch (e) { if (e && e.name === 'AbortError') return []; /* fall through */ }
    }
    return new Promise((res) => {
      const inp = h('input', { type: 'file', accept, multiple: !!o.multiple, style: 'display:none' });
      inp.addEventListener('change', () => { res(Array.from(inp.files).map((f) => ({ file: f, handle: null }))); inp.remove(); });
      inp.addEventListener('cancel', () => res([]));
      document.body.appendChild(inp); inp.click();
    });
  };
  PD.readFile = async (f) => new Uint8Array(await f.arrayBuffer());

  PD.download = function (data, name, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };
  // Save with a "Save as" dialog when supported
  PD.saveAs = async function (data, name, opts) {
    opts = opts || {};
    const blob = data instanceof Blob ? data : new Blob([data], { type: opts.mime || 'application/octet-stream' });
    const ext = (name.match(/\.[^.]+$/) || ['.pdf'])[0];
    if (window.showSaveFilePicker) {
      try {
        const hd = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: opts.desc || 'File', accept: { [opts.mime || 'application/octet-stream']: [ext] } }] });
        const w = await hd.createWritable(); await w.write(blob); await w.close();
        return hd;
      } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    PD.download(blob, name); return true;
  };
  PD.writeHandle = async function (handle, data) {
    const w = await handle.createWritable(); await w.write(data instanceof Blob ? data : new Blob([data])); await w.close();
  };

  /* ---------- ZIP (store) ---------- */
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  PD.zip = function (files) {
    const enc = new TextEncoder(); const parts = []; const cds = []; let off = 0;
    const d = new Date();
    const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    for (const f of files) {
      const nm = enc.encode(f.name); const data = f.data; const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nm, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, dt, true); cd.setUint16(14, dd, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
      cds.push(cd.buffer, nm);
      off += 30 + nm.length + data.length;
    }
    let cdSize = 0; cds.forEach((c) => (cdSize += c.byteLength));
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...cds, end.buffer], { type: 'application/zip' });
  };

  /* ---------- Canvas helpers ---------- */
  PD.canvasToBytes = (canvas, type, q) => new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type || 'image/png', q));
  PD.canvasToBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob((b) => res(b), type || 'image/png', q));
  PD.dataUrlToBytes = (u) => { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  PD.blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  PD.loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image failed to load')); i.src = src; });
})();
