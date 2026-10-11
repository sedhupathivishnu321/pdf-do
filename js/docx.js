/* PDF Do — layout-aware Word (.docx) export.
   Text keeps fonts, sizes, colors, alignment, spacing; multi-column / sidebar pages become positioned paragraphs;
   pictures AND vector figures (diagrams, charts, logos) are exported as images placed where they sit. */
(function () {
  'use strict';
  const PD = window.PD;
  const D = (PD.docx = {});
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fixGlyphs = (t) => t.replace(/[\uF000-\uF0FF]/g, (c) => (c === '\uF0B7' ? '\u2022' : String.fromCharCode(c.charCodeAt(0) - 0xF000)));
  const tw = (pt) => Math.round(pt * 20);
  const emu = (pt) => Math.round(pt * 12700);

  const FONT_MAP = { arialmt: 'Arial', arial: 'Arial', helvetica: 'Arial', timesnewroman: 'Times New Roman', timesnewromanps: 'Times New Roman', times: 'Times New Roman', timesroman: 'Times New Roman', courier: 'Courier New', couriernew: 'Courier New', couriernewps: 'Courier New', calibri: 'Calibri', cambria: 'Cambria', verdana: 'Verdana', tahoma: 'Tahoma', georgia: 'Georgia', segoeui: 'Segoe UI', symbol: 'Symbol', trebuchetms: 'Trebuchet MS', garamond: 'Garamond', palatinolinotype: 'Palatino Linotype', consolas: 'Consolas', comicsansms: 'Comic Sans MS', palatino: 'Palatino Linotype', bookantiqua: 'Book Antiqua', mspgothic: 'MS Gothic' };
  const KNOWN = new Set(['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Cambria', 'Verdana', 'Tahoma', 'Georgia', 'Segoe UI', 'Symbol', 'Trebuchet MS', 'Garamond', 'Palatino Linotype', 'Consolas', 'Comic Sans MS', 'Book Antiqua', 'Cambria Math', 'Century Gothic', 'Candara', 'Corbel', 'Constantia', 'Impact', 'Lucida Console']);
  function fontInfo(raw, generic) {
    const n = String(raw || '').replace(/^[A-Z]{6}\+/, '');
    const bold = /bold|black|heavy|semibold|demi|bx|\bbf/i.test(n), italic = /italic|oblique|ital$|-it\b|\bmi\d|ti\d/i.test(n);
    const base = n.split(/[-,]/)[0].replace(/(PSMT|PS|MT)$/i, '');
    const key = base.toLowerCase().replace(/[^a-z]/g, '');
    let name = FONT_MAP[key];
    if (!name) {
      if (/nimbusrom|nimbusroman|libertin|stix|latinmodern|^cm(r|bx|ti|sl)|^lmroman|palladio|^urw.*(rom|bookman|palladio)|charter|minion|times|serif(?!.*sans)|^tx(r|t)|^ptm|^ntx|newtx/i.test(n)) name = 'Times New Roman';
      else if (/nimbussan|^cmss|^lmsans|helvet|^phv|swiss|arial|sans/i.test(n)) name = 'Arial';
      else if (/nimbusmon|^cmtt|^lmmono|courier|mono|^pcr/i.test(n)) name = 'Courier New';
      else if (/^cmmi|^cmsy|^cmex|^msam|^msbm|math/i.test(n)) name = 'Cambria Math';
      else { const nice = base.replace(/([a-z])([A-Z])/g, '$1 $2').trim(); name = KNOWN.has(nice) ? nice : (generic === 'serif' ? 'Times New Roman' : generic === 'monospace' ? 'Courier New' : /^[A-Z]{2,}/.test(n) && !generic ? 'Times New Roman' : 'Arial'); }
    }
    const safe = /nimbus|times|arial|helvet|courier|liberation|gyre|^cm|ptm|phv/i.test(n) && ['Times New Roman', 'Arial', 'Courier New', 'Cambria Math'].includes(name);
    return { name, bold, italic, safe };
  }

  /* ---------- extraction ---------- */
  async function extractPage(pd, n) {
    const page = await pd.getPage(n); const vp = page.getViewport({ scale: 1 });
    const SC = 2.2; const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width * SC); cv.height = Math.ceil(vp.height * SC);
    await page.render({ canvasContext: cv.getContext('2d', { willReadFrequently: true }), viewport: page.getViewport({ scale: SC }), background: '#fff' }).promise;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tc = await page.getTextContent(); let items = [];
    tc.items.forEach((it) => {
      if (!it.str || !it.str.trim().length) return;
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform); const fs = Math.hypot(tx[2], tx[3]) || 10;
      if (Math.abs(Math.atan2(tx[1], tx[0])) > 0.08) return;
      let fo = null; try { fo = page.commonObjs.get(it.fontName); } catch (e) { /* ignore */ }
      const st = tc.styles[it.fontName]; const fi = fontInfo(fo && fo.name, st && st.fontFamily);
      items.push({ s: it.str, raw: (fo && fo.name) || '', x0: tx[4], x1: tx[4] + it.width, base: tx[5], fs, f: fi, y0: tx[5] - fs * 0.9, y1: tx[5] + fs * 0.25 });
    });

    // drop invisible text (hidden OCR/accessibility layers, off-page text): nothing is actually painted under it
    items = items.filter((it) => {
      if (it.y1 < 0 || it.y0 > vp.height || it.x1 < 0 || it.x0 > vp.width) return false;
      const x = Math.max(0, Math.floor(it.x0 * SC)), y = Math.max(0, Math.floor((it.base - it.fs * 0.68) * SC)), w = Math.min(cv.width - x, Math.ceil((it.x1 - it.x0) * SC)), h = Math.min(cv.height - y, Math.ceil(it.fs * 0.58 * SC));
      if (w < 1 || h < 1) return false;
      const d = ctx.getImageData(x, y, w, h).data; let c = 0;
      for (let q = 0; q < d.length; q += 4) if (d[q] + d[q + 1] + d[q + 2] < 700) c++;
      return c >= Math.max(2, w * h * 0.04);
    });
    items = items.filter((it, i) => !items.some((o, j) => j < i && o.s === it.s && Math.abs(o.x0 - it.x0) < it.fs * 0.35 && Math.abs(o.base - it.base) < it.fs * 0.35));

    /* figures: anything that is not text (pictures, charts, diagrams, logos) */
    const W = cv.width, H = cv.height; const img = ctx.getImageData(0, 0, W, H); const px = img.data;
    const ink = new Uint8Array(W * H);
    for (let i = 0, q = 0; i < px.length; i += 4, q++) ink[q] = px[i] + px[i + 1] + px[i + 2] < 690 ? 1 : 0;
    items.forEach((it) => { const x0 = Math.max(0, Math.floor((it.x0 - 1.5) * SC)), x1 = Math.min(W, Math.ceil((it.x1 + 1.5) * SC)), y0 = Math.max(0, Math.floor((it.y0 - it.fs * 0.12) * SC)), y1 = Math.min(H, Math.ceil((it.y1 + it.fs * 0.1) * SC)); for (let y = y0; y < y1; y++) ink.fill(0, y * W + x0, y * W + x1); });
    const cell = 10, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell); const cnt = new Int32Array(gw * gh);
    for (let y = 0; y < H; y++) { const row = y * W, gy = ((y / cell) | 0) * gw; for (let x = 0; x < W; x++) if (ink[row + x]) cnt[gy + ((x / cell) | 0)]++; }
    const seen = new Uint8Array(gw * gh); const figs = [];
    for (let s = 0; s < cnt.length; s++) {
      if (cnt[s] < 4 || seen[s]) continue;
      const st = [s]; seen[s] = 1; let x0 = gw, y0 = gh, x1 = 0, y1 = 0, sum = 0;
      while (st.length) {
        const c = st.pop(), cx = c % gw, cy = (c / gw) | 0; sum += cnt[c]; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const k = ny * gw + nx; if (cnt[k] >= 4 && !seen[k]) { seen[k] = 1; st.push(k); } }
      }
      const f = { x: (x0 * cell) / SC, y: (y0 * cell) / SC, w: ((x1 - x0 + 1) * cell) / SC, h: ((y1 - y0 + 1) * cell) / SC };
      const density = sum / (((x1 - x0 + 1) * cell) * ((y1 - y0 + 1) * cell));
      if (f.w < 9 || f.h < 9 || f.w * f.h < 600) continue;               // specks, rules, underlines
      if (f.w > vp.width * 0.93 && f.h > vp.height * 0.93) continue;     // full-page background
      const inside = items.filter((it) => { const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2; return cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h; });
      if (density > 0.72 && inside.length) continue;                     // solid shading behind text
      if (inside.length >= 14) {                                         // many labels: a table (keep text) or a busy diagram (make it a picture)
        const textArea = inside.reduce((a, it) => a + (it.x1 - it.x0) * it.fs, 0); const coverage = textArea / (f.w * f.h);
        let colored = 0, inkN = 0; const X0 = Math.floor(f.x * SC), X1 = Math.min(W, Math.ceil((f.x + f.w) * SC)), Y0 = Math.floor(f.y * SC), Y1 = Math.min(H, Math.ceil((f.y + f.h) * SC));
        for (let y = Y0; y < Y1; y += 2) for (let x = X0; x < X1; x += 2) { const q = y * W + x; if (!ink[q]) continue; inkN++; const r = px[q * 4], g = px[q * 4 + 1], b = px[q * 4 + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 28) colored++; }
        const isDiagram = coverage < 0.14 || (inkN > 200 && colored / inkN > 0.04);
        if (!isDiagram) continue;
      }
      figs.push(Object.assign(f, { inside }));
    }
    // display equations (TeX math fonts) become pictures: Word cannot rebuild their glyph layout
    {
      const isMath = (it) => /^[A-Z]{6}\+(cm|msam|msbm|eufm|rsfs|lm.*math|stix.*math)|cmmi|cmsy|cmex|msam|msbm|eufm|rsfs|mathit|mathematical|^symbol/i.test(it.raw || '');
      const cmChars = items.filter((it) => /cm(r|bx|ti|sl|ss|tt)\d/i.test(it.raw || '')).reduce((a, it) => a + it.s.length, 0), allChars = items.reduce((a, it) => a + it.s.length, 0) || 1;
      const texPage = cmChars / allChars > 0.35;   // a page typeset entirely in Computer Modern: not every CM item is math
      const mathy = (it) => isMath(it) && !(texPage && /cm(r|bx|ti|sl|ss|tt)\d/i.test(it.raw || ''));
      const mi = items.filter(mathy); const boxes = [];
      const addBox = (b, it) => { const hit = boxes.find((q) => b.x0 < q.x1 + it.fs * 0.8 && q.x0 < b.x1 + it.fs * 0.8 && b.y0 < q.y1 && q.y0 < b.y1); if (hit) { hit.x0 = Math.min(hit.x0, b.x0); hit.x1 = Math.max(hit.x1, b.x1); hit.y0 = Math.min(hit.y0, b.y0); hit.y1 = Math.max(hit.y1, b.y1); hit.n++; } else boxes.push(Object.assign(b, { n: 1 })); };
      mi.forEach((it) => addBox({ x0: it.x0 - it.fs * 0.4, x1: it.x1 + it.fs * 0.4, y0: it.base - it.fs * 1.3, y1: it.base + it.fs * 0.75 }, it));
      // merge boxes that are vertically stacked parts of one display equation (fractions, sums)
      for (let k = 0; k < 3; k++) mi.forEach((it) => addBox({ x0: it.x0 - it.fs * 0.4, x1: it.x1 + it.fs * 0.4, y0: it.base - it.fs * 1.3, y1: it.base + it.fs * 0.75 }, it));
      boxes.forEach((q) => {
        if (q.n < 3) return;
        const within = (it) => { const cx = (it.x0 + it.x1) / 2, cy = it.base - it.fs * 0.3; return cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1; };
        let inside = items.filter(within);
        const total = inside.reduce((a, it) => a + it.s.trim().length, 0), math = inside.filter(mathy).reduce((a, it) => a + it.s.trim().length, 0);
        if (!total || !(total - math <= 16 || math / total >= 0.5)) return;        // inline math inside a text line stays text
        // grow upward/downward over neighbouring lines of the same display equation block (e.g. the first line of a stack)
        for (let g = 0; g < 4; g++) {
          const fsq = 10; const near = items.filter((it) => !within(it) && it.x0 >= q.x0 - 6 && it.x1 <= q.x1 + 6 && ((it.base < q.y0 + fsq && it.base > q.y0 - fsq * 2.4) || (it.base > q.y1 - fsq && it.base < q.y1 + fsq * 2.4)) && (mathy(it) || /^[\d\s().,=+\-−]+$/.test(it.s)));
          if (!near.length) break;
          const nm = near.filter((it) => mathy(it) && !items.some((o) => !mathy(o) && o.s.trim().length > 2 && Math.abs(o.base - it.base) < 3 && !/^[\d\s().,=+\-−]+$/.test(o.s))); if (!nm.length) break;
          const ny0 = Math.min(q.y0, ...nm.map((it) => it.base - it.fs * 1.3)), ny1 = Math.max(q.y1, ...nm.map((it) => it.base + it.fs * 0.75));
          if (ny0 === q.y0 && ny1 === q.y1) break; q.y0 = ny0; q.y1 = ny1; inside = items.filter(within);
        }
        // pull in the equation number "(8)" sitting to the right on the same baseline
        const num = items.find((it) => /^\(\d+[a-z]?\)$/.test(it.s.trim()) && it.base > q.y0 && it.base < q.y1 && it.x0 >= q.x1 - 2 && it.x0 - q.x1 < 260);
        if (num) { q.x1 = num.x1 + 2; inside = items.filter(within); }
        // inline math: ordinary words touch the formula on the same line -> leave it as text
        const adjacent = items.filter((it) => !within(it) && it.base > q.y0 + it.fs * 0.5 && it.base < q.y1 - it.fs * 0.1 && (Math.abs(it.x0 - q.x1) < 12 || Math.abs(q.x0 - it.x1) < 12 || (it.x0 < q.x0 && it.x1 > q.x0) || (it.x0 < q.x1 && it.x1 > q.x1)));
        if (adjacent.length) return;
        figs.push({ x: Math.max(0, q.x0), y: Math.max(0, q.y0), w: q.x1 - q.x0, h: q.y1 - q.y0, inside, eq: true });
      });
    }
    const inlineBoxes = [];
    {
      const isMathI = (it) => /^[A-Z]{6}\+(cm|msam|msbm|eufm|rsfs|lm.*math|stix.*math)|cmmi|cmsy|cmex|msam|msbm|eufm|rsfs|mathit|mathematical|^symbol/i.test(it.raw || '');
      const cmC = items.filter((it) => /cm(r|bx|ti|sl|ss|tt)\d/i.test(it.raw || '')).reduce((a, it) => a + it.s.length, 0), allC = items.reduce((a, it) => a + it.s.length, 0) || 1;
      const texP = cmC / allC > 0.35;
      const cand = items.filter((it) => isMathI(it) && !(texP && /cm(r|bx|ti|sl|ss|tt)\d/i.test(it.raw || '')) && !figs.some((f) => f.eq && (it.x0 + it.x1) / 2 > f.x && (it.x0 + it.x1) / 2 < f.x + f.w && it.base > f.y && it.base < f.y + f.h));
      cand.sort((a, b) => a.x0 - b.x0);
      cand.forEach((it) => {
        const r = { x0: it.x0 - 1, x1: it.x1 + 1, y0: it.base - it.fs * 0.85, y1: it.base + it.fs * 0.28 };
        const hit = inlineBoxes.find((q) => r.x0 < q.x1 + it.fs * 0.55 && q.x0 < r.x1 + it.fs * 0.55 && r.y0 < q.y1 + it.fs * 0.3 && q.y0 < r.y1 + it.fs * 0.3);
        const grow = hit && Math.max(hit.x1, r.x1) - Math.min(hit.x0, r.x0) < 150 && Math.max(hit.y1, r.y1) - Math.min(hit.y0, r.y0) < it.fs * 2.4;
        if (grow) { hit.x0 = Math.min(hit.x0, r.x0); hit.x1 = Math.max(hit.x1, r.x1); hit.y0 = Math.min(hit.y0, r.y0); hit.y1 = Math.max(hit.y1, r.y1); } else inlineBoxes.push(r);
      });
    }
    // merge overlapping figure boxes, then crop
    let merged = true; while (merged) { merged = false; for (let a = 0; a < figs.length && !merged; a++) for (let b = a + 1; b < figs.length && !merged; b++) { const A = figs[a], B = figs[b]; if (A.x < B.x + B.w + 6 && B.x < A.x + A.w + 6 && A.y < B.y + B.h + 6 && B.y < A.y + A.h + 6) { const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y); const x2 = Math.max(A.x + A.w, B.x + B.w), y2 = Math.max(A.y + A.h, B.y + B.h); figs[a] = { x, y, w: x2 - x, h: y2 - y, inside: [] }; figs.splice(b, 1); merged = true; } } }
    const HI = 4.5;
    const crispCrop = async (x, y, w, h) => {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * HI)); c.height = Math.max(1, Math.round(h * HI));
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: cx, viewport: page.getViewport({ scale: HI }), transform: [1, 0, 0, 1, -x * HI, -y * HI], background: '#ffffff' }).promise;
      const png = await PD.canvasToBytes(c, 'image/png'); c.width = c.height = 0; return png;
    };
    const images = []; const pad = 2.5;
    for (const f of figs) {
      const x = Math.max(0, f.x - pad), y = Math.max(0, f.y - pad), w = Math.min(vp.width - x, f.w + pad * 2), h = Math.min(vp.height - y, f.h + pad * 2);
      images.push({ x, y, w, h, png: await crispCrop(x, y, w, h) });
    }
    items = items.filter((it) => { const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2; return !images.some((f) => cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h); });
    const inlineEqs = [];
    for (const q of inlineBoxes) {
      if (images.some((f) => q.x0 > f.x && q.x1 < f.x + f.w && q.y0 > f.y && q.y1 < f.y + f.h)) continue;
      const x = Math.max(0, q.x0), y = Math.max(0, q.y0), w = Math.min(vp.width - x, q.x1 - q.x0), h = Math.min(vp.height - y, q.y1 - q.y0); if (w < 2 || h < 2) continue;
      inlineEqs.push({ x, y, w, h, png: await crispCrop(x, y, w, h) });
    }

    const color = (it) => {
      try {
        const x = Math.max(0, Math.floor(it.x0 * SC)), y = Math.max(0, Math.floor(it.y0 * SC)), w = Math.max(1, Math.min(W - x, Math.ceil((it.x1 - it.x0) * SC))), h = Math.max(1, Math.min(H - y, Math.ceil((it.y1 - it.y0) * SC)));
        const d = ctx.getImageData(x, y, w, h).data; let best = 1e9, bi = 0;
        for (let p = 0; p < d.length; p += 4) { const l = d[p] + d[p + 1] + d[p + 2]; if (l < best) { best = l; bi = p; } }
        if (best > 600) return null;
        const hex = [d[bi], d[bi + 1], d[bi + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        return /^[0-3][0-9a-f][0-3][0-9a-f][0-3][0-9a-f]$/.test(hex) ? null : hex;
      } catch (e) { return null; }
    };
    items.forEach((it) => { it.color = color(it); });
    cv.width = cv.height = 0;
    return { w: vp.width, h: vp.height, items, images, inlineEqs, crop: crispCrop };
  }

  /* ---------- rows / segments ---------- */
  function buildRows(items) {
    items = items.slice().sort((a, b) => (Math.abs(a.base - b.base) < Math.min(a.fs, b.fs) * 0.35 ? a.x0 - b.x0 : a.base - b.base));
    const rows = [];
    items.forEach((it) => { const r = rows.find((q) => Math.abs(q.base - it.base) < Math.min(q.fs, it.fs) * 0.35); if (r) r.items.push(it); else rows.push({ base: it.base, fs: it.fs, items: [it] }); });
    // small items sitting just above / below a larger row are super- / subscripts of it
    for (let a = rows.length - 1; a >= 0; a--) {
      const small = rows[a]; if (small.items.some((i) => i.fs >= small.fs * 0.9 && false)) continue;
      const host = !small.items.some((i) => i.pic) && small.items.reduce((n, i) => n + i.s.trim().length, 0) <= 8 && rows.find((q, b) => b !== a && q.fs > small.fs * 1.18 && q.fs < small.fs * 1.9 && Math.abs(q.base - small.base) < q.fs * 0.75 && small.items.every((i) => i.x0 >= Math.min(...q.items.map((z) => z.x0)) - 2 && i.x0 <= Math.max(...q.items.map((z) => z.x1)) + 2));
      if (host) { small.items.forEach((i) => { i.sup = small.base < host.base ? 1 : -1; i.hostFs = host.fs; }); host.items.push(...small.items); rows.splice(a, 1); }
    }
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x0 - b.x0); r.fs = Math.max(...r.items.map((i) => i.fs)); r.base = r.items.reduce((s, i) => s + i.base, 0) / r.items.length;
      const segs = []; let cur = null;
      r.items.forEach((it) => {
        if (cur && it.x0 - cur.x1 < Math.max(Math.min(cur.lastFs, it.fs) * 1.0, 7)) { const gap = it.x0 - cur.x1; const sp = gap > r.fs * 0.18 && !/\s$/.test(cur.runs[cur.runs.length - 1].s) && !/^\s/.test(it.s) ? ' ' : ''; pushRun(cur, it, sp); cur.x1 = Math.max(cur.x1, it.x1); cur.items.push(it); cur.lastFs = it.fs; }
        else { cur = { x0: it.x0, x1: it.x1, runs: [], items: [it], lastFs: it.fs }; pushRun(cur, it, ''); segs.push(cur); }
      });
      segs.forEach((sg) => { sg.base = sg.items.reduce((a, i) => a + i.base, 0) / sg.items.length; sg.fs = Math.max(...sg.items.map((i) => i.fs)); });
      r.segs = segs; r.x0 = segs[0].x0; r.x1 = segs[segs.length - 1].x1;
    });
    rows.sort((a, b) => a.base - b.base);
    return rows;
  }
  function pushRun(seg, it, sp) {
    if (it.pic) { seg.runs.push({ s: '', pic: it.pic, f: it.f, fs: it.fs, color: null, sup: 0 }); return; }
    const last = seg.runs[seg.runs.length - 1];
    if (last && last.f.name === it.f.name && last.f.bold === it.f.bold && last.f.italic === it.f.italic && Math.abs(last.fs - it.fs) < 0.6 && !last.pic && last.color === it.color && (last.sup || 0) === (it.sup || 0)) last.s += sp + it.s;
    else seg.runs.push({ s: sp + it.s, f: it.f, fs: it.fs, color: it.color, sup: it.sup || 0 });
  }
  const rowText = (r) => r.segs.map((sg) => sg.runs.map((q) => q.s).join('')).join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
  function dropHiddenRows(rows) {
    const txt = rows.map(rowText); const drop = new Set();
    const count = (i) => txt.filter((t, j) => j !== i && !drop.has(j) && t.length > 14 && t === txt[i]).length;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]; if (drop.has(i) || drop.has(j)) continue;
      if (Math.abs(a.base - b.base) > Math.min(a.fs, b.fs) * 0.66) continue;
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0); if (ov < Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.3) continue;
      // two rows occupy the same spot: one is a hidden / duplicate layer. Prefer dropping the one whose text also appears elsewhere.
      const ca = count(i), cb = count(j);
      if (ca > cb) drop.add(i); else if (cb > ca) drop.add(j); else if (txt[i].length < txt[j].length) drop.add(i); else drop.add(j);
    }
    return rows.filter((r, i) => !drop.has(i));
  }
  let picXml = null;
  const runXml = (r) => {
    if (r.pic) return picXml(r.pic); const sz = Math.max(2, Math.round((r.sup ? r.fs / 0.65 : r.fs) * 2)); return '<w:r><w:rPr><w:rFonts w:ascii="' + esc(r.f.name) + '" w:hAnsi="' + esc(r.f.name) + '" w:cs="' + esc(r.f.name) + '"/>' + (r.f.bold ? '<w:b/>' : '') + (r.f.italic ? '<w:i/>' : '') + (r.color ? '<w:color w:val="' + r.color + '"/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' + (r.sup ? '<w:vertAlign w:val="' + (r.sup > 0 ? 'superscript' : 'subscript') + '"/>' : '') + '</w:rPr><w:t xml:space="preserve">' + esc(fixGlyphs(r.s)) + '</w:t></w:r>'; };

  // vertical gutters (empty bands of text) → column ranges, or null for a single-column page
  function detectColumns(rows, pageW) {
    const segs = []; rows.forEach((r) => r.segs.forEach((s) => { if (s.x1 - s.x0 < pageW * 0.55) segs.push(s); }));
    if (segs.length < 8) return null;
    const min = Math.floor(Math.min(...segs.map((s) => s.x0))), max = Math.ceil(Math.max(...segs.map((s) => s.x1)));
    const cover = new Int32Array(max - min + 2);
    segs.forEach((s) => { for (let x = Math.floor(s.x0) - min; x <= Math.ceil(s.x1) - min; x++) cover[x]++; });
    const gutters = []; let st = -1;
    for (let x = 0; x <= max - min + 1; x++) {
      const empty = x <= max - min && cover[x] <= 1;
      if (empty && st < 0) st = x; if (!empty && st >= 0) { if (x - st >= 9 && st > 0 && x < max - min + 1) gutters.push((st + x) / 2 + min); st = -1; }
    }
    if (!gutters.length) return null;
    const edges = [-1e9].concat(gutters, [1e9]); const cols = [];
    for (let i = 0; i < edges.length - 1; i++) cols.push({ a: edges[i], b: edges[i + 1] });
    return cols;
  }
  function makeParas(rows, L, R, startBottom, keepLines) {
    const cw = Math.max(20, R - L), paras = []; let prevBottom = startBottom;
    rows.forEach((r) => {
      const hasPic = r.segs.some((sg) => sg.runs.some((q) => q.pic)); const single = r.segs.length === 1 && !hasPic; const last0 = paras[paras.length - 1];
      const full = (q) => q.x1 >= L + cw * 0.93;
      if (!keepLines && last0 && single && last0.single) {
        const pr = last0.rows[last0.rows.length - 1]; const gap = r.base - pr.base;
        const sameLeft = Math.abs(r.x0 - pr.x0) < r.fs * 1.8 || Math.abs(r.x0 - last0.rows[0].x0) < r.fs * 1.8;
        if (gap > 0 && gap < Math.max(pr.fs, r.fs) * 1.75 && Math.abs(pr.fs - r.fs) < 1.2 && sameLeft && full(pr) && last0.align === 'left') { last0.rows.push(r); prevBottom = r.base + r.fs * 0.25; return; }
      }
      const mid = L + cw / 2;
      const centered = single && Math.abs((r.x0 + r.x1) / 2 - mid) < cw * 0.03 && r.x0 - L > cw * 0.06;
      const right = single && !centered && R - r.x1 < cw * 0.03 && r.x0 - L > cw * 0.3;
      paras.push({ rows: [r], single, align: centered ? 'center' : right ? 'right' : 'left', before: Math.max(0, r.base - r.fs - prevBottom + r.fs * 0.15), L, R });
      prevBottom = r.base + r.fs * 0.25;
    });
    return paras;
  }
  function paraRuns(p) {
    let runs = ''; const rs = p.rows;
    rs.forEach((r, ri) => {
      r.segs.forEach((s, si) => { if (si) runs += '<w:r><w:tab/></w:r>'; runs += s.runs.map(runXml).join(''); });
      if (ri < rs.length - 1) {
        const lastRun = rs[ri].segs[rs[ri].segs.length - 1].runs.slice(-1)[0]; const nextRun = rs[ri + 1].segs[0].runs[0];
        const hyph = lastRun && !lastRun.pic && /[a-z]-$/.test(lastRun.s) && nextRun && !nextRun.pic && /^[a-z]/.test(nextRun.s);
        if (hyph) { /* TeX-style line-end hyphenation: drop the hyphen so the word is whole again */ runs = runs.replace(/-(<\/w:t><\/w:r>)$/, '$1'); }
        else if (!(lastRun && lastRun.s.endsWith(' '))) runs += '<w:r><w:t xml:space="preserve"> </w:t></w:r>';
      }
    });
    return runs;
  }

  D._x = { extractPage, buildRows, detectColumns, dropHiddenRows };
  /* ---------- builder ---------- */
  D.build = async function (d, idx, mode, busy) {
    const bytes = await PD.pdf.bake(d);
    const pd = await pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/', password: d.pw || '' }).promise;
    const media = []; let imgId = 0; let body = ''; let words = 0;
    const drawing = (img, rid, anchor, id) => {
      const cx = emu(img.w), cy = emu(img.h); const nm = 'image' + id + '.png';
      const gfx = '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + nm + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
      if (anchor) return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + id + '" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' + emu(img.x) + '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>' + emu(img.y) + '</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="' + id + '" name="Picture ' + id + '"/><wp:cNvGraphicFramePr/>' + gfx + '</wp:anchor></w:drawing></w:r>';
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Picture ' + id + '"/><wp:cNvGraphicFramePr/>' + gfx + '</wp:inline></w:drawing></w:r>';
    };
    const tiny = '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>';
    for (let k = 0; k < idx.length; k++) {
      busy && busy.set(k / idx.length, 'Analyzing page ' + (idx[k] + 1) + ' layout', media.length + ' pictures so far');
      const pg = await extractPage(pd, idx[k] + 1);
      pg.images.forEach((im) => { im.rid = 'rId' + (100 + imgId); im.id = ++imgId; media.push({ name: 'image' + im.id + '.png', rid: im.rid, data: im.png }); });
      let rows;
      picXml = (e) => { const lower = Math.round((e.lower != null ? e.lower : e.h * 0.2) * 2); return drawing(e, e.rid, false, e.id).replace('<w:r>', '<w:r><w:rPr><w:position w:val="-' + lower + '"/></w:rPr>'); };
      if (mode === 'exact') pg.inlineEqs.forEach((e) => { e.rid = 'rId' + (100 + imgId); e.id = ++imgId; media.push({ name: 'image' + e.id + '.png', rid: e.rid, data: e.png }); });
      const inBox = (it) => { const cx = (it.x0 + it.x1) / 2, cy = it.base - it.fs * 0.3; return pg.inlineEqs.some((e) => cx > e.x - 0.5 && cx < e.x + e.w + 0.5 && cy > e.y - 0.5 && cy < e.y + e.h + 0.5); };
      if (mode === 'exact') {
        rows = dropHiddenRows(buildRows(pg.items));
        if (pg.inlineEqs.length) { pg.inlineEqs.forEach((e) => pg.images.push(e)); pg.items = pg.items.filter((it) => !inBox(it)); rows = dropHiddenRows(buildRows(pg.items)); }
      } else {
        // inline math becomes a picture sitting inside the flowing text
        // any line containing inline math is rendered whole as one sharp picture: guarantees exact symbols, sub/superscripts and spacing
        const base0 = dropHiddenRows(buildRows(pg.items.filter((it) => !inBox(it) || true)));
        const keep = []; const pseudo = []; const cands = [];
        for (const r0 of base0) for (const sg of r0.segs) {
          const hits = sg.items.filter(inBox);
          if (!hits.length) { keep.push(...sg.items); continue; }
          const boxes = pg.inlineEqs.filter((e) => sg.items.some((it) => { const cx = (it.x0 + it.x1) / 2, cy = it.base - it.fs * 0.3; return cx > e.x - 0.5 && cx < e.x + e.w + 0.5 && cy > e.y - 0.5 && cy < e.y + e.h + 0.5; }));
          const fsMax = Math.max(...sg.items.map((it) => it.fs)), base = sg.base;
          cands.push({ x0: Math.max(0, sg.x0 - 1), x1: Math.min(pg.w, sg.x1 + 1), y0: Math.max(0, Math.min(base - fsMax * 0.95, ...boxes.map((e) => e.y)) - 0.5), y1: Math.min(pg.h, Math.max(base + fsMax * 0.3, ...boxes.map((e) => e.y + e.h)) + 0.5), base, fs: fsMax });
        }
        // lines whose pictures would overlap (tall sums, fractions, stacked limits) become one block picture
        for (let again = true; again;) { again = false; for (let a2 = 0; a2 < cands.length && !again; a2++) for (let b2 = a2 + 1; b2 < cands.length && !again; b2++) { const A = cands[a2], B = cands[b2]; if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 - 0.5 && B.y0 < A.y1 - 0.5) { cands[a2] = { x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1), y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1), base: Math.max(A.base, B.base), fs: Math.max(A.fs, B.fs) }; cands.splice(b2, 1); again = true; } } }
        for (const c of cands) {
          const e = { x: c.x0, y: c.y0, w: c.x1 - c.x0, h: c.y1 - c.y0 };
          e.png = await pg.crop(e.x, e.y, e.w, e.h); e.rid = 'rId' + (100 + imgId); e.id = ++imgId; media.push({ name: 'image' + e.id + '.png', rid: e.rid, data: e.png });
          e.lower = Math.max(0, c.y1 - c.base);
          pseudo.push({ s: '', pic: e, raw: '', x0: e.x, x1: e.x + e.w, base: c.base, fs: c.fs, f: { name: 'Times New Roman', bold: false, italic: false, safe: true }, y0: e.y, y1: e.y + e.h, color: null });
        }
        const covered = (it) => pseudo.some((q) => { const e = q.pic; const cx = (it.x0 + it.x1) / 2, cy = it.base - it.fs * 0.3; return cx > e.x - 1 && cx < e.x + e.w + 1 && cy > e.y - 1 && cy < e.y + e.h + 1; });
        pg.items = keep.filter((it) => !covered(it)).concat(pseudo); rows = dropHiddenRows(buildRows(pg.items));
      }
      rows.forEach((r) => r.segs.forEach((s) => s.runs.forEach((q) => (words += q.s.split(/\s+/).filter(Boolean).length))));
      const last = k === idx.length - 1;
      const finish = (xml, sect) => { body += xml + (last ? '<w:p><w:pPr>' + tiny + '</w:pPr></w:p>' + sect : '<w:p><w:pPr>' + tiny + sect + '</w:pPr></w:p>'); };
      const pgSz = '<w:pgSz w:w="' + tw(pg.w) + '" w:h="' + tw(pg.h) + '"/>';
      const anchoredImgs = () => pg.images.map((im) => '<w:p><w:pPr>' + tiny + '</w:pPr>' + drawing(im, im.rid, true, im.id) + '</w:p>').join('');

      /* ----- exact mode (also used automatically for multi-column / sidebar pages): every line pinned ----- */
      if (mode === 'exact') {
        let xml = anchoredImgs();
        const lines = []; rows.forEach((r) => r.segs.forEach((sg, si) => lines.push({ s: sg, base: sg.base, fs: sg.fs, nextX: si + 1 < r.segs.length ? r.segs[si + 1].x0 - 1 : pg.w - 1 })));
        lines.forEach((ln) => { const mates = lines.filter((q) => Math.abs(q.s.x0 - ln.s.x0) < 24); const colR = Math.max(...mates.map((q) => q.s.x1)); const colL = Math.min(...mates.map((q) => q.s.x0)); ln.just = ln.s.runs.every((r) => r.f.safe) && ln.s.x1 >= colR - 1.2 && ln.s.x1 - ln.s.x0 > 0.55 * (colR - colL) && mates.length > 3; });
        lines.forEach((ln) => {
          const s = ln.s; let gap = 1e9; lines.forEach((q) => { const d = Math.abs(q.base - ln.base); if (q !== ln && d > 0.5 && d < gap && Math.min(q.s.x1, s.x1) - Math.max(q.s.x0, s.x0) > 0) gap = d; });
          const h = Math.max(ln.fs * 0.8, Math.min(ln.fs * 1.25, gap * 0.98)); const w = ln.just ? (s.x1 - s.x0) + 0.8 : Math.max(10, Math.min(ln.nextX - s.x0, (s.x1 - s.x0) * 1.35 + 14));
          xml += '<w:p><w:pPr><w:framePr w:w="' + tw(w) + '" w:h="' + tw(h) + '" w:hRule="exact" w:hSpace="0" w:vSpace="0" w:wrap="none" w:vAnchor="page" w:hAnchor="page" w:x="' + tw(s.x0) + '" w:y="' + tw(ln.base - h * 0.8) + '"/><w:spacing w:before="0" w:after="0" w:line="' + tw(h) + '" w:lineRule="exact"/>' + (ln.just ? '<w:jc w:val="both"/>' : '') + '</w:pPr>' + s.runs.map(runXml).join('') + (ln.just ? '<w:r><w:br/></w:r>' : '') + '</w:p>';
        });
        finish(xml, '<w:sectPr>' + pgSz + '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>');
        continue;
      }

      /* ===== editable mode: real flowing paragraphs; columns become Word columns ===== */
      const BASE = 0.8; // Word puts the baseline ~80% down an exact-height line
      const gut = detectColumns(dropHiddenRows(buildRows(pg.items.filter((i) => !i.pic))), pg.w); const wideLimit = pg.w * 0.55;
      const colOf = (x0, x1) => (!gut ? -1 : x1 - x0 >= wideLimit ? -1 : gut.findIndex((q) => (x0 + x1) / 2 >= q.a && (x0 + x1) / 2 < q.b));
      const buckets = {};
      const gCenters = gut ? gut.slice(0, -1).map((q) => q.b) : [];
      // a "wide" segment that is really two columns glued together (nothing crosses the gutter) is split back into its columns
      const splitSeg = (sg) => {
        let parts = [sg.items.slice().sort((a, b) => a.x0 - b.x0)];
        gCenters.forEach((gc) => { const next = []; parts.forEach((pt) => { const x0 = Math.min(...pt.map((i) => i.x0)), x1 = Math.max(...pt.map((i) => i.x1)); if (x0 < gc && x1 > gc && !pt.some((i) => i.x0 < gc - 1 && i.x1 > gc + 1)) { next.push(pt.filter((i) => (i.x0 + i.x1) / 2 < gc), pt.filter((i) => (i.x0 + i.x1) / 2 >= gc)); } else next.push(pt); }); parts = next.filter((q) => q.length); });
        return parts;
      };
      if (gut) rows.forEach((r) => r.segs.forEach((sg) => { splitSeg(sg).forEach((pt) => { const x0 = Math.min(...pt.map((i) => i.x0)), x1 = Math.max(...pt.map((i) => i.x1)); const c = colOf(x0, x1); (buckets[c] = buckets[c] || []).push(...pt); }); })); else buckets[-1] = pg.items;
      const rowsBy = {}; Object.keys(buckets).forEach((c) => { rowsBy[c] = gut ? buildRows(buckets[c]) : rows; });
      const K = gut ? gut.length : 1;
      // geometry
      const allRows = Object.values(rowsBy).flat();
      const xsAll = allRows.map((r) => r.x0).concat(pg.images.map((i) => i.x)), xeAll = allRows.map((r) => r.x1).concat(pg.images.map((i) => i.x + i.w));
      const Lm = Math.max(10, Math.min(pg.w * 0.4, xsAll.length ? Math.min(...xsAll) : 54)), Rm = Math.max(10, Math.min(pg.w * 0.4, pg.w - (xeAll.length ? Math.max(...xeAll) : pg.w - 54)));
      const topAll = allRows.map((r) => r.base - r.fs).concat(pg.images.map((i) => i.y)); const Tm = Math.max(10, Math.min(pg.h * 0.3, topAll.length ? Math.min(...topAll) : 54));
      const botAll = allRows.map((r) => r.base + r.fs * 0.3).concat(pg.images.map((i) => i.y + i.h)); const Bm = Math.max(0, pg.h - (botAll.length ? Math.max(...botAll) : pg.h - 40) - 30); // spare room so Word's slightly different line breaks never spill a page
      const colL = [], colR = [];
      for (let c = 0; c < K; c++) { const rr = rowsBy[gut ? c : -1] || []; colL[c] = rr.length ? Math.min(...rr.map((r) => r.x0)) : (gut && gut[c].a > -1e8 ? gut[c].a : Lm); colR[c] = rr.length ? Math.max(...rr.map((r) => r.x1)) : (gut && gut[c].b < 1e8 ? gut[c].b : pg.w - Rm); }
      if (gut) { colL[0] = Lm; colR[K - 1] = pg.w - Rm; }
      const SL = K > 1 ? 4 : 2; // a few points of slack on each side so Word never wraps one line more than the PDF did
      const pgMar = '<w:pgMar w:top="' + tw(Tm) + '" w:right="' + tw(Math.max(0, Rm - SL)) + '" w:bottom="' + tw(Bm) + '" w:left="' + tw(Math.max(0, Lm - SL)) + '" w:header="0" w:footer="0" w:gutter="0"/>';
      const colsXml = (multi) => (multi && K > 1 ? '<w:cols w:num="' + K + '" w:equalWidth="0">' + colL.map((l, c) => '<w:col w:w="' + tw(colR[c] - l + (K > 1 ? SL : 0) + (c === 0 || c === K - 1 ? SL * 0 : 0)) + '"' + (c < K - 1 ? ' w:space="' + tw(Math.max(2, colL[c + 1] - colR[c] - SL)) + '"' : '') + '/>').join('') + '</w:cols>' : '<w:cols w:num="1"/>');

      // blocks (rows and pictures) tagged by column (-1 = spans the page)
      const blocks = [];
      Object.keys(rowsBy).forEach((c) => rowsBy[c].forEach((r) => blocks.push({ t: 'row', c: +c, y: r.base - r.fs, r })));
      pg.images.forEach((im) => blocks.push({ t: 'img', c: colOf(im.x, im.x + im.w), y: im.y, im }));
      blocks.sort((a, b) => a.y - b.y);
      const bands = []; blocks.forEach((b) => { const kind = b.c < 0 ? 'full' : 'col'; const cur = bands[bands.length - 1]; if (cur && cur.kind === kind) cur.blocks.push(b); else bands.push({ kind, blocks: [b] }); });

      const emitBlocks = (list, L, R, startCursor) => {
        const cw = Math.max(30, R - L), mid = L + cw / 2; let xml = '', cursor = startCursor;
        const rowList = list.filter((b) => b.t === 'row').map((b) => b.r).sort((a, b) => a.base - b.base);
        const items2 = []; makeParas(rowList, L, R, startCursor, false).forEach((p) => items2.push({ t: 'p', y: p.rows[0].base - p.rows[0].fs, p }));
        list.filter((b) => b.t === 'img').forEach((b) => items2.push({ t: 'i', y: b.im.y, im: b.im })); items2.sort((a, b) => a.y - b.y);
        items2.forEach((it) => {
          if (it.t === 'i') {
            const im = Object.assign({}, it.im); const sc = Math.min(1, cw / im.w); im.w *= sc; im.h *= sc;
            const cen = Math.abs(it.im.x + it.im.w / 2 - mid) < cw * 0.08; const jc = cen ? 'center' : (it.im.x + it.im.w / 2 > mid + cw * 0.25 ? 'right' : 'left');
            xml += '<w:p><w:pPr><w:keepNext w:val="0"/><w:spacing w:before="' + Math.min(tw(Math.max(0, it.im.y - cursor)), 20000) + '" w:after="0" w:line="' + tw(im.h + 2) + '" w:lineRule="atLeast"/><w:ind w:left="' + (jc === 'left' ? tw(Math.max(0, it.im.x - L)) : 0) + '"/><w:jc w:val="' + jc + '"/></w:pPr>' + drawing(im, im.rid, false, im.id) + '</w:p>';
            cursor = Math.max(cursor, it.im.y) + im.h; return;
          }
          const p = it.p, rs = p.rows, first = rs[0]; const pitch = rs.length > 1 ? (rs[rs.length - 1].base - first.base) / (rs.length - 1) : 0;
          const H = pitch || first.fs * 1.2; const picsOf = (r) => r.segs.flatMap((sg) => sg.runs.filter((q) => q.pic).map((q) => q.pic)); const rowPicH = (r) => Math.max(0, ...picsOf(r).map((e) => e.h)); const hasPics = rs.some((r) => picsOf(r).length);
          const top = hasPics ? Math.min(...rs.map((r) => (picsOf(r).length ? Math.min(...picsOf(r).map((e) => e.y)) : r.base - BASE * H))) : first.base - BASE * H;
          let jc = p.align; if (jc === 'left' && rs.length >= 2 && rs.slice(0, -1).every((q) => q.x1 >= L + cw * 0.93)) jc = 'both';
          const left = rs.length > 1 ? Math.min(...rs.slice(1).map((q) => q.x0)) - L : first.x0 - L; const firstLine = rs.length > 1 ? first.x0 - (left + L) : 0;
          let tabs = ''; if (!p.single) tabs = '<w:tabs>' + first.segs.slice(1).map((sg) => '<w:tab w:val="left" w:pos="' + tw(sg.x0 - L) + '"/>').join('') + '</w:tabs>';
          xml += '<w:p><w:pPr>' + tabs + '<w:spacing w:before="' + Math.min(tw(Math.max(0, top - cursor)), 20000) + '" w:after="0" w:line="' + tw(H) + '" w:lineRule="' + (rs.some((q) => q.segs.some((sg) => sg.runs.some((r) => r.pic))) ? 'atLeast' : 'exact') + '"/><w:ind w:left="' + (jc === 'left' || jc === 'both' ? tw(Math.max(0, left)) : 0) + '" w:firstLine="' + (firstLine > 0 ? tw(firstLine) : 0) + '"' + (firstLine < 0 ? ' w:hanging="' + tw(-firstLine) + '"' : '') + '/><w:jc w:val="' + jc + '"/></w:pPr>' + paraRuns(p) + '</w:p>';
          cursor = Math.max(cursor, top) + (hasPics ? Math.max(H, rs.reduce((a, r) => a + Math.max(H, rowPicH(r)), 0)) : H * rs.length);
        });
        return { xml, cursor };
      };
      let G = Tm; let bandNo = 0;
      bands.forEach((band, bi) => {
        let xml = '', endCursor = G;
        if (band.kind === 'full') { const r = emitBlocks(band.blocks, Lm, pg.w - Rm, G); xml = r.xml; endCursor = r.cursor; }
        else {
          const parts = [];
          for (let c = 0; c < K; c++) { const lst = band.blocks.filter((b) => b.c === c); if (!lst.length) continue; const r = emitBlocks(lst, c === 0 ? Lm : colL[c], c === K - 1 ? pg.w - Rm : colR[c], G); parts.push(r.xml); endCursor = Math.max(endCursor, r.cursor); }
          parts.forEach((x) => { xml += x; }); // columns flow naturally: left column text continues into the right column
        }
        G = endCursor; if (!xml) return;
        const lastBand = last && bi === bands.length - 1;
        const sect = '<w:sectPr><w:type w:val="' + (bandNo === 0 ? 'nextPage' : 'continuous') + '"/>' + pgSz + pgMar + colsXml(band.kind === 'col') + '</w:sectPr>'; bandNo++;
        if (lastBand) body += xml + sect; else { const i = xml.lastIndexOf('</w:pPr>'); body += xml.slice(0, i) + sect + xml.slice(i); }
      });
      if (!bands.length) { const sect = '<w:sectPr><w:type w:val="nextPage"/>' + pgSz + pgMar + '<w:cols w:num="1"/></w:sectPr>'; if (last) body += '<w:p><w:pPr>' + tiny + '</w:pPr></w:p>' + sect; else body += '<w:p><w:pPr>' + tiny + sect + '</w:pPr></w:p>'; }
    }
    pd.destroy();
    const enc = new TextEncoder();
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const files = [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/_rels/document.xml.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + media.map((m) => '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.name + '"/>').join('') + '</Relationships>') },
      { name: 'word/document.xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + '</w:body></w:document>') },
    ].concat(media.map((m) => ({ name: 'word/media/' + m.name, data: m.data })));
    return { blob: PD.zip(files), words, images: media.length };
  };
})();
