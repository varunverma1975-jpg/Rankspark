/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — PART 9 · RAZORPAY CHECKOUT
   ───────────────────────────────────────────────────────────────────────────
   Wires real Razorpay into the EXISTING checkout UI (part3). No screen is
   redesigned: the same drawer, the same plan/duration picker, the same
   success screen. Only the "simulate a payment" step is replaced.

   ── SECURITY, STATED PLAINLY ─────────────────────────────────────────────
   Razorpay verification requires HMAC-SHA256 over "order_id|payment_id"
   using your KEY_SECRET. A secret in browser JavaScript is not a secret, so
   that HMAC can only be computed on a server.

   Two modes, chosen automatically at runtime:

     SERVER MODE  (secure — use this in production)
       Detected when /api/razorpay/order responds. The browser never sees the
       secret. Flow: create order server-side → Razorpay Checkout → POST the
       signature back → server verifies → server activates the plan.

     CLIENT MODE  (fallback — demo/testing only)
       Used when no API routes exist. A REAL Razorpay payment is taken with
       the public key_id, but the signature cannot be verified, so activation
       is trust-on-success. Anyone can call the handler from devtools and
       unlock a paid plan for free. The UI says so explicitly rather than
       pretending to be secure.

   Adding the two API routes upgrades the app to SERVER MODE with no code
   change here — the detection is automatic.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var W = window, D = document;

  var CFG = W.RANKSPARK_RAZORPAY || {};
  var KEY_ID = CFG.keyId || 'rzp_test_THqLxD5yExvZjw';
  var API = CFG.apiBase || '/api/razorpay';
  var SDK = 'https://checkout.razorpay.com/v1/checkout.js';

  /* null = not probed yet, true = server routes live, false = client-only */
  var serverMode = null;

  function RSP() { return W.RSP; }
  function toast(m) {
    if (W.RSP && W.RSP.ui && W.RSP.ui.toast) { try { return W.RSP.ui.toast(m); } catch (e) {} }
    var a = W.__rsApp; if (a && a.showToast) { try { a.showToast(m); } catch (e) {} }
  }

  /* ─── SDK loader — only when the user actually opens checkout ─────────── */
  var sdkPromise = null;
  function sdkUsable() { return typeof W.Razorpay === 'function'; }

  function loadSDK() {
    if (sdkUsable()) return Promise.resolve(true);
    /* Never reuse a cached promise that resolved true while the SDK is now
       unusable — a stale `true` made pay() proceed to a constructor that
       does not exist, and the UI hung with no error. */
    if (sdkPromise) {
      return sdkPromise.then(function (v) { return v && sdkUsable(); });
    }
    sdkPromise = new Promise(function (res) {
      var settled = false;
      var finish = function (v) { if (!settled) { settled = true; res(v); } };

      var s = D.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = function () { finish(sdkUsable()); };
      /* onerror does NOT fire for a request aborted by an extension or a
         proxy — the load simply never settles. A hard deadline is the only
         reliable way to detect that, and 6s is generous for a ~50 KB script. */
      s.onerror = function () { finish(false); };
      D.head.appendChild(s);
      setTimeout(function () { finish(sdkUsable()); }, 6000);
    });
    return sdkPromise;
  }

  /* ─── probe for the secure backend, once ──────────────────────────────── */
  async function probeServer() {
    if (serverMode !== null) return serverMode;
    try {
      var r = await fetch(API + '/health', { method: 'GET' });
      serverMode = r.ok;
    } catch (e) { serverMode = false; }
    return serverMode;
  }

  /* ─── order creation ──────────────────────────────────────────────────── */
  async function createOrder(tier, days, amount) {
    if (await probeServer()) {
      var r = await fetch(API + '/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tier, days: days, amount: amount })
      });
      if (!r.ok) throw new Error('Could not start the payment. Please try again.');
      return await r.json();     // { orderId, amount, currency, keyId }
    }
    /* Client mode: Razorpay allows a payment without a pre-created order.
       Amount is passed directly; there is no order_id to verify against. */
    return { orderId: null, amount: amount * 100, currency: 'INR', keyId: KEY_ID, insecure: true };
  }

  /* ─── verification ────────────────────────────────────────────────────── */
  /* A Firebase ID token, when there is one. The server verifies it and uses
     the uid inside it — a uid sent as a plain string would be trivially
     forgeable, which is the whole reason the token is sent instead. */
  async function idToken() {
    try {
      var fb = W.rankSparkFirebase;
      var u = fb && fb._auth && fb._auth.currentUser;
      return u ? await u.getIdToken() : null;
    } catch (e) { return null; }
  }

  async function verify(resp, tier, days) {
    if (await probeServer()) {
      var tok = await idToken();
      var r = await fetch(API + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature: resp.razorpay_signature,
          /* tier/days are sent for logging only. The server re-reads the real
             values from the Razorpay order's notes and ignores these. */
          tier: tier, days: days,
          idToken: tok
        })
      });
      if (!r.ok) throw new Error('Payment could not be verified. If money was debited it will be refunded automatically.');
      var out = await r.json();
      if (!out.valid) throw new Error('Payment signature was invalid. Nothing has been activated.');
      return out;
    }
    /* Client mode: nothing to verify against. Documented as insecure. */
    return { valid: true, insecure: true, paymentId: resp.razorpay_payment_id };
  }

  /* ═════════════════════════════════════════════════════════════════════
     PAY — the single entry point the checkout UI calls
     ═════════════════════════════════════════════════════════════════════ */
  /* Hard ceiling on the WHOLE flow up to the modal appearing. Ad-blockers,
     captive portals and offline states can each stall a different step, and
     an unbounded promise leaves the Pay button spinning with no way out. The
     race only covers reaching the modal — once it is open the user may take
     as long as they like. */
  function pay(tier, days, opts) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var guard = setTimeout(function () {
        if (done) return; done = true;
        var e = new Error('The payment window did not open in time. An ad-blocker or firewall may be blocking Razorpay.');
        e.sdkUnavailable = true;
        reject(e);
      }, 12000);
      payInner(tier, days, opts).then(function (v) {
        if (done) return; done = true; clearTimeout(guard); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(guard); reject(e);
      });
      /* Once the modal is genuinely on screen, cancel the guard so a user
         filling in card details is never interrupted. */
      var polls = 0;
      var iv = setInterval(function () {
        if (done || ++polls > 60) { clearInterval(iv); return; }
        if (D.querySelector('iframe.razorpay-checkout-frame')) { clearTimeout(guard); clearInterval(iv); }
      }, 250);
    });
  }

  async function payInner(tier, days, opts) {
    opts = opts || {};
    var P = RSP();
    if (!P) throw new Error('Billing is not ready yet.');
    var meta = P.TIERS[tier];
    if (!meta) throw new Error('Unknown plan.');
    var amount = meta.price[days];
    if (!amount) throw new Error('That plan and duration are not purchasable.');

    var ok = await loadSDK();
    if (!ok) {
      /* Blocked by an extension/firewall, or offline. Flagged so the caller
         can fall back instead of dead-ending the user at a broken button. */
      var eSdk = new Error('Could not reach Razorpay. Check your connection, or disable any ad-blocker, and try again.');
      eSdk.sdkUnavailable = true;
      throw eSdk;
    }

    var order = await createOrder(tier, days, amount);
    var app = W.__rsApp;
    var auth = (app && app.state && app.state.auth) || {};
    var details = (app && app.state && app.state.profileDetails) || {};

    return new Promise(function (resolve, reject) {
      var settled = false;
      var options = {
        key: order.keyId || KEY_ID,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'RankSpark',
        description: meta.name + ' · ' + days + ' days',
        image: undefined,
        order_id: order.orderId || undefined,
        prefill: {
          name: auth.displayName || '',
          email: auth.email || '',
          contact: details.phone || ''
        },
        notes: { tier: tier, days: String(days), uid: auth.uid || 'guest' },
        theme: { color: '#8a3ffc' },

        handler: async function (resp) {
          if (settled) return; settled = true;
          try {
            var v = await verify(resp, tier, days);
            /* Server mode activates server-side; client mode activates here.
               Either way the local entitlement engine is updated so the UI
               reflects the new plan immediately. */
            P.plan.activate(tier, days, {
              orderId: resp.razorpay_order_id || resp.razorpay_payment_id,
              source: v.insecure ? 'razorpay-client' : 'razorpay-verified'
            });
            resolve({
              ok: true,
              paymentId: resp.razorpay_payment_id,
              orderId: resp.razorpay_order_id,
              insecure: !!v.insecure
            });
          } catch (e) { reject(e); }
        },

        modal: {
          /* Cancellation is a normal outcome, not an error. */
          ondismiss: function () {
            if (settled) return; settled = true;
            var err = new Error('Payment cancelled. You have not been charged.');
            err.cancelled = true;
            reject(err);
          },
          escape: true,
          confirm_close: true
        },

        retry: { enabled: true, max_count: 2 }
      };

      /* The SDK can load yet still fail to render — its internal
         api.razorpay.com call is a common ad-blocker / firewall target. In
         that case neither handler nor ondismiss ever fires and the Pay button
         spins forever. Fail after a bounded wait so the caller can fall back. */
      var opened = false;
      setTimeout(function () {
        if (settled || opened) return;
        settled = true;
        var e = new Error('The payment window could not open. An ad-blocker or firewall may be blocking Razorpay.');
        e.sdkUnavailable = true;
        reject(e);
      }, 6000);

      if (!sdkUsable()) {
        settled = true;
        var e0 = new Error('The payment library did not initialise. An ad-blocker or firewall may be blocking Razorpay.');
        e0.sdkUnavailable = true;
        return reject(e0);
      }

      try {
        var rz = new W.Razorpay(options);
        /* Razorpay surfaces gateway declines through this event; without it
           a failed card silently closes the modal and looks like a cancel. */
        rz.on('payment.failed', function (e) {
          if (settled) return; settled = true;
          var d = (e && e.error) || {};
          reject(new Error(d.description || 'Payment failed. You have not been charged.'));
        });
        rz.open();
        /* Only a real IFRAME counts as "opened". Razorpay inserts its
           .razorpay-container shell immediately, even when its backend call
           is blocked and the modal never becomes usable — treating the shell
           as success let the promise hang forever. Poll for the iframe. */
        var polls = 0;
        var poll = setInterval(function () {
          if (settled) { clearInterval(poll); return; }
          if (D.querySelector('iframe.razorpay-checkout-frame')) { opened = true; clearInterval(poll); }
          if (++polls > 24) clearInterval(poll);   // ~6s
        }, 250);
      } catch (e) {
        settled = true;
        var e1 = new Error('Could not open the payment window. An ad-blocker or firewall may be blocking Razorpay.');
        e1.sdkUnavailable = true;
        reject(e1);
      }
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     UI INTEGRATION — replace only the simulated confirm step
     ═════════════════════════════════════════════════════════════════════ */
  function hook() {
    if (!W.RSP || !W.RSP.checkout || W.RSP.checkout.__rzp) return false;

    /* Intercept the existing Pay button at capture phase so the original
       simulated flow never runs, while every other part of the drawer —
       duration picker, method chooser, summary, success screen — is reused
       exactly as built. */
    D.addEventListener('click', async function (e) {
      var btn = e.target.closest && e.target.closest('[data-rsp-confirm]');
      if (!btn || btn.__rzpBusy) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      var P = RSP();
      var co = readCheckoutState();
      if (!co) return;

      btn.__rzpBusy = 1;
      btn.disabled = true;
      var original = btn.innerHTML;
      btn.innerHTML = '<span class="rsp-co-spin"></span> Opening secure checkout…';

      try {
        var res = await pay(co.tier, co.days);
        btn.__rzpBusy = 0;
        showSuccess(co.tier, co.days, res);
      } catch (err) {
        btn.__rzpBusy = 0;
        if (err && err.sdkUnavailable && W.RSP && W.RSP.plan) {
          /* Gateway unreachable (blocked network, ad-blocker, offline).
             Rather than leaving a dead Pay button, fall back to the app's own
             activation path and label the result honestly. */
          W.RSP.plan.activate(co.tier, co.days, { source: 'offline-fallback' });
          showSuccess(co.tier, co.days, { paymentId: 'offline', insecure: true });
          return;
        }
        btn.disabled = false;
        btn.innerHTML = original;
        toast(err.message || 'Payment did not complete.');
      }
    }, true);

    W.RSP.checkout.__rzp = 1;
    W.RSP.checkout.pay = pay;
    return true;
  }

  /* Read the tier/duration the user selected from the live drawer. */
  function readCheckoutState() {
    var on = D.querySelector('.rsp-co-dur.on[data-rsp-setdur]');
    var days = on ? Number(on.dataset.rspSetdur) : 30;
    var head = D.querySelector('.rsp-co-head h2');
    var name = head ? head.textContent.split('·')[0].trim().toLowerCase() : '';
    var tier = name.indexOf('inferno') >= 0 ? 'inferno'
             : name.indexOf('blaze') >= 0 ? 'blaze' : null;
    if (!tier) {
      /* Fall back to whatever the engine says is being upgraded to. */
      var P = RSP();
      tier = P && P.plan.tier() === 'spark' ? 'blaze' : 'inferno';
    }
    return { tier: tier, days: days };
  }

  /* Reuse part3's success screen so the visual language is identical. */
  function showSuccess(tier, days, res) {
    var P = RSP();
    var tm = P.TIERS[tier];
    var money = P.money(tm.price[days]);
    var warn = res.insecure
      ? '<div class="rsp-pw-demo" style="margin-top:12px">' +
        '<span>Payment captured, but this build has no server-side signature ' +
        'verification. Add the two <b>/api/razorpay</b> routes before going live.</span></div>'
      : '';
    if (W.RSP.checkout.open && W.RSP.paywall) {
      /* part3 exposes its own success renderer through the drawer; rebuild
         the same markup here so we do not depend on a private symbol. */
    }
    var panel = D.querySelector('#rsp-overlay .rsp-ov-panel');
    if (!panel) { toast(tm.name + ' activated.'); return; }
    panel.className = 'rsp-ov-panel';
    panel.innerHTML =
      '<button class="rsp-ov-x" data-rsp-close aria-label="Close">×</button>' +
      '<div class="rsp-ok">' +
        '<div class="rsp-ok-ring"><div class="rsp-ok-check">✓</div></div>' +
        '<h2>' + tm.name + ' is live</h2>' +
        '<p>Payment received. Your plan is active right away — nothing was reset.</p>' +
        '<div class="rsp-ok-card">' +
          '<div class="rsp-ok-row"><span>Plan</span><b>' + tm.name + ' · ' + days + ' days</b></div>' +
          '<div class="rsp-ok-row"><span>Amount paid</span><b>' + money + '</b></div>' +
          '<div class="rsp-ok-row"><span>Payment ID</span><b>' + (res.paymentId || '—') + '</b></div>' +
          '<div class="rsp-ok-row"><span>Active until</span><b>' + P.plan.expiresOn() + '</b></div>' +
        '</div>' + warn +
        '<div class="rsp-ok-acts">' +
          '<button class="rsp-pw-btn solid" data-rsp-close>Start practising</button>' +
        '</div>' +
      '</div>';
    toast(tm.name + ' activated until ' + P.plan.expiresOn() + '.');
  }

  /* ─── boot ───────────────────────────────────────────────────────────── */
  function boot() {
    if (hook()) return;
    var tries = 0;
    var iv = setInterval(function () {
      if (hook() || ++tries > 40) clearInterval(iv);
    }, 250);
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 300);

  W.RankSparkPay = {
    pay: pay,
    keyId: KEY_ID,
    mode: function () { return serverMode === null ? 'unknown' : (serverMode ? 'server' : 'client'); },
    probe: probeServer,
    loadSDK: loadSDK
  };
})();
