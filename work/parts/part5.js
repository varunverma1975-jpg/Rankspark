/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — SETTINGS REDESIGN + FONT PAIRING  (part 5)
   ───────────────────────────────────────────────────────────────────────────
   AUDIT FINDINGS THAT SHAPED THIS
   • 7 stored preferences were never read anywhere: language, subject, timer,
     solutions, dailyGoals, testReminders, streakAlerts. They rendered as
     working controls but changed nothing. Each is now either wired to real
     behaviour or removed.
   • applyPreferences()/savePreference() are declared twice in the host app;
     the first pair is dead (later declaration wins). We call through
     window.__rsSavePreference, which points at the live one.
   • Real capabilities had NO settings UI: document darkening
     (rankspark-png-dark-mode), motion reduction, keyboard shortcuts.
   • Appearance was buried two taps deep inside a modal.

   Everything here is additive. No host function is replaced — the legacy
   groups are hidden and rebuilt, and all writes go through the app's own
   persistence path so existing readers stay correct.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  function APP() { return W.__rsApp || null; }
  function prefs() { var a = APP(); return (a && a.state && a.state.preferences) || {}; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }
  function ico(n, sz) {
    return '<svg class="ui-icon" style="width:' + (sz || 16) + 'px;height:' + (sz || 16) +
           'px" aria-hidden="true"><use href="#icon-' + n + '"></use></svg>';
  }
  function toast(m) {
    var a = APP();
    if (a && a.showToast) { try { return a.showToast(m); } catch (e) {} }
    if (W.showToast) { try { return W.showToast(m); } catch (e) {} }
  }
  /* Route through the app's own savePreference so state, localStorage and
     applyPreferences() all stay in agreement. */
  function setPref(k, v) {
    if (W.__rsSavePreference) { try { W.__rsSavePreference(k, v); return; } catch (e) {} }
    var a = APP(); if (!a) return;
    a.state.preferences[k] = v;
    try { localStorage.setItem('rankspark-preferences', JSON.stringify(a.state.preferences)); } catch (e) {}
  }
  function fx(n) { try { W.__rsFX && W.__rsFX.feedback(n); } catch (e) {} }

  /* ═══════════════════════════════════════════════════════════════════
     A. FONT PAIRING
     Only the weights actually used are requested: 700 for headings
     (800 where the family ships it), 400 + 600 for body.
     ═══════════════════════════════════════════════════════════════════ */
  var PAIRS = {
    system: {
      id: 'system', name: 'RankSpark Sans', note: 'Default interface font',
      heading: { name: 'Inter', role: 'sans' },
      body:    { name: 'Inter', role: 'sans' },
      headingStack: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      bodyStack:    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      css: null, lhHeading: 1.2, lhBody: 1.6, fsBody: 16
    },
    editorial: {
      id: 'editorial', name: 'Editorial', note: 'Playfair Display + Source Sans 3',
      heading: { name: 'Playfair Display', role: 'serif' },
      body:    { name: 'Source Sans 3',    role: 'sans'  },
      headingStack: '"Playfair Display", Georgia, "Times New Roman", serif',
      bodyStack:    '"Source Sans 3", Inter, ui-sans-serif, system-ui, sans-serif',
      css: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700;1,900&family=Source+Sans+3:wght@300;400;600&display=swap',
      lhHeading: 1.15, lhBody: 1.6, fsBody: 17
    },
    poster: {
      id: 'poster', name: 'Poster', note: 'Abril Fatface + Lato',
      heading: { name: 'Abril Fatface', role: 'display' },
      body:    { name: 'Lato',          role: 'sans'    },
      /* Abril Fatface ships a single 400 weight that is already ultra-bold;
         requesting 700 would return the same file, so we ask only for 400
         and never synthesise a faux-bold on top of it. */
      headingStack: '"Abril Fatface", Georgia, serif',
      bodyStack:    'Lato, Inter, ui-sans-serif, system-ui, sans-serif',
      css: 'https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Lato:wght@400;700&display=swap',
      lhHeading: 1.1, lhBody: 1.6, fsBody: 17, headingWeight: 400
    },
    modern: {
      id: 'modern', name: 'Modern', note: 'Young Serif + DM Sans',
      heading: { name: 'Young Serif', role: 'serif' },
      body:    { name: 'DM Sans',     role: 'sans'  },
      /* Young Serif is a single-weight (400) display serif. */
      headingStack: '"Young Serif", Georgia, serif',
      bodyStack:    '"DM Sans", Inter, ui-sans-serif, system-ui, sans-serif',
      css: 'https://fonts.googleapis.com/css2?family=Young+Serif&family=DM+Sans:opsz,wght@9..40,400;9..40,600&display=swap',
      lhHeading: 1.18, lhBody: 1.6, fsBody: 17, headingWeight: 400
    }
  };
  var PAIR_ORDER = ['system', 'editorial', 'poster', 'modern'];
  var K_PAIR = 'rankspark-fontpair';

  var loaded = {};
  /* Idempotent stylesheet injection. Resolves when the faces are usable so
     the preview never measures fallback metrics. */
  function loadPair(id) {
    var p = PAIRS[id];
    if (!p || !p.css) return Promise.resolve();
    if (loaded[id]) return loaded[id];

    loaded[id] = new Promise(function (resolve) {
      var existing = D.querySelector('link[data-fontpair="' + id + '"]');
      var done = function () {
        if (!D.fonts || !D.fonts.load) return resolve();
        /* Explicitly load the exact faces we will paint with. */
        var want = [
          (p.headingWeight || 700) + ' 1em "' + p.heading.name + '"',
          '400 1em "' + p.body.name + '"',
          '600 1em "' + p.body.name + '"'
        ];
        Promise.all(want.map(function (f) {
          return D.fonts.load(f).catch(function () {});
        })).then(function () { resolve(); }, function () { resolve(); });
      };
      if (existing) return done();

      var l = D.createElement('link');
      l.rel = 'stylesheet';
      l.href = p.css;
      l.setAttribute('data-fontpair', id);
      l.crossOrigin = 'anonymous';
      l.onload = done;
      l.onerror = function () { resolve(); };   // offline → keep fallbacks
      D.head.appendChild(l);
      /* Never let a slow network block the UI. */
      setTimeout(done, 2500);
    });
    return loaded[id];
  }

  function currentPair() {
    var id;
    try { id = localStorage.getItem(K_PAIR); } catch (e) {}
    return PAIRS[id] ? id : 'system';
  }

  function applyPair(id, announce) {
    var p = PAIRS[id] || PAIRS.system;
    var root = D.documentElement;

    var paint = function () {
      root.style.setProperty('--font-heading', p.headingStack);
      root.style.setProperty('--font-body', p.bodyStack);
      root.style.setProperty('--lh-heading', String(p.lhHeading));
      root.style.setProperty('--lh-body', String(p.lhBody));
      root.style.setProperty('--fs-body', p.fsBody + 'px');
      root.style.setProperty('--fw-heading', String(p.headingWeight || 700));
      if (p.id === 'system') D.body.removeAttribute('data-fontpair');
      else D.body.setAttribute('data-fontpair', p.id);
    };

    try { localStorage.setItem(K_PAIR, p.id); } catch (e) {}

    if (p.css) loadPair(p.id).then(paint);
    else paint();

    if (announce) toast(p.name + ' typography applied.');
    try { W.dispatchEvent(new CustomEvent('rankspark-fontpair', { detail: { id: p.id } })); } catch (e) {}
  }

  /* Apply before first paint so there is no flash of the default face. */
  applyPair(currentPair(), false);

  /* The editorial headline uses Playfair 900 + Source Sans 300 regardless of
     which pairing is active, so load that pair once on boot. Without this the
     headline falls back to Georgia whenever a non-editorial pairing is set. */
  loadPair('editorial');

  /* ═══════════════════════════════════════════════════════════════════
     B. NEW SETTINGS WIRED TO REAL BEHAVIOUR
     Each of these controls something the app already does but never
     exposed. No gimmicks — every one changes observable behaviour.
     ═══════════════════════════════════════════════════════════════════ */

  /* 1. Motion — the app has a full animation layer (--m-* tokens). Users who
        want calm UI had to change an OS setting. */
  var K_MOTION = 'rankspark-motion';
  function motion() { try { return localStorage.getItem(K_MOTION) || 'full'; } catch (e) { return 'full'; } }
  function applyMotion(v) {
    try { localStorage.setItem(K_MOTION, v); } catch (e) {}
    D.body.setAttribute('data-motion', v);
    var s = D.getElementById('rs-motion-off');
    if (v === 'calm') {
      if (!s) {
        s = D.createElement('style');
        s.id = 'rs-motion-off';
        /* Neutralise the motion tokens rather than blanket-killing animation,
           so functional transitions (toggles) still read as responsive.
           The app declares the --m-* tokens on :root from a <style> block that
           comes LATER in the document than ours, so a plain :root rule of equal
           specificity loses on source order. Scoping to body[data-motion] wins
           on specificity regardless of position. */
        s.textContent =
          'body[data-motion="calm"]{--m-xs:1ms;--m-sm:1ms;--m-md:1ms;--m-lg:1ms;--m-xl:1ms}' +
          'body[data-motion="calm"] .page.active,body[data-motion="calm"] #anx2>.a2-r,' +
          'body[data-motion="calm"] #stx>.st-r,body[data-motion="calm"] #rs-result>*,' +
          'body[data-motion="calm"] .x-in,body[data-motion="calm"] #sv>*,' +
          'body[data-motion="calm"] .quick-grid>*,body[data-motion="calm"] .metric-strip>.metric' +
          '{animation:none!important;opacity:1!important;transform:none!important}';
        D.head.appendChild(s);
      }
    } else if (s) s.remove();
  }
  applyMotion(motion());

  /* 2. Document darkening — real feature that only existed as an unlabelled
        ◐ button inside the runtime header. */
  var K_PNG = 'rankspark-png-dark-mode';
  function pngDark() { try { return localStorage.getItem(K_PNG) === 'true'; } catch (e) { return false; } }
  function applyPngDark(on) {
    try { localStorage.setItem(K_PNG, String(on)); } catch (e) {}
    D.body.classList.toggle('png-doc-dark', on);
    var b = D.getElementById('png-dark-toggle');
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  applyPngDark(pngDark());

  /* 3. Reading width — long analytics/solution text on a 27" monitor runs to
        180 characters. Capping measure is a genuine readability win. */
  var K_WIDTH = 'rankspark-measure';
  function measure() { try { return localStorage.getItem(K_WIDTH) || 'comfortable'; } catch (e) { return 'comfortable'; } }
  function applyMeasure(v) {
    try { localStorage.setItem(K_WIDTH, v); } catch (e) {}
    D.body.setAttribute('data-measure', v);
    var s = D.getElementById('rs-measure');
    if (!s) { s = D.createElement('style'); s.id = 'rs-measure'; D.head.appendChild(s); }
    s.textContent = v === 'wide'
      ? 'body[data-measure="wide"] .content>main{max-width:none}'
      : v === 'narrow'
        ? 'body[data-measure="narrow"] #anx2,body[data-measure="narrow"] #stx,' +
          'body[data-measure="narrow"] #page-pricing{max-width:820px;margin-inline:auto}'
        : '';
  }
  applyMeasure(measure());

  /* ═══════════════════════════════════════════════════════════════════
     C. SECTION MODEL
     ═══════════════════════════════════════════════════════════════════ */
  function themeSwatch(name, cols) {
    var cur = (prefs().appearance || 'Dark');
    return '<button class="st-th' + (cur === name ? ' on' : '') + '" data-st-theme="' + esc(name) + '"' +
      ' role="radio" aria-checked="' + (cur === name) + '" aria-label="' + esc(name) + ' theme">' +
      '<span class="st-th-tick">' + ico('check', 10) + '</span>' +
      '<span class="st-th-p" style="background:' + cols[0] + '">' +
        cols.slice(1).map(function (c, i) {
          return '<i style="background:' + c + ';height:' + (44 - i * 11) + '%"></i>';
        }).join('') +
      '</span><span class="st-th-n">' + esc(name) + '</span></button>';
  }

  function fontCard(id) {
    var p = PAIRS[id];
    var on = currentPair() === id;
    /* Font stacks contain double quotes ("Abril Fatface"). Interpolated raw
       into style="…" they close the attribute early and the declaration is
       dropped — the heading silently falls back to the body face. Escaping
       to &quot; keeps the attribute intact and the CSS valid. */
    var hStack = esc(p.headingStack), bStack = esc(p.bodyStack);
    var hw = p.headingWeight || 700;
    return '<button class="st-fp' + (on ? ' on' : '') + '" data-st-font="' + id + '"' +
      ' role="radio" aria-checked="' + on + '" aria-label="' + esc(p.name) + ' — ' +
      esc(p.heading.name) + ' headings with ' + esc(p.body.name) + ' body">' +
      '<span class="st-fp-hd">' +
        '<span class="st-fp-nm">' + esc(p.name) + '</span>' +
        '<span class="st-pill heading">Heading</span>' +
        '<span class="st-pill ' + p.heading.role + '">' + p.heading.role + '</span>' +
        '<span class="st-fp-tick">' + ico('check', 11) + '</span>' +
      '</span>' +
      '<span class="st-fp-pv">' +
        '<span class="pv-h" style="font-family:' + hStack + ';font-weight:' + hw + '">' +
          'Design is <em>thinking</em> made visual.</span>' +
        '<span class="pv-b" style="font-family:' + bStack + '">' +
          'Every question you attempt feeds the same picture: what you know, what you ' +
          'guessed, and which chapter is quietly costing you marks.</span>' +
        '<span class="pv-tags">' +
          '<span class="st-pill heading">Heading · ' + esc(p.heading.name) + '</span>' +
          '<span class="st-pill ' + p.heading.role + '">' + p.heading.role + '</span>' +
          '<span class="st-pill body">Body · ' + esc(p.body.name) + '</span>' +
          '<span class="st-pill ' + p.body.role + '">' + p.body.role + '</span>' +
        '</span>' +
      '</span></button>';
  }

  function row(o) {
    var ctl = '';
    if (o.kind === 'toggle') {
      ctl = '<button class="st-tg" role="switch" aria-checked="' + (o.on ? 'true' : 'false') +
            '" data-st-toggle="' + o.key + '" aria-label="' + esc(o.title) + '"></button>';
    } else if (o.kind === 'seg') {
      ctl = '<span class="st-seg" role="radiogroup" aria-label="' + esc(o.title) + '">' +
        o.options.map(function (op) {
          return '<button role="radio" aria-checked="' + (op[0] === o.value) + '" data-st-seg="' + o.key +
                 '" data-v="' + esc(op[0]) + '"' + (op[0] === o.value ? ' class="on"' : '') + '>' +
                 esc(op[1]) + '</button>';
        }).join('') + '</span>';
    } else if (o.kind === 'select') {
      ctl = '<select class="st-sel" data-st-select="' + o.key + '" aria-label="' + esc(o.title) + '">' +
        o.options.map(function (op) {
          return '<option value="' + esc(op) + '"' + (op === o.value ? ' selected' : '') + '>' + esc(op) + '</option>';
        }).join('') + '</select>';
    } else if (o.kind === 'nav') {
      ctl = (o.value ? '<span class="st-val">' + esc(o.value) + '</span>' : '') +
            '<svg class="st-chev ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
    }
    return '<div class="st-row' + (o.kind === 'nav' ? ' act' : '') + (o.danger ? ' danger' : '') + '"' +
      (o.act ? ' data-st-act="' + o.act + '"' : '') +
      ' data-st-find="' + esc((o.title + ' ' + (o.desc || '') + ' ' + (o.keywords || '')).toLowerCase()) + '"' +
      (o.kind === 'nav' ? ' tabindex="0" role="button"' : '') + '>' +
      '<span class="st-ri">' + ico(o.icon, 16) + '</span>' +
      '<span class="st-rt"><b>' + esc(o.title) + '</b>' +
        (o.desc ? '<small>' + esc(o.desc) + '</small>' : '') + '</span>' +
      '<span class="st-rr">' + ctl + '</span></div>';
  }

  function sec(o) {
    return '<section class="st-r st-sec" data-st-sec="' + o.id + '">' +
      '<header class="st-sh"><span class="st-sh-i">' + ico(o.icon, 15) + '</span>' +
      '<span><b>' + esc(o.title) + '</b>' + (o.desc ? '<small>' + esc(o.desc) + '</small>' : '') + '</span></header>' +
      o.body + '</section>';
  }

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function storageUsed() {
    var t = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('rankspark') === 0 || k && k.indexOf('rs-') === 0) {
          t += (localStorage.getItem(k) || '').length + k.length;
        }
      }
    } catch (e) {}
    return t * 2;   // UTF-16
  }

  /* ═══════════════════════════════════════════════════════════════════
     C2. EDITORIAL HEADLINE
     The .rs-headline / .rs-subtitle pair, applied to the Settings page
     header so the style ships on a real surface rather than living only in
     a stylesheet. <em> inside the headline renders italic indigo.
     ═══════════════════════════════════════════════════════════════════ */
  function editorialHeader() {
    var page = D.getElementById('page-profile');
    if (!page) return;
    var head = page.querySelector('.page-heading');
    if (!head || head.dataset.rsEditorial === '1') return;

    var h1 = head.querySelector('h1');
    var sub = head.querySelector('.subheading');
    if (h1) {
      h1.classList.add('rs-headline');
      h1.innerHTML = 'Make it <em>yours</em>.';
    }
    if (sub) {
      sub.classList.add('rs-subtitle');
      sub.textContent = 'Every control here changes something real — your theme, your typography, ' +
        'how sessions behave, and what leaves this device. Nothing is decorative.';
    }
    head.dataset.rsEditorial = '1';
  }

  /* ═══════════════════════════════════════════════════════════════════
     D. RENDER
     ═══════════════════════════════════════════════════════════════════ */
  function render() {
    var page = D.getElementById('page-profile');
    if (!page || !page.classList.contains('active')) return;
    var a = APP(); if (!a) return;

    editorialHeader();

    /* Hide the legacy groups from JS — their own rules can win on order. */
    var groups = page.querySelectorAll('.premium-settings-group');
    for (var i = 0; i < groups.length; i++) groups[i].style.setProperty('display', 'none', 'important');

    var host = D.getElementById('stx');
    if (!host) {
      host = D.createElement('div');
      host.id = 'stx';
      var anchor = page.querySelector('.premium-settings-group');
      var layout = page.querySelector('.profile-layout') || page;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
      else layout.appendChild(host);
    }

    var P = prefs(), st = a.state;
    var pd = st.profileDetails || {};
    var H = '';

    /* ── search bar ─────────────────────────────────────────────────── */
    H += '<div class="st-r st-bar">' +
      '<label class="st-search" id="st-search"><span>' + ico('search', 15) + '</span>' +
      '<input type="search" id="st-q" placeholder="Search settings…" autocomplete="off" aria-label="Search settings">' +
      '<button class="st-clear" id="st-x" aria-label="Clear search">×</button></label>' +
      '<button class="st-reset" data-st-act="reset">Reset to defaults</button></div>';

    /* ── account ────────────────────────────────────────────────────── */
    var accBody =
      row({ icon: 'user', title: 'Personal Details', desc: 'Name, username, phone, location',
            kind: 'nav', act: 'sheet:profile', value: st.auth.displayName || 'Learner',
            keywords: 'name username phone location class profile' }) +
      row({ icon: 'book', title: 'Exam & Study Preferences', desc: 'Target exam, year, subjects',
            kind: 'nav', act: 'sheet:exam', value: pd.primaryExam || 'Not set',
            keywords: 'exam target year subject goal jee neet' }) +
      (st.auth.isLoggedIn
        ? row({ icon: 'user', title: 'Sign Out', desc: st.auth.email || 'Signed in',
                kind: 'nav', act: 'logout', keywords: 'logout sign out account' })
        : row({ icon: 'user', title: 'Sign In to Sync', desc: 'Save progress across devices',
                kind: 'nav', act: 'login', keywords: 'login sign in sync google account' }));
    H += sec({ id: 'account', icon: 'user', title: 'Account', desc: 'Who you are and how you sync', body: accBody });

    /* ── appearance (promoted out of the modal) ─────────────────────── */
    var themes =
      '<div class="st-themes" role="radiogroup" aria-label="Theme" data-st-find="theme dark light sepia vivid appearance colour color">' +
      themeSwatch('Dark',        ['#0b1122', '#8a3ffc', '#34d7ff', '#2ee3a2']) +
      themeSwatch('Light',       ['#eef2fb', '#8a3ffc', '#38a0ff', '#2ee3a2']) +
      themeSwatch('Sepia Grain', ['#2c261d', '#b48a43', '#e4c16f', '#cbb99b']) +
      themeSwatch('Vivid Play',  ['#1a0d27', '#ffb43e', '#ffd276', '#59e0b2']) +
      '</div>';

    var appBody = themes +
      row({ icon: 'edit', title: 'Interface scale', desc: 'Size of all text and controls',
            kind: 'seg', key: 'fontSize', value: P.fontSize || 'Medium',
            options: [['Small', 'S'], ['Medium', 'M'], ['Large', 'L']],
            keywords: 'font size scale text bigger smaller zoom accessibility' }) +
      row({ icon: 'grid', title: 'Reading width', desc: 'Cap line length on wide screens',
            kind: 'seg', key: 'measure', value: measure(),
            options: [['narrow', 'Narrow'], ['comfortable', 'Comfy'], ['wide', 'Wide']],
            keywords: 'width measure line length layout density wide narrow' }) +
      row({ icon: 'zoom', title: 'Motion', desc: 'Reduce animation across the app',
            kind: 'seg', key: 'motion', value: motion(),
            options: [['full', 'Full'], ['calm', 'Calm']],
            keywords: 'motion animation reduce calm accessibility vestibular' });
    H += sec({ id: 'appearance', icon: 'spark', title: 'Appearance',
               desc: 'Theme, scale and motion', body: appBody });

    /* ── typography ─────────────────────────────────────────────────── */
    H += sec({ id: 'typography', icon: 'edit', title: 'Typography',
      desc: 'Font pairing for headings and body text',
      body: '<div class="st-fonts" role="radiogroup" aria-label="Font pairing" ' +
        'data-st-find="font typeface typography pairing serif sans display playfair abril young lato dm sans source">' +
        PAIR_ORDER.map(fontCard).join('') + '</div>' +
        '<p class="st-note">Fonts load from Google Fonts on first use and are cached by ' +
        'your browser. If the network is unavailable the system stack is used instead.</p>' });

    /* ── practice ───────────────────────────────────────────────────── */
    var pracBody =
      row({ icon: 'check', title: 'Auto-save sessions', desc: 'Resume an interrupted test',
            kind: 'toggle', key: 'autoSave', on: P.autoSave !== false,
            keywords: 'autosave resume session save progress' }) +
      row({ icon: 'info', title: 'Confirm before submitting', desc: 'Ask before ending a test',
            kind: 'toggle', key: 'confirmExit', on: P.confirmExit !== false,
            keywords: 'confirm exit submit warn dialog' }) +
      row({ icon: 'clock', title: 'Default marking scheme', desc: 'Applied when Practice Setup leaves it unset',
            kind: 'select', key: 'marking', value: P.marking || '+4 / -1',
            options: ['+4 / -1', '+4 / 0', '+1 / 0', '+2 / -0.5'],
            keywords: 'marking scheme negative score points' }) +
      row({ icon: 'book', title: 'Darken question documents', desc: 'Invert scanned pages for night study',
            kind: 'toggle', key: 'pngDark', on: pngDark(),
            keywords: 'dark document invert png scan night image' });
    H += sec({ id: 'practice', icon: 'practice', title: 'Practice',
               desc: 'Defaults for every session you start', body: pracBody });

    /* ── feedback ───────────────────────────────────────────────────── */
    var fbBody =
      row({ icon: 'bell', title: 'Sound effects', desc: 'Audio cue on answers and actions',
            kind: 'toggle', key: 'sound', on: P.sound !== false,
            keywords: 'sound audio effects volume mute' }) +
      row({ icon: 'phone', title: 'Haptic feedback', desc: 'Vibrate on interactions (mobile)',
            kind: 'toggle', key: 'vibration', on: !!P.vibration,
            keywords: 'haptic vibration buzz touch mobile' });
    H += sec({ id: 'feedback', icon: 'spark', title: 'Feedback',
               desc: 'How the app responds to you', body: fbBody });

    /* ── shortcuts (documenting a real, undiscoverable feature) ─────── */
    var KEYS = [['?', 'Show shortcuts'], ['S', 'Start practice'], ['T', 'Cycle theme'],
                ['G then H', 'Home'], ['G then A', 'Analytics'], ['G then P', 'Practice'],
                ['G then B', 'Saved library'], ['Esc', 'Close overlay']];
    H += sec({ id: 'keys', icon: 'grid', title: 'Keyboard shortcuts',
      desc: 'Available on any screen', body:
      '<div class="st-keys" data-st-find="keyboard shortcut hotkey keys navigation">' +
      KEYS.map(function (k) {
        return '<div class="st-key"><span>' + esc(k[1]) + '</span><b>' + esc(k[0]) + '</b></div>';
      }).join('') + '</div>' });

    /* ── data ───────────────────────────────────────────────────────── */
    var used = storageUsed();
    var pctUsed = Math.min(100, Math.round(used / (5 * 1024 * 1024) * 100));
    var dataBody =
      '<div class="st-store" data-st-find="storage space usage local data size">' +
        '<div class="st-store-b"><i data-w="' + Math.max(2, pctUsed) + '"></i></div>' +
        '<div class="st-store-l"><span>Local storage used</span><b>' + bytes(used) + '</b></div>' +
      '</div>' +
      row({ icon: 'download', title: 'Export my data', desc: 'Download everything as JSON',
            kind: 'nav', act: 'export', keywords: 'export download backup json data' }) +
      row({ icon: 'trash', title: 'Clear local data', desc: 'Answers, bookmarks and history on this device',
            kind: 'nav', act: 'clear', danger: true, keywords: 'clear delete cache reset local storage' }) +
      row({ icon: 'x', title: 'Delete account', desc: 'Permanently remove cloud data',
            kind: 'nav', act: 'delete', danger: true, keywords: 'delete account remove permanent' });
    H += sec({ id: 'data', icon: 'folder', title: 'Data & Privacy',
               desc: 'Your data stays on this device unless you sign in', body: dataBody });

    H += '<div class="st-r" id="st-none" style="display:none"><div class="st-sec st-empty">' +
         'No settings match that search.</div></div>';

    host.innerHTML = H;

    requestAnimationFrame(function () {
      var b = host.querySelector('.st-store-b i');
      if (b) b.style.width = b.getAttribute('data-w') + '%';
    });

    /* Preserve an in-flight query across re-renders. */
    if (query) { var q = D.getElementById('st-q'); if (q) { q.value = query; filter(query); } }
  }

  /* ═══════════════════════════════════════════════════════════════════
     E. SEARCH
     ═══════════════════════════════════════════════════════════════════ */
  var query = '';
  function filter(q) {
    q = (q || '').trim().toLowerCase();
    query = q;
    var host = D.getElementById('stx'); if (!host) return;
    var wrap = D.getElementById('st-search');
    if (wrap) wrap.classList.toggle('has', !!q);

    var secs = host.querySelectorAll('[data-st-sec]');
    var anyVisible = false;

    for (var i = 0; i < secs.length; i++) {
      var s = secs[i];
      var items = s.querySelectorAll('[data-st-find]');
      var hit = 0;
      for (var j = 0; j < items.length; j++) {
        var match = !q || items[j].getAttribute('data-st-find').indexOf(q) >= 0;
        items[j].style.display = match ? '' : 'none';
        if (match) hit++;
      }
      /* A section title itself can match, revealing all of its rows. */
      var titleEl = s.querySelector('.st-sh b');
      var titleHit = q && titleEl && titleEl.textContent.toLowerCase().indexOf(q) >= 0;
      if (titleHit) {
        for (var k = 0; k < items.length; k++) items[k].style.display = '';
        hit = items.length;
      }
      s.style.display = (hit > 0) ? '' : 'none';
      if (hit > 0) anyVisible = true;
    }
    var none = D.getElementById('st-none');
    if (none) none.style.display = anyVisible ? 'none' : '';
  }

  /* ═══════════════════════════════════════════════════════════════════
     F. EVENTS
     ═══════════════════════════════════════════════════════════════════ */
  function onProfile() {
    var p = D.getElementById('page-profile');
    return p && p.classList.contains('active');
  }

  function act(name) {
    var a = APP();
    if (name.indexOf('sheet:') === 0) {
      var key = name.slice(6);
      var legacy = D.querySelector('[data-edit-sheet="' + key + '"]');
      if (legacy) { legacy.click(); return; }
      if (W.openSheet) { try { W.openSheet(key); } catch (e) {} }
      return;
    }
    var map = {
      login:  '#profile-login-row',
      logout: '#profile-logout-row',
      export: '#download-data-row',
      clear:  '#clear-cache-row',
      delete: '#delete-account-row'
    };
    if (map[name]) {
      var el = D.querySelector(map[name]);
      /* The legacy rows are display:none but still carry the real handlers,
         so clicking them reuses the app's own confirmation + logic. */
      if (el) { el.click(); return; }
    }
    if (name === 'reset') resetAll();
  }

  function resetAll() {
    if (!W.confirm('Reset all preferences to their defaults?\n\nYour study data — attempts, ' +
                   'bookmarks, notes and history — is not affected.')) return;
    var a = APP(); if (!a) return;
    var d = {
      appearance: 'Dark', fontSize: 'Medium', marking: '+4 / -1',
      autoSave: true, confirmExit: true, sound: true, vibration: false
    };
    Object.keys(d).forEach(function (k) { setPref(k, d[k]); });
    applyMotion('full');
    applyMeasure('comfortable');
    applyPngDark(false);
    applyPair('system', false);
    try { localStorage.removeItem(K_PAIR); } catch (e) {}
    render();
    toast('Preferences reset to defaults.');
    fx('toggle');
  }

  D.addEventListener('click', function (e) {
    if (!onProfile()) return;
    var t = e.target; if (!t || !t.closest) return;

    var tg = t.closest('[data-st-toggle]');
    if (tg) {
      var key = tg.dataset.stToggle;
      var next = tg.getAttribute('aria-checked') !== 'true';
      tg.setAttribute('aria-checked', String(next));
      if (key === 'pngDark') applyPngDark(next);
      else setPref(key, next);
      fx('toggle');
      return;
    }

    var sg = t.closest('[data-st-seg]');
    if (sg) {
      var k2 = sg.dataset.stSeg, v2 = sg.dataset.v;
      var grp = sg.parentNode.querySelectorAll('[data-st-seg]');
      for (var i = 0; i < grp.length; i++) {
        var on = grp[i] === sg;
        grp[i].classList.toggle('on', on);
        grp[i].setAttribute('aria-checked', String(on));
      }
      if (k2 === 'motion') applyMotion(v2);
      else if (k2 === 'measure') applyMeasure(v2);
      else setPref(k2, v2);
      fx('toggle');
      return;
    }

    var th = t.closest('[data-st-theme]');
    if (th) {
      var name = th.dataset.stTheme;
      setPref('appearance', name);
      var all = D.querySelectorAll('[data-st-theme]');
      for (var j = 0; j < all.length; j++) {
        var sel = all[j] === th;
        all[j].classList.toggle('on', sel);
        all[j].setAttribute('aria-checked', String(sel));
      }
      fx('toggle');
      return;
    }

    var fp = t.closest('[data-st-font]');
    if (fp) {
      var id = fp.dataset.stFont;
      applyPair(id, true);
      var cards = D.querySelectorAll('[data-st-font]');
      for (var m = 0; m < cards.length; m++) {
        var isOn = cards[m] === fp;
        cards[m].classList.toggle('on', isOn);
        cards[m].setAttribute('aria-checked', String(isOn));
      }
      fx('toggle');
      return;
    }

    if (t.closest('#st-x')) {
      var q = D.getElementById('st-q');
      if (q) { q.value = ''; q.focus(); }
      filter('');
      return;
    }

    var ac = t.closest('[data-st-act]');
    if (ac) { e.preventDefault(); act(ac.dataset.stAct); }
  });

  D.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'st-q') filter(e.target.value);
  });

  D.addEventListener('change', function (e) {
    if (!onProfile() || !e.target) return;
    var s = e.target.closest && e.target.closest('[data-st-select]');
    if (s) setPref(s.dataset.stSelect, s.value);
  });

  /* Keyboard: Enter/Space activates nav rows; Escape clears search. */
  D.addEventListener('keydown', function (e) {
    if (!onProfile()) return;
    if (e.key === 'Escape' && e.target && e.target.id === 'st-q') {
      e.target.value = ''; filter(''); return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var r = e.target && e.target.closest && e.target.closest('.st-row.act[data-st-act]');
    if (r) { e.preventDefault(); act(r.dataset.stAct); }
  });

  /* Keep in sync when the app changes prefs elsewhere (e.g. the T shortcut). */
  var syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { if (onProfile()) render(); }, 120);
  }
  W.addEventListener('storage', function (e) {
    if (e.key === 'rankspark-preferences') scheduleSync();
  });

  function boot() {
    W.__rsBooted = W.__rsBooted || {};
    if (W.__rsBooted.settings) return;
    W.__rsBooted.settings = 1;

    var pg = D.getElementById('page-profile');
    if (pg) {
      var was = pg.classList.contains('active');
      new MutationObserver(function () {
        var now = pg.classList.contains('active');
        if (now && !was) setTimeout(render, 40);
        was = now;
      }).observe(pg, { attributes: true, attributeFilter: ['class'] });
      if (was) setTimeout(render, 60);
    }

    /* Theme changes made from the FX layer (T key) must repaint the swatches. */
    var bodyObs = new MutationObserver(function () { if (onProfile()) scheduleSync(); });
    bodyObs.observe(D.body, { attributes: true, attributeFilter: ['data-theme', 'data-font-size'] });

    W.rsRenderSettings = render;
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Public surface for other parts / console. */
  W.RSFonts = {
    pairs: PAIRS, order: PAIR_ORDER,
    current: currentPair, apply: applyPair, load: loadPair
  };
})();
