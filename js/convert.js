/* PDF Do — convert: PDF↔images, text/Markdown/HTML/Word export, OCR, text→PDF, blank document */
(function () {
  'use strict';
  const PD = window.PD;
  const L = window.PDFLib;
  const { h } = PD;
  const U = PD.ui;
  const Cv = (PD.convert = {});
  const need = () => { if (!PD.cur) { PD.toast('Open a PDF first', 'info'); return null; } return PD.cur; };
  const field = (label, ctl) => h('label', { class: 'field' }, h('span', null, label), ctl);

  /* ---------- PDF → images ---------- */
  Cv.pdfToImages = async function () {
    const d = need(); if (!d) return;
    const o = { fmt: 'png', dpi: 150, range: 'all', q: 0.9 };
    const rng = h('input', { class: 'input', value: 'all' }); rng.addEventListener('input', () => (o.range = rng.value));
    const ok = await PD.modal({ title: 'PDF to images', icon: 'image', sub: d.n + ' pages in ' + d.name,
      content: h('div', { class: 'stack' }, field('Format', U.seg([{ v: 'png', label: 'PNG' }, { v: 'jpeg', label: 'JPG' }], o.fmt, (v) => (o.fmt = v))), field('Resolution', U.select([{ v: 72, label: '72 dpi — screen' }, { v: 150, label: '150 dpi — standard' }, { v: 220, label: '220 dpi — sharp' }, { v: 300, label: '300 dpi — print' }, { v: 450, label: '450 dpi — poster' }], 150, (v) => (o.dpi = +v))), field('Pages', rng), field('JPG quality', U.range(0.5, 1, 0.05, 0.9, (v) => (o.q = v), (v) => Math.round(v * 100) + '%'))),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Convert', kind: 'primary', value: true }] });
    if (!ok) return;
    const idx = PD.parseRange(o.range, d.n); if (!idx.length) { PD.toast('No valid pages in that range', 'error'); return; }
    await PD.withBusy('Rendering pages…', async (b) => {
      const bytes = await PD.pdf.bake(d); const pd = await pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: d.pw || '' }).promise;
      const files = []; const pad = String(d.n).length; const ext = o.fmt === 'png' ? 'png' : 'jpg';
      for (let k = 0; k < idx.length; k++) {
        b.set(k / idx.length, 'Page ' + (idx[k] + 1), k + 1 + ' of ' + idx.length);
        const c = await PD.tools.renderToCanvas(pd, idx[k], o.dpi / 72);
        files.push({ name: PD.baseName(d.name) + ' - page ' + String(idx[k] + 1).padStart(pad, '0') + '.' + ext, data: await PD.canvasToBytes(c, 'image/' + o.fmt, o.q) }); c.width = c.height = 0;
      }
      pd.destroy();
      if (files.length === 1) await PD.saveAs(new Blob([files[0].data], { type: 'image/' + o.fmt }), files[0].name, { mime: 'image/' + o.fmt, desc: 'Image' });
      else await PD.saveAs(PD.zip(files), PD.baseName(d.name) + ' (images).zip', { mime: 'application/zip', desc: 'ZIP archive' });
      PD.toast('Exported ' + files.length + ' image' + (files.length > 1 ? 's' : ''), 'ok');
    });
  };

  /* ---------- images → PDF ---------- */
  Cv.imagesToPdf = async function (preFiles) {
    const files = preFiles || (await PD.pickFiles({ accept: '.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*', multiple: true, desc: 'Images', legacy: true })); if (!files.length) return;
    const items = []; for (const f of files) items.push({ name: f.file.name, file: f.file, url: URL.createObjectURL(f.file) });
    const o = { size: 'fit', orient: 'auto', margin: 0 };
    const list = h('div', { class: 'img-list' });
    const draw = () => { list.innerHTML = ''; items.forEach((it, k) => list.appendChild(h('div', { class: 'img-item' }, h('img', { src: it.url }), h('span', null, it.name), h('div', { class: 'mc-acts' }, h('button', { class: 'icon-btn', html: PD.ic('up', 14), onclick: () => { if (k) { [items[k - 1], items[k]] = [items[k], items[k - 1]]; draw(); } } }), h('button', { class: 'icon-btn', html: PD.ic('down', 14), onclick: () => { if (k < items.length - 1) { [items[k + 1], items[k]] = [items[k], items[k + 1]]; draw(); } } }), h('button', { class: 'icon-btn', html: PD.ic('x', 14), onclick: () => { items.splice(k, 1); draw(); } }))))); };
    draw();
    const ok = await PD.modal({ title: 'Images to PDF', icon: 'image', wide: true, sub: 'Each image becomes one page, in this order.',
      content: h('div', { class: 'stack' }, list, h('div', { class: 'grid3' }, field('Page size', U.select([{ v: 'fit', label: 'Fit to image' }, { v: 'A4', label: 'A4' }, { v: 'Letter', label: 'US Letter' }, { v: 'A5', label: 'A5' }], 'fit', (v) => (o.size = v))), field('Orientation', U.select([{ v: 'auto', label: 'Auto' }, { v: 'portrait', label: 'Portrait' }, { v: 'landscape', label: 'Landscape' }], 'auto', (v) => (o.orient = v))), field('Margin (pt)', U.num(0, (v) => (o.margin = Math.max(0, v)), { min: 0, max: 100 })))),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Create PDF', kind: 'primary', value: true }] });
    if (!ok || !items.length) return;
    await PD.withBusy('Building PDF…', async (b) => {
      const out = await L.PDFDocument.create(); const SZ = { A4: [595.3, 841.9], Letter: [612, 792], A5: [419.5, 595.3] };
      for (let k = 0; k < items.length; k++) {
        b.set(k / items.length, 'Adding ' + items[k].name);
        const f = items[k].file; let bytes = await PD.readFile(f); let img;
        const type = f.type || '';
        try { img = /png/.test(type) ? await out.embedPng(bytes) : /jpe?g/.test(type) ? await out.embedJpg(bytes) : null; } catch (e) { img = null; }
        if (!img) { const im = await PD.loadImage(items[k].url); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); img = await out.embedPng(await PD.canvasToBytes(c)); }
        let pw, ph;
        if (o.size === 'fit') { pw = img.width * 0.75 + o.margin * 2; ph = img.height * 0.75 + o.margin * 2; const mx = Math.max(pw, ph); if (mx > 1700) { pw *= 1700 / mx; ph *= 1700 / mx; } }
        else { [pw, ph] = SZ[o.size]; const land = o.orient === 'landscape' || (o.orient === 'auto' && img.width > img.height); if (land !== pw > ph) [pw, ph] = [ph, pw]; if (o.orient === 'portrait' && pw > ph) [pw, ph] = [ph, pw]; }
        const page = out.addPage([pw, ph]); const aw = pw - o.margin * 2, ah = ph - o.margin * 2; const s = Math.min(aw / img.width, ah / img.height);
        page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
      }
      out.setProducer('PDF Do'); out.setTitle('Images');
      await PD.openBytes(await out.save(), 'Images.pdf', null, { dirty: true }); PD.setMode('read'); PD.toast('Created a ' + items.length + '-page PDF', 'ok');
    });
    items.forEach((it) => URL.revokeObjectURL(it.url));
  };

  /* ---------- extract embedded images ---------- */
  Cv.extractImages = async function () {
    const d = need(); if (!d) return;
    const o = { range: 'all', min: 40 };
    const rng = h('input', { class: 'input', value: 'all' }); rng.addEventListener('input', () => (o.range = rng.value));
    const ok = await PD.modal({ title: 'Extract images', icon: 'image', sub: 'Saves the pictures embedded in the document as PNG files.', content: h('div', { class: 'stack' }, field('Pages', rng), field('Ignore images smaller than (px)', U.num(40, (v) => (o.min = v), { min: 0, max: 2000 }))), buttons: [{ label: 'Cancel', value: false }, { label: 'Extract', kind: 'primary', value: true }] });
    if (!ok) return;
    const idx = PD.parseRange(o.range, d.n); const OPS = pdfjsLib.OPS;
    await PD.withBusy('Looking for images…', async (b) => {
      const bytes = await PD.pdf.bake(d); const pd = await pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: d.pw || '' }).promise;
      const files = []; const seen = new Set();
      for (let k = 0; k < idx.length; k++) {
        b.set(k / idx.length, 'Page ' + (idx[k] + 1), files.length + ' images so far');
        const page = await pd.getPage(idx[k] + 1); const ops = await page.getOperatorList(); let n = 0;
        for (let q = 0; q < ops.fnArray.length; q++) {
          const fn = ops.fnArray[q]; if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;
          let img;
          if (fn === OPS.paintInlineImageXObject) img = ops.argsArray[q][0];
          else { const id = ops.argsArray[q][0]; if (seen.has(id)) continue; seen.add(id); const store = /^g_/.test(id) ? page.commonObjs : page.objs; img = await new Promise((res) => { try { if (store.has(id)) res(store.get(id)); else store.get(id, res); } catch (e) { res(null); } }); }
          if (!img || !img.width || img.width < o.min || img.height < o.min) continue;
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d');
          if (img.bitmap) x.drawImage(img.bitmap, 0, 0);
          else if (img.data) {
            const id2 = x.createImageData(img.width, img.height); const dd = id2.data, s = img.data;
            if (img.kind === 3 || s.length === img.width * img.height * 4) dd.set(s.subarray(0, dd.length));
            else if (img.kind === 2 || s.length === img.width * img.height * 3) { for (let a = 0, bI = 0; a < dd.length; a += 4, bI += 3) { dd[a] = s[bI]; dd[a + 1] = s[bI + 1]; dd[a + 2] = s[bI + 2]; dd[a + 3] = 255; } }
            else { const rowBytes = (img.width + 7) >> 3; for (let yy = 0; yy < img.height; yy++) for (let xx = 0; xx < img.width; xx++) { const bit = (s[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1; const p = (yy * img.width + xx) * 4; dd[p] = dd[p + 1] = dd[p + 2] = bit ? 255 : 0; dd[p + 3] = 255; } }
            x.putImageData(id2, 0, 0);
          } else continue;
          files.push({ name: PD.baseName(d.name) + ' - p' + (idx[k] + 1) + ' img' + ++n + '.png', data: await PD.canvasToBytes(c, 'image/png') }); c.width = c.height = 0;
        }
      }
      pd.destroy();
      if (!files.length) { PD.toast('No embedded images found in those pages', 'info'); return; }
      if (files.length === 1) await PD.saveAs(new Blob([files[0].data], { type: 'image/png' }), files[0].name, { mime: 'image/png', desc: 'PNG image' });
      else await PD.saveAs(PD.zip(files), PD.baseName(d.name) + ' (images).zip', { mime: 'application/zip', desc: 'ZIP archive' });
      PD.toast('Extracted ' + files.length + ' image' + (files.length > 1 ? 's' : ''), 'ok');
    });
  };

  /* ---------- Word export through the bundled local service (PyMuPDF layout engine + Tesseract OCR) ---------- */
  Cv.docxViaService = async function (d) {
    const o = { ocr: 'auto', lang: 'eng', pages: 'all', math: true, tables: true, engine: 'layout' };
    const rng = h('input', { class: 'input', value: 'all' }); rng.addEventListener('input', () => (o.pages = rng.value));
    const lang = h('input', { class: 'input', value: 'eng' }); lang.addEventListener('input', () => (o.lang = lang.value.trim() || 'eng'));
    const ok = await PD.modal({ title: 'Export as Word document', icon: 'file', sub: 'High-fidelity engine: columns, tables, images, fonts and OCR for scanned pages. Runs on this computer.',
      content: h('div', { class: 'stack' },
        field('Engine', U.seg([{ v: 'layout', label: 'Layout-preserved (recommended)' }, { v: 'service', label: 'Reflowing Word' }, { v: 'quick', label: 'Quick (built-in)' }], 'layout', (v) => (o.engine = v))),
        field('Pages', rng),
        field('Scanned pages (OCR)', U.select([{ v: 'auto', label: 'Automatic — OCR only scanned pages' }, { v: 'always', label: 'Always OCR every page' }, { v: 'never', label: 'Never — keep page pictures' }], 'auto', (v) => (o.ocr = v))),
        field('OCR language code(s), e.g. eng or eng+hin', lang),
        U.check('Detect tables', true, (v) => (o.tables = v)), U.check('Keep equations as sharp pictures', true, (v) => (o.math = v)),
        h('p', { class: 'muted small' }, 'Layout-preserved: same page count and placement as the PDF; text stays editable text. Reflowing Word: real paragraphs, columns and tables, but page breaks can shift. Equations and diagrams are pictures in both.')),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Export', kind: 'primary', value: true }] });
    if (!ok) return;
    if (o.engine === 'quick') { PD.svc.ready = false; try { await Cv.textExport('docx'); } finally { PD.svc.ready = true; } return; }
    const idx = PD.parseRange(o.pages, d.n); const pages = o.pages.trim().toLowerCase() === 'all' ? '' : idx.map((i) => i + 1).join(',');
    try {
      await PD.withBusy('Converting to Word…', async (b) => {
        const bytes = await PD.pdf.bake(d);
        const r = await PD.svc.convertDocx(bytes, d.name, { ocr: o.ocr, lang: o.lang, pages, mode: o.engine === 'service' ? 'editable' : 'layout', math_as_image: o.math, tables: o.tables }, b);
        await PD.saveAs(r.blob, PD.baseName(d.name) + '.docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', desc: 'Word document' });
        const R = r.report || {};
        PD.toast('Exported ' + (R.pages || '') + ' pages · ' + (R.tables || 0) + ' tables' + (R.ocr_pages ? ' · OCR on ' + R.ocr_pages : ''), 'ok');
        (R.warnings || []).slice(0, 2).forEach((w) => PD.toast(w, 'info', 6000));
      });
    } catch (e) { /* withBusy already showed the error */ }
  };

  /* ---------- structured text extraction ---------- */
  async function structure(d, idx, busy) {
    const pages = []; const sizes = [];
    for (let k = 0; k < idx.length; k++) {
      if (busy) busy.set(k / idx.length, 'Reading page ' + (idx[k] + 1));
      const lines = await PD.annot.textLines(d, idx[k]); lines.forEach((l) => sizes.push(l.fs));
      pages.push({ i: idx[k], lines });
    }
    sizes.sort((a, b) => a - b); const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
    const paras = pages.map((pg) => {
      const out = []; let cur = null;
      pg.lines.forEach((l) => {
        const gap = cur ? l.baseY - cur.baseY : 1e9; const level = l.fs > body * 1.55 ? 1 : l.fs > body * 1.3 ? 2 : l.fs > body * 1.12 ? 3 : 0;
        if (cur && gap > 0 && gap < Math.max(cur.fs, l.fs) * 1.7 && level === cur.level && gap < 200) { cur.text += (cur.text.endsWith('-') ? '' : ' ') + l.str; cur.baseY = l.baseY; }
        else { cur = { text: l.str, level, fs: l.fs, baseY: l.baseY }; out.push(cur); }
      });
      return out;
    });
    return { pages, paras, body };
  }
  Cv.textExport = async function (fmt) {
    const d = need(); if (!d) return;
    if (fmt === 'docx' && PD.svc && PD.svc.ready) { await Cv.docxViaService(d); return; }
    const rng = h('input', { class: 'input', value: 'all' }); let dmode = 'auto';
    const names = { txt: 'Plain text', md: 'Markdown', html: 'Web page (HTML)', docx: 'Word document' };
    const ok = await PD.modal({ title: 'Export as ' + names[fmt], icon: 'file', content: h('div', { class: 'stack' }, field('Pages', rng), fmt === 'docx' ? field('Layout', PD.ui.seg([{ v: 'auto', label: 'Editable (recommended)' }, { v: 'exact', label: 'Exact positions (text boxes)' }], 'auto', (v) => (dmode = v))) : null, fmt === 'docx' ? h('p', { class: 'muted small' }, 'Keeps fonts, sizes, bold / italic, colors, alignment, columns and pictures. Editable rebuilds real Word paragraphs and columns you can type into, with pictures and equations placed inline. Exact pins every line in a text box — closest to the PDF but awkward to edit.') : null, h('p', { class: 'muted small' }, 'Text is read from the PDF’s text layer. For scanned pages, run OCR first.')), buttons: [{ label: 'Cancel', value: false }, { label: 'Export', kind: 'primary', value: true }] });
    if (!ok) return;
    const idx = PD.parseRange(rng.value, d.n);
    if (fmt === 'docx') {
      await PD.withBusy('Building Word document…', async (b) => {
        const r = await PD.docx.build(d, idx, dmode, b);
        if (!r.words && !r.images) { PD.toast('No selectable text or pictures found — try OCR first', 'error'); return; }
        await PD.saveAs(r.blob, PD.baseName(d.name) + '.docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', desc: 'Word document' });
        PD.toast('Exported ' + r.words + ' words and ' + r.images + ' picture' + (r.images === 1 ? '' : 's'), 'ok');
      });
      return;
    }
    await PD.withBusy('Extracting text…', async (b) => {
      const st = await structure(d, idx, b); const total = st.paras.reduce((s, p) => s + p.length, 0);
      if (!total) { PD.toast('No selectable text found — try OCR', 'error'); return; }
      let data, mime;
      if (fmt === 'txt') { data = st.paras.map((p) => p.map((q) => q.text).join('\n\n')).join('\n\n\f\n\n'); mime = 'text/plain'; }
      else if (fmt === 'md') { data = st.paras.map((p) => p.map((q) => (q.level ? '#'.repeat(q.level) + ' ' : '') + q.text).join('\n\n')).join('\n\n---\n\n'); mime = 'text/markdown'; }
      else if (fmt === 'html') {
        data = '<!doctype html><html><head><meta charset="utf-8"><title>' + PD.esc(PD.baseName(d.name)) + '</title><style>body{font:16px/1.6 Georgia,serif;max-width:46em;margin:3em auto;padding:0 1em;color:#222}h1,h2,h3{font-family:system-ui;line-height:1.25}hr{margin:3em 0;border:0;border-top:1px solid #ddd}</style></head><body>' +
          st.paras.map((p, k) => p.map((q) => (q.level ? '<h' + q.level + '>' + PD.esc(q.text) + '</h' + q.level + '>' : '<p>' + PD.esc(q.text) + '</p>')).join('\n')).join('\n<hr>\n') + '</body></html>'; mime = 'text/html';
      } else {
        const x = (s) => PD.esc(s);
        const body = st.paras.map((p, k) => p.map((q) => { const sz = Math.round(q.fs * 2); const bold = q.level ? '<w:b/>' : ''; return '<w:p><w:pPr><w:spacing w:after="140"/></w:pPr><w:r><w:rPr>' + bold + '<w:sz w:val="' + Math.max(16, Math.min(72, q.level ? sz : Math.round(st.body * 2))) + '"/></w:rPr><w:t xml:space="preserve">' + x(q.text) + '</w:t></w:r></w:p>'; }).join('') + (k < st.paras.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '')).join('');
        const enc = new TextEncoder();
        const files = [
          { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
          { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
          { name: 'word/document.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>') },
        ];
        data = PD.zip(files); mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      await PD.saveAs(data instanceof Blob ? data : new Blob([data], { type: mime + ';charset=utf-8' }), PD.baseName(d.name) + '.' + fmt, { mime, desc: names[fmt] });
      PD.toast('Exported ' + names[fmt], 'ok');
    });
  };

  /* ---------- OCR ---------- */
  let worker = null;
  async function getWorker(onProgress) {
    if (worker) { worker._cb = onProgress; return worker; }
    let w = null;
    w = worker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'lib/tess/worker.min.js', corePath: 'lib/tess/core.wasm.js', langPath: 'lib/tess/lang', gzip: true, workerBlobURL: false,
      logger: (m) => { if (worker && worker._cb && m.status === 'recognizing text') worker._cb(m.progress); },
    });
    w._cb = onProgress; return w;
  }
  Cv.ocr = async function () {
    const d = need(); if (!d) return;
    const o = { range: 'all', dpi: 200, searchable: true };
    const rng = h('input', { class: 'input', value: 'all' }); rng.addEventListener('input', () => (o.range = rng.value));
    const ok = await PD.modal({ title: 'Recognize text (OCR)', icon: 'scan', sub: 'Runs entirely on this computer. English is built in.',
      content: h('div', { class: 'stack' }, field('Pages', rng), field('Scan quality', U.select([{ v: 150, label: '150 dpi — fast' }, { v: 200, label: '200 dpi — recommended' }, { v: 300, label: '300 dpi — best for small print' }], 200, (v) => (o.dpi = +v))), U.check('Make the PDF searchable (adds an invisible text layer)', true, (v) => (o.searchable = v))),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Start OCR', kind: 'primary', value: true }] });
    if (!ok) return;
    const idx = PD.parseRange(o.range, d.n); if (!idx.length) return;
    const results = [];
    try {
      await PD.withBusy('Preparing OCR engine…', async (b) => {
        const wk = await getWorker((p) => b.set(null, null, Math.round(p * 100) + '% of current page'));
        const baked = await PD.pdf.bake(d); const pd = await pdfjsLib.getDocument({ data: baked.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: d.pw || '' }).promise;
        for (let k = 0; k < idx.length; k++) {
          b.set(k / idx.length, 'Reading page ' + (idx[k] + 1) + ' (' + (k + 1) + ' of ' + idx.length + ')');
          const c = await PD.tools.renderToCanvas(pd, idx[k], o.dpi / 72);
          const r = await wk.recognize(c, {}, { blocks: true, text: true });
          const words = []; const blocks = (r.data.blocks || []);
          blocks.forEach((bl) => (bl.paragraphs || []).forEach((pa) => (pa.lines || []).forEach((ln) => (ln.words || []).forEach((w) => words.push({ t: w.text, b: w.bbox, c: w.confidence })))));
          results.push({ i: idx[k], text: r.data.text, words, k: 72 / o.dpi, conf: r.data.confidence }); c.width = c.height = 0;
        }
        pd.destroy();
      });
    } catch (e) { return; }
    const all = results.map((r) => '— Page ' + (r.i + 1) + ' —\n' + r.text.trim()).join('\n\n');
    const wc = results.reduce((s, r) => s + r.words.length, 0);
    const ta = h('textarea', { class: 'input ocr-out', rows: 14 }); ta.value = all;
    const res = await PD.modal({ title: 'OCR complete', icon: 'check', wide: true, sub: wc + ' words recognized on ' + results.length + ' page(s) · average confidence ' + Math.round(results.reduce((s, r) => s + (r.conf || 0), 0) / results.length) + '%', content: ta,
      buttons: [{ label: 'Copy text', value: 'copy', left: true }, { label: 'Save .txt', value: 'txt' }, o.searchable ? { label: 'Add text layer to PDF', kind: 'primary', value: 'layer' } : { label: 'Done', kind: 'primary', value: 'done' }] });
    if (res === 'copy') { await navigator.clipboard.writeText(ta.value).catch(() => {}); PD.toast('Text copied', 'ok'); }
    else if (res === 'txt') await PD.saveAs(new Blob([ta.value], { type: 'text/plain' }), PD.baseName(d.name) + ' (OCR).txt', { mime: 'text/plain', desc: 'Text' });
    else if (res === 'layer') {
      await PD.withBusy('Adding text layer…', () => PD.pdf.edit(d, 'OCR text layer', async (pdf) => {
        pdf.registerFontkit(window.fontkit); const font = await pdf.embedFont(L.StandardFonts.Helvetica); const pages = pdf.getPages();
        for (const r of results) {
          const jp = await d.page(r.i); const vp = jp.getViewport({ scale: 1 }); const pg = pages[r.i];
          r.words.forEach((w) => {
            if (!w.t || w.c < 30) return; let txt = w.t; try { font.encodeText(txt); } catch (e) { txt = txt.replace(/[^\x20-\xff]/g, ''); if (!txt) return; }
            const x0 = w.b.x0 * r.k, x1 = w.b.x1 * r.k, y1 = w.b.y1 * r.k, hh = (w.b.y1 - w.b.y0) * r.k; const tw1 = font.widthOfTextAtSize(txt, 1); if (!tw1) return;
            const size = Math.max(2, Math.min((x1 - x0) / tw1, hh * 1.3)); const p = vp.convertToPdfPoint(x0, y1 - hh * 0.2);
            pg.drawText(txt, { x: p[0], y: p[1], size, font, opacity: 0, rotate: L.degrees(-pg.getRotation().angle) });
          });
        }
      }));
      PD.toast('Text layer added — the document is now searchable', 'ok');
    }
  };

  /* ---------- text → PDF / blank ---------- */
  Cv.textToPdf = async function () {
    const f = await PD.pickFiles({ accept: '.txt,.md,.csv,.log,.json,text/plain', desc: 'Text files', legacy: true }); if (!f.length) return;
    const text = await f[0].file.text();
    const o = { font: { family: 'Inter', bold: false, italic: false }, size: 11, margin: 54, size2: 'A4' };
    const ok = await PD.modal({ title: 'Text to PDF', icon: 'file', content: h('div', { class: 'stack' }, h('p', { class: 'muted' }, f[0].file.name + ' · ' + text.length.toLocaleString() + ' characters'), field('Font', PD.fonts.picker(o.font.family, (v) => (o.font.family = v))), h('div', { class: 'grid3' }, field('Size', U.num(o.size, (v) => (o.size = v), { min: 6, max: 36 })), field('Margin (pt)', U.num(o.margin, (v) => (o.margin = v), { min: 10, max: 120 })), field('Paper', U.select(['A4', 'Letter'], 'A4', (v) => (o.size2 = v))))), buttons: [{ label: 'Cancel', value: false }, { label: 'Create PDF', kind: 'primary', value: true }] });
    if (!ok) return;
    await PD.withBusy('Typesetting…', async () => {
      const out = await L.PDFDocument.create(); out.registerFontkit(window.fontkit); const fe = await PD.fonts.embed(out, o.font); const font = fe.font;
      const [pw, ph] = o.size2 === 'A4' ? [595.3, 841.9] : [612, 792]; const mw = pw - o.margin * 2; const lh = o.size * 1.4;
      const lines = []; text.replace(/\r/g, '').replace(/\t/g, '    ').split('\n').forEach((para) => { if (!para) { lines.push(''); return; } let cur = ''; para.split(/(\s+)/).forEach((w) => { let test = cur + w; let safe = test; try { font.encodeText(safe); } catch (e) { safe = safe.replace(/[^\x20-\xff]/g, '?'); } if (cur && font.widthOfTextAtSize(safe, o.size) > mw) { lines.push(cur.trimEnd()); cur = w.trimStart(); } else cur = test; }); lines.push(cur.trimEnd()); });
      let page = out.addPage([pw, ph]), y = ph - o.margin - o.size;
      for (const ln of lines) { if (y < o.margin) { page = out.addPage([pw, ph]); y = ph - o.margin - o.size; } if (ln) { let t = ln; try { font.encodeText(t); } catch (e) { t = t.replace(/[^\x20-\xff]/g, '?'); } page.drawText(t, { x: o.margin, y, size: o.size, font }); } y -= lh; }
      out.setTitle(PD.baseName(f[0].file.name)); out.setProducer('PDF Do');
      await PD.openBytes(await out.save(), PD.baseName(f[0].file.name) + '.pdf', null, { dirty: true }); PD.setMode('read');
    });
  };
  Cv.blank = async function () {
    const o = { n: 1, size: 'A4', land: false };
    const ok = await PD.modal({ title: 'New blank PDF', icon: 'blank', content: h('div', { class: 'stack' }, h('div', { class: 'grid3' }, field('Pages', U.num(1, (v) => (o.n = Math.max(1, Math.min(500, Math.round(v)))), { min: 1, max: 500 })), field('Size', U.select(['A4', 'A5', 'A3', 'Letter', 'Legal'], 'A4', (v) => (o.size = v))), field('Orientation', U.select([{ v: 'p', label: 'Portrait' }, { v: 'l', label: 'Landscape' }], 'p', (v) => (o.land = v === 'l'))))), buttons: [{ label: 'Cancel', value: false }, { label: 'Create', kind: 'primary', value: true }] });
    if (!ok) return;
    const SZ = { A4: [595.3, 841.9], A5: [419.5, 595.3], A3: [841.9, 1190.6], Letter: [612, 792], Legal: [612, 1008] };
    const out = await L.PDFDocument.create(); let [w, hh] = SZ[o.size]; if (o.land) [w, hh] = [hh, w]; for (let i = 0; i < o.n; i++) out.addPage([w, hh]); out.setProducer('PDF Do');
    await PD.openBytes(await out.save(), 'Untitled.pdf', null, { dirty: true }); PD.setMode('edit');
  };
})();
