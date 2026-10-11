/* PDF Do — font manager: standard 14, bundled families, uploaded fonts, installed system fonts */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;

  const STD = {
    'Helvetica': { css: 'Helvetica, Arial, sans-serif', cat: 'Standard', map: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
    'Times Roman': { css: '"Times New Roman", Times, serif', cat: 'Standard', map: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
    'Courier': { css: '"Courier New", Courier, monospace', cat: 'Standard', map: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
  };
  const F = (PD.fonts = {
    STD,
    bundled: window.PD_BUNDLED_FONTS || [],
    uploaded: {}, // family -> {family, variants:[{id,bold,italic,bytes,style}]}
    system: {},   // family -> [FontData]
    systemLoaded: false,
    bytesCache: new Map(),
    docCache: new WeakMap(),
    onChange: [],
  });
  const changed = () => F.onChange.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });

  F.init = async function () {
    // register bundled faces
    for (const fam of F.bundled) {
      for (const f of fam.files) {
        try {
          const face = new FontFace(fam.family, 'url(assets/fonts/' + f.f + ')', { weight: String(f.w), style: f.i ? 'italic' : 'normal' });
          document.fonts.add(face); face.load().catch(() => {});
        } catch (e) { /* ignore */ }
      }
    }
    const saved = await PD.idb.all('fonts');
    for (const { key, value } of saved) { try { await F.registerUploaded(value, false); } catch (e) { /* ignore */ } }
    const sysNames = PD.store.get('systemFonts', null);
    if (sysNames) sysNames.forEach((n) => { if (!F.system[n]) F.system[n] = null; });
    changed();
  };

  F.cssStack = function (spec) {
    const fam = spec.family;
    if (STD[fam]) return STD[fam].css;
    const cat = (F.bundled.find((b) => b.family === fam) || {}).cat;
    const fb = cat === 'Serif' ? 'serif' : cat === 'Mono' ? 'monospace' : cat === 'Handwriting' ? 'cursive' : 'sans-serif';
    return '"' + fam + '", ' + fb;
  };
  F.cssStyle = (spec) => 'font-family:' + F.cssStack(spec) + ';font-weight:' + (spec.bold ? 700 : 400) + ';font-style:' + (spec.italic ? 'italic' : 'normal') + ';';

  F.families = function () {
    const out = [];
    Object.keys(STD).forEach((n) => out.push({ name: n, cat: 'Standard', kind: 'std' }));
    const order = ['Sans', 'Serif', 'Mono', 'Display', 'Handwriting'];
    F.bundled.slice().sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || PD.natSort(a.family, b.family)).forEach((b) => out.push({ name: b.family, cat: b.cat, kind: 'bundled' }));
    Object.keys(F.uploaded).sort(PD.natSort).forEach((n) => out.push({ name: n, cat: 'Your fonts', kind: 'upload' }));
    Object.keys(F.system).sort(PD.natSort).forEach((n) => { if (!STD[n] && !F.bundled.some((b) => b.family === n) && !F.uploaded[n]) out.push({ name: n, cat: 'Installed', kind: 'system' }); });
    return out;
  };
  F.kindOf = (fam) => (STD[fam] ? 'std' : F.uploaded[fam] ? 'upload' : F.bundled.some((b) => b.family === fam) ? 'bundled' : 'system');

  /* ---- uploaded fonts ---- */
  F.registerUploaded = async function (rec, persist) {
    const fam = (F.uploaded[rec.family] = F.uploaded[rec.family] || { family: rec.family, variants: [] });
    if (fam.variants.some((v) => v.id === rec.id)) return;
    fam.variants.push(rec);
    const face = new FontFace(rec.family, rec.bytes.slice().buffer, { weight: rec.bold ? '700' : '400', style: rec.italic ? 'italic' : 'normal' });
    await face.load(); document.fonts.add(face);
    if (persist) await PD.idb.set('fonts', rec.id, rec);
  };
  F.addFiles = async function (files) {
    const added = [];
    for (const file of files) {
      const bytes = await PD.readFile(file);
      let family = PD.baseName(file.name), sub = '';
      try {
        const f = window.fontkit.create(bytes);
        const font = f.fonts ? f.fonts[0] : f;
        family = font.familyName || family; sub = font.subfamilyName || '';
      } catch (e) { throw new Error('"' + file.name + '" is not a valid font file'); }
      const low = (sub + ' ' + file.name).toLowerCase();
      const rec = { id: PD.uid('f'), family, bytes, bold: /bold|black|heavy/.test(low), italic: /italic|oblique/.test(low), style: sub, file: file.name };
      await F.registerUploaded(rec, true);
      added.push(family);
    }
    changed();
    return Array.from(new Set(added));
  };
  F.removeUploaded = async function (family) {
    const fam = F.uploaded[family]; if (!fam) return;
    for (const v of fam.variants) await PD.idb.del('fonts', v.id);
    delete F.uploaded[family]; changed();
  };

  /* ---- system fonts ---- */
  F.loadSystem = async function () {
    if (!window.queryLocalFonts) { PD.toast('Installed-font access is not supported in this browser build.', 'error'); return false; }
    try {
      const list = await window.queryLocalFonts();
      const map = {};
      list.forEach((fd) => { (map[fd.family] = map[fd.family] || []).push(fd); });
      F.system = map; F.systemLoaded = true;
      PD.store.set('systemFonts', Object.keys(map));
      changed();
      return true;
    } catch (e) {
      PD.toast('Permission to read installed fonts was declined.', 'error');
      return false;
    }
  };

  async function fetchBytes(url) {
    if (F.bytesCache.has(url)) return F.bytesCache.get(url);
    let bytes;
    try { const r = await fetch(url); bytes = new Uint8Array(await r.arrayBuffer()); }
    catch (e) {
      bytes = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer'; x.onload = () => res(new Uint8Array(x.response)); x.onerror = () => rej(new Error('Cannot read font ' + url)); x.send(); });
    }
    F.bytesCache.set(url, bytes); return bytes;
  }

  /* ---- embedding into pdf-lib documents ---- */
  // returns {font, fakeBold, fakeItalic}
  F.embed = async function (pdfDoc, spec) {
    let cache = F.docCache.get(pdfDoc); if (!cache) { cache = new Map(); F.docCache.set(pdfDoc, cache); }
    const key = spec.family + '|' + !!spec.bold + '|' + !!spec.italic;
    if (cache.has(key)) return cache.get(key);
    const L = window.PDFLib; const kind = F.kindOf(spec.family);
    let res = null;
    try {
      if (kind === 'std') {
        const m = STD[spec.family].map; const idx = (spec.bold ? 1 : 0) + (spec.italic ? 2 : 0);
        const order = [0, 1, 2, 3]; // regular, bold, italic, bold-italic in map: [reg,bold,obl,boldobl]
        const pick = spec.bold && spec.italic ? 3 : spec.bold ? 1 : spec.italic ? 2 : 0;
        res = { font: await pdfDoc.embedFont(L.StandardFonts[m[pick]]), fakeBold: false, fakeItalic: false, std: true };
      } else {
        pdfDoc.registerFontkit(window.fontkit);
        let bytes = null, haveBold = false, haveItalic = false;
        if (kind === 'bundled') {
          const fam = F.bundled.find((b) => b.family === spec.family);
          const want = (w, i) => fam.files.find((f) => f.w === w && f.i === i);
          let f = want(spec.bold ? 700 : 400, !!spec.italic);
          if (f) { haveBold = !!spec.bold; haveItalic = !!spec.italic; }
          else if ((f = want(spec.bold ? 700 : 400, false))) { haveBold = !!spec.bold; }
          else if ((f = want(400, !!spec.italic))) { haveItalic = !!spec.italic; }
          else f = fam.files[0];
          bytes = await fetchBytes('assets/fonts/' + f.f);
        } else if (kind === 'upload') {
          const vs = F.uploaded[spec.family].variants;
          let v = vs.find((x) => x.bold === !!spec.bold && x.italic === !!spec.italic) || vs.find((x) => x.bold === !!spec.bold) || vs.find((x) => x.italic === !!spec.italic) || vs[0];
          bytes = v.bytes; haveBold = v.bold; haveItalic = v.italic;
        } else {
          if (!F.systemLoaded || !F.system[spec.family]) await F.loadSystem();
          const list = F.system[spec.family];
          if (!list || !list.length) throw new Error('missing');
          const sc = (fd) => { const s = (fd.style || '').toLowerCase(); const b = /bold|black|heavy/.test(s), i = /italic|oblique/.test(s); return (b === !!spec.bold ? 2 : 0) + (i === !!spec.italic ? 2 : 0) + (/^regular$|^normal$/.test(s) && !spec.bold && !spec.italic ? 1 : 0); };
          const fd = list.slice().sort((a, b) => sc(b) - sc(a))[0];
          const s = (fd.style || '').toLowerCase(); haveBold = /bold|black|heavy/.test(s); haveItalic = /italic|oblique/.test(s);
          bytes = new Uint8Array(await (await fd.blob()).arrayBuffer());
        }
        let font;
        try { font = await pdfDoc.embedFont(bytes, { subset: true }); } catch (e) { font = await pdfDoc.embedFont(bytes); }
        res = { font, fakeBold: !!spec.bold && !haveBold, fakeItalic: !!spec.italic && !haveItalic, std: false };
      }
    } catch (e) {
      console.warn('Font fallback for', spec.family, e);
      const pick = spec.bold && spec.italic ? 3 : spec.bold ? 1 : spec.italic ? 2 : 0;
      res = { font: await pdfDoc.embedFont(L.StandardFonts[STD['Helvetica'].map[pick]]), fakeBold: false, fakeItalic: false, std: true, fallback: true };
    }
    cache.set(key, res);
    return res;
  };

  /* ---- font picker popover ---- */
  F.picker = function (value, onPick) {
    const btn = h('button', { class: 'fontbtn', type: 'button' });
    const label = h('span', { class: 'fb-name' });
    btn.append(label, h('span', { class: 'fb-caret', html: PD.ic('down', 14) }));
    const paint = () => { label.textContent = value; label.style.cssText = F.cssStyle({ family: value }); };
    paint();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = h('div', { class: 'fontpop' });
      const search = h('input', { class: 'input', placeholder: 'Search fonts…', type: 'text' });
      const listEl = h('div', { class: 'fp-list' });
      const foot = h('div', { class: 'fp-foot' },
        h('button', { class: 'btn small', html: PD.ic('upload', 14) + '<span>Add font file…</span>', onclick: async () => {
          const files = await PD.pickFiles({ accept: '.ttf,.otf,.woff,.woff2,.ttc', multiple: true, desc: 'Fonts', legacy: true });
          if (!files.length) return;
          try { const fams = await F.addFiles(files.map((f) => f.file)); PD.toast('Added font' + (fams.length > 1 ? 's' : '') + ': ' + fams.join(', '), 'ok'); if (fams[0]) { value = fams[0]; paint(); onPick(value); } fill(); }
          catch (err) { PD.toast(err.message, 'error'); }
        } }),
        h('button', { class: 'btn small', html: PD.ic('font', 14) + '<span>Use installed fonts</span>', onclick: async (ev) => { ev.target.closest('button').disabled = true; if (await F.loadSystem()) { PD.toast(Object.keys(F.system).length + ' installed fonts available', 'ok'); fill(); } } }));
      function fill() {
        const q = search.value.trim().toLowerCase(); listEl.innerHTML = '';
        let cat = '';
        F.families().filter((f) => !q || f.name.toLowerCase().includes(q)).forEach((f) => {
          if (f.cat !== cat) { cat = f.cat; listEl.appendChild(h('div', { class: 'fp-cat' }, cat)); }
          const it = h('button', { class: 'fp-item' + (f.name === value ? ' sel' : ''), type: 'button', style: 'font-family:' + F.cssStack({ family: f.name }) }, f.name);
          it.addEventListener('click', () => { value = f.name; paint(); onPick(value); close(); });
          if (f.kind === 'upload') it.appendChild(h('span', { class: 'fp-x', title: 'Remove font', html: PD.ic('x', 12), onclick: async (ev) => { ev.stopPropagation(); await F.removeUploaded(f.name); fill(); } }));
          listEl.appendChild(it);
        });
        if (!listEl.children.length) listEl.appendChild(h('div', { class: 'fp-empty' }, 'No fonts match'));
      }
      search.addEventListener('input', fill);
      pop.append(search, listEl, foot);
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      const top = Math.min(r.bottom + 6, window.innerHeight - 420);
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px'; pop.style.top = Math.max(8, top) + 'px';
      fill(); setTimeout(() => search.focus(), 30);
      const sel = listEl.querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'center' });
      function close() { pop.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', key, true); }
      function away(ev) { if (!pop.contains(ev.target)) close(); }
      function key(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
      setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', key, true); }, 0);
    });
    btn.setValue = (v) => { value = v; paint(); };
    return btn;
  };
})();
