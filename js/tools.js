/* PDF Do — document tools: watermark, header/footer/page numbers, crop, resize, metadata, redaction, flatten, compress, forms */
(function () {
  'use strict';
  const PD = window.PD;
  const L = window.PDFLib;
  const { h } = PD;
  const U = PD.ui;
  const T = (PD.tools = PD.tools || {});
  const need = () => { if (!PD.cur) { PD.toast('Open a PDF first', 'info'); return null; } return PD.cur; };
  const col = (hex) => PD.pdf.col(hex);
  const field = (label, ctl) => h('label', { class: 'field' }, h('span', null, label), ctl);
  const rad = (d) => (d * Math.PI) / 180;

  /* ---------- render helpers ---------- */
  T.renderToCanvas = async function (pdfDoc, i, scale) {
    const page = await pdfDoc.getPage(i + 1); const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#ffffff' }).promise; return c;
  };
  // rebuild pages as images. opts: dpi, quality, pages (indices or null=all), black {pageIdx:[{x,y,w,h}]} in visual points
  T.rasterize = async function (bytes, opts, busy) {
    opts = opts || {}; const dpi = opts.dpi || 150; const scale = dpi / 72; const png = !!opts.png;
    const task = pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: opts.password || '' });
    const pd = await task.promise; const n = pd.numPages;
    const targets = opts.pages || Array.from({ length: n }, (_, i) => i);
    let out, replace = !!opts.pages;
    if (replace) out = await L.PDFDocument.load(bytes); else out = await L.PDFDocument.create();
    for (let k = 0; k < targets.length; k++) {
      const i = targets[k]; if (busy) busy.set(k / targets.length, 'Rendering page ' + (i + 1) + ' of ' + n);
      const page = await pd.getPage(i + 1); const vp1 = page.getViewport({ scale: 1 });
      const c = await T.renderToCanvas(pd, i, scale);
      const rects = (opts.black && opts.black[i]) || [];
      if (rects.length) { const x = c.getContext('2d'); x.fillStyle = '#000'; rects.forEach((r) => x.fillRect(Math.floor(r.x * scale), Math.floor(r.y * scale), Math.ceil(r.w * scale) + 1, Math.ceil(r.h * scale) + 1)); }
      const imgBytes = await PD.canvasToBytes(c, png ? 'image/png' : 'image/jpeg', opts.quality || 0.85);
      const img = png ? await out.embedPng(imgBytes) : await out.embedJpg(imgBytes);
      let np;
      if (replace) { out.removePage(i); np = out.insertPage(i, [vp1.width, vp1.height]); } else np = out.addPage([vp1.width, vp1.height]);
      np.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      if (opts.keepText) await keepInvisibleText(out, np, page, vp1, rects);
      c.width = c.height = 0;
    }
    pd.destroy();
    out.setProducer('PDF Do');
    return await out.save();
  };
  // re-add the page's text as an invisible layer (skipping anything under redaction boxes) so rebuilt pages stay searchable
  let _hv = null;
  async function keepInvisibleText(out, np, page, vp, rects) {
    try {
      _hv = _hv || new WeakMap(); let font = _hv.get(out); if (!font) { font = await out.embedFont(L.StandardFonts.Helvetica); _hv.set(out, font); }
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        if (Math.abs(Math.atan2(tx[1], tx[0])) > 0.02) continue;
        const fs = Math.hypot(tx[2], tx[3]), w = it.width; const r0 = { x: tx[4], y: tx[5] - fs, w, h: fs * 1.2 };
        if (rects.some((r) => !(r0.x > r.x + r.w || r0.x + r0.w < r.x || r0.y > r.y + r.h || r0.y + r0.h < r.y))) continue;
        let str = it.str; try { font.encodeText(str); } catch (e) { str = str.replace(/[^ -ÿ]/g, '?'); }
        const w1 = font.widthOfTextAtSize(str, 1) || 1; const size = Math.max(1, Math.min(fs * 2, w / w1));
        np.drawText(str, { x: tx[4], y: vp.height - tx[5], size, font, opacity: 0 });
      }
    } catch (e) { console.warn('text layer', e); }
  }
  T.rasterBytes = async function (doc, opts) {
    const bytes = opts.bake === false ? doc.bytes : await PD.pdf.bake(doc);
    const b = PD.busy('Rebuilding pages…');
    try { return await T.rasterize(bytes, Object.assign({}, opts, { password: doc.pw }), b); } finally { b.done(); }
  };

  /* ---------- redaction ---------- */
  T.applyRedactions = async function (silent) {
    const d = need(); if (!d) return;
    const black = {}; let count = 0;
    Object.keys(d.ov).forEach((k) => { const l = d.ov[k].filter((o) => o.t === 'redact'); if (l.length) { black[k] = l.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })); count += l.length; } });
    if (!count) { PD.toast('No redaction marks yet — use the Redact tool to mark areas', 'info'); return; }
    const pages = Object.keys(black).map(Number);
    if (!silent) {
      const ok = await PD.confirm('Apply ' + count + ' redaction' + (count > 1 ? 's' : '') + '?', 'Pages ' + pages.map((p) => p + 1).join(', ') + ' will be rebuilt as images with the marked areas blacked out. Text on those pages becomes non-selectable. This cannot be undone after saving.', 'Apply redactions', true);
      if (!ok) return;
    }
    // remove marks, bake the rest, then rasterize target pages
    Object.keys(black).forEach((k) => { d.ov[k] = d.ov[k].filter((o) => o.t !== 'redact'); if (!d.ov[k].length) delete d.ov[k]; });
    await PD.withBusy('Applying redactions…', async (b) => {
      const baked = await PD.pdf.bake(d);
      const out = await T.rasterize(baked, { pages, black, dpi: 200, quality: 0.92, password: d.pw, keepText: true }, b);
      await d.commit(out, 'Apply redactions');
    });
    PD.toast('Redactions applied — content under the black boxes is gone', 'ok');
  };

  /* ---------- flatten / compress ---------- */
  T.flattenDialog = async function () {
    const d = need(); if (!d) return;
    let dpi = 150, q = 0.85;
    const ok = await PD.modal({ title: 'Flatten to images', icon: 'flatten', sub: 'Rebuild every page as a picture. Removes form fields, hidden layers, and protection.',
      content: h('div', { class: 'stack' }, field('Resolution', U.select([{ v: 96, label: '96 dpi — small' }, { v: 150, label: '150 dpi — balanced' }, { v: 220, label: '220 dpi — sharp' }, { v: 300, label: '300 dpi — print' }], 150, (v) => (dpi = +v))), field('JPEG quality', U.range(0.4, 1, 0.05, 0.85, (v) => (q = v), (v) => Math.round(v * 100) + '%')), h('p', { class: 'muted small' }, 'Text will no longer be selectable. Run OCR from Convert to make it searchable again.')),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Flatten', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Flattening…', async () => { const out = await T.rasterBytes(d, { dpi, quality: q }); await d.commit(out, 'Flatten to images'); });
    PD.toast('Document flattened', 'ok');
  };
  T.compressDialog = async function () {
    const d = need(); if (!d) return;
    const presets = [
      { v: 'lossless', title: 'Optimize structure', sub: 'Lossless. Rewrites the file with compressed object streams.', ic: 'zip' },
      { v: 'balanced', title: 'Balanced', sub: 'Pages become 130 dpi pictures (JPEG 70%). Good for scans.', ic: 'image' },
      { v: 'strong', title: 'Smallest file', sub: 'Pages become 90 dpi pictures (JPEG 55%). Best for sharing.', ic: 'flatten' },
    ];
    let pick = 'lossless';
    const list = h('div', { class: 'choice-list' });
    presets.forEach((p) => { const b = h('button', { class: 'choice' + (p.v === pick ? ' on' : ''), onclick: () => { pick = p.v; Array.from(list.children).forEach((c, i) => c.classList.toggle('on', presets[i].v === pick)); } }, h('span', { html: PD.ic(p.ic, 20) }), h('div', null, h('b', null, p.title), h('small', null, p.sub))); list.appendChild(b); });
    const ok = await PD.modal({ title: 'Compress PDF', icon: 'zip', sub: 'Current size: ' + PD.fmtBytes(d.bytes.length), content: list, buttons: [{ label: 'Cancel', value: false }, { label: 'Compress', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Compressing…', async (b) => {
      const baked = await PD.pdf.bake(d); let out;
      if (pick === 'lossless') { const pdf = await PD.pdf.load(baked); out = await pdf.save({ useObjectStreams: true }); }
      else out = await T.rasterize(baked, { dpi: pick === 'balanced' ? 130 : 90, quality: pick === 'balanced' ? 0.7 : 0.55, password: d.pw, keepText: true }, b);
      const saved = baked.length - out.length;
      if (out.length >= baked.length) { PD.toast('This file is already well optimized (' + PD.fmtBytes(baked.length) + ')', 'info'); return; }
      await d.commit(out, 'Compress');
      PD.toast('Smaller by ' + Math.round((saved / baked.length) * 100) + '% — ' + PD.fmtBytes(baked.length) + ' → ' + PD.fmtBytes(out.length), 'ok');
    });
  };

  /* ---------- metadata ---------- */
  T.metadata = async function () {
    const d = need(); if (!d) return;
    const m = await d.pdf.getMetadata().catch(() => ({ info: {} })); const inf = m.info || {};
    const f = { title: inf.Title || '', author: inf.Author || '', subject: inf.Subject || '', keywords: inf.Keywords || '' };
    const mk = (k, label, ph) => { const i = h('input', { class: 'input', value: f[k], placeholder: ph || '' }); i.addEventListener('input', () => (f[k] = i.value)); return field(label, i); };
    const ro = h('div', { class: 'kv' }, [['File', d.name], ['Size', PD.fmtBytes(d.bytes.length)], ['Pages', d.n], ['PDF version', inf.PDFFormatVersion || '—'], ['Producer', inf.Producer || '—'], ['Created with', inf.Creator || '—'], ['Created', fmtDate(inf.CreationDate)], ['Modified', fmtDate(inf.ModDate)], ['Tagged', m.metadata ? 'XMP present' : 'No XMP']].map(([k, v]) => h('div', null, h('small', null, k), h('b', null, String(v)))));
    const res = await PD.modal({ title: 'Document properties', icon: 'info', wide: true, content: h('div', { class: 'stack' }, mk('title', 'Title'), mk('author', 'Author'), mk('subject', 'Subject'), mk('keywords', 'Keywords (comma separated)'), ro),
      buttons: [{ label: 'Remove all metadata', kind: 'danger', value: 'wipe', left: true }, { label: 'Cancel', value: false }, { label: 'Save properties', kind: 'primary', value: 'save' }] });
    if (!res) return;
    await PD.pdf.edit(d, 'Edit properties', (pdf) => {
      if (res === 'wipe') { pdf.setTitle(''); pdf.setAuthor(''); pdf.setSubject(''); pdf.setKeywords([]); pdf.setProducer('PDF Do'); pdf.setCreator(''); pdf.catalog.delete(L.PDFName.of('Metadata')); }
      else { pdf.setTitle(f.title); pdf.setAuthor(f.author); pdf.setSubject(f.subject); pdf.setKeywords(f.keywords.split(',').map((s) => s.trim()).filter(Boolean)); pdf.setProducer('PDF Do'); pdf.setModificationDate(new Date()); }
    });
    PD.toast(res === 'wipe' ? 'Metadata removed' : 'Properties saved', 'ok');
  };
  function fmtDate(s) { if (!s) return '—'; const m = String(s).match(/D:(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?/); return m ? m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : '') : String(s); }

  /* ---------- watermark ---------- */
  T.watermark = async function () {
    const d = need(); if (!d) return;
    const w = { kind: 'text', text: 'CONFIDENTIAL', font: { family: 'Helvetica', bold: true, italic: false }, size: 72, color: '#ef4444', op: 0.22, rot: 40, tile: false, range: 'all', img: null, imgScale: 0.5, behind: false };
    const prev = h('div', { class: 'wm-prev' }, h('div', { class: 'wm-page' }, h('div', { class: 'wm-text' })));
    const paint = () => {
      const t = prev.querySelector('.wm-text'); const s = (w.size / 612) * 100;
      t.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(' + -w.rot + 'deg);white-space:nowrap;opacity:' + w.op + ';color:' + w.color + ';font-size:' + s * 1.9 + 'px;' + PD.fonts.cssStyle(w.font);
      t.textContent = w.kind === 'text' ? w.text : '';
      if (w.kind === 'image' && w.img) t.innerHTML = '<img src="' + w.img.url + '" style="width:' + w.imgScale * 160 + 'px">';
    };
    const txt = h('input', { class: 'input', value: w.text }); txt.addEventListener('input', () => { w.text = txt.value; paint(); });
    const textBox = h('div', { class: 'stack' }, field('Text', txt), field('Font', PD.fonts.picker(w.font.family, (f) => { w.font.family = f; paint(); })), h('div', { class: 'grid2' }, field('Size', U.num(w.size, (v) => { w.size = v; paint(); }, { min: 8, max: 400 })), field('Color', U.color(w.color, (c) => { w.color = c; paint(); }))), U.check('Bold', true, (v) => { w.font.bold = v; paint(); }));
    const imgBox = h('div', { class: 'stack' }, h('button', { class: 'btn', html: PD.ic('image', 16) + '<span>Choose image…</span>', onclick: async () => { const f = await PD.pickFiles({ accept: '.png,.jpg,.jpeg', legacy: true, desc: 'Images' }); if (f.length) { const bytes = await PD.readFile(f[0].file); w.img = { bytes, png: /png/i.test(f[0].file.type), url: URL.createObjectURL(f[0].file) }; paint(); } } }), field('Scale', U.range(0.1, 1.5, 0.05, w.imgScale, (v) => { w.imgScale = v; paint(); }, (v) => Math.round(v * 100) + '%')));
    const setKind = (k) => { w.kind = k; textBox.style.display = k === 'text' ? '' : 'none'; imgBox.style.display = k === 'image' ? '' : 'none'; paint(); };
    const body = h('div', { class: 'split2' }, h('div', { class: 'stack' }, U.seg([{ v: 'text', label: 'Text' }, { v: 'image', label: 'Image' }], 'text', setKind), textBox, imgBox,
      field('Opacity', U.range(0.03, 1, 0.01, w.op, (v) => { w.op = v; paint(); }, (v) => Math.round(v * 100) + '%')), field('Rotation', U.range(-90, 90, 1, w.rot, (v) => { w.rot = v; paint(); }, (v) => v + '°')),
      U.check('Repeat as tiles across the page', false, (v) => (w.tile = v)), U.check('Place behind page content (may be hidden by opaque pages)', false, (v) => (w.behind = v)), (() => { const r = h('input', { class: 'input', value: 'all' }); r.addEventListener('input', () => (w.range = r.value)); return field('Pages', r); })()), prev);
    setKind('text');
    const ok = await PD.modal({ title: 'Watermark', icon: 'water', xwide: true, content: body, buttons: [{ label: 'Cancel', value: false }, { label: 'Add watermark', kind: 'primary', value: true }] });
    if (!ok) return;
    if (w.kind === 'image' && !w.img) { PD.toast('Choose an image first', 'error'); return; }
    await PD.withBusy('Adding watermark…', () => PD.pdf.edit(d, 'Watermark', async (pdf) => {
      pdf.registerFontkit(window.fontkit);
      const pages = pdf.getPages(); const idx = PD.parseRange(w.range, pages.length);
      let fe, img;
      if (w.kind === 'text') fe = await PD.fonts.embed(pdf, w.font); else img = w.img.png ? await pdf.embedPng(w.img.bytes) : await pdf.embedJpg(w.img.bytes);
      for (const i of idx) {
        const pg = pages[i]; const { width: pw, height: ph } = pg.getSize(); const R = pg.getRotation().angle;
        const spots = [];
        if (w.tile) { const gx = pw / 2.2, gy = ph / 3.2; for (let y = gy / 2; y < ph; y += gy) for (let x = gx / 2; x < pw; x += gx) spots.push([x, y]); } else spots.push([pw / 2, ph / 2]);
        for (const [cx, cy] of spots) {
          const ang = w.rot - R;
          if (w.kind === 'text') {
            const size = w.tile ? Math.min(w.size, pw / 8) : w.size; const tw = fe.font.widthOfTextAtSize(w.text, size);
            const a = rad(ang); const x = cx - (tw / 2) * Math.cos(a) + (size * 0.35) * Math.sin(a), y = cy - (tw / 2) * Math.sin(a) - (size * 0.35) * Math.cos(a);
            pg.drawText(w.text, { x, y, size, font: fe.font, color: col(w.color), opacity: w.op, rotate: L.degrees(ang), xSkew: fe.fakeItalic ? L.degrees(12) : undefined });
          } else {
            const iw = img.width * w.imgScale * (w.tile ? 0.5 : 1), ih = img.height * w.imgScale * (w.tile ? 0.5 : 1); const a = rad(ang);
            pg.drawImage(img, { x: cx - (iw / 2) * Math.cos(a) + (ih / 2) * Math.sin(a), y: cy - (iw / 2) * Math.sin(a) - (ih / 2) * Math.cos(a), width: iw, height: ih, rotate: L.degrees(ang), opacity: w.op });
          }
        }
      }
    }));
    PD.toast('Watermark added', 'ok');
  };

  /* ---------- header / footer / page numbers / Bates ---------- */
  T.headerFooter = async function (preset) {
    const d = need(); if (!d) return;
    const S = { hl: '', hc: '', hr: '', fl: '', fc: preset === 'numbers' ? 'Page {page} of {pages}' : '', fr: '', font: { family: 'Helvetica', bold: false, italic: false }, size: 10, color: '#374151', margin: 28, range: 'all', skipFirst: false, start: 1, bates: 'DOC-', batesStart: 1, digits: 6 };
    const mk = (k, ph) => { const i = h('input', { class: 'input', value: S[k], placeholder: ph || '' }); i.addEventListener('input', () => (S[k] = i.value)); return i; };
    const grid = h('div', { class: 'hf-grid' },
      h('div', { class: 'hf-lab' }), h('b', null, 'Left'), h('b', null, 'Center'), h('b', null, 'Right'),
      h('div', { class: 'hf-lab' }, 'Header'), mk('hl'), mk('hc'), mk('hr'),
      h('div', { class: 'hf-lab' }, 'Footer'), mk('fl'), mk('fc'), mk('fr'));
    const tokens = h('div', { class: 'tokens' }, [['{page}', 'page number'], ['{pages}', 'total pages'], ['{date}', 'today'], ['{file}', 'file name'], ['{bates}', 'Bates number']].map(([t, l]) => h('span', { class: 'token', title: l }, t)));
    const range = h('input', { class: 'input', value: 'all' }); range.addEventListener('input', () => (S.range = range.value));
    const body = h('div', { class: 'stack' }, grid, tokens,
      h('div', { class: 'grid3' }, field('Font', PD.fonts.picker('Helvetica', (f) => (S.font.family = f))), field('Size', U.num(S.size, (v) => (S.size = v), { min: 4, max: 60 })), field('Color', U.color(S.color, (c) => (S.color = c)))),
      h('div', { class: 'grid3' }, field('Margin (pt)', U.num(S.margin, (v) => (S.margin = v), { min: 4, max: 200 })), field('First page number', U.num(S.start, (v) => (S.start = v))), field('Pages', range)),
      h('div', { class: 'grid3' }, field('Bates prefix', mk('bates')), field('Bates start', U.num(S.batesStart, (v) => (S.batesStart = v))), field('Digits', U.num(S.digits, (v) => (S.digits = v), { min: 1, max: 12 }))),
      U.check('Skip the first page', false, (v) => (S.skipFirst = v)));
    const ok = await PD.modal({ title: preset === 'numbers' ? 'Page numbers' : 'Headers, footers & Bates', icon: preset === 'numbers' ? 'pagenum' : 'hash', xwide: true, content: body, buttons: [{ label: 'Cancel', value: false }, { label: 'Apply', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Stamping pages…', () => PD.pdf.edit(d, 'Header/footer', async (pdf) => {
      pdf.registerFontkit(window.fontkit);
      const fe = await PD.fonts.embed(pdf, S.font); const pages = pdf.getPages(); const idx = PD.parseRange(S.range, pages.length).filter((i) => !(S.skipFirst && i === 0));
      const n = pages.length; const dateStr = new Date().toLocaleDateString();
      idx.forEach((i, k) => {
        const pg = pages[i]; const R = pg.getRotation().angle; const { width: W, height: H } = pg.getSize();
        const sub = (s) => s.replace(/\{page\}/g, String(S.start + i)).replace(/\{pages\}/g, String(n + S.start - 1)).replace(/\{date\}/g, dateStr).replace(/\{file\}/g, d.name).replace(/\{bates\}/g, S.bates + String(S.batesStart + k).padStart(S.digits, '0'));
        const place = (txt, hAlign, top) => {
          if (!txt) return; txt = sub(txt); try { fe.font.encodeText(txt); } catch (e) { txt = txt.replace(/[^\x20-\xff]/g, '?'); }
          const tw = fe.font.widthOfTextAtSize(txt, S.size);
          // position in visual (unrotated-view) frame then map to page space
          const vw = R % 180 ? H : W, vh = R % 180 ? W : H;
          const vx = hAlign === 'l' ? S.margin : hAlign === 'c' ? (vw - tw) / 2 : vw - S.margin - tw;
          const vy = top ? vh - S.margin - S.size * 0.8 : S.margin;
          let x, y;
          if (R === 0) { x = vx; y = vy; } else if (R === 90) { x = vy; y = vw - vx; } else if (R === 180) { x = vw - vx; y = vh - vy; } else { x = vh - vy; y = vx; }
          pg.drawText(txt, { x, y, size: S.size, font: fe.font, color: col(S.color), rotate: L.degrees(-R) });
        };
        place(S.hl, 'l', true); place(S.hc, 'c', true); place(S.hr, 'r', true); place(S.fl, 'l', false); place(S.fc, 'c', false); place(S.fr, 'r', false);
      });
    }));
    PD.toast('Applied to ' + PD.parseRange(S.range, d.n).length + ' pages', 'ok');
  };

  /* ---------- crop & resize ---------- */
  T.crop = async function (indices) {
    const d = need(); if (!d) return;
    const m = { t: 0, r: 0, b: 0, l: 0 }; let mode = 'manual'; const idxAll = indices && indices.length ? indices : PD.parseRange('all', d.n);
    const mkNum = (k, lab) => field(lab, U.num(0, (v) => (m[k] = Math.max(0, v)), { min: 0, unit: 'pt' }));
    const auto = h('div', { class: 'muted small' }, 'Finds the bounding box of the content on each page and trims the rest, keeping an 8 pt border.');
    const manual = h('div', { class: 'grid2' }, mkNum('t', 'Top'), mkNum('r', 'Right'), mkNum('b', 'Bottom'), mkNum('l', 'Left'));
    const sw = (v) => { mode = v; manual.style.display = v === 'manual' ? '' : 'none'; auto.style.display = v === 'auto' ? '' : 'none'; };
    const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Applies to ' + (indices && indices.length ? indices.length + ' selected page(s)' : 'all pages') + '.'), U.seg([{ v: 'manual', label: 'Margins' }, { v: 'auto', label: 'Auto-trim whitespace' }], 'manual', sw), manual, auto);
    sw('manual');
    const ok = await PD.modal({ title: 'Crop pages', icon: 'crop', content: body, buttons: [{ label: 'Cancel', value: false }, { label: 'Crop', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Cropping…', async (b) => {
      const baked = await PD.pdf.bake(d); const probe = mode === 'auto' ? await pdfjsLib.getDocument({ data: baked.slice(), password: d.pw || '' }).promise : null;
      await PD.pdf.edit(d, 'Crop pages', async (pdf) => {
        const pages = pdf.getPages();
        for (let k = 0; k < idxAll.length; k++) {
          const i = idxAll[k]; const pg = pages[i]; const jp = await d.page(i); const vp = jp.getViewport({ scale: 1 });
          let box = { x: m.l, y: m.t, w: vp.width - m.l - m.r, h: vp.height - m.t - m.b };
          if (mode === 'auto') {
            b.set(k / idxAll.length, 'Analyzing page ' + (i + 1));
            const sc = 0.5; const c = await T.renderToCanvas(probe, i, sc); const ctx = c.getContext('2d'); const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const p = (y * c.width + x) * 4; if (data[p] < 245 || data[p + 1] < 245 || data[p + 2] < 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
            if (x1 <= x0 || y1 <= y0) continue; const pad = 8;
            box = { x: Math.max(0, x0 / sc - pad), y: Math.max(0, y0 / sc - pad), w: 0, h: 0 }; box.w = Math.min(vp.width, x1 / sc + pad) - box.x; box.h = Math.min(vp.height, y1 / sc + pad) - box.y;
          }
          if (box.w < 20 || box.h < 20) continue;
          const p1 = vp.convertToPdfPoint(box.x, box.y), p2 = vp.convertToPdfPoint(box.x + box.w, box.y + box.h);
          const x = Math.min(p1[0], p2[0]), y = Math.min(p1[1], p2[1]), w = Math.abs(p2[0] - p1[0]), hh = Math.abs(p2[1] - p1[1]);
          pg.setCropBox(x, y, w, hh); pg.setMediaBox(x, y, w, hh);
        }
      });
      if (probe) probe.destroy();
    });
    PD.toast('Pages cropped', 'ok');
  };

  const SIZES = { A5: [419.5, 595.3], A4: [595.3, 841.9], A3: [841.9, 1190.6], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224] };
  T.resize = async function () {
    const d = need(); if (!d) return; let size = 'A4', fit = 'fit';
    const ok = await PD.modal({ title: 'Change page size', icon: 'full', content: h('div', { class: 'stack' }, field('Target size', U.select(Object.keys(SIZES).map((k) => ({ v: k, label: k + ' (' + Math.round(SIZES[k][0]) + ' × ' + Math.round(SIZES[k][1]) + ' pt)' })), size, (v) => (size = v))), field('Content', U.select([{ v: 'fit', label: 'Scale to fit (keep proportions)' }, { v: 'fill', label: 'Stretch to fill' }], fit, (v) => (fit = v))), h('p', { class: 'muted small' }, 'Pages are redrawn at the new size. Links and form fields on resized pages are not preserved.')),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Resize', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Resizing…', () => PD.pdf.edit(d, 'Resize pages', async (pdf) => {
      const out = await L.PDFDocument.create(); const src = pdf.getPages();
      for (let i = 0; i < src.length; i++) {
        const sp = src[i]; const vw = d.info[i].w, vh = d.info[i].h; let [tw, th] = SIZES[size]; if (vw > vh) [tw, th] = [th, tw];
        const [emb] = await out.embedPdf(pdf, [i]);
        const np = out.addPage([tw, th]); const ew = emb.width, eh = emb.height;
        if (fit === 'fill') np.drawPage(emb, { x: 0, y: 0, width: tw, height: th });
        else { const s = Math.min(tw / ew, th / eh); np.drawPage(emb, { x: (tw - ew * s) / 2, y: (th - eh * s) / 2, width: ew * s, height: eh * s }); }
      }
      // swap contents of pdf for out
      const bytes = await out.save(); const fresh = await L.PDFDocument.load(bytes);
      for (let i = pdf.getPageCount() - 1; i >= 0; i--) pdf.removePage(i);
      (await pdf.copyPages(fresh, fresh.getPageIndices())).forEach((p) => pdf.addPage(p));
    }));
    PD.toast('Pages resized to ' + size, 'ok');
  };

  /* ---------- forms ---------- */
  const fieldType = (f) => (f instanceof L.PDFTextField ? 'TextField' : f instanceof L.PDFCheckBox ? 'CheckBox' : f instanceof L.PDFDropdown ? 'Dropdown' : f instanceof L.PDFOptionList ? 'OptionList' : f instanceof L.PDFRadioGroup ? 'RadioGroup' : f instanceof L.PDFButton ? 'Button' : f instanceof L.PDFSignature ? 'Signature' : 'Field');
  T.formFields = async function (doc) {
    if (doc._ff && doc._ff.bytes === doc.bytes) return doc._ff.list;
    let list = [];
    try {
      const pdf = await PD.pdf.load(doc.bytes); const form = pdf.getForm();
      list = form.getFields().map((f) => {
        const type = fieldType(f);
        const o = { name: f.getName(), type };
        try {
          if (type === 'TextField') o.value = f.getText() || '';
          else if (type === 'CheckBox') o.value = f.isChecked();
          else if (type === 'Dropdown' || type === 'OptionList') { o.options = f.getOptions(); o.value = (f.getSelected() || [])[0] || ''; }
          else if (type === 'RadioGroup') { o.options = f.getOptions(); o.value = f.getSelected() || ''; }
        } catch (e) { /* ignore */ }
        return o;
      });
    } catch (e) { list = []; }
    doc._ff = { bytes: doc.bytes, list }; return list;
  };
  T.renderFormPanel = async function (root) {
    root.innerHTML = '';
    const d = PD.cur; if (!d) return;
    const fields = await T.formFields(d);
    root.appendChild(h('div', { class: 'insp-title' }, h('span', { class: 'chip' }, 'Form fields'), h('span', { class: 'muted small' }, fields.length + ' found')));
    if (!fields.length) { root.appendChild(h('div', { class: 'empty-note' }, h('span', { html: PD.ic('form', 28, 1.4) }), h('b', null, 'No fillable fields'), h('small', null, 'This PDF has no interactive fields. Use the tools above to add text fields, checkboxes and dropdowns.'))); return; }
    const vals = {};
    fields.forEach((f) => {
      vals[f.name] = f.value; let ctl;
      if (f.type === 'TextField') { ctl = h('input', { class: 'input', value: f.value || '' }); ctl.addEventListener('input', () => (vals[f.name] = ctl.value)); }
      else if (f.type === 'CheckBox') ctl = U.check('Checked', f.value, (v) => (vals[f.name] = v));
      else if (f.type === 'Dropdown' || f.type === 'OptionList' || f.type === 'RadioGroup') ctl = U.select([''].concat(f.options || []), f.value, (v) => (vals[f.name] = v));
      else ctl = h('span', { class: 'muted small' }, f.type + ' (not editable)');
      root.appendChild(h('div', { class: 'ffield' }, h('label', null, f.name), ctl));
    });
    root.appendChild(h('div', { class: 'btnrow sticky' },
      h('button', { class: 'btn primary', html: PD.ic('check', 16) + '<span>Apply values</span>', onclick: async () => { await T.applyForm(vals, false); } }),
      h('button', { class: 'btn', html: PD.ic('flatten', 16) + '<span>Fill & flatten</span>', onclick: async () => { await T.applyForm(vals, true); } })));
  };
  T.applyForm = async function (vals, flatten) {
    const d = need(); if (!d) return;
    await PD.pdf.edit(d, flatten ? 'Flatten form' : 'Fill form', async (pdf) => {
      const form = pdf.getForm();
      for (const f of form.getFields()) {
        const v = vals[f.getName()]; if (v === undefined) continue; const type = fieldType(f);
        try {
          if (type === 'TextField') f.setText(String(v)); else if (type === 'CheckBox') v ? f.check() : f.uncheck();
          else if (type === 'Dropdown') { if (v) f.select(v); else f.clear(); } else if (type === 'RadioGroup') { if (v) f.select(v); } else if (type === 'OptionList') { if (v) f.select(v); }
        } catch (e) { console.warn('field', f.getName(), e); }
      }
      if (flatten) form.flatten();
    });
    PD.toast(flatten ? 'Form filled and flattened' : 'Form values applied', 'ok');
    PD.emit('forms:refresh');
  };
  T.flattenForms = async function () { const d = need(); if (!d) return; await PD.pdf.edit(d, 'Flatten form', (pdf) => { pdf.getForm().flatten(); }); PD.toast('Form fields flattened', 'ok'); };

  /* ---------- password protection ---------- */
  T.protectDialog = async function () {
    const d = need(); if (!d) return;
    const o = { user: '', user2: '', owner: '' };
    const perms = { print: true, hiprint: true, copy: true, modify: true, annotate: true, fill: true, assemble: true };
    const pw = (k, ph) => { const i = h('input', { class: 'input', type: 'password', placeholder: ph || '', autocomplete: 'new-password' }); i.addEventListener('input', () => (o[k] = i.value)); return i; };
    const body = h('div', { class: 'stack' },
      field('Password to open the document', pw('user', 'Leave empty to let anyone open it')), field('Confirm password', pw('user2')),
      field('Owner password (needed to change these permissions)', pw('owner', 'Optional — a random one is used if blank')),
      h('div', { class: 'insp-h' }, 'Allow readers to'),
      h('div', { class: 'perm-grid' }, [['print', 'Print'], ['hiprint', 'Print in high quality'], ['copy', 'Copy text & images'], ['modify', 'Edit content'], ['annotate', 'Add comments'], ['fill', 'Fill in forms'], ['assemble', 'Rearrange pages']].map(([k, l]) => U.check(l, true, (v) => (perms[k] = v)))),
      h('p', { class: 'muted small' }, 'AES-256 encryption. A protected copy is saved as a new file — your open document is not changed. Remember the password: it cannot be recovered.'));
    const res = await PD.modal({ title: 'Protect with password', icon: 'key', wide: true, content: body,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Protect & save copy', kind: 'primary', icon: 'lock', run: async () => {
        if (!o.user && !o.owner && Object.values(perms).every(Boolean)) { PD.toast('Set a password or restrict at least one permission', 'error'); return false; }
        if (o.user !== o.user2) { PD.toast('The two passwords do not match', 'error'); return false; }
        return true;
      } }] });
    if (!res) return;
    await PD.withBusy('Encrypting…', async () => {
      const bytes = await PD.pdf.bake(d); const out = await PD.pdf.encrypt(bytes, o.user, o.owner, perms);
      // verify the result opens with the password before handing it over
      const t = pdfjsLib.getDocument({ data: out.slice(), password: o.user, standardFontDataUrl: 'lib/standard_fonts/' }); const chk = await t.promise; const okPages = chk.numPages === d.n; chk.destroy();
      if (!okPages) throw new Error('Verification failed — the protected file was not saved');
      await PD.saveAs(out, PD.baseName(d.name) + ' (protected).pdf', { mime: 'application/pdf', desc: 'Protected PDF' });
      PD.toast('Protected copy created', 'ok');
    });
  };
  T.unlock = async function () {
    const d = need(); if (!d) return;
    const ok = await PD.confirm('Remove protection?', 'Pages are rebuilt as images (with a hidden text layer so search still works) and the password and restrictions are dropped.', 'Remove protection');
    if (!ok) return;
    await PD.withBusy('Removing protection…', async () => { const out = await T.rasterBytes(d, { dpi: 170, quality: 0.92, bake: false, keepText: true }); d.pw = null; await d.commit(out, 'Remove protection'); });
    PD.toast('Protection removed', 'ok');
  };
  T.flattenAnnotations = async function () {
    const d = need(); if (!d) return;
    if (!d.objCount()) { PD.toast('There are no annotations to flatten', 'info'); return; }
    await PD.pdf.edit(d, 'Flatten annotations', () => {}); PD.toast('Annotations merged into the page content', 'ok');
  };

  /* ---------- read aloud ---------- */
  let speaking = false;
  T.readAloud = async function () {
    const d = need(); if (!d) return;
    const ss = window.speechSynthesis;
    if (!ss) { PD.toast('Speech is not available on this system', 'error'); return; }
    if (speaking) { speaking = false; ss.cancel(); document.body.classList.remove('reading'); PD.toast('Stopped reading', 'info'); return; }
    // voices load lazily in Chromium
    let voices = ss.getVoices();
    if (!voices.length) { await new Promise((r) => { ss.onvoiceschanged = r; setTimeout(r, 800); }); voices = ss.getVoices(); }
    const voice = voices.find((v) => /^en/i.test(v.lang) && /natural|online/i.test(v.name)) || voices.find((v) => /^en/i.test(v.lang)) || voices[0] || null;
    speaking = true; document.body.classList.add('reading'); ss.cancel();
    PD.toast('Reading aloud from page ' + (d.cur + 1) + ' — click “Read aloud” again to stop', 'info');
    let any = false;
    for (let i = d.cur; i < d.n && speaking; i++) {
      const pt = await PD.viewer.pageText(d, i); const text = pt.text.replace(/\s+/g, ' ').trim(); if (!text) continue;
      any = true; PD.viewer.goto(i, true);
      // short chunks: Chromium silently stops long utterances
      const chunks = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
      const parts = []; let cur = '';
      chunks.forEach((c) => { if ((cur + c).length > 220) { if (cur) parts.push(cur); cur = c; } else cur += c; }); if (cur) parts.push(cur);
      for (const part of parts) {
        if (!speaking) break;
        await new Promise((res) => { const u = new SpeechSynthesisUtterance(part); if (voice) { u.voice = voice; u.lang = voice.lang; } u.onend = res; u.onerror = res; ss.speak(u); });
      }
    }
    if (!any && speaking) PD.toast('No readable text found. Run OCR first for scanned pages.', 'error');
    speaking = false; document.body.classList.remove('reading');
  };

  /* ---------- sanitize ---------- */
  T.sanitize = async function () {
    const d = need(); if (!d) return;
    const ok = await PD.confirm('Remove hidden data?', 'Strips metadata, JavaScript, embedded files, and document-level actions. Visible content is unchanged.', 'Sanitize');
    if (!ok) return;
    await PD.pdf.edit(d, 'Sanitize', (pdf) => {
      pdf.setTitle(''); pdf.setAuthor(''); pdf.setSubject(''); pdf.setKeywords([]); pdf.setCreator(''); pdf.setProducer('PDF Do');
      const cat = pdf.catalog;
      ['Metadata', 'OpenAction', 'AA', 'Names', 'PieceInfo', 'StructTreeRoot'].forEach((k) => cat.delete(L.PDFName.of(k)));
      pdf.getPages().forEach((p) => { try { p.node.delete(L.PDFName.of('AA')); p.node.delete(L.PDFName.of('PieceInfo')); } catch (e) { /* ignore */ } });
    });
    PD.toast('Hidden data removed', 'ok');
  };

  /* ---------- document actions ---------- */
  T.duplicateDoc = async function () { const d = need(); if (!d) return; const bytes = await PD.pdf.bake(d); await PD.openBytes(bytes, PD.baseName(d.name) + ' copy.pdf', null, { dirty: true }); };
  T.rename = async function () { const d = need(); if (!d) return; const n = await PD.prompt('Rename document', 'File name', PD.baseName(d.name)); if (n) { d.name = n.replace(/\.pdf$/i, '') + '.pdf'; PD.emit('docs:changed'); } };
  T.print = async function () {
    const d = need(); if (!d) return;
    await PD.withBusy('Preparing print preview…', async (b) => {
      const bytes = await PD.pdf.bake(d); const pd = await pdfjsLib.getDocument({ data: bytes.slice(), password: d.pw || '' }).promise;
      const root = PD.$('#printroot'); root.innerHTML = '';
      for (let i = 0; i < pd.numPages; i++) {
        b.set(i / pd.numPages, 'Page ' + (i + 1) + ' of ' + pd.numPages);
        const c = await T.renderToCanvas(pd, i, 150 / 72); const img = new Image(); img.src = c.toDataURL('image/jpeg', 0.92); await img.decode().catch(() => {});
        const pg = await pd.getPage(i + 1); const vp = pg.getViewport({ scale: 1 });
        img.style.cssText = 'display:block;width:100%;height:auto;page-break-after:always;break-after:page;'; const wrap = h('div', { class: 'printpage', 'data-w': vp.width, 'data-h': vp.height }, img); root.appendChild(wrap);
      }
      pd.destroy();
    });
    setTimeout(() => { window.print(); }, 100);
  };
})();
