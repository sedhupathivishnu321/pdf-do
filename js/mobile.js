/* PDF Do - phone behaviour: drawers, pinch-zoom, Android back button, status bar. Loaded last. */
(function () {
  'use strict';
  const PD = (window.PD = window.PD || {});
  const $ = (s) => document.querySelector(s);
  const mq = window.matchMedia('(max-width: 820px)');
  const cap = window.Capacitor;
  const plug = (n) => (cap && cap.Plugins && cap.Plugins[n]) || null;

  function closeDrawers() {
    PD.leftOpen = false; PD.inspOpen = false;
    document.body.classList.remove('has-left', 'has-insp');
  }
  function apply() {
    document.body.classList.toggle('mobile', mq.matches);
    if (mq.matches) closeDrawers();
    setTimeout(() => { try { PD.viewer && PD.viewer.applyFit && PD.viewer.applyFit(); } catch (e) { } }, 280);
  }
  apply();
  (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));

  // only one drawer at a time; tapping outside closes them
  const btnL = $('#btn-left'), btnI = $('#btn-insp');
  if (btnL) btnL.addEventListener('click', () => { if (mq.matches && document.body.classList.contains('has-left')) { PD.inspOpen = false; document.body.classList.remove('has-insp'); } }, true);
  if (btnI) btnI.addEventListener('click', () => { if (mq.matches && document.body.classList.contains('has-insp')) { PD.leftOpen = false; document.body.classList.remove('has-left'); } }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!mq.matches) return;
    const b = document.body;
    if (!(b.classList.contains('has-left') || b.classList.contains('has-insp'))) return;
    if (e.target.closest('#leftpanel,#inspector,#btn-left,#btn-insp,.m-back,#palette')) return;
    closeDrawers();
  }, true);
  // opening a PDF or switching mode on a phone should not leave a drawer covering the page
  PD.on && PD.on('mode:changed', () => { if (mq.matches) closeDrawers(); });

  // two-finger pinch zoom on the page view
  const sc = $('#scroll');
  if (sc) {
    let d0 = 0, busy = false;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    sc.addEventListener('touchstart', (e) => { if (e.touches.length === 2) d0 = dist(e.touches); }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const d = dist(e.touches), f = d / d0;
      if (busy || Math.abs(f - 1) < 0.04) return;
      busy = true; d0 = d;
      requestAnimationFrame(() => { try { PD.viewer.zoomBy(f); } catch (er) { } busy = false; });
    }, { passive: false });
    sc.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }

  // native shell (Capacitor): status bar + Android back button
  const App = plug('App'), SB = plug('StatusBar');
  if (PD.native) {
    document.documentElement.classList.add('native');
    try { SB && SB.setStyle && SB.setStyle({ style: 'DARK' }); SB && SB.setBackgroundColor && SB.setBackgroundColor({ color: '#0b0916' }); } catch (e) { }
    if (App && App.addListener) {
      App.addListener('backButton', () => {
        if (document.querySelector('.m-back')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
        if (document.body.classList.contains('has-left') || document.body.classList.contains('has-insp')) { closeDrawers(); return; }
        if (PD.mode && PD.mode !== 'home') { PD.setMode('home'); return; }
        App.exitApp && App.exitApp();
      });
    }
  }
})();
