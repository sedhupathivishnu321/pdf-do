/* PDF Do — burn overlay objects into PDF bytes; shared pdf-lib helpers; save pipeline */
(function () {
  'use strict';
  const PD = window.PD;
  const L = window.PDFLib;
  const { rgb, degrees } = L;
  const P = (PD.pdf = {});

  const col = (hex, fb) => { if (!hex) return fb; const c = PD.hexToRgb(hex); return rgb(c[0] / 255, c[1] / 255, c[2] / 255); };
  P.col = col;

  P.load = async function (bytes) {
    try { return await L.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test((e && (e.message || e.name || e.constructor.name)) || '')) { const err = new Error('encrypted'); err.encrypted = true; throw err; }
      throw e;
    }
  };

  // Protected PDFs cannot be rewritten by pdf-lib; offer to rebuild the pages as images (with a hidden text layer)
  P.unlockFlow = async function (doc) {
    const ok = await PD.confirm('This PDF is protected', 'PDF Do cannot rewrite protected PDFs directly. It can unlock this one by rebuilding every page as an image (text stays searchable through a hidden text layer). Unlock now?', 'Unlock & continue');
    if (!ok) throw new Error('Cancelled');
    const bytes = await PD.tools.rasterBytes(doc, { dpi: 150, quality: 0.92, bake: false, keepText: true });
    doc.pw = null; await doc.commit(bytes, 'Unlock', true); return doc.bytes;
  };

  // Run a structural edit on the current document. Overlay objects are baked in first.
  P.edit = async function (doc, label, fn, opts) {
    opts = opts || {};
    let bytes;
    try { bytes = await P.bake(doc); } catch (e) { console.error(e); throw e; }
    let pdf;
    try { pdf = await P.load(bytes); }
    catch (e) {
      if (e.encrypted) { bytes = await P.unlockFlow(doc); pdf = await P.load(bytes); }
      else throw e;
    }
    const ret = await fn(pdf);
    const out = await pdf.save({ useObjectStreams: opts.objectStreams !== false });
    if (!opts.dryRun) await doc.commit(out, label);
    return opts.dryRun ? out : ret;
  };

  /* ---------- bake overlay ---------- */
  P.bake = async function (doc, opts) {
    opts = opts || {};
    if (!doc.objCount()) return doc.bytes;
    let pdf;
    try { pdf = await P.load(doc.bytes); }
    catch (e) { if (e.encrypted) { await P.unlockFlow(doc); pdf = await P.load(doc.bytes); } else throw e; }
    await P.burn(pdf, doc, opts);
    return await pdf.save();
  };

  const std = { 'Helvetica': [0.905, 0.212], 'Times Roman': [0.891, 0.216], 'Courier': [0.833, 0.3] };
  function metrics(spec, fe) {
    const fk = fe.font && fe.font.embedder && fe.font.embedder.font;
    if (fk && fk.unitsPerEm && fk.ascent != null) return [fk.ascent / fk.unitsPerEm, Math.abs(fk.descent) / fk.unitsPerEm];
    return std[spec.family] || [0.9, 0.22];
  }
  function safeText(font, s) {
    try { font.encodeText(s); return s; } catch (e) {
      let out = ''; for (const ch of s) { try { font.encodeText(ch); out += ch; } catch (e2) { out += '?'; } } return out;
    }
  }

  P.burn = async function (pdf, doc, opts) {
    opts = opts || {};
    pdf.registerFontkit(window.fontkit);
    const pages = pdf.getPages();
    const imgCache = {};
    for (const k of Object.keys(doc.ov)) {
      const i = +k; const page = pages[i]; const list = doc.ov[k]; if (!page || !list.length) continue;
      const jp = await doc.page(i); const vp = jp.getViewport({ scale: 1 });
      const toP = (x, y) => { const q = vp.convertToPdfPoint(x, y); return { x: q[0], y: q[1] }; };
      const dirAngle = (cx, cy, th) => { const a = toP(cx, cy), b = toP(cx + Math.cos(th), cy + Math.sin(th)); return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; };
      const rect2 = (x, y, w, h) => { const a = toP(x, y), b = toP(x + w, y + h); return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }; };
      // local (relative to object top-left, before rotation about centre) → pdf point
      const mkL2P = (o, W, H) => { const th = rad(o.rot || 0), cx = o.x + W / 2, cy = o.y + H / 2; return (lx, ly) => { const dx = lx - W / 2, dy = ly - H / 2; return toP(cx + dx * Math.cos(th) - dy * Math.sin(th), cy + dx * Math.sin(th) + dy * Math.cos(th)); }; };
      const poly = (pts, o) => { const d = 'M ' + pts.map((p) => p.x + ' ' + -p.y).join(' L ') + ' Z'; page.drawSvgPath(d, Object.assign({ x: 0, y: 0 }, o)); };

      for (const o of list) {
        const op = o.op != null ? o.op : 1;
        switch (o.t) {
          case 'rect': {
            const r = rect2(o.x, o.y, o.w, o.h);
            const base = { color: o.fill ? col(o.fill) : undefined, borderColor: o.stroke && o.sw ? col(o.stroke) : undefined, borderWidth: o.stroke ? o.sw || 0 : 0, opacity: o.fill ? op : 0, borderOpacity: op };
            if (o.dash) base.borderDashArray = [Math.max(3, o.sw * 3), Math.max(3, o.sw * 2)];
            if (o.rad > 0 && !(doc.info[i].rot)) {
              const rr = Math.min(o.rad, o.w / 2, o.h / 2); const w = o.w, hh = o.h;
              const d = `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${hh - rr} Q ${w} ${hh} ${w - rr} ${hh} H ${rr} Q 0 ${hh} 0 ${hh - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
              const tl = toP(o.x, o.y);
              page.drawSvgPath(d, { x: tl.x, y: tl.y, color: base.color, borderColor: base.borderColor, borderWidth: base.borderWidth, opacity: base.opacity, borderOpacity: base.borderOpacity, borderDashArray: base.borderDashArray });
            } else page.drawRectangle(Object.assign({ x: r.x, y: r.y, width: r.width, height: r.height }, base));
            break;
          }
          case 'ellipse': {
            const c = toP(o.x + o.w / 2, o.y + o.h / 2); const sw = doc.info[i].rot % 180 === 90;
            page.drawEllipse({ x: c.x, y: c.y, xScale: (sw ? o.h : o.w) / 2, yScale: (sw ? o.w : o.h) / 2, color: o.fill ? col(o.fill) : undefined, borderColor: o.stroke && o.sw ? col(o.stroke) : undefined, borderWidth: o.stroke ? o.sw || 0 : 0, opacity: o.fill ? op : 0, borderOpacity: op, borderDashArray: o.dash ? [Math.max(3, o.sw * 3), Math.max(3, o.sw * 2)] : undefined });
            break;
          }
          case 'line': case 'arrow': {
            const a = toP(o.p[0], o.p[1]), b = toP(o.p[2], o.p[3]);
            page.drawLine({ start: a, end: b, thickness: o.sw, color: col(o.stroke), opacity: op, lineCap: L.LineCapStyle.Round, dashArray: o.dash ? [Math.max(3, o.sw * 3), Math.max(3, o.sw * 2)] : undefined });
            if (o.t === 'arrow') {
              const [x1, y1, x2, y2] = o.p; const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(9, o.sw * 4.2), sp = rad(26);
              poly([toP(x2, y2), toP(x2 - hl * Math.cos(ang - sp), y2 - hl * Math.sin(ang - sp)), toP(x2 - hl * Math.cos(ang + sp), y2 - hl * Math.sin(ang + sp))], { color: col(o.stroke), opacity: op, borderColor: col(o.stroke), borderWidth: o.sw * 0.4, borderOpacity: op });
            }
            break;
          }
          case 'measure': {
            const [x1, y1, x2, y2] = o.p; const a = toP(x1, y1), b = toP(x2, y2); const col0 = col(o.stroke);
            page.drawLine({ start: a, end: b, thickness: o.sw, color: col0, opacity: op });
            const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang), ny = Math.cos(ang);
            [[x1, y1], [x2, y2]].forEach(([x, y]) => page.drawLine({ start: toP(x - nx * 6, y - ny * 6), end: toP(x + nx * 6, y + ny * 6), thickness: o.sw, color: col0, opacity: op }));
            const fe = await PD.fonts.embed(pdf, { family: 'Helvetica', bold: true }); const lab = PD.annot.measureLabel(o); const fs = 11;
            const tw = fe.font.widthOfTextAtSize(lab, fs); const mx = (x1 + x2) / 2 - nx * 11, my = (y1 + y2) / 2 - ny * 11;
            const L2 = mkL2P({ x: mx - tw / 2 - 5, y: my - 8, rot: 0 }, tw + 10, 16);
            poly([L2(0, 0), L2(tw + 10, 0), L2(tw + 10, 16), L2(0, 16)], { color: col0, opacity: op });
            const bp = L2(5, 12); page.drawText(lab, { x: bp.x, y: bp.y, size: fs, font: fe.font, color: rgb(1, 1, 1), opacity: op, rotate: degrees(-(doc.info[i].rot || 0)) });
            break;
          }
          case 'ink': {
            const pts = o.pts.map((p) => toP(p[0], p[1])); if (pts.length < 2) break;
            let d = 'M ' + pts[0].x + ' ' + -pts[0].y;
            for (let q = 1; q < pts.length - 1; q++) { const mx = (pts[q].x + pts[q + 1].x) / 2, my = (pts[q].y + pts[q + 1].y) / 2; d += ` Q ${pts[q].x} ${-pts[q].y} ${mx} ${-my}`; }
            d += ` L ${pts[pts.length - 1].x} ${-pts[pts.length - 1].y}`;
            page.drawSvgPath(d, { x: 0, y: 0, borderColor: col(o.stroke), borderWidth: o.sw, borderOpacity: op, borderLineCap: L.LineCapStyle.Round });
            break;
          }
          case 'area': { const r = rect2(o.x, o.y, o.w, o.h); page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(o.color), opacity: o.op, blendMode: L.BlendMode.Multiply }); break; }
          case 'whiteout': { const r = rect2(o.x, o.y, o.w, o.h); page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(o.color, rgb(1, 1, 1)), opacity: 1 }); break; }
          case 'redact': { if (opts.redactBlack) { const r = rect2(o.x, o.y, o.w, o.h); page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: rgb(0, 0, 0) }); } break; }
          case 'markup': {
            for (const m of o.rects) {
              const r = rect2(m.x, m.y, m.w, m.h);
              if (o.kind === 'highlight') page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(o.color), opacity: o.op != null ? o.op : 0.45, blendMode: L.BlendMode.Multiply });
              else {
                const lw = Math.max(1, m.h * 0.07) * 1.4;
                if (o.kind === 'underline' || o.kind === 'strike') {
                  const yy = o.kind === 'underline' ? m.y + m.h - lw / 1.4 : m.y + m.h * 0.55;
                  page.drawLine({ start: toP(m.x, yy), end: toP(m.x + m.w, yy), thickness: lw, color: col(o.color) });
                } else {
                  const y = m.y + m.h - Math.max(1.5, m.h * 0.1), amp = Math.max(1, m.h * 0.07), step = Math.max(2.5, m.h * 0.18);
                  const pts = [toP(m.x, y)]; let up = true; for (let x = m.x + step; x <= m.x + m.w + step; x += step) { pts.push(toP(Math.min(x, m.x + m.w), y + (up ? -amp : amp))); up = !up; }
                  page.drawSvgPath('M ' + pts.map((p) => p.x + ' ' + -p.y).join(' L '), { x: 0, y: 0, borderColor: col(o.color), borderWidth: lw * 0.9 });
                }
              }
            }
            break;
          }
          case 'image': {
            let img = imgCache[o.img];
            if (!img) { const url = PD.imgs[o.img]; const bytes = PD.dataUrlToBytes(url); img = imgCache[o.img] = /^data:image\/png/.test(url) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); }
            const L2P = mkL2P(o, o.w, o.h); const bl = L2P(0, o.h);
            page.drawImage(img, { x: bl.x, y: bl.y, width: o.w, height: o.h, rotate: degrees(dirAngle(o.x + o.w / 2, o.y + o.h / 2, rad(o.rot || 0))), opacity: op });
            break;
          }
          case 'stamp': {
            const L2P = mkL2P(o, o.w, o.h); const ang = dirAngle(o.x + o.w / 2, o.y + o.h / 2, rad(o.rot || 0));
            const bw = Math.max(1.5, o.h * 0.06), rr = o.h * 0.14, w = o.w - bw, hh = o.h - bw;
            const tl = L2P(bw / 2, bw / 2);
            const d = `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${hh - rr} Q ${w} ${hh} ${w - rr} ${hh} H ${rr} Q 0 ${hh} 0 ${hh - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
            page.drawSvgPath(d, { x: tl.x, y: tl.y, rotate: degrees(ang), borderColor: col(o.color), borderWidth: bw, borderOpacity: op });
            const fe = await PD.fonts.embed(pdf, { family: 'Helvetica', bold: true });
            const fs = Math.max(6, Math.min(o.h * 0.5, (o.w * 0.86) / Math.max(3, o.text.length * 0.62)));
            const txt = safeText(fe.font, o.text); const tw = fe.font.widthOfTextAtSize(txt, fs);
            const base = L2P((o.w - tw) / 2, o.h / 2 + fs * 0.35);
            page.drawText(txt, { x: base.x, y: base.y, size: fs, font: fe.font, color: col(o.color), opacity: op, rotate: degrees(ang) });
            break;
          }
          case 'note': {
            const r = rect2(o.x, o.y, 22, 22);
            page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(o.color || '#fbbf24'), borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.8 });
            for (let q = 0; q < 3; q++) { const yy = o.y + 6 + q * 5; page.drawLine({ start: toP(o.x + 4, yy), end: toP(o.x + (q === 2 ? 11 : 18), yy), thickness: 1, color: rgb(0.25, 0.25, 0.25) }); }
            try {
              const rr = rect2(o.x, o.y, 22, 22); const c = col(o.color || '#fbbf24');
              const ann = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [rr.x, rr.y, rr.x + rr.width, rr.y + rr.height], Contents: L.PDFHexString.fromText(o.text || ''), Name: 'Comment', F: 4, Open: false, T: L.PDFHexString.fromText('PDF Do') });
              page.node.addAnnot(pdf.context.register(ann));
            } catch (e) { /* annotation is optional */ }
            break;
          }
          case 'link': {
            const r = rect2(o.x, o.y, o.w, o.h); let ann;
            if (o.mode === 'page') ann = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [r.x, r.y, r.x + r.width, r.y + r.height], Border: [0, 0, 0], Dest: [pages[Math.min(pages.length - 1, o.page || 0)].ref, L.PDFName.of('Fit')] });
            else ann = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [r.x, r.y, r.x + r.width, r.y + r.height], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: L.PDFString.of(o.url || '') } });
            page.node.addAnnot(pdf.context.register(ann)); break;
          }
          case 'field': {
            const form = pdf.getForm(); const r = rect2(o.x, o.y, o.w, o.h); const name = o.name || PD.uid('fld');
            try {
              if (o.fk === 'check') { const cb = form.createCheckBox(name); cb.addToPage(page, { x: r.x, y: r.y, width: r.width, height: r.height, borderColor: rgb(0.25, 0.25, 0.3), borderWidth: 1 }); }
              else if (o.fk === 'drop') { const dd = form.createDropdown(name); dd.addOptions((o.opts || '').split(',').map((s) => s.trim()).filter(Boolean)); dd.addToPage(page, { x: r.x, y: r.y, width: r.width, height: r.height, borderColor: rgb(0.25, 0.25, 0.3), borderWidth: 1 }); }
              else { const tf = form.createTextField(name); if (o.multi) tf.enableMultiline(); tf.addToPage(page, { x: r.x, y: r.y, width: r.width, height: r.height, borderColor: rgb(0.25, 0.25, 0.3), borderWidth: 1 }); }
            } catch (e) { console.warn('field', e); }
            break;
          }
          case 'text': await burnText(pdf, page, o, toP, dirAngle, mkL2P, rect2, poly); break;
        }
      }
    }
  };
  const rad = (d) => (d * Math.PI) / 180;

  async function burnText(pdf, page, o, toP, dirAngle, mkL2P, rect2, poly) {
    const f = o.font || { family: 'Helvetica' };
    if (o.rep) { const r = rect2(o.rep.x, o.rep.y, o.rep.w, o.rep.h); page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: col(o.rep.color, rgb(1, 1, 1)) }); }
    if (!o.text) return;
    const fe = await PD.fonts.embed(pdf, f); const font = fe.font;
    const size = o.size, lh = o.lh || 1.25, ls = o.ls || 0;
    const wid = (s) => font.widthOfTextAtSize(safeText(font, s), size) + ls * [...s].length + (fe.fakeBold ? size * 0.03 : 0);
    // wrap
    const lines = [];
    String(o.text).split('\n').forEach((para) => {
      if (!o.w) { lines.push(para); return; }
      const words = para.split(/(\s+)/); let cur = '';
      words.forEach((wd) => {
        const test = cur + wd;
        if (cur && wid(test.replace(/\s+$/, '')) > o.w) { lines.push(cur.replace(/\s+$/, '')); cur = /^\s+$/.test(wd) ? '' : wd; }
        else cur = test;
      });
      lines.push(cur.replace(/\s+$/, ''));
    });
    const widths = lines.map(wid);
    const W = o.w || Math.max(1, ...widths), H = lines.length * lh * size;
    const [asc, desc] = metrics(f, fe);
    const lead = (lh * size - (asc + desc) * size) / 2; const baseY0 = lead + asc * size;
    const L2P = mkL2P(o, W, H); const ang = dirAngle(o.x + W / 2, o.y + H / 2, rad(o.rot || 0));
    const color = col(o.color, rgb(0, 0, 0)); const op = o.op != null ? o.op : 1;
    if (o.bg) { poly([L2P(0, 0), L2P(W, 0), L2P(W, H), L2P(0, H)], { color: col(o.bg), opacity: op }); }
    const skew = fe.fakeItalic ? degrees(12) : undefined;
    lines.forEach((ln, k) => {
      const lw = widths[k]; const lx = o.align === 'center' ? (W - lw) / 2 : o.align === 'right' ? W - lw : 0; const by = k * lh * size + baseY0;
      const txt = safeText(font, ln);
      const drawAt = (x, s, extraX) => { const p = L2P(x + (extraX || 0), by); page.drawText(s, { x: p.x, y: p.y, size, font, color, opacity: op, rotate: degrees(ang), xSkew: skew }); };
      if (ls) { let x = lx; for (const ch of txt) { drawAt(x, ch); if (fe.fakeBold) drawAt(x, ch, size * 0.025); x += font.widthOfTextAtSize(ch, size) + ls; } }
      else { drawAt(lx, txt); if (fe.fakeBold) { drawAt(lx, txt, size * 0.03); drawAt(lx, txt, size * 0.015); } }
      if (f.underline || f.strike) {
        const th = Math.max(0.5, size / 16);
        if (f.underline) page.drawLine({ start: L2P(lx, by + size * 0.12), end: L2P(lx + lw, by + size * 0.12), thickness: th, color, opacity: op });
        if (f.strike) page.drawLine({ start: L2P(lx, by - size * 0.28), end: L2P(lx + lw, by - size * 0.28), thickness: th, color, opacity: op });
      }
    });
  }

  /* ---------- save pipeline ---------- */
  P.checkRedactions = async function (doc) {
    const has = Object.values(doc.ov).some((l) => l.some((o) => o.t === 'redact'));
    if (!has) return true;
    const r = await PD.modal({ title: 'Redaction marks found', icon: 'eyeoff', content: PD.h('p', { class: 'muted' }, 'This document still has areas marked for redaction. Redactions only remove content once applied.'),
      buttons: [{ label: 'Cancel', value: 'x' }, { label: 'Save anyway', value: 'skip' }, { label: 'Apply redactions & save', kind: 'primary', value: 'apply' }] });
    if (r === 'apply') { await PD.tools.applyRedactions(true); return true; }
    return r === 'skip';
  };
  PD.save = async function (doc, as) {
    doc = doc || PD.cur; if (!doc) return false;
    if (!(await P.checkRedactions(doc))) return false;
    try {
      return await PD.withBusy('Saving ' + doc.name, async () => {
        const bytes = await P.bake(doc);
        let hd = doc.handle;
        if (!as && hd && hd.createWritable) {
          try {
            if ((await hd.queryPermission({ mode: 'readwrite' })) !== 'granted') await hd.requestPermission({ mode: 'readwrite' });
            await PD.writeHandle(hd, bytes); doc.savedAt = doc.hi; PD.emit('doc:history', doc); PD.toast('Saved ' + doc.name, 'ok'); return true;
          } catch (e) { console.warn(e); }
        }
        const r = await PD.saveAs(bytes, doc.name.replace(/\.pdf$/i, '') + (as ? ' (copy)' : '') + '.pdf', { mime: 'application/pdf', desc: 'PDF document' });
        if (!r) return false;
        if (r !== true && r.name) { doc.handle = r; doc.name = r.name; }
        if (!as) doc.savedAt = doc.hi;
        PD.emit('doc:history', doc); PD.emit('docs:changed'); PD.toast('Saved ' + (r && r.name ? r.name : doc.name), 'ok'); return true;
      });
    } catch (e) { return false; }
  };
  P.exportBytes = (doc) => P.bake(doc || PD.cur);
})();
