/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK PREMIUM — OUTER SHELL BRIDGE
   The landing nav has a "Pricing" link pointing at a dead #pricing anchor.
   Wire it so it launches the app and lands directly on the Plans view.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var appLive = false;
  var pending = null;

  /* The embedded app announces itself once its scripts have run. */
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.rsp !== 'ready') return;
    appLive = true;
    if (pending) { send(pending); pending = null; }
  });

  function send(view) {
    var f = document.getElementById('appFrame');
    if (!f || !f.contentWindow) return false;
    try { f.contentWindow.postMessage({ rsp: 'go', view: view }, '*'); return true; }
    catch (err) { return false; }
  }

  function openApp(view) {
    var stage = document.getElementById('appStage');
    var cta = document.getElementById('ctaSpark');

    /* Reuse the existing launch path so the reveal animation, preload and
       audio/haptic feedback all behave exactly as they do for "Let's Spark". */
    if (stage && !stage.classList.contains('show')) {
      if (cta && !cta.disabled) cta.click();
      else stage.classList.add('show');
    }

    if (appLive) send(view);
    else {
      pending = view;
      /* Fallback: if the app never announces (older payload), retry briefly. */
      var tries = 0;
      var iv = setInterval(function () {
        if (appLive || tries++ > 40) { clearInterval(iv); return; }
        if (send(view)) { /* keep trying until ready confirms */ }
      }, 250);
    }
  }

  function wire() {
    var links = document.querySelectorAll('a[href="#pricing"], [data-cur="pricing"]');
    Array.prototype.forEach.call(links, function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openApp('pricing');
      });
    });

    /* Direct deep link: ranksparks.html#pricing */
    if (location.hash === '#pricing') setTimeout(function () { openApp('pricing'); }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
