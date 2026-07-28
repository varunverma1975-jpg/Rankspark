/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK PREMIUM — PART 2 / 3 · UI SURFACES
   ───────────────────────────────────────────────────────────────────────────
   • #page-pricing — full plan comparison view, injected into <main>
   • sidebar plan card — live tier + real usage meters
   • trial / expiry banner on Home
   • nav entry, routing, and re-render on every plan event
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;
  var RSP = W.RSP;
  if (!RSP || !RSP.plan) return;

  var P = RSP.plan, T = RSP.TIERS, ORDER = RSP.TIER_ORDER, ENT = RSP.ENTITLEMENTS;
  var INF = Infinity;

  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || D).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* Use the app's own sprite so icons stay visually consistent. */
  function ico(name, sz) {
    return '<svg class="ui-icon" style="width:' + (sz || 16) + 'px;height:' + (sz || 16) +
           'px" aria-hidden="true"><use href="#icon-' + name + '"></use></svg>';
  }
  function toast(msg) {
    if (W.showToast) { try { return W.showToast(msg); } catch (e) {} }
    var t = $('#toast'); if (!t) return;
    var spans = t.querySelectorAll('span');
    (spans[spans.length - 1] || t).textContent = msg;
    t.classList.add('show');
    clearTimeout(W.__rspToast);
    W.__rspToast = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  RSP.ui = RSP.ui || {};
  RSP.ui.ico = ico; RSP.ui.esc = esc; RSP.ui.toast = toast;

  /* Selected billing duration on the pricing page. */
  var billDays = 30;

  /* ═════════════════════════════════════════════════════════════════════
     A. PRICING PAGE
     ═════════════════════════════════════════════════════════════════════ */

  /* Highlight reel per tier — the 4 lines that actually sell it. */
  var HIGHLIGHTS = {
    spark: [
      { on: true,  k: '2 Physics + 1 Chemistry volume', t: ' free, plus a starter volume for your stream' },
      { on: true,  k: '1 mock test a week',             t: ' with score and accuracy' },
      { on: true,  k: '20 PYQs weekly',                 t: ' and 3 custom sessions' },
      { on: false, k: 'No performance history',         t: ' — you see the session, not the trend' }
    ],
    blaze: [
      { on: true, k: 'Your full exam library',      t: ' — every volume, every PYQ' },
      { on: true, k: '8 mocks a month',             t: ' with pace and comparison reports' },
      { on: true, k: '30-day analytics',            t: ' across subject and chapter' },
      { on: true, k: 'Unlimited custom practice',   t: ' and 2,000 bookmarks' }
    ],
    inferno: [
      { on: true, k: 'Everything, unlimited',        t: ' — mocks, sessions, exports' },
      { on: true, k: 'Topic-level diagnosis',        t: ' that names the chapter to fix' },
      { on: true, k: 'Recommended next session',     t: ' built from your own attempts' },
      { on: true, k: 'Every exam stream',            t: ' plus templates and priority support' }
    ]
  };

  var FAQ = [
    ['Is the 7-day trial really free?',
     'Yes. Seven days of full Blaze access after you verify your account — no card, no UPI mandate, nothing to cancel. When it ends you drop back to Spark automatically and every attempt, bookmark and analytic you created stays exactly where it is.'],
    ['What happens to my data if I downgrade?',
     'Nothing is deleted, ever. Your XP, streaks, saved questions, mistake book and attempt history remain on your account. Features above your tier simply become read-only — for example a full bookmark shelf still opens, you just cannot add to it until you free a slot or upgrade.'],
    ['Can I pay for a shorter or longer period?',
     'Every plan is sold as tier + duration: 7, 30, 90, 180 or 365 days. Longer durations carry a lower effective monthly rate — the annual Blaze plan works out to ₹100 a month against ₹149 monthly. Access expires on the date shown on your invoice; nothing auto-charges unless you explicitly turn on renewal.'],
    ['Which payment methods work?',
     'UPI is the primary method — intent and QR both. Cards, net banking and wallets are available as fallbacks. All prices are in INR and the full payable amount is shown before you confirm.'],
    ['Do I need Inferno, or is Blaze enough?',
     'Blaze is built for one primary exam and covers most aspirants completely. Choose Inferno if you are a repeater, you prepare across multiple exams or subjects, you regularly hit mock and export limits, or you want the app to tell you which topic to attack next rather than only reporting what happened.'],
    ['Can I switch or cancel?',
     'Switch tiers whenever you like — buying the same tier again extends your existing expiry rather than replacing it. There is no lock-in and no cancellation step for prepaid durations, because nothing renews on its own.']
  ];

  function priceBlock(t) {
    var tier = T[t];
    var amt = tier.price[billDays] || 0;
    var isFree = tier.rank === 0;

    if (isFree) {
      return '<div class="rsp-price">' +
               '<span class="rsp-price-num">Free</span>' +
               '<span class="rsp-price-per">forever</span>' +
             '</div>' +
             '<div class="rsp-price-note">No card, no expiry, no trial clock</div>';
    }

    var per = billDays === 7 ? 'for 7 days'
            : billDays === 30 ? '/month'
            : 'total';
    var note = '';
    if (billDays > 30) {
      var rate = RSP.monthlyRate(t, billDays);
      var save = RSP.savingPct(t, billDays);
      var full = (tier.price[30] || 0) * RSP.months(billDays);
      note = '<span class="rsp-price-strike">' + RSP.money(full) + '</span>' +
             RSP.money(rate) + '/mo' + (save ? ' · <b>save ' + save + '%</b>' : '');
    } else if (billDays === 7) {
      note = 'Paid week · <b>the free trial is better</b>';
    } else {
      note = 'Billed once · cancel anytime · no auto-renew';
    }

    return '<div class="rsp-price">' +
             '<span class="rsp-price-cur">₹</span>' +
             '<span class="rsp-price-num" data-count="' + amt + '">' + amt.toLocaleString('en-IN') + '</span>' +
             '<span class="rsp-price-per">' + per + '</span>' +
           '</div>' +
           '<div class="rsp-price-note">' + note + '</div>';
  }

  function tierCard(t) {
    var tier = T[t];
    var cur = P.tier();
    var isCur = cur === t;
    var sub = P.sub();
    var trialOnThis = sub.isTrial && cur === t;

    var cls = 'rsp-tier';
    if (tier.recommended && !isCur) cls += ' is-featured';
    if (isCur) cls += ' is-current';

    var flag = '';
    if (isCur) flag = '<span class="rsp-tier-flag curr">' + (trialOnThis ? 'On trial' : 'Your plan') + '</span>';
    else if (tier.recommended) flag = '<span class="rsp-tier-flag pop">Most popular</span>';

    /* CTA logic — the button says what actually happens next. */
    var cta, ctaCls, ctaSub = '', act = '';
    if (isCur && !trialOnThis) {
      cta = t === 'spark' ? 'Your current plan' : 'Extend ' + tier.name;
      ctaCls = t === 'spark' ? 'ghost' : 'solid';
      act = t === 'spark' ? '' : 'buy';
      ctaSub = t === 'spark' ? 'Upgrade whenever you are ready'
             : 'Renews to ' + P.expiresOn() + ' → +' + billDays + ' days';
    } else if (trialOnThis) {
      cta = 'Keep ' + tier.name + ' after trial'; ctaCls = 'solid'; act = 'buy';
      ctaSub = P.daysLeft() + ' trial day' + (P.daysLeft() === 1 ? '' : 's') + ' remaining';
    } else if (t === 'spark') {
      cta = 'Included with every account'; ctaCls = 'ghost'; act = '';
      ctaSub = 'You always keep this';
    } else if (t === 'blaze' && P.trialEligible()) {
      cta = 'Start 7-day free trial'; ctaCls = 'solid'; act = 'trial';
      ctaSub = 'No card required · then ' + RSP.money(tier.price[30]) + '/mo';
    } else {
      var up = T[t].rank > T[cur].rank;
      cta = (up ? 'Upgrade to ' : 'Switch to ') + tier.name; ctaCls = 'solid'; act = 'buy';
      ctaSub = billDays === 30 ? 'UPI · cards · net banking'
             : RSP.money(tier.price[billDays]) + ' for ' + billDays + ' days';
    }

    var feats = HIGHLIGHTS[t].map(function (f) {
      return '<div class="rsp-feat' + (f.on ? '' : ' off') + '">' +
               ico(f.on ? 'check' : 'minus', 14) +
               '<span><b>' + esc(f.k) + '</b>' + esc(f.t) + '</span>' +
             '</div>';
    }).join('');

    return '<article class="' + cls + '" data-t="' + t + '" data-rsp-tilt>' +
      flag +
      '<div class="rsp-tier-head">' +
        '<div class="rsp-tier-glyph">' + ico(tier.glyph, 20) + '</div>' +
        '<div><div class="rsp-tier-name">' + esc(tier.name) + '</div>' +
        '<div class="rsp-tier-tag">' + esc(tier.tagline) + '</div></div>' +
      '</div>' +
      '<p class="rsp-tier-blurb">' + esc(tier.blurb) + '</p>' +
      priceBlock(t) +
      (act
        ? '<button class="rsp-tier-cta ' + ctaCls + '" data-rsp-act="' + act + '" data-t="' + t + '">' +
            esc(cta) + (act === 'buy' ? ico('arrow-right', 15) : '') + '</button>'
        : '<button class="rsp-tier-cta ghost" disabled>' + esc(cta) + '</button>') +
      '<div class="rsp-tier-sub">' + esc(ctaSub) + '</div>' +
      '<div class="rsp-feats">' +
        '<div class="rsp-feats-h">' + (t === 'spark' ? 'What you get' : 'Everything below, plus') + '</div>' +
        feats +
      '</div>' +
    '</article>';
  }

  function billingSwitch() {
    var btns = RSP.DURATIONS.map(function (d) {
      var save = RSP.savingPct('blaze', d.days);
      var sub = d.days === 7 ? 'trial instead' : (save ? 'save ' + save + '%' : 'standard');
      return '<button data-rsp-dur="' + d.days + '"' + (d.days === billDays ? ' class="on"' : '') + '>' +
               esc(d.label) + '<small>' + sub + '</small>' +
             '</button>';
    }).join('');
    return '<div class="rsp-billing">' +
             '<div class="rsp-billing-l">' +
               '<strong>Choose your billing period</strong>' +
               '<span>Longer prepaid durations lower the effective monthly rate. Nothing renews automatically.</span>' +
             '</div>' +
             '<div class="rsp-seg" id="rsp-seg"><span class="rsp-seg-thumb"></span>' + btns + '</div>' +
           '</div>';
  }

  /* ── usage panel — only meaningful entitlements, live values ─────────── */
  var METERED = [
    'mock.completed_per_month',
    'custom.sessions_per_week',
    'pyq.questions_per_week',
    'paper_lab.exports_per_month',
    'bookmarks.max_count',
    'pack.volume_access'
  ];

  function usagePanel() {
    var cards = METERED.map(function (k) {
      var r = P.canUse(k, 0);
      var e = ENT[k];
      var cls = 'rsp-meter';
      var valTxt, foot, pct = r.pct;

      if (r.unlimited) {
        cls += ' inf';
        valTxt = '<b>' + r.used.toLocaleString('en-IN') + '</b> used · unlimited';
        foot = 'No cap on ' + T[P.tier()].name;
      } else {
        if (pct >= 100) cls += ' full';
        else if (pct >= 70) cls += ' warn';
        valTxt = '<b>' + r.used.toLocaleString('en-IN') + '</b> / ' + r.limit.toLocaleString('en-IN');
        var lbl = P.periodLabel(r.period);
        foot = pct >= 100
          ? 'Limit reached' + (r.resetAt ? ' · resets ' + P.fmtDate(r.resetAt) : '')
          : (r.limit - r.used) + ' left' + (lbl ? ' ' + lbl : '');
      }
      return '<div class="' + cls + '">' +
               '<div class="rsp-meter-top"><span class="rsp-meter-label">' + esc(e.label) + '</span>' +
               '<span class="rsp-meter-val">' + valTxt + '</span></div>' +
               '<div class="rsp-meter-track"><i class="rsp-meter-fill" data-pct="' + pct + '"></i></div>' +
               '<div class="rsp-meter-foot">' + esc(foot) + '</div>' +
             '</div>';
    }).join('');

    var sub = P.sub(), t = P.tier(), tm = T[t];
    var statusLine;
    if (sub.isTrial) statusLine = 'Blaze trial · ' + P.daysLeft() + ' day' + (P.daysLeft() === 1 ? '' : 's') + ' left · ends ' + P.expiresOn();
    else if (t === 'spark') statusLine = 'Free forever · no expiry';
    else statusLine = 'Active until ' + P.expiresOn() + ' · ' + P.daysLeft() + ' days remaining';

    return '<div class="section-title"><h2>Your plan &amp; usage</h2>' +
             '<span class="rsp-tier-chip" data-t="' + t + '">' + ico(tm.glyph, 12) + esc(tm.name) + '</span></div>' +
           '<div class="card" style="padding:18px 18px 20px;margin-bottom:8px">' +
             '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
               '<div style="font-size:11.5px;color:var(--muted)">' + esc(statusLine) + '</div>' +
               (t !== 'spark' && sub.orderId ? '<div style="font-size:10px;color:var(--muted-2);font-variant-numeric:tabular-nums">Order ' + esc(sub.orderId) + '</div>' : '') +
             '</div>' +
             '<div class="rsp-usage-grid">' + cards + '</div>' +
           '</div>';
  }

  /* ── comparison matrix ──────────────────────────────────────────────── */
  function matrix() {
    var groups = {};
    Object.keys(ENT).forEach(function (k) {
      var e = ENT[k]; if (!e.row) return;
      (groups[e.group] = groups[e.group] || []).push(e);
    });

    var cur = P.tier();
    var head = '<colgroup><col style="width:34%">' +
      ORDER.map(function (t) { return '<col' + (t === 'blaze' ? ' class="rsp-hl"' : '') + '>'; }).join('') +
      '</colgroup><thead><tr><th>Capability</th>' +
      ORDER.map(function (t) {
        var tm = T[t];
        var price = t === 'spark' ? 'Free' : RSP.money(tm.price[30]) + '/mo';
        return '<th data-t="' + t + '"><div class="rsp-mh"><b>' + esc(tm.name) +
               (t === cur ? ' ·' : '') + '</b><span>' + price + '</span></div></th>';
      }).join('') + '</tr></thead>';

    var body = Object.keys(groups).map(function (g) {
      return '<tr class="rsp-grp"><td colspan="4">' + esc(g) + '</td></tr>' +
        groups[g].map(function (e) {
          return '<tr class="rsp-row"><td>' + esc(e.row) + '</td>' +
            ORDER.map(function (t) {
              var d = e.display && e.display[t];
              var lim = e.limit[t];
              if (d === undefined) {
                if (typeof lim === 'boolean') d = lim ? 'Yes' : '—';
                else d = lim === INF ? 'Unlimited' : String(lim);
              }
              var neg = (d === '—' || d === 'No' || lim === false || lim === 0);
              if (d === 'Yes' || d === '—' || d === 'No') {
                return '<td class="' + (neg ? 'off' : 'on') + '"><span class="rsp-tick ' + (neg ? 'n' : 'y') + '">' +
                       ico(neg ? 'minus' : 'check', 12) + '</span></td>';
              }
              return '<td class="' + (neg ? 'off' : 'on') + '">' + esc(d) + '</td>';
            }).join('') + '</tr>';
        }).join('');
    }).join('');

    return '<div class="section-title"><h2>Compare every capability</h2>' +
             '<span style="color:var(--muted);font-size:11px">' + Object.keys(ENT).length + ' tracked entitlements</span></div>' +
           '<div class="rsp-matrix-wrap"><table class="rsp-matrix">' + head + '<tbody>' + body + '</tbody></table></div>' +
           '<div class="section-title" style="margin-top:22px"><h2>Never behind a paywall</h2></div>' +
           '<div class="rsp-never">' + RSP.NEVER_GATED.map(function (s) {
             return '<div class="rsp-never-item">' + ico('check', 14) + '<span>' + esc(s) + '</span></div>';
           }).join('') + '</div>';
  }

  function faq() {
    return '<div class="section-title" style="margin-top:24px"><h2>Before you decide</h2></div>' +
           '<div class="rsp-faq">' + FAQ.map(function (q, i) {
             return '<details' + (i === 0 ? ' open' : '') + '><summary>' + esc(q[0]) + '</summary>' +
                    '<div class="rsp-faq-b">' + esc(q[1]) + '</div></details>';
           }).join('') + '</div>';
  }

  function hero() {
    var t = P.tier(), sub = P.sub();
    var eyebrow = sub.isTrial
      ? 'Blaze trial · ' + P.daysLeft() + ' days left'
      : t === 'spark' ? 'You are on Spark' : T[t].name + ' active';
    return '<section class="rsp-hero">' +
      '<div class="rsp-hero-in">' +
        '<span class="rsp-eyebrow"><i class="rsp-eyebrow-dot"></i>' + esc(eyebrow) + '</span>' +
        '<h1>Practice is free.<em>Knowing what to fix is the upgrade.</em></h1>' +
        '<p class="rsp-hero-sub">Every RankSpark account can find questions, sit a mock and review a solution. ' +
        'Paid plans exist for the harder problem — <b>the full syllabus in one place</b>, ' +
        '<b>enough mock volume to build exam stamina</b>, and <b>analysis that names the chapter costing you marks</b>.</p>' +
        '<div class="rsp-hero-facts">' +
          '<span class="rsp-fact">' + ico('bolt', 14) + '<b>7 days</b> of Blaze, free, no card</span>' +
          '<span class="rsp-fact">' + ico('check', 14) + '<b>No auto-renew</b> unless you ask for it</span>' +
          '<span class="rsp-fact">' + ico('shuffle', 14) + '<b>UPI</b>, cards &amp; net banking</span>' +
          '<span class="rsp-fact">' + ico('bookmark', 14) + '<b>Your data stays</b> if you downgrade</span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function renderPricing() {
    var page = $('#page-pricing'); if (!page) return;
    page.innerHTML =
      '<div class="page-heading"><div><h1>Plans &amp; Pricing</h1>' +
        '<p class="subheading">Pick the plan that matches how hard you are preparing.</p></div>' +
        '<button class="secondary-btn" data-view="home">' + ico('arrow-left', 14) + ' Back to Home</button></div>' +
      hero() +
      billingSwitch() +
      '<div class="rsp-tiers">' + ORDER.map(tierCard).join('') + '</div>' +
      '<div style="text-align:center;margin:16px 0 26px;font-size:11px;color:var(--muted-2)">' +
        'Prices in INR and inclusive of applicable taxes. Access runs to the expiry date on your invoice.</div>' +
      usagePanel() +
      matrix() +
      faq() +
      '<div style="height:22px"></div>';

    wireSeg(page);
    wireTilt(page);
    animateMeters(page);
  }

  /* ── segmented control: sliding thumb ───────────────────────────────── */
  function wireSeg(root) {
    var seg = $('#rsp-seg', root); if (!seg) return;
    var thumb = $('.rsp-seg-thumb', seg);
    function place() {
      var on = $('button.on', seg); if (!on || !thumb) return;
      thumb.style.width = on.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + (on.offsetLeft - 4) + 'px)';
    }
    /* Two frames: layout must settle before the thumb is measured. */
    requestAnimationFrame(function () { requestAnimationFrame(place); });
    W.addEventListener('resize', place);
    seg.__place = place;
  }

  /* ── pointer-tracked card glow ──────────────────────────────────────── */
  function wireTilt(root) {
    if (W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    $$('[data-rsp-tilt]', root).forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--px', ((e.clientX - r.left) / r.width * 100) + '%');
        el.style.setProperty('--py', ((e.clientY - r.top) / r.height * 100) + '%');
      });
    });
  }

  /* ── meters fill on reveal ──────────────────────────────────────────── */
  function animateMeters(root) {
    var fills = $$('.rsp-meter-fill', root);
    if (!fills.length) return;
    var run = function () {
      fills.forEach(function (f, i) {
        setTimeout(function () { f.style.width = (f.dataset.pct || 0) + '%'; }, 60 + i * 55);
      });
    };
    if (!('IntersectionObserver' in W)) return run();
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { run(); io.disconnect(); } });
    }, { threshold: .25 });
    io.observe(fills[0].closest('.rsp-usage-grid') || fills[0]);
  }

  /* ── price roll on duration change ──────────────────────────────────── */
  function repriceOnly() {
    ORDER.forEach(function (t) {
      var card = $('.rsp-tier[data-t="' + t + '"]'); if (!card) return;
      var old = card.querySelector('.rsp-price');
      var note = card.querySelector('.rsp-price-note');
      var html = priceBlock(t);
      var box = D.createElement('div'); box.innerHTML = html;
      if (old && note) {
        old.replaceWith(box.querySelector('.rsp-price'));
        note.replaceWith(box.querySelector('.rsp-price-note'));
      }
      /* CTA copy depends on duration too. */
      var freshCard = D.createElement('div'); freshCard.innerHTML = tierCard(t);
      var newCta = freshCard.querySelector('.rsp-tier-cta');
      var newSub = freshCard.querySelector('.rsp-tier-sub');
      var curCta = card.querySelector('.rsp-tier-cta');
      var curSub = card.querySelector('.rsp-tier-sub');
      if (newCta && curCta) curCta.replaceWith(newCta);
      if (newSub && curSub) curSub.replaceWith(newSub);

      var num = card.querySelector('.rsp-price-num');
      if (num) {
        num.animate(
          [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }],
          { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' }
        );
      }
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     B. SIDEBAR PLAN CARD
     ═════════════════════════════════════════════════════════════════════ */
  function sidebarCard() {
    var old = $('.plan-card');
    var host = $('#rsp-side');
    if (!host) {
      host = D.createElement('button');
      host.id = 'rsp-side';
      host.type = 'button';
      host.className = 'rsp-side';
      host.setAttribute('data-view', 'pricing');
      if (old && old.parentNode) old.parentNode.replaceChild(host, old);
      else {
        var aside = $('.sidebar');
        if (aside) aside.appendChild(host); else return;
      }
    }

    var t = P.tier(), tm = T[t], sub = P.sub();
    host.dataset.t = t;
    host.style.setProperty('--a', tm.accent);
    host.style.setProperty('--b', tm.accent2);

    var state, body, cta;
    if (sub.isTrial) {
      var dl = P.daysLeft();
      state = 'Trial · ' + dl + ' day' + (dl === 1 ? '' : 's') + ' left';
      body = 'Your free Blaze trial ends <b>' + esc(P.expiresOn()) + '</b>. Keep it to hold on to the full library.';
      cta = 'Keep Blaze';
    } else if (t === 'spark') {
      state = 'Free forever';
      body = P.trialEligible()
        ? 'Try <b>7 days of Blaze free</b> — full syllabus, 8 mocks, no card needed.'
        : 'Unlock the full syllabus, real mock volume and 30-day analysis.';
      cta = P.trialEligible() ? 'Start free trial' : 'See plans';
    } else {
      var d = P.daysLeft();
      state = d + ' day' + (d === 1 ? '' : 's') + ' remaining';
      body = 'Active until <b>' + esc(P.expiresOn()) + '</b>.' +
             (t === 'blaze' ? ' Inferno adds unlimited mocks and topic diagnosis.' : ' Every capability unlocked.');
      cta = t === 'blaze' ? 'Compare with Inferno' : 'Manage plan';
    }

    /* Two most-pressured meters, so the card is informative not decorative. */
    var picks = ['mock.completed_per_month', 'paper_lab.exports_per_month']
      .map(function (k) { return P.canUse(k, 0); })
      .filter(function (r) { return !r.unlimited; })
      .sort(function (a, b) { return b.pct - a.pct; })
      .slice(0, 2);

    var meters = picks.map(function (r) {
      var cls = r.pct >= 100 ? ' full' : r.pct >= 70 ? ' warn' : '';
      return '<div class="rsp-side-meter">' +
               '<div class="rsp-side-meter-top"><span>' + esc(ENT[r.key].label) + '</span>' +
               '<b>' + r.used + '/' + r.limit + '</b></div>' +
               '<div class="rsp-side-bar' + cls + '"><i style="width:' + r.pct + '%"></i></div>' +
             '</div>';
    }).join('');

    host.innerHTML =
      '<div class="rsp-side-row">' +
        '<span class="rsp-side-glyph">' + ico(tm.glyph, 14) + '</span>' +
        '<span><span class="rsp-side-name">' + esc(tm.name) + '</span>' +
        '<span class="rsp-side-state">' + esc(state) + '</span></span>' +
      '</div>' +
      '<div class="rsp-side-body">' + body + '</div>' +
      (meters ? '<div class="rsp-side-meters">' + meters + '</div>' : '') +
      '<span class="rsp-side-cta">' + esc(cta) + '</span>';
  }

  /* ═════════════════════════════════════════════════════════════════════
     C. STATUS BANNER (Home)
     ═════════════════════════════════════════════════════════════════════ */
  var DISMISS = 'rankspark-banner-dismissed';

  function banner() {
    var home = $('#page-home'); if (!home) return;
    var old = $('#rsp-banner'); if (old) old.remove();

    var sub = P.sub(), t = P.tier(), dl = P.daysLeft();
    var kind = null, title = '', copy = '', days = null, cta = null;

    if (sub.isTrial) {
      kind = dl <= 2 ? 'ending' : 'trial';
      title = dl <= 2 ? 'Your Blaze trial ends soon' : 'Blaze trial active';
      copy = dl <= 2
        ? 'After ' + P.expiresOn() + ' you return to Spark. Nothing you have created is lost — the library and mock volume are what you lose.'
        : 'Full library, 8 mocks a month and 30-day analysis until ' + P.expiresOn() + '.';
      days = dl; cta = 'Keep Blaze';
    } else if (sub.status === 'trial-ended' && !dismissed('trial-ended')) {
      kind = 'expired'; title = 'Your trial has ended';
      copy = 'You are back on Spark. Every attempt, bookmark and analytic you created during the trial is still here.';
      cta = 'See plans';
    } else if (sub.status === 'expired' && !dismissed('expired')) {
      kind = 'expired'; title = 'Your plan has expired';
      copy = 'Access dropped to Spark on ' + P.fmtDate(sub.startsAt) + '. Renew to unlock the full library again.';
      cta = 'Renew';
    } else if (t !== 'spark' && dl !== null && dl <= 5) {
      kind = 'ending'; title = T[t].name + ' expires in ' + dl + ' day' + (dl === 1 ? '' : 's');
      copy = 'Extend before ' + P.expiresOn() + ' to keep unlimited access running without a gap.';
      days = dl; cta = 'Extend plan';
    }
    if (!kind) return;

    var el = D.createElement('div');
    el.id = 'rsp-banner';
    el.className = 'rsp-banner';
    el.dataset.k = kind;
    el.innerHTML =
      '<span class="rsp-banner-ico">' + ico(kind === 'expired' ? 'info' : kind === 'ending' ? 'clock' : 'bolt', 16) + '</span>' +
      '<span class="rsp-banner-txt"><b>' + esc(title) + '</b><span>' + esc(copy) + '</span></span>' +
      (days !== null ? '<span class="rsp-banner-days"><b>' + days + '</b><span>day' + (days === 1 ? '' : 's') + '</span></span>' : '') +
      '<button class="primary-btn" data-view="pricing" style="padding:8px 14px;font-size:11px">' + esc(cta) + '</button>' +
      '<button class="rsp-banner-x" data-rsp-dismiss="' + esc(sub.status) + '" aria-label="Dismiss">' + ico('x', 12) + '</button>';

    var head = home.querySelector('.page-heading');
    if (head && head.nextSibling) home.insertBefore(el, head.nextSibling);
    else home.insertBefore(el, home.firstChild);
  }

  function dismissed(k) {
    try { return (localStorage.getItem(DISMISS) || '').split(',').indexOf(k) >= 0; }
    catch (e) { return false; }
  }
  function dismiss(k) {
    try {
      var l = (localStorage.getItem(DISMISS) || '').split(',').filter(Boolean);
      if (l.indexOf(k) < 0) l.push(k);
      localStorage.setItem(DISMISS, l.join(','));
    } catch (e) {}
  }

  /* ═════════════════════════════════════════════════════════════════════
     D. MOUNT — page, nav entry, routing
     ═════════════════════════════════════════════════════════════════════ */
  function mountPage() {
    if ($('#page-pricing')) return;
    var main = $('main'); if (!main) return;
    var sec = D.createElement('section');
    sec.className = 'page';
    sec.id = 'page-pricing';
    main.appendChild(sec);
  }

  function mountNav() {
    if ($('.nav-link[data-view="pricing"]')) return;
    var nav = $('.nav'); if (!nav) return;
    var fb = $('#feedback-btn');
    var a = D.createElement('a');
    a.className = 'nav-link';
    a.href = '#pricing';
    a.dataset.view = 'pricing';
    a.setAttribute('aria-label', 'Plans and pricing');
    a.innerHTML = '<span class="nav-icon">' + ico('diamond', 18) + '</span><span>Plans</span>';
    if (fb) nav.insertBefore(a, fb); else nav.appendChild(a);

    /* Match the app's own nav binding so back-stack + mobile menu behave. */
    a.addEventListener('click', function (e) {
      e.preventDefault();
      go('pricing');
      if (W.toggleMobileMenu) { try { W.toggleMobileMenu(false); } catch (er) {} }
    });
  }

  function go(view) {
    if (W.__rsShowView) { try { return W.__rsShowView(view); } catch (e) {} }
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + view); });
    $$('.nav-link, .bottom-link').forEach(function (l) { l.classList.toggle('active', l.dataset.view === view); });
    W.scrollTo({ top: 0, behavior: 'smooth' });
  }
  RSP.ui.go = go;

  /* Patch showView so entering #pricing always renders fresh numbers. */
  function patchRouter() {
    var orig = W.__rsShowView;
    if (typeof orig !== 'function' || orig.__rspPatched) return;
    var wrapped = function (view) {
      var r = orig.apply(this, arguments);
      if (view === 'pricing') renderPricing();
      if (view === 'home') banner();
      return r;
    };
    wrapped.__rspPatched = true;
    W.__rsShowView = wrapped;
  }

  /* ═════════════════════════════════════════════════════════════════════
     E. EVENTS
     ═════════════════════════════════════════════════════════════════════ */
  D.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* duration switch */
    var dur = t.closest('[data-rsp-dur]');
    if (dur) {
      e.preventDefault();
      billDays = Number(dur.dataset.rspDur);
      $$('#rsp-seg button').forEach(function (b) { b.classList.toggle('on', b === dur); });
      var seg = $('#rsp-seg'); if (seg && seg.__place) seg.__place();
      repriceOnly();
      return;
    }

    /* tier CTA */
    var act = t.closest('[data-rsp-act]');
    if (act) {
      e.preventDefault();
      var tier = act.dataset.t, kind = act.dataset.rspAct;
      if (kind === 'trial') {
        if (RSP.checkout && RSP.checkout.trial) RSP.checkout.trial();
        else if (P.startTrial()) toast('7-day Blaze trial started.');
      } else if (kind === 'buy') {
        if (RSP.checkout && RSP.checkout.open) RSP.checkout.open(tier, billDays);
        else toast('Checkout is not available in this build.');
      }
      return;
    }

    /* banner dismiss */
    var dis = t.closest('[data-rsp-dismiss]');
    if (dis) {
      e.preventDefault(); e.stopPropagation();
      dismiss(dis.dataset.rspDismiss);
      var b = $('#rsp-banner');
      if (b) { b.style.transition = 'opacity .3s, transform .3s'; b.style.opacity = '0'; b.style.transform = 'translateY(-6px)'; setTimeout(function () { b.remove(); }, 300); }
      return;
    }

    /* legacy upgrade buttons anywhere in the app */
    var up = t.closest('[data-upgrade]');
    if (up) { e.preventDefault(); go('pricing'); }
  }, true);

  /* Any plan change re-paints every surface. */
  W.addEventListener('rankspark-plan', function (e) {
    sidebarCard();
    banner();
    if ($('#page-pricing') && $('#page-pricing').classList.contains('active')) renderPricing();
    var d = e.detail || {};
    if (d.type === 'expired') {
      toast(d.wasTrial ? 'Trial ended — you are back on Spark.' : 'Your plan expired. You are on Spark.');
    }
  });

  /* ── boot ───────────────────────────────────────────────────────────── */
  function boot() {
    mountPage();
    mountNav();
    sidebarCard();
    banner();
    patchRouter();

    /* Neutralise the old demo upgrade so it can never contradict the engine. */
    W.upgradeDemo = function () { go('pricing'); };

    if (location.hash === '#pricing') { go('pricing'); renderPricing(); }
  }

  /* The app's own boot assigns window.__rsShowView late; wait for it. */
  function whenReady(fn) {
    if (D.readyState === 'loading') return D.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); });
    setTimeout(fn, 0);
  }
  whenReady(function () {
    boot();
    /* re-patch after the app finishes wiring, in case we won the race */
    setTimeout(patchRouter, 400);
    setTimeout(function () { sidebarCard(); banner(); }, 800);
  });

  /* ── Deep-link bridge for the outer landing shell ─────────────────────
     ranksparks.html embeds this app in an iframe and has a "Pricing" link in
     its top nav. It posts {rsp:'go', view:'pricing'} once the frame is live;
     we announce readiness so it knows when the post will be honoured.      */
  (function bridge() {
    if (W.parent === W) return;
    W.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.rsp !== 'go' || !d.view) return;
      if (!D.getElementById('page-' + d.view)) return;
      go(d.view);
      if (d.view === 'pricing') renderPricing();
    });
    var announce = function () {
      try { W.parent.postMessage({ rsp: 'ready' }, '*'); } catch (e) {}
    };
    announce();
    setTimeout(announce, 600);
    setTimeout(announce, 1800);
  })();

  RSP.ui.renderPricing = renderPricing;
  RSP.ui.sidebarCard = sidebarCard;
  RSP.ui.banner = banner;
  RSP.ui.setDuration = function (d) { billDays = d; };
})();
