/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK PREMIUM — PART 1 / 3 · ENTITLEMENT ENGINE
   ───────────────────────────────────────────────────────────────────────────
   Tiers, pricing matrix, entitlement keys, usage metering, trial clock,
   persistence + migration off the legacy `free|pro|gold` flag.

   Design notes
   • The engine only ever computes TRUTH ("is this allowed, how much is left").
     Whether a denial actually blocks the action is a separate policy switch
     (RS.config.enforce) so the demo can surface paywalls without hurting the
     product walkthrough. Flip one boolean to ship real gating.
   • Everything is namespaced on window.RSP. No existing globals are shadowed.
   • Periods reset lazily on read — no timers, no drift, survives a closed tab.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window;
  var RSP = W.RSP = W.RSP || {};

  /* ── Reload shim ──────────────────────────────────────────────────────
     The app is mounted by writing into a same-origin iframe (so that
     location.hostname is the real host and Firebase Auth works — a blob:
     document reports "" and is rejected as auth/unauthorized-domain).

     One consequence, verified: calling location.reload() inside a written
     document navigates the frame to a BLANK about:blank, and
     Location.prototype.reload is non-configurable so it cannot be patched.
     The shell therefore exposes parent.__rsRemount(), which re-writes the
     document properly. RSP.reload() prefers it and degrades to a normal
     reload anywhere else (standalone file, direct navigation, admin). */
  RSP.reload = function () {
    try {
      if (W.parent && W.parent !== W && typeof W.parent.__rsRemount === 'function') {
        W.parent.__rsRemount();
        return;
      }
    } catch (e) { /* cross-origin parent — fall through */ }
    try { W.location.reload(); } catch (e) {}
  };

  /* ─────────────────────────────────────────────────────────────────────────
     CONFIG
     ───────────────────────────────────────────────────────────────────────── */
  RSP.config = {
    /* false → paywalls are shown but the action still proceeds (demo build).
       true  → canUse() denials genuinely stop the action.                    */
    enforce: false,

    /* The strategy doc specifies Spark 40 exports/mo and Blaze 5/mo, which
       makes the paid tier strictly worse than free on this one line. It is
       implemented as written; flip to true for the corrected ladder.         */
    fixPaperLabInversion: false,

    currency: '₹',
    locale: 'en-IN',
    trialDays: 7,
    trialTier: 'blaze'
  };

  var INF = Infinity;

  /* ─────────────────────────────────────────────────────────────────────────
     TIERS
     ───────────────────────────────────────────────────────────────────────── */
  var TIERS = RSP.TIERS = {
    spark: {
      id: 'spark', rank: 0, name: 'Spark', tagline: 'Just starting',
      blurb: 'Enough to finish a real study session and see your first analytics — free, forever.',
      audience: 'New aspirants finding their routine',
      accent: '#34d7ff', accent2: '#2a7fff', glyph: 'spark',
      price: { 7: 0, 30: 0, 90: 0, 180: 0, 365: 0 }
    },
    blaze: {
      id: 'blaze', rank: 1, name: 'Blaze', tagline: 'Getting serious',
      blurb: 'The full syllabus for your main exam, real mock volume, and the analysis that tells you what to fix.',
      audience: 'Regular students on one primary exam',
      accent: '#a855f7', accent2: '#6d28d9', glyph: 'bolt',
      recommended: true,
      price: { 7: 49, 30: 149, 90: 399, 180: 699, 365: 1199 }
    },
    inferno: {
      id: 'inferno', rank: 2, name: 'Inferno', tagline: 'Maximum power',
      blurb: 'Unlimited practice across every stream, topic-level diagnosis, and a plan for your next session.',
      audience: 'Repeaters, rank-chasers, multi-exam learners',
      accent: '#ff9f43', accent2: '#ff4d6d', glyph: 'flame',
      price: { 7: 99, 30: 399, 90: 999, 180: 1799, 365: 2999 }
    }
  };

  var ORDER = RSP.TIER_ORDER = ['spark', 'blaze', 'inferno'];

  /* ─────────────────────────────────────────────────────────────────────────
     BILLING DURATIONS
     ───────────────────────────────────────────────────────────────────────── */
  RSP.DURATIONS = [
    { days: 7,   key: '7',   label: '7 days',   short: '7D',  unit: 'week',  note: 'Paid fallback — the free trial is the better door' },
    { days: 30,  key: '30',  label: '1 month',  short: '1M',  unit: 'mo',    note: 'Standard monthly price', dflt: true },
    { days: 90,  key: '90',  label: '3 months', short: '3M',  unit: 'mo',    note: 'One full revision cycle' },
    { days: 180, key: '180', label: '6 months', short: '6M',  unit: 'mo',    note: 'A semester or attempt cycle' },
    { days: 365, key: '365', label: '12 months',short: '1Y',  unit: 'mo',    note: 'Best annual value' }
  ];

  /* Billing months per duration. 365 is sold as 12 months, not 12.17 — using
     days/30 would render the annual plan as ₹99/mo instead of the ₹100 quoted
     in the pricing strategy. Always divide by the marketed month count. */
  var MONTHS = { 30: 1, 90: 3, 180: 6, 365: 12 };

  /* Effective ₹/month for a tier+duration, used for the "₹100/mo" line. */
  RSP.monthlyRate = function (tierId, days) {
    var t = TIERS[tierId]; if (!t) return 0;
    var p = t.price[days] || 0;
    var m = MONTHS[days];
    if (!p || !m) return p;
    return Math.round(p / m);
  };

  /* Percent saved vs. paying the 30-day price for the same span. */
  RSP.savingPct = function (tierId, days) {
    var t = TIERS[tierId]; var m = MONTHS[days];
    if (!t || !m || m === 1) return 0;
    var base = (t.price[30] || 0) * m;
    var real = t.price[days] || 0;
    if (!base || !real) return 0;
    return Math.max(0, Math.round((1 - real / base) * 100));
  };

  /* Marketed month count, so the UI can say "12 months" not "12.17". */
  RSP.months = function (days) { return MONTHS[days] || 0; };

  RSP.money = function (n) {
    if (n === INF) return '∞';
    try { return RSP.config.currency + Number(n).toLocaleString(RSP.config.locale); }
    catch (e) { return RSP.config.currency + n; }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     ENTITLEMENTS
     Each key is one metered or boolean capability. `limit` is per tier.
     period: 'week' | 'month' | 'day' | 'total' | null (boolean gate)
     ───────────────────────────────────────────────────────────────────────── */
  var PLE = RSP.config.fixPaperLabInversion;

  var ENT = RSP.ENTITLEMENTS = {

    /* ── Content access ─────────────────────────────────────────────── */
    'pack.volume_access': {
      label: 'Book volumes', period: 'total', unit: 'volumes',
      group: 'Content',
      row: 'Free book / volume allowance',
      limit: { spark: 4, blaze: INF, inferno: INF },
      display: { spark: '2 Physics + 1 Chemistry + 1 starter', blaze: 'Full library, primary exam', inferno: 'Every released pack' },
      blocked: 'This volume is outside your free starter library.',
      outcome: 'Unlock every volume in your exam library.'
    },
    'pyq.questions_per_week': {
      label: 'PYQ questions', period: 'week', unit: 'questions',
      group: 'Content', row: 'Previous-year questions',
      limit: { spark: 20, blaze: INF, inferno: INF },
      display: { spark: '20 / week sample', blaze: 'Full PYQ library', inferno: 'All exams & subjects' },
      blocked: 'You have opened all 20 sample PYQs this week.',
      outcome: 'Open the complete previous-year archive, unmetered.'
    },
    'bank.full_library': {
      label: 'Question bank', period: null, group: 'Content', row: 'Question bank access',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: 'Starter packs', blaze: 'Full library, one stream', inferno: 'All supported streams' },
      blocked: 'The full question bank is a paid capability.',
      outcome: 'Search and practise the entire bank.'
    },

    /* ── Practice ───────────────────────────────────────────────────── */
    'custom.sessions_per_week': {
      label: 'Custom sessions', period: 'week', unit: 'sessions',
      group: 'Practice', row: 'Custom Practice',
      limit: { spark: 3, blaze: INF, inferno: INF },
      display: { spark: '3 / week · 10 Q each', blaze: 'Unlimited', inferno: 'Unlimited + saved presets' },
      blocked: 'You have used all 3 custom sessions this week.',
      outcome: 'Build as many custom sessions as you want.'
    },
    'custom.questions_per_session': {
      label: 'Questions per session', period: null, group: 'Practice', row: 'Session length cap',
      limit: { spark: 10, blaze: INF, inferno: INF },
      display: { spark: '10 questions', blaze: 'No cap', inferno: 'No cap' },
      blocked: 'Free sessions are capped at 10 questions.',
      outcome: 'Run full-length sessions of any size.'
    },
    'random.sessions_per_week': {
      label: 'Random practice', period: 'week', unit: 'sessions',
      group: 'Practice', row: 'Random practice',
      limit: { spark: 3, blaze: INF, inferno: INF },
      display: { spark: 'Limited', blaze: 'Unlimited', inferno: 'Unlimited' },
      blocked: 'Random practice is limited on Spark.',
      outcome: 'Shuffle the whole bank as often as you like.'
    },
    'mock.completed_per_month': {
      label: 'Mock tests', period: 'month', unit: 'mocks',
      group: 'Practice', row: 'Mock tests',
      limit: { spark: 4, blaze: 8, inferno: INF },
      display: { spark: '1 / week', blaze: '8 / month', inferno: 'Unlimited' },
      blocked: 'You have already taken this period\'s mock test.',
      outcome: 'Sit exam-pressure mocks whenever you are ready.'
    },
    'solutions.full': {
      label: 'Detailed solutions', period: null, group: 'Practice', row: 'Solutions',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: 'Free questions only', blaze: 'Full detailed solutions', inferno: 'Solutions + mistake workflow' },
      blocked: 'Full worked solutions are a paid capability.',
      outcome: 'Read the complete method behind every answer.'
    },

    /* ── Analysis ───────────────────────────────────────────────────── */
    'analytics.history_days': {
      label: 'Analytics history', period: null, unit: 'days',
      group: 'Analysis', row: 'Performance history',
      limit: { spark: 0, blaze: 30, inferno: INF },
      display: { spark: 'Current session', blaze: '30-day history', inferno: 'Unlimited history' },
      blocked: 'Spark shows the session you just finished, not your trend.',
      outcome: 'See whether you are actually improving, week over week.'
    },
    'analytics.topic_diagnosis': {
      label: 'Topic diagnosis', period: null, group: 'Analysis', row: 'Weak-topic diagnosis',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: 'Subject & chapter', inferno: 'Topic-level + trend alerts' },
      blocked: 'Topic-level diagnosis is an Inferno capability.',
      outcome: 'Get told exactly which topic to fix next, and why.'
    },
    'analytics.recommendation': {
      label: 'Next-session plan', period: null, group: 'Analysis', row: 'Recommended next session',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Auto-built from your data' },
      blocked: 'Recommended sessions are built from long-range data.',
      outcome: 'Turn your performance data into your next study session.'
    },
    'filters.advanced': {
      label: 'Advanced filters', period: null, group: 'Analysis', row: 'Search & filters',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: 'Subject only', blaze: 'Chapter, exam, year, type', inferno: 'All + saved presets' },
      blocked: 'Year, exam-source and question-type filters are paid.',
      outcome: 'Slice the bank down to exactly the questions you need.'
    },
    'filters.saved_presets': {
      label: 'Saved filter presets', period: null, group: 'Analysis', row: 'Saved filter presets',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Unlimited presets' },
      blocked: 'Saved presets are an Inferno capability.',
      outcome: 'Reopen your favourite drill in one tap.'
    },

    /* ── Output ─────────────────────────────────────────────────────── */
    'paper_lab.exports_per_month': {
      label: 'Paper Lab exports', period: 'month', unit: 'exports',
      group: 'Output', row: 'Paper Lab exports',
      limit: PLE
        ? { spark: 5, blaze: 40, inferno: INF }
        : { spark: 40, blaze: 5, inferno: INF },
      display: PLE
        ? { spark: '5 / month · basic', blaze: '40 / month · premium', inferno: 'Unlimited + templates' }
        : { spark: '40 / month · basic', blaze: '5 / month · premium', inferno: 'Unlimited + templates' },
      blocked: 'You have used every Paper Lab export in this billing month.',
      outcome: 'Print exam-ready papers whenever you need them.'
    },
    'paper_lab.templates': {
      label: 'Paper templates', period: null, group: 'Output', row: 'Reusable templates & keys',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Templates + answer keys' },
      blocked: 'Reusable paper templates are an Inferno capability.',
      outcome: 'Save a paper format once and reuse it all year.'
    },
    'paper_lab.branding': {
      label: 'Custom branding', period: null, group: 'Output', row: 'Logo & branding on papers',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Your logo & institute name' },
      blocked: 'Custom branding is an Inferno capability.',
      outcome: 'Put your own logo on every paper you export.'
    },
    'data.export': {
      label: 'Data export', period: null, group: 'Output', row: 'Performance export',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: '—', blaze: 'CSV / PDF summary', inferno: 'Full export + revision report' },
      blocked: 'Performance exports are a paid capability.',
      outcome: 'Take your numbers into a spreadsheet or a printout.'
    },

    /* ── Library ────────────────────────────────────────────────────── */
    'bookmarks.max_count': {
      label: 'Bookmarks', period: 'total', unit: 'saved',
      group: 'Library', row: 'Saved questions',
      limit: { spark: 50, blaze: 2000, inferno: INF },
      display: { spark: '50 questions', blaze: '2,000 questions', inferno: 'Unlimited + folders' },
      blocked: 'Your bookmark shelf is full.',
      outcome: 'Save everything worth coming back to.',
      /* Never destructive: reads always allowed, only new writes are metered. */
      readOnlyOnLimit: true
    },
    'bookmarks.folders': {
      label: 'Folders & tags', period: null, group: 'Library', row: 'Folders & tags',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Folders + tags' },
      blocked: 'Organising bookmarks into folders is an Inferno capability.',
      outcome: 'Keep a thousand saved questions actually findable.'
    },

    /* ── Competition & account ──────────────────────────────────────── */
    'leaderboard.participate': {
      label: 'Leaderboard', period: null, group: 'Competition', row: 'Leaderboard placement',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: 'Personal rank only', blaze: 'Primary-exam board', inferno: 'Cross-exam + percentile history' },
      blocked: 'Ranked placement is a paid capability.',
      outcome: 'Measure yourself against everyone chasing the same seat.'
    },
    'leaderboard.percentile_history': {
      label: 'Percentile history', period: null, group: 'Competition', row: 'Percentile history',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: '—', blaze: '—', inferno: 'Full percentile trend' },
      blocked: 'Percentile history is an Inferno capability.',
      outcome: 'Watch your percentile move across the whole attempt cycle.'
    },
    'account.no_ads': {
      label: 'Ad-free', period: null, group: 'Competition', row: 'Ads & upgrade prompts',
      limit: { spark: false, blaze: true, inferno: true },
      display: { spark: 'Light prompts', blaze: 'No ads', inferno: 'No ads' },
      blocked: '', outcome: 'Study without a single interruption.'
    },
    'account.priority_support': {
      label: 'Priority support', period: null, group: 'Competition', row: 'Support',
      limit: { spark: false, blaze: false, inferno: true },
      display: { spark: 'Community', blaze: 'Email support', inferno: 'Priority support' },
      blocked: '', outcome: 'Get a human on your problem the same day.'
    }
  };

  /* Rows that are always free — used by the pricing matrix's "never gated"
     footnote and by guard() as a hard allow-list. */
  RSP.NEVER_GATED = [
    'Login, profile and ownership of your data',
    'At least one complete practice session',
    'Basic score, accuracy and answer review',
    'XP, streaks, bookmarks and history you already earned',
    'Account deletion and export of your own basic data'
  ];

  /* ─────────────────────────────────────────────────────────────────────────
     PERSISTENCE
     ───────────────────────────────────────────────────────────────────────── */
  var K_SUB    = 'rankspark-subscription';
  var K_USAGE  = 'rankspark-usage';
  var K_LEGACY = 'rankspark-plan';
  var K_MIGRATED = 'rankspark-plan-migrated';

  /* ── Reaching the host app's state ────────────────────────────────────
     The app declares `const state = {...}` at the top level of a classic
     script. That is a SCRIPT-SCOPE binding in the global lexical environment,
     NOT a property of window — so `window.state` is undefined. A sibling
     classic script can still resolve the bare identifier, but only once the
     declaration has been evaluated, and it throws ReferenceError before that.
     hostState() resolves it safely and never throws.                       */
  function hostState() {
    try { if (typeof state !== 'undefined' && state) return state; } catch (e) {}
    try { if (W.state) return W.state; } catch (e) {}
    return null;
  }

  function readJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function defaultSub() {
    return {
      tier: 'spark',
      status: 'active',
      startsAt: new Date().toISOString(),
      expiresAt: null,          // null = never expires (Spark)
      durationDays: null,
      isTrial: false,
      trialUsedAt: null,
      autoRenew: false,
      orderId: null,
      source: 'default'
    };
  }

  var sub = readJSON(K_SUB, null);

  /* ── Migration: legacy free|pro|gold → spark|blaze|inferno ────────────
     Runs exactly once and records that it ran. Without the flag, deleting
     the subscription (support reset, dev reset, user clearing a plan) would
     resurrect the old tier from the legacy key on the very next load.      */
  if (!sub) {
    sub = defaultSub();
    var migrated = false;
    try { migrated = localStorage.getItem(K_MIGRATED) === '1'; } catch (e) {}

    if (!migrated) {
      var legacy = null;
      try { legacy = localStorage.getItem(K_LEGACY); } catch (e) {}
      if (legacy === 'pro')  { sub.tier = 'blaze';   sub.source = 'migrated'; }
      if (legacy === 'gold') { sub.tier = 'inferno'; sub.source = 'migrated'; }
      if (sub.tier !== 'spark') {
        sub.durationDays = 30;
        sub.expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
      }
      try { localStorage.setItem(K_MIGRATED, '1'); } catch (e) {}
    }
    writeJSON(K_SUB, sub);
  }
  if (!TIERS[sub.tier]) sub.tier = 'spark';

  var usage = readJSON(K_USAGE, {});

  function persistSub() {
    writeJSON(K_SUB, sub);
    /* Keep the legacy flag in sync so untouched code (Paper Lab, older
       branches) keeps behaving correctly during the transition. */
    try {
      localStorage.setItem(K_LEGACY,
        sub.tier === 'inferno' ? 'gold' : sub.tier === 'blaze' ? 'pro' : 'free');
    } catch (e) {}
    /* Mirror onto the host app's live state so untouched code paths that read
       state.plan directly (Paper Lab) agree with the engine immediately. */
    var hs = hostState();
    if (hs) { try { hs.plan = sub.tier === 'inferno' ? 'gold' : sub.tier === 'blaze' ? 'pro' : 'free'; } catch (e) {} }
  }
  function persistUsage() { writeJSON(K_USAGE, usage); }

  /* ─────────────────────────────────────────────────────────────────────────
     PERIODS — lazy reset, no timers
     ───────────────────────────────────────────────────────────────────────── */
  function periodStamp(period, at) {
    var d = at ? new Date(at) : new Date();
    if (period === 'day')  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (period === 'week') {
      /* ISO week starting Monday. */
      var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var dow = (t.getDay() + 6) % 7;
      t.setDate(t.getDate() - dow);
      return 'w' + t.getFullYear() + '-' + t.getMonth() + '-' + t.getDate();
    }
    if (period === 'month') return d.getFullYear() + '-' + d.getMonth();
    return 'total';
  }

  function periodEnd(period) {
    var d = new Date();
    if (period === 'day')   return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (period === 'week')  { var dow = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + 7); }
    if (period === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return null;
  }

  function periodLabel(period) {
    return period === 'day' ? 'today'
         : period === 'week' ? 'this week'
         : period === 'month' ? 'this month'
         : '';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     SUBSCRIPTION STATE
     ───────────────────────────────────────────────────────────────────────── */
  function expired() {
    if (!sub.expiresAt) return false;
    return Date.now() > new Date(sub.expiresAt).getTime();
  }

  /* Downgrade-on-expiry. Never destroys data — only the tier changes. */
  function reconcile() {
    if (sub.tier !== 'spark' && expired()) {
      var was = sub.tier, wasTrial = sub.isTrial;
      sub.tier = 'spark';
      sub.status = wasTrial ? 'trial-ended' : 'expired';
      sub.isTrial = false;
      sub.expiresAt = null;
      sub.durationDays = null;
      persistSub();
      emit('expired', { from: was, wasTrial: wasTrial });
      return true;
    }
    return false;
  }

  function tier()      { reconcile(); return sub.tier; }
  function tierMeta()  { return TIERS[tier()]; }
  function rank()      { return TIERS[tier()].rank; }

  function daysLeft() {
    if (!sub.expiresAt) return null;
    var ms = new Date(sub.expiresAt).getTime() - Date.now();
    return ms <= 0 ? 0 : Math.ceil(ms / 864e5);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(RSP.config.locale,
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return iso.slice(0, 10); }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     LIMITS & USAGE
     ───────────────────────────────────────────────────────────────────────── */
  function limitFor(key, forTier) {
    var e = ENT[key]; if (!e) return INF;
    var l = e.limit[forTier || tier()];
    return l === undefined ? INF : l;
  }

  function usedFor(key) {
    var e = ENT[key]; if (!e || !e.period) return 0;
    var rec = usage[key];
    var stamp = periodStamp(e.period);
    if (!rec || rec.p !== stamp) return 0;
    return rec.n || 0;
  }

  /* Some counters are derived from real app data rather than a stored tally —
     that keeps them honest even if a write is missed. */
  var DERIVED = {
    'bookmarks.max_count': function () {
      var s = hostState();
      if (s && Array.isArray(s.bookmarks)) return s.bookmarks.length;
      /* Fall back to storage: the engine can boot before the app's state
         object is initialised, and during tests state is replaced wholesale. */
      var raw = readJSON('rankspark-bookmarks', null);
      return Array.isArray(raw) ? raw.length : 0;
    },
    'pack.volume_access': function () {
      var s = hostState();
      if (s && s.loadedPacks && typeof s.loadedPacks.size === 'number') return s.loadedPacks.size;
      return usedFor('pack.volume_access');
    }
  };

  function used(key) {
    if (DERIVED[key]) { try { return DERIVED[key](); } catch (e) {} }
    return usedFor(key);
  }

  /* ── canUse() — the single question every gated action asks ─────────── */
  function canUse(key, qty) {
    qty = qty == null ? 1 : qty;
    reconcile();
    var e = ENT[key];
    var t = sub.tier;

    if (!e) {
      return { key: key, allowed: true, unknown: true, tier: t, limit: INF, used: 0, remaining: INF };
    }

    var lim = limitFor(key, t);
    var boolGate = (typeof lim === 'boolean');
    var u = boolGate ? 0 : used(key);
    var unlimited = (lim === INF);

    var allowed = boolGate ? lim : (unlimited ? true : (u + qty) <= lim);
    var remaining = boolGate ? (lim ? INF : 0) : (unlimited ? INF : Math.max(0, lim - u));

    /* Cheapest tier that would satisfy the request. */
    var target = null;
    for (var i = ORDER.indexOf(t) + 1; i < ORDER.length; i++) {
      var cand = ORDER[i], cl = limitFor(key, cand);
      var ok = (typeof cl === 'boolean') ? cl : (cl === INF || (u + qty) <= cl);
      if (ok) { target = cand; break; }
    }

    var end = e.period ? periodEnd(e.period) : null;

    return {
      key: key,
      allowed: allowed,
      tier: t,
      limit: lim,
      used: u,
      qty: qty,
      remaining: remaining,
      unlimited: unlimited,
      boolGate: boolGate,
      period: e.period || null,
      periodLabel: periodLabel(e.period),
      resetAt: end ? end.toISOString() : null,
      upgradeTarget: target,
      meta: e,
      /* pct of the allowance consumed, for meters */
      pct: (unlimited || boolGate || !lim) ? (boolGate ? (lim ? 0 : 100) : 0)
           : Math.min(100, Math.round((u / lim) * 100))
    };
  }

  /* ── record() — call AFTER the action succeeded, never before ───────── */
  function record(key, qty) {
    var e = ENT[key];
    if (!e || !e.period || e.period === 'total') return;
    if (DERIVED[key]) return;                       // derived counters self-report
    qty = qty == null ? 1 : qty;
    var stamp = periodStamp(e.period);
    var rec = usage[key];
    if (!rec || rec.p !== stamp) rec = usage[key] = { p: stamp, n: 0 };
    rec.n += qty;
    persistUsage();
    emit('usage', { key: key, used: rec.n, limit: limitFor(key) });
  }

  /* Idempotent variant — a refresh cannot double-spend a quota. */
  var seen = {};
  function recordOnce(key, id, qty) {
    var tag = key + '::' + id;
    if (seen[tag]) return false;
    seen[tag] = 1;
    record(key, qty);
    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     GUARD — the one call a feature makes
     Returns true if the action should proceed.
     In demo mode (config.enforce = false) it always returns true but still
     surfaces the paywall, so the walkthrough is never dead-ended.
     ───────────────────────────────────────────────────────────────────────── */
  function guard(key, opts) {
    opts = opts || {};
    var r = canUse(key, opts.qty);
    if (r.allowed) return true;
    if (RSP.paywall && RSP.paywall.open) RSP.paywall.open(r, opts);
    return !RSP.config.enforce;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     PLAN CHANGES
     ───────────────────────────────────────────────────────────────────────── */
  function activate(tierId, days, meta) {
    if (!TIERS[tierId]) return false;
    meta = meta || {};
    var now = Date.now();
    /* Stacking: if the same tier is already active, extend from its expiry. */
    var base = (sub.tier === tierId && sub.expiresAt && new Date(sub.expiresAt).getTime() > now && !sub.isTrial)
      ? new Date(sub.expiresAt).getTime() : now;

    var prev = sub.tier;
    sub.tier = tierId;
    sub.status = 'active';
    sub.isTrial = false;
    sub.startsAt = new Date(now).toISOString();
    sub.durationDays = tierId === 'spark' ? null : days;
    sub.expiresAt = tierId === 'spark' ? null : new Date(base + days * 864e5).toISOString();
    sub.orderId = meta.orderId || ('RS-' + now.toString(36).toUpperCase());
    sub.source = meta.source || 'demo-activation';
    persistSub();
    emit('change', { from: prev, to: tierId, days: days });
    return true;
  }

  function trialEligible() {
    return !sub.trialUsedAt && sub.tier === 'spark';
  }

  function startTrial() {
    if (!trialEligible()) return false;
    var now = Date.now();
    var prev = sub.tier;
    sub.tier = RSP.config.trialTier;
    sub.status = 'trialing';
    sub.isTrial = true;
    sub.startsAt = new Date(now).toISOString();
    sub.durationDays = RSP.config.trialDays;
    sub.expiresAt = new Date(now + RSP.config.trialDays * 864e5).toISOString();
    sub.trialUsedAt = new Date(now).toISOString();
    sub.autoRenew = false;
    sub.source = 'trial';
    persistSub();
    emit('change', { from: prev, to: sub.tier, trial: true });
    return true;
  }

  function cancel() {
    var prev = sub.tier;
    sub.tier = 'spark'; sub.status = 'cancelled'; sub.isTrial = false;
    sub.expiresAt = null; sub.durationDays = null;
    persistSub();
    emit('change', { from: prev, to: 'spark', cancelled: true });
  }

  /* Testing affordance — resets metering without touching study data. */
  function resetUsage() { usage = {}; seen = {}; persistUsage(); emit('usage', {}); }

  /* ─────────────────────────────────────────────────────────────────────────
     EVENTS
     ───────────────────────────────────────────────────────────────────────── */
  function emit(type, detail) {
    try {
      W.dispatchEvent(new CustomEvent('rankspark-plan', {
        detail: Object.assign({ type: type, tier: sub.tier }, detail || {})
      }));
    } catch (e) {}
  }

  /* Re-check expiry when the tab wakes up. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) reconcile();
  });
  W.addEventListener('storage', function (e) {
    if (e.key === K_SUB)   { sub = readJSON(K_SUB, sub); emit('change', { external: true }); }
    if (e.key === K_USAGE) { usage = readJSON(K_USAGE, usage); emit('usage', { external: true }); }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     PUBLIC API
     ───────────────────────────────────────────────────────────────────────── */
  RSP.plan = {
    /* read */
    tier: tier, meta: tierMeta, rank: rank, sub: function () { reconcile(); return Object.assign({}, sub); },
    isPaid: function () { return tier() !== 'spark'; },
    isTrial: function () { reconcile(); return !!sub.isTrial; },
    daysLeft: daysLeft, expiresOn: function () { return fmtDate(sub.expiresAt); },
    atLeast: function (t) { return rank() >= (TIERS[t] ? TIERS[t].rank : 99); },

    /* entitlements */
    canUse: canUse, limit: limitFor, used: used,
    record: record, recordOnce: recordOnce, guard: guard,

    /* mutations */
    activate: activate, startTrial: startTrial, cancel: cancel,
    trialEligible: trialEligible, resetUsage: resetUsage,

    /* helpers shared with parts 2 & 3 */
    fmtDate: fmtDate, periodLabel: periodLabel, reconcile: reconcile,
    hostState: hostState
  };

  /* ── Retrofit the legacy Paper Lab flags onto the new engine ─────────── */
  W.getPlanTier = function () {
    var t = tier();
    return t === 'inferno' ? 'gold' : t === 'blaze' ? 'pro' : 'free';
  };
  W.getPlanLimits = function () {
    return {
      pdfPerMonth: limitFor('paper_lab.exports_per_month'),
      branding: canUse('paper_lab.branding').allowed,
      unlimitedPDF: limitFor('paper_lab.exports_per_month') === INF,
      templates: canUse('paper_lab.templates').allowed
    };
  };

  reconcile();
})();
