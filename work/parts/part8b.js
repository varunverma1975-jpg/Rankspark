/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — PART 8b · PACK LIBRARY UI
   ───────────────────────────────────────────────────────────────────────────
   Adds Download / Open / Delete / Update to the EXISTING book cards by
   decorating renderPackSelector() rather than replacing it. The card markup,
   grid, categories and click-to-open behaviour all stay exactly as they were;
   this only adds the states a remote pack needs.

   Interception strategy: the app binds its own click handler inside
   renderPackSelector(). Rather than fight it, we attach a capture-phase
   listener that runs FIRST for remote packs, does the download, seeds
   state.packFiles, and then lets the original handler proceed — so the
   existing loadBookFull() path runs untouched.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  function APP() { return W.__rsApp || null; }
  function ST() { var a = APP(); return a && a.state; }
  function P() { return W.RankSparkPacks; }
  function toast(m) { var a = APP(); if (a && a.showToast) { try { a.showToast(m); } catch (e) {} } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  /* ── ask for persistent storage ───────────────────────────────────────
     Without this, a browser under disk pressure can silently evict several
     GB of downloaded packs. Requested once, quietly. */
  (async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        var already = await navigator.storage.persisted();
        if (!already) await navigator.storage.persist();
      }
    } catch (e) {}
  })();

  /* ═════════════════════════════════════════════════════════════════════
     CARD DECORATION
     ═════════════════════════════════════════════════════════════════════ */
  function decorate() {
    var s = ST(); if (!s || !P()) return;
    D.querySelectorAll('[data-book-id]').forEach(function (card) {
      var id = card.getAttribute('data-book-id');
      var pack = s.loadedPacks.get(id);
      if (!pack || !pack.remote) return;              // device-imported: leave alone
      if (card.querySelector('.rsp-dl')) return;      // already decorated

      var r = pack.remote;
      var bar = D.createElement('div');
      bar.className = 'rsp-dl';

      if (pack.loaded) {
        bar.innerHTML = '<span class="rsp-dl-s ok">Open</span>' +
          '<button class="rsp-dl-x" data-pack-del="' + esc(id) + '" title="Delete download">&times;</button>';
      } else if (pack.downloaded) {
        bar.innerHTML = '<span class="rsp-dl-s ready">Ready offline</span>' +
          (pack.updateAvailable
            ? '<button class="rsp-dl-b upd" data-pack-upd="' + esc(id) + '">Update</button>'
            : '') +
          '<button class="rsp-dl-x" data-pack-del="' + esc(id) + '" title="Delete download">&times;</button>';
      } else if (pack.partial) {
        bar.innerHTML = '<button class="rsp-dl-b" data-pack-get="' + esc(id) + '">Resume · ' +
          P().fmtBytes(Math.max(0, r.size - pack.partialBytes)) + ' left</button>';
      } else {
        bar.innerHTML = '<button class="rsp-dl-b" data-pack-get="' + esc(id) + '">Download · ' +
          P().fmtBytes(r.size) + '</button>';
      }
      card.appendChild(bar);

      /* Meta line: subject + version, using data already in the manifest. */
      if (r.subject || r.version) {
        var meta = card.querySelector('.book-cover-info small');
        if (meta && !pack.downloaded && !pack.loaded) {
          meta.textContent = [r.subject, r.version ? 'v' + r.version : ''].filter(Boolean).join(' · ') || 'Tap to download';
        }
      }
    });
    if (P().lazyCovers) P().lazyCovers();
  }

  /* Re-decorate whenever the app re-renders its selector. */
  function hookRender() {
    if (!W.renderPackSelector || W.renderPackSelector.__rsp) return;
    var orig = W.renderPackSelector;
    var wrapped = function () {
      var out = orig.apply(this, arguments);
      setTimeout(decorate, 0);
      return out;
    };
    wrapped.__rsp = 1;
    W.renderPackSelector = wrapped;
  }

  /* The selector is re-rendered by code we do not control, so also watch
     the container. Cheap: childList only, and decorate() is idempotent. */
  function observe() {
    var host = D.getElementById('practice-pack-selector');
    if (!host || host.__rspObs) return;
    host.__rspObs = 1;
    new MutationObserver(function () { setTimeout(decorate, 0); })
      .observe(host, { childList: true, subtree: false });
  }

  /* ═════════════════════════════════════════════════════════════════════
     PROGRESS UI — reuses the card's existing loading overlay markup
     ═════════════════════════════════════════════════════════════════════ */
  function showProgress(id, pct, info) {
    var card = D.querySelector('[data-book-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    var ov = card.querySelector('.rsp-prog');
    if (!ov) {
      ov = D.createElement('div');
      ov.className = 'rsp-prog';
      ov.innerHTML = '<div class="rsp-prog-ring"><svg viewBox="0 0 44 44">' +
        '<circle cx="22" cy="22" r="19" class="t"/><circle cx="22" cy="22" r="19" class="f"/></svg>' +
        '<b>0%</b></div><small class="rsp-prog-t"></small><small class="rsp-prog-e"></small>' +
        '<button class="rsp-prog-x" data-pack-stop="' + esc(id) + '">Pause</button>';
      card.appendChild(ov);
    }
    var c = 2 * Math.PI * 19;
    var f = ov.querySelector('.f');
    if (f) { f.style.strokeDasharray = c; f.style.strokeDashoffset = c - (pct / 100) * c; }
    var b = ov.querySelector('b'); if (b) b.textContent = Math.round(pct) + '%';
    var t = ov.querySelector('.rsp-prog-t'); if (t && info) t.textContent = info.text || '';
    var e = ov.querySelector('.rsp-prog-e');
    if (e && info) e.textContent = [info.rate, info.eta].filter(Boolean).join(' · ');
  }
  function clearProgress(id) {
    var card = D.querySelector('[data-book-id="' + CSS.escape(id) + '"]');
    var ov = card && card.querySelector('.rsp-prog');
    if (ov) ov.remove();
  }

  /* ═════════════════════════════════════════════════════════════════════
     ACTIONS
     ═════════════════════════════════════════════════════════════════════ */
  async function getPack(id, thenOpen) {
    var s = ST(); var pack = s && s.loadedPacks.get(id);
    if (!pack) return;
    if (P().isDownloading(id)) { toast('Already downloading.'); return; }

    /* Keep RAM flat: drop other packs' ZIP blobs before pulling a new one. */
    P().releaseOthers(id);

    showProgress(id, 0, { text: 'Starting…' });
    try {
      await P().ensureLocal(id, function (pct, info) { showProgress(id, pct, info); });
      clearProgress(id);
      pack.downloaded = true; pack.partial = false; pack.updateAvailable = false;
      toast('Downloaded. Opening…');
      if (W.renderPackSelector) W.renderPackSelector();
      if (thenOpen) openPack(id);
    } catch (e) {
      clearProgress(id);
      if (W.renderPackSelector) W.renderPackSelector();
      toast(e && e.message ? e.message : 'Download failed.');
    }
  }

  /* Hand off to the app's own card handler so the existing engine path
     (loadBookFull → JSZip → normalise → render) runs unchanged. */
  function openPack(id) {
    var card = D.querySelector('[data-book-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    card.__rspAllow = 1;
    card.click();
  }

  /* ═════════════════════════════════════════════════════════════════════
     CLICK INTERCEPT (capture phase, so it runs before the app's handler)
     ═════════════════════════════════════════════════════════════════════ */
  D.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var get = t.closest('[data-pack-get]');
    if (get) { e.preventDefault(); e.stopPropagation(); getPack(get.dataset.packGet, true); return; }

    var upd = t.closest('[data-pack-upd]');
    if (upd) {
      e.preventDefault(); e.stopPropagation();
      var uid = upd.dataset.packUpd;
      P().remove(uid).then(function () { getPack(uid, true); });
      return;
    }

    var stop = t.closest('[data-pack-stop]');
    if (stop) {
      e.preventDefault(); e.stopPropagation();
      P().cancel(stop.dataset.packStop);
      clearProgress(stop.dataset.packStop);
      toast('Paused. Your progress is saved — tap Resume to continue.');
      setTimeout(function () { if (W.renderPackSelector) W.renderPackSelector(); }, 250);
      return;
    }

    var del = t.closest('[data-pack-del]');
    if (del) {
      e.preventDefault(); e.stopPropagation();
      var did = del.dataset.packDel;
      var s = ST(); var pk = s && s.loadedPacks.get(did);
      if (!W.confirm('Delete the downloaded copy of "' + ((pk && pk.name) || did) +
                     '"?\n\nYour progress, bookmarks and analytics are NOT affected. ' +
                     'You can download it again any time.')) return;
      P().remove(did).then(function () {
        toast('Download deleted.');
        if (W.renderPackSelector) W.renderPackSelector();
      });
      return;
    }

    /* Tapping the card body for a remote pack that is not downloaded yet:
       download first, then let the normal open flow run. */
    var card = t.closest('[data-book-id]');
    if (!card) return;
    if (card.__rspAllow) { card.__rspAllow = 0; return; }   // our own re-dispatch
    var s2 = ST(); if (!s2) return;
    var pack = s2.loadedPacks.get(card.getAttribute('data-book-id'));
    if (!pack || !pack.remote) return;                      // device pack: untouched
    if (pack.loaded) return;                                // already open
    var have = pack.downloaded && s2.packFiles && s2.packFiles[pack.id];
    if (have) return;                                       // blob ready, let it open

    e.preventDefault(); e.stopPropagation();
    if (pack.downloaded) {
      /* On disk but not in memory this session — hydrate, then open. */
      P().ensureLocal(pack.id).then(function () { openPack(pack.id); })
        .catch(function (err) { toast(err.message || 'Could not open this pack.'); });
    } else {
      getPack(pack.id, true);
    }
  }, true);

  /* ═════════════════════════════════════════════════════════════════════
     STORAGE SUMMARY — added to the practice book card header
     ═════════════════════════════════════════════════════════════════════ */
  async function storageLine() {
    if (!P()) return;
    var card = D.getElementById('practice-book-card');
    if (!card) return;
    var est = await P().storage();
    if (!est) return;
    var el = D.getElementById('rsp-store');
    if (!el) {
      el = D.createElement('div');
      el.id = 'rsp-store';
      el.className = 'rsp-store';
      var head = card.querySelector('.section-title') || card.firstElementChild;
      if (head && head.parentNode) head.parentNode.insertBefore(el, head.nextSibling);
      else card.appendChild(el);
    }
    var used = est.usage || 0, quota = est.quota || 0;
    var pct = quota ? Math.min(100, (used / quota) * 100) : 0;
    el.innerHTML =
      '<div class="rsp-store-b"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="rsp-store-t"><span>' + P().fmtBytes(used) + ' used offline</span>' +
      '<span>' + (quota ? P().fmtBytes(quota) + ' available' : '') + '</span></div>';
  }

  /* ─── boot ───────────────────────────────────────────────────────────── */
  function boot() {
    hookRender();
    observe();
    decorate();
    storageLine();
  }
  W.addEventListener('rankspark-catalog', function () {
    hookRender(); observe(); setTimeout(decorate, 60); storageLine();
  });
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 200);
  setTimeout(boot, 1200);   // after the app's own late init
})();
