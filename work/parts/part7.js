/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — PART 7 · CLOUD BRIDGE  (Prompt-pack Section 0.5 + 3 + 9 + 12)
   ───────────────────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   The app declares a Firebase integration surface — window.rankSparkFirebase
   with signInWithGoogle / signOut / saveUserSnapshot / loadUserSnapshot /
   submitRankedAttempt / loadLeaderboard / deleteAccountData — and nine call
   sites guard on `window.rankSparkFirebase?.enabled`.

   It never initialises. Two independent reasons, both verified at runtime:

     1. It is loaded via three relative <script src> tags —
        firebase-config.js, idb-cache.js, firebase-adapter.js — and none of
        those files were ever shipped.
     2. The app runs from a `blob:` URL inside the landing shell's iframe.
        A blob: document has no resolvable base URL, so a relative src can
        never load even if the files existed.

   Net effect today: `typeof window.rankSparkFirebase === 'undefined'`, so
   cloud sync, Google auth and the leaderboard are silently dead, and every
   admin-side integration would target a hook that never exists.

   This module is that missing adapter, written to work from a blob: origin:
   the SDK is imported from an absolute https:// URL, and configuration is
   read from a global / localStorage rather than a sibling file.

   It also implements the client half of the admin contract:
     • Section 3  — batched remote config with TTL cache + last-known-good
     • Section 9  — announcement banners with per-message dismissal
     • Section 12 — maintenance screen with bypass allowlist + countdown

   MOCK MODE
   With no Firebase config present the adapter still installs and reports
   enabled:false. Every method resolves against localStorage instead of
   throwing, so the app behaves exactly as it does today and nothing
   regresses before real keys are added.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;

  /* Fail loudly in the console, never to the user. */
  function warn(m, e) { try { console.warn('[RankSpark/cloud] ' + m, e || ''); } catch (_) {} }

  function APP() { return W.__rsApp || null; }
  function toast(m) {
    var a = APP();
    if (a && a.showToast) { try { return a.showToast(m); } catch (e) {} }
  }
  function readJSON(k, d) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  /* ─── configuration discovery ────────────────────────────────────────────
     Order matters: an explicitly injected global beats stored config, so a
     host page can override without clearing the user's browser state.       */
  var CFG_KEY = 'rankspark-firebase-config';
  function firebaseConfig() {
    var c = W.RANKSPARK_FIREBASE_CONFIG;
    if (c && c.apiKey && c.projectId) return c;
    c = readJSON(CFG_KEY, null);
    if (c && c.apiKey && c.projectId) return c;
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REMOTE CONFIG  (Section 3)
     One batched read, cached with a short TTL, plus a last-known-good copy
     that survives an outage. `configVersion` lets the admin bust the cache
     early via the "Force refresh all clients" action.
     ═══════════════════════════════════════════════════════════════════════ */
  var TTL_MS = 5 * 60 * 1000;
  var K_CACHE = 'rankspark-remote-config';
  var K_GOOD  = 'rankspark-remote-config-lkg';
  var K_SEEN  = 'rankspark-msg-dismissed';

  /* Shipping defaults. Also the fallback when Firestore is unreachable and no
     last-known-good exists yet, so the app is never blocked by the network. */
  var DEFAULTS = {
    configVersion: 0,
    maintenance: { enabled: false, message: '', allowedUids: [], scheduledStart: null, scheduledEnd: null },
    featureFlags: {
      leaderboard: true,
      rankedSubmissions: true,
      paperLab: true,
      cloudSync: true
    },
    minAppVersion: 0,
    messages: [],
    pricing: null
  };

  var remote = null;   // resolved config for this page load

  function mergeConfig(base, patch) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    if (!patch) return out;
    Object.keys(patch).forEach(function (k) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && base[k]) {
        out[k] = mergeConfig(base[k], patch[k]);
      } else if (patch[k] !== undefined && patch[k] !== null) {
        out[k] = patch[k];
      }
    });
    return out;
  }

  function cachedConfig() {
    var c = readJSON(K_CACHE, null);
    if (c && c.at && (Date.now() - c.at) < TTL_MS) return c.data;
    return null;
  }
  function lastKnownGood() { return readJSON(K_GOOD, null); }

  function applyConfig(cfg) {
    remote = mergeConfig(DEFAULTS, cfg || {});
    W.RS_CONFIG = remote;

    applyFlags(remote.featureFlags);
    applyMaintenance(remote.maintenance);
    applyMessages(remote.messages);

    try {
      W.dispatchEvent(new CustomEvent('rankspark-config', { detail: remote }));
    } catch (e) {}
    return remote;
  }

  /* ─── feature flags ────────────────────────────────────────────────────
     Flags hide surfaces rather than delete data, so flipping one back on
     restores the feature intact.                                          */
  function applyFlags(f) {
    if (!f) return;
    var css = D.getElementById('rs-flags');
    if (!css) { css = D.createElement('style'); css.id = 'rs-flags'; D.head.appendChild(css); }
    var rules = [];
    if (f.leaderboard === false) {
      rules.push('[data-view="leaderboard"]{display:none!important}');
      rules.push('#page-leaderboard{display:none!important}');
    }
    if (f.paperLab === false) rules.push('[data-paper-lab],#plm-open{display:none!important}');
    css.textContent = rules.join('');
    D.body.setAttribute('data-flags', Object.keys(f).filter(function (k) { return f[k]; }).join(' '));
  }

  /* ─── maintenance screen  (Section 12) ─────────────────────────────────
     A full on-brand takeover, not an alert(). Admin uids in allowedUids
     bypass it so QA can verify a release while users are locked out.      */
  function applyMaintenance(m) {
    var host = D.getElementById('rs-maint');
    var uid = (APP() && APP().state.auth && APP().state.auth.uid) || '';
    var bypass = m && Array.isArray(m.allowedUids) && m.allowedUids.indexOf(uid) >= 0;

    var live = !!(m && m.enabled);
    /* A scheduled window only counts once it has actually started. */
    if (live && m.scheduledStart) {
      var s = Date.parse(m.scheduledStart);
      if (isFinite(s) && Date.now() < s) live = false;
    }
    if (live && m.scheduledEnd) {
      var e = Date.parse(m.scheduledEnd);
      if (isFinite(e) && Date.now() > e) live = false;
    }

    if (!live || bypass) {
      if (host) host.remove();
      D.body.classList.remove('rs-maint-on');
      return;
    }
    if (host) return;   // already showing

    host = D.createElement('div');
    host.id = 'rs-maint';
    host.setAttribute('role', 'alertdialog');
    host.setAttribute('aria-live', 'assertive');
    host.innerHTML =
      '<div class="rs-maint-card">' +
        '<div class="rs-maint-badge">Scheduled maintenance</div>' +
        '<h1>We are making RankSpark better</h1>' +
        '<p>' + escapeHTML(m.message || 'RankSpark is briefly offline for maintenance. Your progress is safe — nothing has been lost.') + '</p>' +
        (m.scheduledEnd ? '<div class="rs-maint-count" id="rs-maint-count"></div>' : '') +
        '<button class="rs-maint-retry" id="rs-maint-retry">Check again</button>' +
      '</div>';
    D.body.appendChild(host);
    D.body.classList.add('rs-maint-on');

    var btn = D.getElementById('rs-maint-retry');
    if (btn) btn.addEventListener('click', function () { refreshConfig(true); });

    if (m.scheduledEnd) {
      var el = D.getElementById('rs-maint-count');
      var end = Date.parse(m.scheduledEnd);
      var tick = function () {
        if (!D.getElementById('rs-maint-count')) return;
        var ms = end - Date.now();
        if (ms <= 0) { refreshConfig(true); return; }
        var h = Math.floor(ms / 3600000), mn = Math.floor(ms % 3600000 / 60000), s2 = Math.floor(ms % 60000 / 1000);
        el.textContent = 'Back in ' + (h ? h + 'h ' : '') + mn + 'm ' + s2 + 's';
        setTimeout(tick, 1000);
      };
      tick();
    }
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  /* ─── announcement banners  (Section 9) ────────────────────────────────
     Delivered inside the same config payload — no extra round trip.
     Dismissal is keyed by message id + updatedAt, so editing a message
     re-shows it to users who dismissed the previous revision.             */
  function applyMessages(list) {
    var old = D.getElementById('rs-msg-wrap');
    if (old) old.remove();
    if (!Array.isArray(list) || !list.length) return;

    var seen = readJSON(K_SEEN, {});
    var now = Date.now();
    var a = APP();
    var signedIn = !!(a && a.state.auth && a.state.auth.isLoggedIn);

    var active = list.filter(function (m) {
      if (!m || !m.id || m.enabled === false) return false;
      if (m.startAt && isFinite(Date.parse(m.startAt)) && now < Date.parse(m.startAt)) return false;
      if (m.endAt && isFinite(Date.parse(m.endAt)) && now > Date.parse(m.endAt)) return false;
      if (m.audience === 'guests' && signedIn) return false;
      if (m.audience === 'users' && !signedIn) return false;
      if (seen[m.id] === (m.updatedAt || 1)) return false;
      return true;
    });
    if (!active.length) return;

    var wrap = D.createElement('div');
    wrap.id = 'rs-msg-wrap';
    wrap.innerHTML = active.slice(0, 2).map(function (m) {
      return '<div class="rs-msg" data-k="' + escapeHTML(m.style || 'info') + '" data-id="' + escapeHTML(m.id) + '">' +
        '<span class="rs-msg-t">' + escapeHTML(m.text || '') + '</span>' +
        (m.ctaLabel && m.ctaHref
          ? '<a class="rs-msg-cta" href="' + escapeHTML(m.ctaHref) + '" target="_blank" rel="noopener">' +
            escapeHTML(m.ctaLabel) + '</a>' : '') +
        '<button class="rs-msg-x" aria-label="Dismiss">&times;</button></div>';
    }).join('');
    D.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('.rs-msg-x');
      if (!x) return;
      var row = x.closest('.rs-msg');
      var id = row.getAttribute('data-id');
      var m = active.filter(function (z) { return z.id === id; })[0];
      seen[id] = (m && m.updatedAt) || 1;
      writeJSON(K_SEEN, seen);
      row.style.height = row.offsetHeight + 'px';
      requestAnimationFrame(function () { row.classList.add('out'); });
      setTimeout(function () { row.remove(); if (!wrap.children.length) wrap.remove(); }, 260);
    });
  }

  /* ─── the actual fetch ────────────────────────────────────────────────── */
  var db = null, fb = null, authMod = null;

  async function fetchRemote() {
    if (!db || !fb) throw new Error('offline');
    var appDoc = await fb.getDoc(fb.doc(db, 'config', 'app'));
    var priceDoc = await fb.getDoc(fb.doc(db, 'config', 'pricing'));
    var msgSnap = await fb.getDocs(
      fb.query(fb.collection(db, 'messages'), fb.where('enabled', '==', true), fb.limit(10))
    );
    var messages = [];
    msgSnap.forEach(function (d) { messages.push(Object.assign({ id: d.id }, d.data())); });
    var merged = Object.assign({}, appDoc.exists() ? appDoc.data() : {}, {
      pricing: priceDoc.exists() ? priceDoc.data() : null,
      messages: messages
    });
    return merged;
  }

  async function refreshConfig(force) {
    if (!force) {
      var c = cachedConfig();
      if (c) return applyConfig(c);
    }
    try {
      var data = await fetchRemote();
      writeJSON(K_CACHE, { at: Date.now(), data: data });
      writeJSON(K_GOOD, data);
      return applyConfig(data);
    } catch (e) {
      /* Degrade in order: stale cache → last known good → shipped defaults. */
      var stale = readJSON(K_CACHE, null);
      var good = lastKnownGood();
      if (force) warn('config refresh failed, using fallback', e);
      return applyConfig((stale && stale.data) || good || null);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ADAPTER — the exact surface the app already calls
     ═══════════════════════════════════════════════════════════════════════ */
  function installMock(reason) {
    var api = {
      enabled: false,
      mode: 'local',
      reason: reason,
      /* Every method resolves rather than rejects: the nine call sites in the
         app treat a rejection as a user-visible failure toast, and there is no
         failure here — local-only is a valid, working state. */
      signInWithGoogle: function () {
        toast('Cloud sign-in is not configured yet. Continuing in Guest mode.');
        return Promise.resolve(null);
      },
      signOut: function () { return Promise.resolve(); },
      saveUserSnapshot: function (snap) { writeJSON('rankspark-cloud-snapshot', snap); return Promise.resolve(); },
      loadUserSnapshot: function () { return Promise.resolve(readJSON('rankspark-cloud-snapshot', null)); },
      submitRankedAttempt: function () { return Promise.resolve({ queued: true, local: true }); },
      loadLeaderboard: function () { return Promise.resolve(null); },
      deleteAccountData: function () {
        try { localStorage.removeItem('rankspark-cloud-snapshot'); } catch (e) {}
        return Promise.resolve();
      },
      refreshConfig: refreshConfig,
      getConfig: function () { return remote; }
    };
    W.rankSparkFirebase = api;
    try { W.dispatchEvent(new CustomEvent('rankspark-firebase-ready', { detail: api })); } catch (e) {}
    return api;
  }

  async function installReal(cfg) {
    /* Absolute https:// specifier — a relative import cannot resolve from a
       blob: document, which is exactly why the original adapter never loaded. */
    var BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
    var appMod = await import(BASE + 'firebase-app.js');
    var fsMod  = await import(BASE + 'firebase-firestore.js');
    authMod    = await import(BASE + 'firebase-auth.js');

    var app = appMod.initializeApp(cfg);
    db = fsMod.getFirestore(app);
    fb = fsMod;
    var auth = authMod.getAuth(app);

    /* Offline persistence is best-effort: it throws in multi-tab or private
       browsing, and neither is a reason to lose cloud sync. */
    try { await fsMod.enableIndexedDbPersistence(db); } catch (e) { /* expected */ }

    var uidNow = function () { return auth.currentUser ? auth.currentUser.uid : null; };

    authMod.onAuthStateChanged(auth, function (user) {
      try {
        W.dispatchEvent(new CustomEvent('rankspark-auth-changed', { detail: user }));
      } catch (e) {}
      /* Maintenance bypass depends on the signed-in uid. */
      if (remote) applyMaintenance(remote.maintenance);
    });

    var api = {
      enabled: true,
      mode: 'firebase',
      projectId: cfg.projectId,

      /* Google sign-in.

         Popup vs redirect: popup is used because the app lives in an iframe,
         where a redirect would navigate the FRAME and lose the mounted
         document. If the popup is blocked we say so instead of failing mute.

         The error codes below are the three that are actually reachable in
         production, and each one previously surfaced as an identical
         "Google sign-in failed" toast, which made them undiagnosable. */
      signInWithGoogle: async function () {
        var p = new authMod.GoogleAuthProvider();
        try {
          var r = await authMod.signInWithPopup(auth, p);
          return r.user;
        } catch (e) {
          var code = (e && e.code) || '';
          if (code === 'auth/unauthorized-domain') {
            var host = location.hostname;
            var err = new Error(
              host
                ? ('This domain (' + host + ') is not authorised in Firebase. ' +
                   'Add it under Authentication → Settings → Authorised domains.')
                : ('Sign-in cannot run from this context: the page reports no ' +
                   'hostname, which Firebase always rejects.'));
            err.code = code; err.hostname = host;
            warn('unauthorized-domain; location.hostname=' + JSON.stringify(host), e);
            throw err;
          }
          if (code === 'auth/popup-blocked') {
            var b = new Error('Your browser blocked the sign-in popup. Allow popups for this site and try again.');
            b.code = code; throw b;
          }
          if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
            var c = new Error('Sign-in was cancelled.');
            c.code = code; c.cancelled = true; throw c;
          }
          throw e;
        }
      },
      signOut: function () { return authMod.signOut(auth); },

      saveUserSnapshot: async function (snap) {
        var uid = uidNow(); if (!uid) return;
        await fsMod.setDoc(
          fsMod.doc(db, 'users', uid),
          Object.assign({}, snap, { updatedAt: fsMod.serverTimestamp() }),
          { merge: true }
        );
      },
      loadUserSnapshot: async function () {
        var uid = uidNow(); if (!uid) return null;
        var d = await fsMod.getDoc(fsMod.doc(db, 'users', uid));
        return d.exists() ? d.data() : null;
      },

      submitRankedAttempt: async function (attempt) {
        var uid = uidNow(); if (!uid) throw new Error('not signed in');
        /* Deterministic id from the attempt makes retries idempotent — a
           flaky network can never double-count a ranked submission. */
        var id = uid + '_' + (attempt.attemptId || Date.now());
        await fsMod.setDoc(fsMod.doc(db, 'rankedAttempts', id),
          Object.assign({}, attempt, { uid: uid, receivedAt: fsMod.serverTimestamp() }));
        return { id: id };
      },

      loadLeaderboard: async function () {
        var q = fsMod.query(fsMod.collection(db, 'users'),
          fsMod.orderBy('progress.rankedXp', 'desc'), fsMod.limit(50));
        var snap = await fsMod.getDocs(q);
        var rows = [];
        snap.forEach(function (d) {
          var v = d.data() || {};
          rows.push({
            uid: d.id,
            displayName: (v.profile && v.profile.displayName) || 'Learner',
            photoURL: (v.profile && v.profile.photoURL) || '',
            rankedXp: (v.progress && v.progress.rankedXp) || 0,
            level: (v.progress && v.progress.level) || 1,
            accuracy: (v.progress && v.progress.accuracy) || 0,
            totalTests: (v.progress && v.progress.totalTests) || 0,
            streak: (v.progress && v.progress.streak) || 0
          });
        });
        return rows;
      },

      deleteAccountData: async function () {
        var uid = uidNow(); if (!uid) return;
        await fsMod.deleteDoc(fsMod.doc(db, 'users', uid));
      },

      /* Presence heartbeat (Section 7). Deliberately opt-in and throttled —
         a 30s write per active user is the single most expensive pattern in
         this design, so it only runs when the admin flag turns it on. */
      heartbeat: async function (view) {
        if (!remote || !remote.featureFlags || !remote.featureFlags.presence) return;
        var uid = uidNow() || ('anon_' + (readJSON('rankspark-device-id', null) || ''));
        if (!uid) return;
        await fsMod.setDoc(fsMod.doc(db, 'sessions', uid), {
          uid: uid, view: view || 'home',
          lastSeen: fsMod.serverTimestamp(),
          ua: navigator.userAgent.slice(0, 120)
        }, { merge: true });
      },

      refreshConfig: refreshConfig,
      getConfig: function () { return remote; },
      _db: db, _fs: fsMod, _auth: auth
    };

    /* The host's loginDemo() catches every failure and shows one fixed
       string — "Google sign-in failed. Staying in Guest mode." — which hides
       the actual cause (unauthorised domain, blocked popup, plain cancel).
       Surfacing the real reason here is a two-line wrapper; rewriting the
       host call site would be a larger, riskier edit for the same result. */
    var rawSignIn = api.signInWithGoogle;
    api.signInWithGoogle = function () {
      return rawSignIn().catch(function (e) {
        if (!e || !e.cancelled) toast((e && e.message) || 'Google sign-in failed.');
        throw e;
      });
    };

    W.rankSparkFirebase = api;
    try { W.dispatchEvent(new CustomEvent('rankspark-firebase-ready', { detail: api })); } catch (e) {}
    return api;
  }

  /* ─── boot ─────────────────────────────────────────────────────────────
     Config is applied from cache synchronously-ish so maintenance mode can
     take effect on the very first paint, then refreshed from the network.  */
  async function boot() {
    applyConfig(cachedConfig() || lastKnownGood() || null);

    var cfg = firebaseConfig();
    if (!cfg) {
      installMock('no-config');
      return;
    }
    try {
      await installReal(cfg);
      await refreshConfig(true);
    } catch (e) {
      warn('Firebase init failed — falling back to local mode', e);
      installMock('init-failed');
    }
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Public helper so the admin app / console can point this build at a
     project without editing the file. */
  W.RankSparkCloud = {
    setConfig: function (cfg) {
      if (!cfg || !cfg.apiKey || !cfg.projectId) throw new Error('Invalid Firebase config');
      writeJSON(CFG_KEY, cfg);
      if (W.RSP && W.RSP.reload) W.RSP.reload(); else location.reload();
    },
    clearConfig: function () {
      try { localStorage.removeItem(CFG_KEY); } catch (e) {}
      if (W.RSP && W.RSP.reload) W.RSP.reload(); else location.reload();
    },
    status: function () {
      var a = W.rankSparkFirebase || {};
      return { enabled: !!a.enabled, mode: a.mode || 'none', reason: a.reason || null,
               configVersion: remote ? remote.configVersion : null };
    },
    refresh: function () { return refreshConfig(true); },
    config: function () { return remote; }
  };
})();
