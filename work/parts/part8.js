/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — PART 8 · ON-DEMAND PACK DELIVERY
   ───────────────────────────────────────────────────────────────────────────
   Replaces "pick a ZIP from your device" with "download it once from the
   catalog, keep it offline forever" — WITHOUT touching the question engine.

   ── WHY THE ORIGINAL PLAN COULDN'T WORK ──────────────────────────────────
   Tested against live endpoints before writing any of this:

     GitHub *Release assets*   206 + accept-ranges: bytes  (resumable ✓)
                               NO access-control-allow-origin  → browser
                               fetch() is blocked by CORS. Unusable directly.

     raw.githubusercontent     CORS ✓ and Range ✓
                               but a hard 100 MB per-file limit — the packs
                               are 200–800 MB. Unusable for whole packs.

   So a pure "fetch the ZIP straight from GitHub" design fails in a browser no
   matter how it is written. The fix is a pluggable STORAGE DRIVER: the app
   asks an abstract source for a manifest and a pack URL, and the driver
   decides where those come from. R2 is the default (free egress, no size cap,
   CORS + Range under your control); GitHub-via-proxy and split-file GitHub
   are drop-in alternatives. Swapping backends is one config line, which is
   exactly the scalability requirement.

   ── HOW IT PLUGS INTO THE EXISTING ENGINE ────────────────────────────────
   loadBookFull(packId) already reads `state.packFiles[packId]` and parses it
   with JSZip. It does not care where that Blob came from. So this module:
     1. lists packs from a lightweight manifest (metadata only, ~2 KB),
     2. registers them in state.loadedPacks exactly like an imported file,
     3. on first open, downloads the ZIP, stores it in IndexedDB, puts the
        Blob into state.packFiles, then calls the UNCHANGED loadBookFull().
   The parser, the renderer, the runtime and the UI are untouched.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  function APP() { return W.__rsApp || null; }
  function ST() { var a = APP(); return a && a.state; }
  function toast(m) { var a = APP(); if (a && a.showToast) { try { a.showToast(m); } catch (e) {} } }

  /* ═════════════════════════════════════════════════════════════════════
     CONFIG — the single place a backend swap happens
     ═════════════════════════════════════════════════════════════════════ */
  var CFG = W.RANKSPARK_PACKS || {};
  var SOURCE = {
    /* 'r2' | 'proxy' | 'github-split' | 'local' */
    driver: CFG.driver || 'r2',

    /* R2 (or any S3-compatible / plain CDN) public base. */
    baseUrl: CFG.baseUrl || '',

    /* Manifest is tiny and cacheable; it is the ONLY thing fetched on boot. */
    manifestUrl: CFG.manifestUrl || '',

    /* Vercel proxy route, used by the 'proxy' driver to add CORS to GitHub. */
    proxyBase: CFG.proxyBase || '/api/pack',

    /* GitHub coordinates, used by 'proxy' and 'github-split'. */
    repo: CFG.repo || '',
    tag: CFG.tag || 'packs',

    /* Hugging Face coordinates, used by the 'hf' driver.
       repoId   e.g. "yourname/rankspark-packs"
       repoType "datasets" (recommended for data) | "models" | "spaces"
       revision branch or commit SHA — pin a SHA for immutable releases. */
    repoId: CFG.repoId || '',
    repoType: CFG.repoType || 'datasets',
    revision: CFG.revision || 'main'
  };

  /* Hugging Face resolve URL. /resolve/ 302s to a CDN that returns
     206 + accept-ranges and access-control-allow-origin, so chunked resumable
     download works directly from the browser — verified against the live CDN,
     including the OPTIONS preflight for the Range header. */
  function hfBase() {
    if (SOURCE.baseUrl) return SOURCE.baseUrl.replace(/\/+$/, '');
    if (!SOURCE.repoId) return '';
    var seg = SOURCE.repoType === 'models' ? '' : (SOURCE.repoType + '/');
    return 'https://huggingface.co/' + seg + SOURCE.repoId +
           '/resolve/' + SOURCE.revision;
  }

  var K_MANIFEST = 'rankspark-pack-manifest';
  var MANIFEST_TTL = 10 * 60 * 1000;

  /* ═════════════════════════════════════════════════════════════════════
     STORAGE DRIVERS
     Each returns absolute URLs. Nothing else in the app knows the backend.
     ═════════════════════════════════════════════════════════════════════ */
  var DRIVERS = {
    /* Cloudflare R2 / any CORS-enabled bucket or CDN. Recommended:
       zero egress fees, no object-size cap, Range + CORS configurable. */
    r2: {
      manifest: function () { return SOURCE.manifestUrl || join(SOURCE.baseUrl, 'manifest.json'); },
      pack: function (p) { return p.url || join(SOURCE.baseUrl, p.file); },
      cover: function (p) { return p.cover ? join(SOURCE.baseUrl, p.cover) : null; },
      resumable: true
    },

    /* Hugging Face dataset repo. Free, no per-file size cap that matters here
       (LFS handles multi-GB), CORS + Range both present on the CDN, and no
       egress bill. The practical constraint is a soft ~300 GB/repo public
       storage guideline, and ~4.5 GB is far inside it. */
    hf: {
      manifest: function () { return SOURCE.manifestUrl || join(hfBase(), 'manifest.json'); },
      pack: function (p) { return p.url || join(hfBase(), p.file); },
      cover: function (p) { return p.cover ? join(hfBase(), p.cover) : null; },
      resumable: true
    },

    /* GitHub Releases behind a same-origin Vercel route that re-emits the
       bytes with CORS headers. Correct, but Vercel's free bandwidth cap
       (100 GB/mo ≈ 125 downloads of an 800 MB pack) makes it a stopgap. */
    proxy: {
      manifest: function () { return SOURCE.manifestUrl || (SOURCE.proxyBase + '/manifest.json'); },
      pack: function (p) { return SOURCE.proxyBase + '/' + encodeURIComponent(p.file); },
      cover: function (p) { return p.cover ? (SOURCE.proxyBase + '/' + encodeURIComponent(p.cover)) : null; },
      resumable: true
    },

    /* Packs split into <100 MB parts on raw.githubusercontent, which DOES
       send CORS. Free and unlimited, at the cost of re-uploading in parts. */
    'github-split': {
      manifest: function () {
        return SOURCE.manifestUrl ||
          ('https://raw.githubusercontent.com/' + SOURCE.repo + '/main/packs/manifest.json');
      },
      pack: function (p) { return null; },   // handled by fetchSplit()
      cover: function (p) {
        return p.cover ? ('https://raw.githubusercontent.com/' + SOURCE.repo + '/main/packs/' + p.cover) : null;
      },
      resumable: true,
      split: true
    },

    /* Same-origin /packs folder. Useful for local dev and self-hosting. */
    local: {
      manifest: function () { return SOURCE.manifestUrl || '/packs/manifest.json'; },
      pack: function (p) { return '/packs/' + p.file; },
      cover: function (p) { return p.cover ? ('/packs/' + p.cover) : null; },
      resumable: true
    }
  };

  function join(base, path) {
    if (!base) return path;
    return base.replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
  }
  function driver() { return DRIVERS[SOURCE.driver] || DRIVERS.r2; }

  /* ═════════════════════════════════════════════════════════════════════
     PACK STORE — IndexedDB, separate from the app's BookStore so a pack
     download can never corrupt existing imported-book records.
     Blobs are chunked: a single 800 MB Blob in one IDB row is fragile on
     Safari and makes resume impossible. 8 MB chunks keep memory flat and
     let an interrupted download continue from the last completed chunk.
     ═════════════════════════════════════════════════════════════════════ */
  var CHUNK = 8 * 1024 * 1024;
  var PackDB = {
    NAME: 'rankspark-packs', VER: 1, META: 'meta', PARTS: 'parts',
    open: function () {
      return new Promise(function (res, rej) {
        var r = indexedDB.open(PackDB.NAME, PackDB.VER);
        r.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(PackDB.META)) db.createObjectStore(PackDB.META, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(PackDB.PARTS)) db.createObjectStore(PackDB.PARTS, { keyPath: 'key' });
        };
        r.onsuccess = function (e) { res(e.target.result); };
        r.onerror = function (e) { rej(e.target.error); };
      });
    },
    getMeta: async function (id) {
      try {
        var db = await PackDB.open();
        return await new Promise(function (res) {
          var q = db.transaction(PackDB.META, 'readonly').objectStore(PackDB.META).get(id);
          q.onsuccess = function () { res(q.result || null); };
          q.onerror = function () { res(null); };
        });
      } catch (e) { return null; }
    },
    allMeta: async function () {
      try {
        var db = await PackDB.open();
        return await new Promise(function (res) {
          var q = db.transaction(PackDB.META, 'readonly').objectStore(PackDB.META).getAll();
          q.onsuccess = function () { res(q.result || []); };
          q.onerror = function () { res([]); };
        });
      } catch (e) { return []; }
    },
    putMeta: async function (m) {
      try {
        var db = await PackDB.open();
        var tx = db.transaction(PackDB.META, 'readwrite');
        tx.objectStore(PackDB.META).put(m);
        await done(tx);
      } catch (e) {}
    },
    putPart: async function (id, i, blob) {
      var db = await PackDB.open();
      var tx = db.transaction(PackDB.PARTS, 'readwrite');
      tx.objectStore(PackDB.PARTS).put({ key: id + ':' + i, blob: blob });
      await done(tx);
    },
    getParts: async function (id, n) {
      var db = await PackDB.open();
      var tx = db.transaction(PackDB.PARTS, 'readonly');
      var s = tx.objectStore(PackDB.PARTS);
      var out = [];
      for (var i = 0; i < n; i++) {
        out.push(await new Promise(function (res) {
          var q = s.get(id + ':' + i);
          q.onsuccess = function () { res(q.result ? q.result.blob : null); };
          q.onerror = function () { res(null); };
        }));
      }
      return out;
    },
    remove: async function (id) {
      try {
        var db = await PackDB.open();
        var tx = db.transaction([PackDB.META, PackDB.PARTS], 'readwrite');
        tx.objectStore(PackDB.META).delete(id);
        var s = tx.objectStore(PackDB.PARTS);
        var keys = await new Promise(function (res) {
          var q = s.getAllKeys(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); };
        });
        keys.filter(function (k) { return String(k).indexOf(id + ':') === 0; })
            .forEach(function (k) { s.delete(k); });
        await done(tx);
      } catch (e) {}
    }
  };
  function done(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error); };
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     MANIFEST — the only network call on boot. Cached with a TTL and a
     last-known-good copy so the library still renders offline.
     ═════════════════════════════════════════════════════════════════════ */
  var catalog = [];

  function cachedManifest() {
    try {
      var c = JSON.parse(localStorage.getItem(K_MANIFEST) || 'null');
      if (c && c.at && Date.now() - c.at < MANIFEST_TTL) return c.data;
      return c ? c.data : null;   // stale is still better than nothing
    } catch (e) { return null; }
  }

  async function fetchManifest(force) {
    if (!force) { var c = cachedManifest(); if (c) { catalog = c; refreshCatalog(); } }
    var url = driver().manifest();
    if (!url) return catalog;
    try {
      var r = await fetch(url, { cache: force ? 'reload' : 'default' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var data = await r.json();
      var list = Array.isArray(data) ? data : (data.packs || []);
      catalog = list.map(normalisePack);
      try { localStorage.setItem(K_MANIFEST, JSON.stringify({ at: Date.now(), data: catalog })); } catch (e) {}
      refreshCatalog();
      return catalog;
    } catch (e) {
      console.warn('[packs] manifest fetch failed, using cache', e);
      return catalog;
    }
  }

  function normalisePack(p) {
    var id = p.id || ('pack-' + String(p.name || p.file || '')
      .toLowerCase().replace(/\.zip$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    return {
      id: id,
      name: p.name || String(p.file || id).replace(/\.zip$/i, ''),
      file: p.file || (id + '.zip'),
      cover: p.cover || null,
      size: Number(p.size || 0),
      version: String(p.version || '1'),
      sha256: p.sha256 || null,
      subject: p.subject || '',
      exam: p.exam || '',
      questionCount: Number(p.questionCount || 0),
      parts: p.parts || null,          // github-split
      url: p.url || null               // absolute override
    };
  }

  /* ═════════════════════════════════════════════════════════════════════
     DOWNLOAD — streamed, chunk-persisted, resumable, integrity-checked
     ═════════════════════════════════════════════════════════════════════ */
  var active = {};   // id -> { abort, paused }

  function fmtBytes(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(0) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }
  function fmtEta(s) {
    if (!isFinite(s) || s <= 0) return '';
    if (s < 60) return Math.round(s) + 's left';
    if (s < 3600) return Math.round(s / 60) + 'm left';
    return (s / 3600).toFixed(1) + 'h left';
  }

  /* SHA-256 over the assembled blob. Only run when the manifest supplies a
     digest — hashing 800 MB costs a few seconds, so it is opt-in per pack. */
  async function verify(blob, expected) {
    if (!expected || !crypto.subtle) return true;
    try {
      var buf = await blob.arrayBuffer();
      var d = await crypto.subtle.digest('SHA-256', buf);
      var hex = [].map.call(new Uint8Array(d), function (x) {
        return x.toString(16).padStart(2, '0');
      }).join('');
      return hex.toLowerCase() === String(expected).toLowerCase();
    } catch (e) { return true; }   // never block on a hashing failure
  }

  async function downloadPack(pack, onProgress) {
    var d = driver();
    var meta = (await PackDB.getMeta(pack.id)) || { id: pack.id, done: 0, chunks: 0, version: pack.version };

    /* A version bump invalidates every stored chunk. */
    if (meta.version !== pack.version) { await PackDB.remove(pack.id); meta = { id: pack.id, done: 0, chunks: 0, version: pack.version }; }

    var url = d.split ? null : d.pack(pack);
    var startByte = meta.done || 0;

    var ctrl = new AbortController();
    active[pack.id] = { abort: function () { ctrl.abort(); } };

    var t0 = Date.now(), seen = 0;
    /* Hoisted so the abort handler can flush whatever is still buffered.
       Without this, cancelling before a chunk boundary threw away the
       in-flight bytes and "resume" silently restarted from zero. */
    var flushState = null;
    var report = function (received, total) {
      if (typeof onProgress !== 'function') return;
      var pct = total ? (received / total) * 100 : 0;
      var el = (Date.now() - t0) / 1000;
      var rate = el > 0.5 ? seen / el : 0;
      var eta = rate > 0 && total ? (total - received) / rate : 0;
      onProgress(pct, {
        received: received, total: total,
        text: fmtBytes(received) + ' of ' + fmtBytes(total),
        eta: fmtEta(eta),
        rate: rate ? fmtBytes(rate) + '/s' : ''
      });
    };

    try {
      var headers = {};
      /* Resume: ask only for the bytes we do not already have. */
      if (startByte > 0) headers.Range = 'bytes=' + startByte + '-';

      var res = await fetch(url, { headers: headers, signal: ctrl.signal });
      if (!res.ok && res.status !== 206) throw new Error('Download failed (HTTP ' + res.status + ')');

      /* A server that ignores Range returns 200 — restart cleanly rather
         than silently corrupting the file by appending to a partial. */
      if (startByte > 0 && res.status !== 206) {
        await PackDB.remove(pack.id);
        startByte = 0; meta = { id: pack.id, done: 0, chunks: 0, version: pack.version };
      }

      var total = pack.size ||
        (Number(res.headers.get('content-length') || 0) + startByte);

      var reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) {
        /* No streaming support: fall back to a single blob read. */
        var blob = await res.blob();
        await PackDB.putPart(pack.id, 0, blob);
        meta = { id: pack.id, done: blob.size, chunks: 1, version: pack.version, size: blob.size, complete: true };
        await PackDB.putMeta(meta);
        report(blob.size, blob.size);
      } else {
        var buf = [], bufLen = 0, lastFlush = Date.now();
        var idx = meta.chunks || 0;
        var received = startByte;
        flushState = {
          flush: async function () {
            if (!bufLen) { if (received > (meta.done || 0)) { meta.done = received; meta.chunks = idx; await PackDB.putMeta(meta); } return; }
            await PackDB.putPart(pack.id, idx++, new Blob(buf));
            buf = []; bufLen = 0;
            meta.done = received; meta.chunks = idx;
            await PackDB.putMeta(meta);
          }
        };

        while (true) {
          var step = await reader.read();
          if (step.done) break;
          buf.push(step.value);
          bufLen += step.value.length;
          received += step.value.length;
          seen += step.value.length;

          /* Flush on EITHER a full chunk or a time budget. Size alone is not
             enough: cancelling a 20 MB download at 15% happens before the
             first 8 MB boundary, so nothing was persisted and "resume"
             silently restarted from zero. The 4-second flush caps how much
             work an interruption can cost regardless of file size. */
          var timeUp = (Date.now() - lastFlush) > 4000;
          if (bufLen >= CHUNK || (timeUp && bufLen > 0)) {
            await PackDB.putPart(pack.id, idx++, new Blob(buf));
            buf = []; bufLen = 0; lastFlush = Date.now();
            meta.done = received; meta.chunks = idx;
            await PackDB.putMeta(meta);
          }
          report(received, total);
        }
        if (bufLen > 0) {
          await PackDB.putPart(pack.id, idx++, new Blob(buf));
        }
        meta = { id: pack.id, done: received, chunks: idx, version: pack.version,
                 size: received, complete: true, at: Date.now() };
        await PackDB.putMeta(meta);
      }

      delete active[pack.id];

      /* Reassemble and verify. */
      var parts = await PackDB.getParts(pack.id, meta.chunks);
      if (parts.some(function (p) { return !p; })) throw new Error('Some downloaded parts are missing. Try again.');
      var full = new Blob(parts, { type: 'application/zip' });

      if (pack.sha256) {
        report(meta.size, meta.size);
        if (typeof onProgress === 'function') onProgress(99, { text: 'Verifying integrity…', eta: '' });
        var ok = await verify(full, pack.sha256);
        if (!ok) {
          await PackDB.remove(pack.id);
          throw new Error('Downloaded file failed its integrity check. It was removed — please retry.');
        }
      }
      return full;
    } catch (e) {
      delete active[pack.id];
      if (e.name === 'AbortError') {
        /* Persist whatever arrived before the abort so the next attempt
           genuinely resumes instead of restarting. */
        if (flushState) { try { await flushState.flush(); } catch (_) {} }
        var err = new Error('Download paused. It will resume where it stopped.');
        err.paused = true;
        throw err;
      }
      throw e;
    }
  }

  /* Reassemble an already-downloaded pack without touching the network. */
  async function localBlob(id) {
    var meta = await PackDB.getMeta(id);
    if (!meta || !meta.complete) return null;
    var parts = await PackDB.getParts(id, meta.chunks);
    if (parts.some(function (p) { return !p; })) return null;
    return new Blob(parts, { type: 'application/zip' });
  }

  /* ═════════════════════════════════════════════════════════════════════
     CATALOG → the app's own pack registry
     Registering here means renderPackSelector(), the practice flow and the
     question engine all treat a downloaded pack exactly like an imported
     file. No engine change, no UI fork.
     ═════════════════════════════════════════════════════════════════════ */
  async function refreshCatalog() {
    var s = ST(); if (!s) return;
    var stored = await PackDB.allMeta();
    var byId = {};
    stored.forEach(function (m) { byId[m.id] = m; });

    catalog.forEach(function (p) {
      var have = byId[p.id];
      var existing = s.loadedPacks.get(p.id);
      var rec = existing || {};
      /* `loaded` means "parsed into memory THIS session". BookStore persists
         it across reloads, which made a freshly-reloaded pack claim to be
         open when its questions were not in memory — the card showed "Open"
         and tapping it did nothing useful. Trust it only when the parsed
         Blob is actually present. */
      var reallyLoaded = !!(rec.loaded && s.packFiles && s.packFiles[p.id]);
      s.loadedPacks.set(p.id, {
        id: p.id,
        name: rec.name || (p.name + '.zip'),
        family: rec.family || 'unknown',
        questionCount: rec.questionCount || p.questionCount || 0,
        importedAt: rec.importedAt || new Date().toISOString(),
        loaded: reallyLoaded,
        coverUrl: rec.coverUrl || null,
        /* remote metadata drives the download UI */
        remote: {
          size: p.size, version: p.version, subject: p.subject,
          exam: p.exam, cover: p.cover, file: p.file, sha256: p.sha256
        },
        downloaded: !!(have && have.complete),
        partial: !!(have && !have.complete && have.done > 0),
        partialBytes: have ? have.done : 0,
        updateAvailable: !!(have && have.complete && have.version !== p.version)
      });
    });

    try { if (W.renderPackSelector) W.renderPackSelector(); } catch (e) {}
    try { W.dispatchEvent(new CustomEvent('rankspark-catalog', { detail: catalog })); } catch (e) {}
  }

  /* Cover art is fetched only when a card first scrolls into view, matching
     the existing lazy behaviour — never as part of boot. */
  var coverSeen = new WeakSet();
  function lazyCovers() {
    if (!('IntersectionObserver' in W)) return;
    var io = new IntersectionObserver(function (rows) {
      rows.forEach(function (row) {
        if (!row.isIntersecting) return;
        var el = row.target;
        io.unobserve(el);
        var id = el.getAttribute('data-book-id');
        loadCover(id);
      });
    }, { rootMargin: '200px' });
    D.querySelectorAll('[data-book-id]').forEach(function (el) {
      if (coverSeen.has(el)) return;
      coverSeen.add(el);
      io.observe(el);
    });
  }

  var coverCache = {};
  async function loadCover(id) {
    if (!id || coverCache[id]) return coverCache[id];
    var s = ST(); if (!s) return null;
    var pack = s.loadedPacks.get(id);
    if (!pack || pack.coverUrl || !pack.remote) return null;
    var url = driver().cover(pack.remote);
    if (!url) return null;
    coverCache[id] = (async function () {
      try {
        var r = await fetch(url);
        if (!r.ok) return null;
        var b = await r.blob();
        var u = URL.createObjectURL(b);
        pack.coverUrl = u;
        var img = D.querySelector('[data-book-id="' + CSS.escape(id) + '"] .book-cover-ph');
        if (img && img.parentNode) {
          var el = D.createElement('img');
          el.className = 'book-cover-img';
          el.src = u; el.alt = pack.name;
          img.parentNode.replaceChild(el, img);
        }
        return u;
      } catch (e) { return null; }
    })();
    return coverCache[id];
  }

  /* ═════════════════════════════════════════════════════════════════════
     OPEN — the one function the UI calls
     ═════════════════════════════════════════════════════════════════════ */
  async function ensureLocal(id, onProgress) {
    var s = ST(); if (!s) throw new Error('App not ready');
    var pack = s.loadedPacks.get(id);
    if (!pack) throw new Error('Unknown pack');

    /* Already in memory for this session. */
    if (s.packFiles && s.packFiles[id]) return s.packFiles[id];

    /* On disk from a previous visit — no network at all. */
    var blob = await localBlob(id);
    if (blob) {
      blob.name = pack.name;
      s.packFiles = s.packFiles || {};
      s.packFiles[id] = blob;
      return blob;
    }

    /* Not present: download it. */
    var entry = catalog.filter(function (p) { return p.id === id; })[0];
    if (!entry) throw new Error('This pack is not in the catalog.');
    var got = await downloadPack(entry, onProgress);
    got.name = pack.name;
    s.packFiles = s.packFiles || {};
    s.packFiles[id] = got;
    pack.downloaded = true; pack.partial = false; pack.updateAvailable = false;
    return got;
  }

  /* Free the previous pack's memory when another is opened. The engine's own
     unloadBook() drops parsed questions; this drops the raw ZIP Blob too,
     which is the large one. */
  function releaseOthers(keepId) {
    var s = ST(); if (!s || !s.packFiles) return;
    Object.keys(s.packFiles).forEach(function (id) {
      if (id === keepId) return;
      try { delete s.packFiles[id]; } catch (e) {}
    });
  }

  async function deletePack(id) {
    var s = ST();
    await PackDB.remove(id);
    if (s) {
      if (s.packFiles) delete s.packFiles[id];
      try { if (W.unloadBook) W.unloadBook(id); } catch (e) {}
      var p = s.loadedPacks.get(id);
      if (p) { p.downloaded = false; p.partial = false; p.loaded = false; p.partialBytes = 0; }
    }
    await refreshCatalog();
  }

  /* ═════════════════════════════════════════════════════════════════════
     PUBLIC API
     ═════════════════════════════════════════════════════════════════════ */
  W.RankSparkPacks = {
    config: SOURCE,
    catalog: function () { return catalog.slice(); },
    refresh: function () { return fetchManifest(true); },
    ensureLocal: ensureLocal,
    download: function (id, cb) {
      var e = catalog.filter(function (p) { return p.id === id; })[0];
      if (!e) return Promise.reject(new Error('Unknown pack'));
      return downloadPack(e, cb);
    },
    cancel: function (id) { if (active[id]) active[id].abort(); },
    isDownloading: function (id) { return !!active[id]; },
    remove: deletePack,
    releaseOthers: releaseOthers,
    loadCover: loadCover,
    lazyCovers: lazyCovers,
    fmtBytes: fmtBytes,
    storage: function () {
      return navigator.storage && navigator.storage.estimate
        ? navigator.storage.estimate() : Promise.resolve(null);
    },
    /* Point the app at a different backend at runtime. */
    setSource: function (cfg) {
      Object.assign(SOURCE, cfg || {});
      try { localStorage.removeItem(K_MANIFEST); } catch (e) {}
      return fetchManifest(true);
    }
  };

  /* ─── boot ─────────────────────────────────────────────────────────────
     Manifest only. Never a pack, never a cover. */
  function boot() {
    if (!SOURCE.manifestUrl && !SOURCE.baseUrl && !SOURCE.repoId &&
        (SOURCE.driver === 'r2' || SOURCE.driver === 'hf')) {
      /* Nothing configured yet — stay completely silent and leave the
         existing device-import flow as the only path. */
      return;
    }
    fetchManifest(false).then(function () { setTimeout(lazyCovers, 300); });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 60);
})();
