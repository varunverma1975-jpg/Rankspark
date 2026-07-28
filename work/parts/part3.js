/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK PREMIUM — PART 3 / 3 · PAYWALLS, GATING & CHECKOUT
   ───────────────────────────────────────────────────────────────────────────
   • Contextual paywall sheet — states the blocked action, the real usage,
     the concrete outcome, and one recommended plan.
   • Gates wired into the actual product surfaces (mocks, custom practice,
     PYQ, Paper Lab, analytics history, bookmarks, filters, leaderboard).
   • Duration picker + UPI/card/net-banking checkout, simulated client-side,
     with the server contract documented for a real backend.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  var RSP = W.RSP;
  if (!RSP || !RSP.plan) return;

  var P = RSP.plan, T = RSP.TIERS, ENT = RSP.ENTITLEMENTS;
  var ico = RSP.ui.ico, esc = RSP.ui.esc, toast = RSP.ui.toast, go = RSP.ui.go;

  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || D).querySelectorAll(s)); }

  /* ═════════════════════════════════════════════════════════════════════
     OVERLAY PLUMBING
     One overlay element, reused. Focus is trapped, Escape closes, and the
     app's own back-stack (__rsNav) sees it as a modal layer.
     ═════════════════════════════════════════════════════════════════════ */
  var ov, panel, lastFocus = null;

  function ensureOverlay() {
    if (ov) return ov;
    ov = D.createElement('div');
    ov.className = 'rsp-ov modal-backdrop';   /* modal-backdrop → the app's
                                                 back-button layer detects it */
    ov.id = 'rsp-overlay';
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = '<div class="rsp-ov-panel" role="dialog" aria-modal="true"></div>';
    D.body.appendChild(ov);
    panel = $('.rsp-ov-panel', ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = $$('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', panel)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && D.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return ov;
  }

  function open(html, cls) {
    ensureOverlay();
    lastFocus = D.activeElement;
    panel.className = 'rsp-ov-panel' + (cls ? ' ' + cls : '');
    panel.innerHTML = '<button class="rsp-ov-x" data-rsp-close aria-label="Close">' + ico('x', 14) + '</button>' + html;
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    D.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      var f = $('[data-rsp-autofocus]', panel) || $('button:not([data-rsp-close])', panel) || panel;
      try { f.focus({ preventScroll: true }); } catch (e) {}
      $$('[data-fill]', panel).forEach(function (el) { el.style.width = el.dataset.fill + '%'; });
    });
  }

  function close() {
    if (!ov || !ov.classList.contains('open')) return;
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden', 'true');
    D.body.style.overflow = '';
    setTimeout(function () { if (!ov.classList.contains('open')) panel.innerHTML = ''; }, 320);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
    lastFocus = null;
  }

  D.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-rsp-close]')) { e.preventDefault(); close(); }
  });

  /* ═════════════════════════════════════════════════════════════════════
     A. PAYWALL
     ═════════════════════════════════════════════════════════════════════ */

  /* What the user gains, per entitlement, at the recommended tier. Written
     as outcomes, never as "Premium feature". */
  function gains(key, target) {
    var e = ENT[key];
    var list = [];
    if (e && e.outcome) list.push(['check', e.outcome, '']);

    var extra = {
      blaze: [
        ['book',  'Your complete exam library', ' — every volume and the full PYQ archive'],
        ['clock', '8 mock tests a month', ' with pace, comparison and score reports'],
        ['chart', '30 days of history', ' across subject and chapter']
      ],
      inferno: [
        ['flame', 'Unlimited everything', ' — mocks, sessions, exports, bookmarks'],
        ['target','Topic-level diagnosis', ' that names the chapter costing you marks'],
        ['spark', 'A recommended next session', ' built from your own attempts']
      ]
    }[target] || [];

    extra.forEach(function (x) {
      if (list.length < 4) list.push([x[0], x[1], x[2]]);
    });
    return list;
  }

  function paywall(result, opts) {
    opts = opts || {};
    var e = result.meta || ENT[result.key] || {};
    var target = result.upgradeTarget || (P.tier() === 'spark' ? 'blaze' : 'inferno');
    var tm = T[target];
    var trial = target === 'blaze' && P.trialEligible();

    /* Headline states the blocked action in the user's own terms. */
    var title = opts.title || e.blocked || 'This is a paid capability.';
    var why = opts.why || (e.label ? 'You are on ' + T[P.tier()].name + '. ' +
      (result.boolGate
        ? esc(e.label) + ' is available from ' + tm.name + ' upwards.'
        : 'Your ' + T[P.tier()].name + ' allowance for ' + esc(e.label).toLowerCase() + ' is used up' +
          (result.resetAt ? ', and resets ' + P.fmtDate(result.resetAt) : '') + '.') : '');

    /* The receipt: real numbers, not a generic pitch. */
    var meter = '';
    if (!result.boolGate && result.limit !== Infinity && result.limit > 0) {
      meter =
        '<div class="rsp-pw-meter">' +
          '<div class="rsp-pw-meter-top">' +
            '<span>' + esc(e.label || 'Usage') + (result.periodLabel ? ' · ' + esc(result.periodLabel) : '') + '</span>' +
            '<b>' + result.used + ' of ' + result.limit + ' used</b>' +
          '</div>' +
          '<div class="rsp-pw-meter-track"><i data-fill="' + Math.min(100, result.pct) + '"></i></div>' +
          (result.resetAt ? '<div class="rsp-pw-reset">Resets on ' + esc(P.fmtDate(result.resetAt)) +
            ' · upgrading lifts the cap immediately</div>' : '') +
        '</div>';
    }

    var gets = gains(result.key, target).map(function (g) {
      return '<div class="rsp-pw-get">' + ico(g[0], 15) + '<span><b>' + esc(g[1]) + '</b>' + esc(g[2]) + '</span></div>';
    }).join('');

    var price = tm.price[30];
    var demoNote = !RSP.config.enforce
      ? '<div class="rsp-pw-demo">' + ico('info', 12) +
        '<span>Demo build: the paywall is shown for review, but your action still went through. ' +
        'Set <b>RSP.config.enforce = true</b> to make limits binding.</span></div>'
      : '';

    open(
      '<div class="rsp-pw-top" style="--a:' + tm.accent + ';--b:' + tm.accent2 + '">' +
        '<div class="rsp-pw-glyph">' + ico(tm.glyph, 22) + '</div>' +
        '<h2>' + esc(title) + '</h2>' +
        (why ? '<p class="rsp-pw-why">' + esc(why) + '</p>' : '') +
        meter +
      '</div>' +
      '<div class="rsp-pw-body" style="--a:' + tm.accent + ';--b:' + tm.accent2 + '">' +
        '<div class="rsp-pw-h">What ' + esc(tm.name) + ' changes</div>' +
        '<div class="rsp-pw-gets">' + gets + '</div>' +
        '<div class="rsp-pw-plan">' +
          '<span class="rsp-pw-plan-g">' + ico(tm.glyph, 17) + '</span>' +
          '<span class="rsp-pw-plan-t"><b>' + esc(tm.name) + '</b><span>' + esc(tm.audience) + '</span></span>' +
          '<span class="rsp-pw-plan-p"><b>' + RSP.money(price) + '</b><span>per month</span></span>' +
        '</div>' +
        '<div class="rsp-pw-acts">' +
          (trial
            ? '<button class="rsp-pw-btn solid" data-rsp-trial data-rsp-autofocus>' + ico('bolt', 15) + ' Start 7-day free trial</button>' +
              '<button class="rsp-pw-btn ghost" data-rsp-buy="' + target + '">Buy ' + esc(tm.name) + ' · ' + RSP.money(price) + '/mo</button>'
            : '<button class="rsp-pw-btn solid" data-rsp-buy="' + target + '" data-rsp-autofocus>' +
              'Upgrade to ' + esc(tm.name) + ico('arrow-right', 15) + '</button>') +
          '<button class="rsp-pw-btn text" data-rsp-plans>See all plans and durations</button>' +
        '</div>' +
        '<div class="rsp-pw-foot">' +
          (trial ? '<b>No card required.</b> Access drops back to Spark automatically after 7 days. '
                 : '<b>No auto-renewal</b> unless you switch it on. ') +
          'Nothing you have already saved is ever deleted.' +
        '</div>' +
        demoNote +
      '</div>'
    );
  }

  RSP.paywall = { open: paywall, close: close };

  /* ═════════════════════════════════════════════════════════════════════
     B. CHECKOUT
     ═════════════════════════════════════════════════════════════════════ */
  var co = { tier: 'blaze', days: 30, method: 'upi' };

  var METHODS = [
    { id: 'upi',     label: 'UPI',        sub: 'Intent or QR',   badge: 'UPI' },
    { id: 'card',    label: 'Card',       sub: 'Credit or debit',badge: 'card' },
    { id: 'netbank', label: 'Net banking',sub: '50+ banks',      badge: 'NB' },
    { id: 'wallet',  label: 'Wallet',     sub: 'Paytm, PhonePe', badge: 'W' }
  ];

  function checkoutHTML() {
    var tm = T[co.tier];
    var amt = tm.price[co.days] || 0;

    var durs = RSP.DURATIONS.map(function (d) {
      var p = tm.price[d.days] || 0;
      var save = RSP.savingPct(co.tier, d.days);
      var rate = RSP.monthlyRate(co.tier, d.days);
      var sub = d.days >= 30 ? RSP.money(rate) + '/month effective' : d.note;
      return '<button class="rsp-co-dur' + (d.days === co.days ? ' on' : '') + '" data-rsp-setdur="' + d.days + '">' +
        (save >= 10 ? '<span class="rsp-co-save">save ' + save + '%</span>' : '') +
        '<span class="rsp-co-radio"></span>' +
        '<span class="rsp-co-dur-t"><b>' + esc(d.label) + '</b><span>' + esc(sub) + '</span></span>' +
        '<span class="rsp-co-dur-p"><b>' + RSP.money(p) + '</b><span>' + d.days + ' days</span></span>' +
      '</button>';
    }).join('');

    var pays = METHODS.map(function (m) {
      return '<button class="rsp-co-pay' + (m.id === co.method ? ' on' : '') + '" data-rsp-setpay="' + m.id + '">' +
        '<span class="rsp-co-pay-i">' + esc(m.badge) + '</span>' +
        '<span class="rsp-co-pay-t"><b>' + esc(m.label) + '</b><span>' + esc(m.sub) + '</span></span>' +
      '</button>';
    }).join('');

    /* Extension semantics: buying the tier you already hold adds days. */
    var sub = P.sub();
    var extending = sub.tier === co.tier && !sub.isTrial && P.daysLeft() > 0;
    var base = extending ? new Date(sub.expiresAt).getTime() : Date.now();
    var newExpiry = P.fmtDate(new Date(base + co.days * 864e5).toISOString());

    /* Prices are tax-inclusive; show the split so the invoice reconciles. */
    var net = Math.round(amt / 1.18);
    var gst = amt - net;

    return '<div class="rsp-co-head">' +
        '<span class="rsp-eyebrow"><i class="rsp-eyebrow-dot"></i>Secure checkout</span>' +
        '<h2>' + esc(tm.name) + ' · ' + (extending ? 'extend access' : 'new plan') + '</h2>' +
        '<p>' + esc(tm.audience) + '</p>' +
      '</div>' +
      '<div class="rsp-co-body" style="--a:' + tm.accent + ';--b:' + tm.accent2 + '">' +
        '<div class="rsp-co-sec">' +
          '<div class="rsp-co-sec-h">Duration</div>' +
          '<div class="rsp-co-durs">' + durs + '</div>' +
        '</div>' +
        '<div class="rsp-co-sec">' +
          '<div class="rsp-co-sec-h">Payment method</div>' +
          '<div class="rsp-co-pays">' + pays + '</div>' +
        '</div>' +
        '<div class="rsp-co-sec" style="margin-bottom:0">' +
          '<div class="rsp-co-sec-h">Order summary</div>' +
          '<div class="rsp-co-sum">' +
            '<div class="rsp-co-line"><span>' + esc(tm.name) + ' — ' + co.days + ' days</span><b>' + RSP.money(amt) + '</b></div>' +
            '<div class="rsp-co-line"><span>Taxable value</span><b>' + RSP.money(net) + '</b></div>' +
            '<div class="rsp-co-line"><span>GST @ 18% (included)</span><b>' + RSP.money(gst) + '</b></div>' +
            (co.days >= 90 ? '<div class="rsp-co-line free"><span>Duration discount</span><b>−' + RSP.savingPct(co.tier, co.days) + '%</b></div>' : '') +
            '<div class="rsp-co-total"><span>Total payable</span><b>' + RSP.money(amt) + '</b></div>' +
            '<div class="rsp-co-expiry">' + (extending ? 'Extends your current access to ' : 'Access active until ') +
              '<b>' + esc(newExpiry) + '</b></div>' +
          '</div>' +
          '<button class="rsp-co-pay-btn" data-rsp-confirm data-rsp-autofocus>' +
            ico('bolt', 16) + ' Pay ' + RSP.money(amt) + ' · ' + esc(METHODS.filter(function (m) { return m.id === co.method; })[0].label) +
          '</button>' +
          '<div class="rsp-co-trust">' +
            '<span>' + ico('check', 11) + 'No auto-renewal</span>' +
            '<span>' + ico('check', 11) + 'Invoice emailed</span>' +
            '<span>' + ico('check', 11) + 'INR, taxes included</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function openCheckout(tier, days) {
    co.tier = T[tier] ? tier : 'blaze';
    co.days = days || 30;
    if (!T[co.tier].price[co.days]) co.days = 30;
    open(checkoutHTML(), 'rsp-co');
  }

  function repaintCheckout() {
    /* Repaint in place so scroll position and focus survive. */
    var y = panel.scrollTop;
    panel.innerHTML = '<button class="rsp-ov-x" data-rsp-close aria-label="Close">' + ico('x', 14) + '</button>' + checkoutHTML();
    panel.scrollTop = y;
  }

  /* ── payment simulation ─────────────────────────────────────────────────
     SERVER CONTRACT (what a real build replaces this with):
       1  POST /api/orders            { tier, days }        → { orderId, amount, currency, receipt }
       2  open Razorpay Checkout with the returned orderId
       3  POST /api/payments/verify   { orderId, paymentId, signature }
             → server recomputes HMAC-SHA256(order_id|payment_id, key_secret)
       4  webhook payment.captured is the source of truth; it is idempotent
          on provider event id and activates the entitlement
       5  client polls / receives the activated subscription and renders this
          success screen
     Nothing below should be trusted by a server — it is presentation only.
     ──────────────────────────────────────────────────────────────────── */
  function confirmPayment(btn) {
    var tm = T[co.tier];
    var amt = tm.price[co.days] || 0;
    var label = METHODS.filter(function (m) { return m.id === co.method; })[0].label;

    btn.disabled = true;
    btn.innerHTML = '<span class="rsp-co-spin"></span> ' +
      (co.method === 'upi' ? 'Waiting for UPI approval…' : 'Contacting your bank…');

    setTimeout(function () {
      btn.innerHTML = '<span class="rsp-co-spin"></span> Verifying payment…';
      setTimeout(function () {
        var orderId = 'RS-' + Date.now().toString(36).toUpperCase();
        P.activate(co.tier, co.days, { orderId: orderId, source: 'checkout-' + co.method });
        success(orderId, amt, label);
      }, 850);
    }, 1250);
  }

  function success(orderId, amt, method) {
    var tm = T[co.tier];
    confetti(tm.accent, tm.accent2);
    open(
      '<div class="rsp-ok">' +
        '<div class="rsp-ok-ring"><div class="rsp-ok-check">' + ico('check', 24) + '</div></div>' +
        '<h2>' + esc(tm.name) + ' is live</h2>' +
        '<p>Your plan is active right away. Everything you had on your old tier came with you — nothing was reset.</p>' +
        '<div class="rsp-ok-card">' +
          '<div class="rsp-ok-row"><span>Plan</span><b>' + esc(tm.name) + ' · ' + co.days + ' days</b></div>' +
          '<div class="rsp-ok-row"><span>Amount paid</span><b>' + RSP.money(amt) + '</b></div>' +
          '<div class="rsp-ok-row"><span>Method</span><b>' + esc(method) + '</b></div>' +
          '<div class="rsp-ok-row"><span>Order ID</span><b>' + esc(orderId) + '</b></div>' +
          '<div class="rsp-ok-row"><span>Active until</span><b>' + esc(P.expiresOn()) + '</b></div>' +
          '<div class="rsp-ok-row"><span>Auto-renewal</span><b>Off</b></div>' +
        '</div>' +
        '<div class="rsp-ok-acts">' +
          '<button class="rsp-pw-btn solid" style="--a:' + tm.accent + ';--b:' + tm.accent2 + '" data-rsp-close data-rsp-autofocus>Start practising</button>' +
          '<button class="rsp-pw-btn text" data-rsp-plans>View plan details</button>' +
        '</div>' +
      '</div>'
    );
    toast(tm.name + ' activated until ' + P.expiresOn() + '.');
  }

  function startTrial() {
    if (!P.trialEligible()) { toast('Your free trial has already been used.'); return; }
    P.startTrial();
    var tm = T[P.tier()];
    confetti(tm.accent, tm.accent2);
    open(
      '<div class="rsp-ok">' +
        '<div class="rsp-ok-ring"><div class="rsp-ok-check">' + ico('bolt', 24) + '</div></div>' +
        '<h2>7 days of Blaze, on us</h2>' +
        '<p>Full library, 8 mocks and 30-day analysis until <b style="color:#d6f5e8">' + esc(P.expiresOn()) +
        '</b>. No card was taken and nothing will be charged.</p>' +
        '<div class="rsp-ok-card">' +
          '<div class="rsp-ok-row"><span>Plan</span><b>Blaze · trial</b></div>' +
          '<div class="rsp-ok-row"><span>Ends on</span><b>' + esc(P.expiresOn()) + '</b></div>' +
          '<div class="rsp-ok-row"><span>Cost</span><b>Free</b></div>' +
          '<div class="rsp-ok-row"><span>After the trial</span><b>Back to Spark, data intact</b></div>' +
        '</div>' +
        '<div class="rsp-ok-acts">' +
          '<button class="rsp-pw-btn solid" data-rsp-close data-rsp-autofocus>Start practising</button>' +
          '<button class="rsp-pw-btn text" data-rsp-plans>See what Blaze unlocks</button>' +
        '</div>' +
      '</div>'
    );
    toast('Blaze trial started — 7 days.');
  }

  RSP.checkout = { open: openCheckout, trial: startTrial, close: close };

  /* ── confetti ───────────────────────────────────────────────────────── */
  function confetti(a, b) {
    if (W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var wrap = D.createElement('div');
    wrap.className = 'rsp-conf';
    var cols = [a, b, '#2ee3a2', '#ffc24b', '#ffffff'];
    var n = 56, html = '';
    for (var i = 0; i < n; i++) {
      html += '<i style="left:' + (Math.random() * 100) + '%;background:' + cols[i % cols.length] +
              ';animation-duration:' + (1.5 + Math.random() * 1.4).toFixed(2) + 's' +
              ';animation-delay:' + (Math.random() * .35).toFixed(2) + 's' +
              ';transform:rotate(' + Math.floor(Math.random() * 360) + 'deg)"></i>';
    }
    wrap.innerHTML = html;
    D.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 3400);
  }

  /* ═════════════════════════════════════════════════════════════════════
     C. EVENT DELEGATION
     ═════════════════════════════════════════════════════════════════════ */
  D.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;

    var buy = t.closest('[data-rsp-buy]');
    if (buy) { e.preventDefault(); openCheckout(buy.dataset.rspBuy, 30); return; }

    if (t.closest('[data-rsp-trial]')) { e.preventDefault(); startTrial(); return; }

    if (t.closest('[data-rsp-plans]')) { e.preventDefault(); close(); go('pricing'); return; }

    var sd = t.closest('[data-rsp-setdur]');
    if (sd) { e.preventDefault(); co.days = Number(sd.dataset.rspSetdur); repaintCheckout(); return; }

    var sp = t.closest('[data-rsp-setpay]');
    if (sp) { e.preventDefault(); co.method = sp.dataset.rspSetpay; repaintCheckout(); return; }

    var cf = t.closest('[data-rsp-confirm]');
    if (cf) { e.preventDefault(); confirmPayment(cf); return; }
  });

  /* ═════════════════════════════════════════════════════════════════════
     D. GATES — wired into the real product
     Every gate follows the same shape: ask the engine, let the engine
     decide whether to show the paywall, and only record usage on success.
     ═════════════════════════════════════════════════════════════════════ */

  /* Map the app's practice modes onto entitlement keys. */
  var MODE_KEY = {
    mock:   'mock.completed_per_month',
    custom: 'custom.sessions_per_week',
    random: 'random.sessions_per_week',
    pyq:    'pyq.questions_per_week'
  };

  function wireGates() {

    /* ── 1. Practice start — the highest-value gate ─────────────────── */
    var startBtn = $('#start-session') || $('[data-start-session]') ||
                   $('#practice-start') || $('[data-go="runtime"]');
    D.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-go="runtime"], #start-session, #practice-start');
      if (!b) return;
      /* state is a script-scope const in the host app, not window.state. */
      var hs = P.hostState();
      var mode = (hs && hs.mode) || 'custom';
      var key = MODE_KEY[mode];
      if (!key) return;
      var r = P.canUse(key, 1);
      if (!r.allowed) {
        paywall(r, { title: modeTitle(mode, r) });
        if (RSP.config.enforce) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      }
      /* Count it only once the session actually begins. */
      P.record(key, 1);
    }, true);

    /* ── 2. Mode tiles on Home — pre-emptive lock badge ─────────────── */
    refreshModeLocks();

    /* ── 3. Paper Lab export ────────────────────────────────────────── */
    D.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('#plm-gen, [data-paper-export]');
      if (!b) return;
      var r = P.canUse('paper_lab.exports_per_month', 1);
      if (!r.allowed) {
        paywall(r);
        if (RSP.config.enforce) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      }
      P.record('paper_lab.exports_per_month', 1);
    }, true);

    /* ── 4. Bookmarks — never destructive, only new writes metered ──── */
    D.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-solution-action="bookmark"], #bookmark-question');
      if (!b) return;
      var r = P.canUse('bookmarks.max_count', 1);
      if (!r.allowed) {
        paywall(r, {
          title: 'Your bookmark shelf is full.',
          why: 'Spark holds ' + r.limit + ' saved questions. Nothing has been deleted — remove an old one, or lift the cap.'
        });
        if (RSP.config.enforce) { e.preventDefault(); e.stopImmediatePropagation(); }
      }
    }, true);

    /* ── 5. Advanced filters in Question Bank ───────────────────────── */
    ['#bank-year-filter', '#bank-exam-filter', '#bank-type-filter', '#bank-chem-filter'].forEach(function (sel) {
      var el = $(sel); if (!el) return;
      el.addEventListener('mousedown', function (e) {
        var r = P.canUse('filters.advanced');
        if (r.allowed) return;
        paywall(r, { title: 'Year, exam and type filters are part of Blaze.' });
        if (RSP.config.enforce) { e.preventDefault(); el.blur(); }
      });
    });

    /* ── 6. Analytics history range ─────────────────────────────────── */
    var range = $('#analytics-range') || $('#analytics-trend-range');
    if (range) {
      range.addEventListener('change', function (e) {
        var want = parseInt(range.value, 10);
        if (!want) return;
        var allowed = P.limit('analytics.history_days');
        if (allowed === Infinity || want <= allowed) return;
        var r = P.canUse('analytics.history_days');
        r.upgradeTarget = allowed >= 30 ? 'inferno' : 'blaze';
        paywall(r, {
          title: want + ' days of history is beyond your plan.',
          why: T[P.tier()].name + ' keeps ' + (allowed ? allowed + ' days' : 'the current session only') +
               '. Longer trends are what show whether your preparation is actually working.'
        });
        if (RSP.config.enforce) { range.value = String(allowed || 7); }
      });
    }

    /* ── 7. Leaderboard participation ───────────────────────────────── */
    D.addEventListener('click', function (e) {
      var l = e.target.closest && e.target.closest('[data-leaderboard-tab]');
      if (!l) return;
      var tab = l.dataset.leaderboardTab;
      if (tab === 'global') return;
      var r = P.canUse('leaderboard.participate');
      if (r.allowed) return;
      paywall(r, { title: 'Ranked boards beyond your personal rank are paid.' });
      if (RSP.config.enforce) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    /* ── 8. Data export ─────────────────────────────────────────────── */
    D.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('#download-data, #download-data-row');
      if (!b) return;
      var r = P.canUse('data.export');
      if (r.allowed) return;
      /* Doc rule: users may always export their own basic data. Only the
         formatted performance report is gated, so we inform and continue. */
      paywall(r, {
        title: 'Formatted performance exports are part of Blaze.',
        why: 'Your raw account data is always yours to download — the CSV/PDF performance report is the paid part.'
      });
    }, true);
  }

  function modeTitle(mode, r) {
    if (mode === 'mock') return 'You have used ' + r.used + ' of ' + r.limit + ' mocks ' + r.periodLabel + '.';
    if (mode === 'pyq') return 'You have opened all ' + r.limit + ' sample PYQs this week.';
    if (mode === 'random') return 'Random practice is limited on ' + T[P.tier()].name + '.';
    return 'You have used all ' + r.limit + ' custom sessions this week.';
  }

  /* Lock badges on the Home quick-start tiles, so the limit is visible
     before the user commits to a flow. */
  function refreshModeLocks() {
    $$('.quick-card[data-mode]').forEach(function (card) {
      var key = MODE_KEY[card.dataset.mode];
      if (!key) return;
      var r = P.canUse(key, 1);
      if (r.allowed) card.removeAttribute('data-rsp-locked');
      else card.setAttribute('data-rsp-locked', '1');
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     E. ANALYTICS VEIL — show the shape of what is hidden
     ═════════════════════════════════════════════════════════════════════ */
  function veilAnalytics() {
    var host = $('#analytics-focus-card');
    if (!host) return;
    var r = P.canUse('analytics.topic_diagnosis');
    var existing = $('#rsp-veil-focus', host.parentNode || D);

    if (r.allowed) { if (existing) existing.remove(); host.style.display = ''; return; }
    if (existing) return;

    var tm = T['inferno'];
    var v = D.createElement('div');
    v.id = 'rsp-veil-focus';
    v.className = 'card rsp-veil';
    v.style.cssText = 'padding:0;overflow:hidden;margin-bottom:12px';
    v.innerHTML =
      '<div class="rsp-veil-content" style="padding:18px">' +
        '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6d7a9a;margin-bottom:8px">Focus topic</div>' +
        '<div style="font-size:17px;font-weight:750;margin-bottom:6px">Rotational Dynamics · Torque</div>' +
        '<div style="font-size:12px;color:#9aa4c0;line-height:1.6">Accuracy 41% across 28 attempts — 14 points below your Physics average. ' +
        'Three of your last five errors were sign conventions.</div>' +
      '</div>' +
      '<div class="rsp-veil-over">' +
        '<span class="rsp-lock" data-t="inferno">' + ico('diamond', 10) + ' Inferno</span>' +
        '<b>Topic-level diagnosis</b>' +
        '<p>Inferno reads your whole attempt history and names the single topic costing you the most marks — then builds the session to fix it.</p>' +
        '<button class="rsp-pw-btn solid" style="--a:' + tm.accent + ';--b:' + tm.accent2 + ';width:auto;padding:10px 18px" ' +
          'data-rsp-buy="inferno">See Inferno</button>' +
      '</div>';
    host.parentNode.insertBefore(v, host);
  }

  /* ═════════════════════════════════════════════════════════════════════
     F. BOOT
     ═════════════════════════════════════════════════════════════════════ */
  function boot() {
    ensureOverlay();
    wireGates();
    veilAnalytics();
  }

  W.addEventListener('rankspark-plan', function () {
    refreshModeLocks();
    veilAnalytics();
  });

  /* Re-evaluate locks when the user lands on a page that shows them. */
  D.addEventListener('click', function (e) {
    var l = e.target.closest && e.target.closest('[data-view]');
    if (l) setTimeout(function () { refreshModeLocks(); veilAnalytics(); }, 120);
  });

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 60); });
  else setTimeout(boot, 60);
  setTimeout(function () { wireGates(); veilAnalytics(); }, 900);

  /* ── Dev console surface ─────────────────────────────────────────────── */
  RSP.dev = {
    grant: function (t, d) { P.activate(t, d || 30, { source: 'dev' }); return P.tier(); },
    /* Full billing reset — clears the subscription, metering, the migration
       marker and the legacy tier flag, so the next load is a true fresh
       install. Study data (attempts, bookmarks, XP) is deliberately kept. */
    reset: function (reload) {
      ['rankspark-subscription', 'rankspark-usage', 'rankspark-banner-dismissed',
       'rankspark-plan-migrated', 'rankspark-plan'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
      });
      if (reload !== false) (window.RSP && RSP.reload ? RSP.reload() : location.reload());
      return 'billing state cleared';
    },
    usage: function () {
      var out = {};
      Object.keys(ENT).forEach(function (k) {
        var r = P.canUse(k, 0);
        out[k] = r.boolGate ? (r.limit ? 'yes' : 'no')
               : r.used + '/' + (r.limit === Infinity ? '∞' : r.limit);
      });
      return out;
    },
    fill: function (k) {
      var lim = P.limit(k);
      if (lim === Infinity || typeof lim === 'boolean') return 'not metered';
      P.record(k, lim);
      return P.canUse(k, 0);
    },
    enforce: function (on) { RSP.config.enforce = on !== false; return RSP.config.enforce; },
    paywall: function (k) { paywall(P.canUse(k, 1)); }
  };
})();
