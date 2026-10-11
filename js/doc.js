/* PDF Do — document model, history, open/close, recent files */
(function () {
  'use strict';
  const PD = window.PD;
  const { h } = PD;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  /* tiny pubsub */
  const subs = {};
  PD.on = (e, f) => { (subs[e] = subs[e] || []).push(f); };
  PD.emit = (e, a) => { (subs[e] || []).forEach((f) => { try { f(a); } catch (err) { console.error(err); } }); };

  PD.imgs = {}; // image store: id -> dataURL (shared by overlay objects so history snapshots stay light)

  class Doc {
    constructor(name, bytes, handle) {
      this.id = PD.uid('d');
      this.name = name || 'Untitled.pdf';
      this.handle = handle || null;
      this.ov = {};           // pageIndex -> [objects]
      this.hist = [];
      this.hi = -1;
      this.savedAt = 0;       // history index that matches the file on disk
      this.zoom = 1;
      this.fit = 'width';
      this.layout = 'continuous';
      this.cur = 0;           // current page index
      this.textCache = new Map();
      this.pageCache = new Map();
      this.pw = null;
      this.rotView = 0;
      this.created = Date.now();
    }
    get n() { return this.pdf ? this.pdf.numPages : 0; }
    get dirty() { return this.hi !== this.savedAt; }

    async load(bytes) {
      if (this.pdf) { try { this.pdf.destroy(); } catch (e) { /* ignore */ } }
      this.textCache.clear(); this.pageCache.clear();
      this.bytes = bytes;
      const self = this;
      const task = pdfjsLib.getDocument({
        data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/',
        password: this.pw || undefined, isEvalSupported: false,
      });
      task.onPassword = async (update, reason) => {
        const wrong = reason === 2;
        const pw = await PD.prompt(wrong ? 'Incorrect password' : 'Password required', 'This PDF is protected. Enter its password to open it.', '', 'password');
        if (pw == null) { task.destroy(); return; }
        self.pw = pw; update(pw);
      };
      this.pdf = await task.promise;
      this.info = [];
      const total = this.pdf.numPages;
      for (let s = 1; s <= total; s += 24) {
        const batch = []; for (let i = s; i < Math.min(total + 1, s + 24); i++) batch.push(this.pdf.getPage(i));
        const pgs = await Promise.all(batch);
        pgs.forEach((p, k) => { const vp = p.getViewport({ scale: 1 }); this.pageCache.set(s - 1 + k, p); this.info.push({ w: vp.width, h: vp.height, rot: p.rotate }); });
      }
      this.cur = PD.clamp(this.cur, 0, Math.max(0, this.n - 1));
    }
    async page(i) { let p = this.pageCache.get(i); if (!p) { p = await this.pdf.getPage(i + 1); this.pageCache.set(i, p); } return p; }

    snapshot(label) {
      this.hist = this.hist.slice(0, this.hi + 1);
      this.hist.push({ bytes: this.bytes, ov: PD.clone(this.ov), label: label || '' });
      if (this.hist.length > 60) { this.hist.shift(); this.savedAt--; }
      this.hi = this.hist.length - 1;
      PD.emit('doc:history', this);
    }
    async restore(idx) {
      const s = this.hist[idx]; if (!s) return;
      this.hi = idx;
      const sameBytes = s.bytes === this.bytes;
      this.ov = PD.clone(s.ov);
      if (!sameBytes) { await this.load(s.bytes); PD.emit('doc:reload', this); }
      else PD.emit('doc:overlay', this);
      PD.emit('doc:history', this);
    }
    async undo() { if (this.hi > 0) { await this.restore(this.hi - 1); } }
    async redo() { if (this.hi < this.hist.length - 1) { await this.restore(this.hi + 1); } }
    // Replace the PDF bytes (structural edit); overlay must already be baked or intentionally kept
    async commit(bytes, label, keepOverlay) {
      if (!keepOverlay) this.ov = {};
      await this.load(bytes);
      this.snapshot(label);
      PD.emit('doc:reload', this);
    }
    objCount() { let c = 0; for (const k in this.ov) c += this.ov[k].length; return c; }
  }
  PD.Doc = Doc;

  PD.setCurrent = function (doc) {
    PD.cur = doc;
    PD.emit('doc:switch', doc);
  };

  PD.openBytes = async function (bytes, name, handle, opts) {
    opts = opts || {};
    const doc = new Doc(name, bytes, handle);
    try {
      await doc.load(bytes);
    } catch (e) {
      console.error(e);
      if (e && e.name === 'PasswordException') throw new Error('Password was not provided');
      throw new Error('Could not open "' + (name || 'file') + '": ' + (e && e.message ? e.message : 'invalid or corrupted PDF'));
    }
    doc.snapshot('Open'); doc.savedAt = opts.dirty ? -1 : 0;
    PD.docs.push(doc);
    PD.setCurrent(doc);
    PD.emit('docs:changed');
    if (!opts.noRecent) PD.recent.add(doc, handle);
    return doc;
  };

  PD.openFiles = async function (items) {
    let last = null;
    for (const it of items) {
      const f = it.file;
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
        if (/^image\//.test(f.type)) { PD.toast('Image dropped — use Convert → Images to PDF', 'info'); continue; }
      }
      const b = PD.busy('Opening ' + f.name);
      try { last = await PD.openBytes(await PD.readFile(f), f.name, it.handle); }
      catch (e) { PD.toast(e.message, 'error'); }
      finally { b.done(); }
    }
    return last;
  };

  PD.openDialog = async function () {
    const files = await PD.pickFiles({ accept: '.pdf,application/pdf', multiple: true, desc: 'PDF documents' });
    if (files.length) await PD.openFiles(files);
  };

  PD.closeDoc = async function (doc, force) {
    if (!force && doc.dirty) {
      const r = await PD.modal({ title: 'Close "' + doc.name + '"?', icon: 'info', content: h('p', { class: 'muted' }, 'This document has changes that have not been saved.'),
        buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard changes', kind: 'danger', value: 'discard' }, { label: 'Save', kind: 'primary', value: 'save' }] });
      if (r === 'cancel' || r === undefined) return false;
      if (r === 'save') { const ok = await PD.save(doc); if (!ok) return false; }
    }
    const i = PD.docs.indexOf(doc);
    PD.docs.splice(i, 1);
    try { doc.pdf && doc.pdf.destroy(); } catch (e) { /* ignore */ }
    PD.idb.del('recover', doc.id);
    if (PD.cur === doc) PD.setCurrent(PD.docs[Math.min(i, PD.docs.length - 1)] || null);
    PD.emit('docs:changed');
    return true;
  };

  /* ---------- recent files ---------- */
  PD.recent = {
    list() { return PD.store.get('recent', []); },
    async add(doc, handle) {
      let l = PD.recent.list().filter((r) => r.name !== doc.name);
      const rec = { id: PD.uid('r'), name: doc.name, size: doc.bytes.length, at: Date.now(), pages: doc.n, pinned: false };
      const prev = PD.recent.list().find((r) => r.name === doc.name); if (prev && prev.pinned) rec.pinned = true;
      l.unshift(rec);
      if (handle) await PD.idb.set('handles', rec.id, handle);
      // keep 14 non-pinned + pinned
      const pinned = l.filter((r) => r.pinned), rest = l.filter((r) => !r.pinned).slice(0, 14);
      PD.store.set('recent', pinned.concat(rest).sort((a, b) => b.at - a.at));
      PD.emit('recent:changed');
    },
    pin(id) { const l = PD.recent.list(); const r = l.find((x) => x.id === id); if (r) { r.pinned = !r.pinned; PD.store.set('recent', l); PD.emit('recent:changed'); } },
    remove(id) { PD.store.set('recent', PD.recent.list().filter((r) => r.id !== id)); PD.idb.del('handles', id); PD.emit('recent:changed'); },
    clear() { PD.store.set('recent', PD.recent.list().filter((r) => r.pinned)); PD.emit('recent:changed'); },
    async open(id) {
      const hd = await PD.idb.get('handles', id);
      if (!hd) { PD.toast('This file’s location was not remembered — please open it again.', 'info'); return PD.openDialog(); }
      try {
        if (hd.requestPermission && (await hd.queryPermission({ mode: 'read' })) !== 'granted') await hd.requestPermission({ mode: 'read' });
        const f = await hd.getFile();
        return PD.openFiles([{ file: f, handle: hd }]);
      } catch (e) { PD.toast('Could not open that file — it may have moved.', 'error'); }
    },
  };

  /* ---------- auto-save recovery ---------- */
  PD.recover = {
    async stash() {
      for (const d of PD.docs) {
        if (!d.dirty) { PD.idb.del('recover', d.id); continue; }
        const imgs = {}; JSON.stringify(d.ov, (k, v) => { if (k === 'img' && PD.imgs[v]) imgs[v] = PD.imgs[v]; return v; });
        await PD.idb.set('recover', d.id, { name: d.name, bytes: d.bytes, ov: d.ov, imgs, at: Date.now() });
      }
    },
    async offer() {
      const all = await PD.idb.all('recover');
      if (!all.length) return;
      const r = await PD.modal({ title: 'Recover unsaved work?', icon: 'clock', sub: 'PDF Do found documents that were open when the app last closed.',
        content: h('ul', { class: 'plain-list' }, all.map((a) => h('li', null, h('b', null, a.value.name), h('span', { class: 'muted' }, ' · ' + new Date(a.value.at).toLocaleString())))),
        buttons: [{ label: 'Discard', value: 'no' }, { label: 'Recover', kind: 'primary', value: 'yes' }] });
      for (const a of all) {
        if (r === 'yes') {
          try {
            Object.assign(PD.imgs, a.value.imgs || {});
            const d = await PD.openBytes(a.value.bytes, a.value.name, null, { noRecent: true, dirty: true });
            d.ov = a.value.ov || {}; d.hist = []; d.hi = -1; d.snapshot('Recovered'); d.savedAt = -1;
            PD.emit('doc:overlay', d);
          } catch (e) { /* ignore */ }
        }
        PD.idb.del('recover', a.key);
      }
    },
  };
  setInterval(() => PD.recover.stash(), 30000);
  window.addEventListener('beforeunload', (e) => { PD.recover.stash(); if (PD.docs.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
})();
