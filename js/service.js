/* PDF Do - client for the bundled local conversion service (PyMuPDF + Tesseract OCR). Present only when the app was started
   through PDFDo.exe; the URL then carries ?svc=PORT&tok=TOKEN. Everything stays on 127.0.0.1. */
(function () {
  'use strict';
  const PD = window.PD;
  const S = (PD.svc = { ready: false, ocr: false, base: null, tok: null });
  try {
    const q = new URLSearchParams(location.search);
    let port = q.get('svc'), tok = q.get('tok');
    if (port && tok) { sessionStorage.setItem('pdfdo.svc', JSON.stringify({ port, tok })); }
    else { const s = JSON.parse(sessionStorage.getItem('pdfdo.svc') || 'null'); if (s) { port = s.port; tok = s.tok; } }
    if (port && /^\d+$/.test(port) && /^[0-9a-f]{32}$/.test(tok || '')) { S.base = 'http://127.0.0.1:' + port; S.tok = tok; }
  } catch (e) { /* ignore */ }

  S.fetch = (path, opts) => { opts = opts || {}; opts.headers = Object.assign({ 'X-PDFDo-Token': S.tok }, opts.headers || {}); return fetch(S.base + path, opts); };

  S.check = async function () {
    if (!S.base) return false;
    try {
      const r = await S.fetch('/api/health'); const j = await r.json();
      S.ready = !!j.ok; S.ocr = !!j.ocr; S.limits = j.limits;
    } catch (e) { S.ready = false; }
    PD.emit('svc:changed', S);
    return S.ready;
  };

  // Convert PDF bytes to .docx on the local service. opts: {ocr, lang, pages, math_as_image, tables}. Returns {blob, report, name}.
  S.convertDocx = async function (bytes, name, opts, busy) {
    opts = opts || {};
    const fd = new FormData();
    fd.append('file', new File([bytes], PD.baseName(name) + '.pdf', { type: 'application/pdf' }));
    fd.append('ocr', opts.ocr || 'auto'); fd.append('mode', opts.mode || 'layout'); fd.append('lang', opts.lang || 'eng'); fd.append('pages', opts.pages || '');
    fd.append('math_as_image', opts.math_as_image === false ? 'false' : 'true'); fd.append('tables', opts.tables === false ? 'false' : 'true');
    let r = await S.fetch('/api/convert', { method: 'POST', body: fd });
    let j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'The conversion service rejected the file');
    const id = j.job_id;
    try {
      for (;;) {
        await PD.sleep(500);
        r = await S.fetch('/api/jobs/' + id); j = await r.json();
        if (!r.ok) throw new Error(j.detail || 'The conversion job was lost');
        if (busy) busy.set(j.progress, j.message || 'Converting…');
        if (j.status === 'error') throw new Error(j.error || 'Conversion failed');
        if (j.status === 'done') break;
      }
      const d = await S.fetch('/api/jobs/' + id + '/download');
      if (!d.ok) throw new Error('Could not download the converted file');
      return { blob: await d.blob(), report: j.report, name: j.name };
    } finally { S.fetch('/api/jobs/' + id, { method: 'DELETE' }).catch(() => {}); }
  };
})();
