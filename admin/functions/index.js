/* ═══════════════════════════════════════════════════════════════════════════
   RANKSPARK — Cloud Functions
   Deploy:  firebase deploy --only functions
   Secrets: firebase functions:secrets:set STRIPE_SECRET STRIPE_WEBHOOK_SECRET RESEND_KEY

   Everything here exists because it CANNOT be done safely in the browser:
   Stripe secret keys, Firebase Auth admin operations, privileged writes, and
   scheduled aggregation.
   ═══════════════════════════════════════════════════════════════════════════ */
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET = defineSecret('STRIPE_SECRET');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const RESEND_KEY = defineSecret('RESEND_KEY');

/* ── shared guards ─────────────────────────────────────────────────────── */
async function assertAdmin(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const doc = await db.doc(`admins/${auth.uid}`).get();
  if (!doc.exists) throw new HttpsError('permission-denied', 'Not an admin.');
  return doc.data();
}
async function audit(adminUid, action, target, reason = '') {
  await db.collection('auditLog').add({
    adminUid, action, target, reason,
    at: admin.firestore.FieldValue.serverTimestamp(), source: 'function'
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 3 — merged config endpoint
   One cacheable HTTP GET instead of three Firestore reads per client.
   At 10k daily users that is ~30k reads/day saved; the CDN cache makes it
   closer to a few hundred origin hits.
   ═══════════════════════════════════════════════════════════════════════ */
exports.getConfig = onRequest({ cors: true, region: 'asia-south1' }, async (req, res) => {
  try {
    const [app, pricing, msgs] = await Promise.all([
      db.doc('config/app').get(),
      db.doc('config/pricing').get(),
      db.collection('messages').where('enabled', '==', true).limit(10).get()
    ]);
    const payload = {
      ...(app.exists ? app.data() : {}),
      pricing: pricing.exists ? pricing.data() : null,
      messages: msgs.docs.map(d => ({ id: d.id, ...d.data() })),
      servedAt: Date.now()
    };
    /* Short CDN cache + SWR: clients get a fast response, and a config change
       propagates within a minute without every client hammering Firestore. */
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=240');
    res.json(payload);
  } catch (e) {
    console.error('getConfig', e);
    res.status(500).json({ error: 'config_unavailable' });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 5 — Stripe
   ═══════════════════════════════════════════════════════════════════════ */

/* Webhook is the SOURCE OF TRUTH for entitlement. The browser's "payment
   succeeded" callback is never trusted: it can be replayed or forged. */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET, STRIPE_WEBHOOK_SECRET], region: 'asia-south1' },
  async (req, res) => {
    const stripe = require('stripe')(STRIPE_SECRET.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
    } catch (e) {
      console.error('Signature verification failed', e.message);
      return res.status(400).send('Bad signature');
    }

    /* Idempotency: Stripe retries aggressively and will redeliver events.
       Recording the event id first means a replay is a no-op. */
    const seen = db.doc(`stripeEvents/${event.id}`);
    if ((await seen.get()).exists) return res.json({ received: true, duplicate: true });
    await seen.set({ type: event.type, at: admin.firestore.FieldValue.serverTimestamp() });

    const o = event.data.object;
    const uid = o.metadata?.uid || o.client_reference_id;

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'invoice.paid': {
          if (!uid) break;
          await db.doc(`users/${uid}`).set({
            plan: o.metadata?.plan || 'blaze',
            subscription: {
              status: 'active',
              stripeCustomerId: o.customer,
              stripeSubscriptionId: o.subscription,
              renewsAt: o.lines?.data?.[0]?.period?.end
                ? new Date(o.lines.data[0].period.end * 1000) : null,
              cancelAtPeriodEnd: false
            }
          }, { merge: true });
          await db.collection('payments').add({
            uid, customer: o.customer_email || o.customer,
            amount: (o.amount_total ?? o.amount_paid ?? 0) / 100,
            currency: o.currency || 'inr',
            plan: o.metadata?.plan || 'blaze',
            status: 'paid', stripeId: o.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          if (!uid) break;
          const dead = event.type.endsWith('deleted') || o.status !== 'active';
          await db.doc(`users/${uid}`).set({
            plan: dead ? 'spark' : (o.metadata?.plan || 'blaze'),
            subscription: {
              status: o.status,
              cancelAtPeriodEnd: !!o.cancel_at_period_end,
              renewsAt: o.current_period_end ? new Date(o.current_period_end * 1000) : null
            }
          }, { merge: true });
          break;
        }
      }
      res.json({ received: true });
    } catch (e) {
      console.error('webhook handler', e);
      /* 500 makes Stripe retry — safe because of the idempotency guard. */
      res.status(500).send('handler error');
    }
  });

exports.refundPayment = onCall(
  { secrets: [STRIPE_SECRET], region: 'asia-south1' },
  async (req) => {
    await assertAdmin(req.auth);
    const { paymentId, reason } = req.data || {};
    if (!paymentId) throw new HttpsError('invalid-argument', 'paymentId required');
    const stripe = require('stripe')(STRIPE_SECRET.value());
    const snap = await db.doc(`payments/${paymentId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Unknown payment');
    const refund = await stripe.refunds.create({ payment_intent: snap.data().stripeId });
    await snap.ref.update({ status: 'refunded', refundId: refund.id });
    await audit(req.auth.uid, 'payment.refund', paymentId, reason || '');
    return { ok: true, refundId: refund.id };
  });

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 6 / 14 — privileged admin operations
   ═══════════════════════════════════════════════════════════════════════ */
exports.setAdmin = onCall({ region: 'asia-south1' }, async (req) => {
  const me = await assertAdmin(req.auth);
  if (me.role !== 'owner') throw new HttpsError('permission-denied', 'Owners only.');
  const { uid, email, grant } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid required');
  if (uid === req.auth.uid && !grant)
    throw new HttpsError('failed-precondition', 'You cannot revoke your own access.');
  if (grant) {
    await db.doc(`admins/${uid}`).set({ email: email || '', role: 'admin',
      addedBy: req.auth.uid, addedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    await db.doc(`admins/${uid}`).delete();
  }
  await audit(req.auth.uid, grant ? 'admin.grant' : 'admin.revoke', uid);
  return { ok: true };
});

exports.suspendUser = onCall({ region: 'asia-south1' }, async (req) => {
  await assertAdmin(req.auth);
  const { uid, suspend, reason } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid required');
  /* Disabling in Auth is what actually blocks sign-in; the Firestore flag
     alone would only hide the UI. */
  await admin.auth().updateUser(uid, { disabled: !!suspend });
  if (suspend) await admin.auth().revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).set({ status: suspend ? 'suspended' : 'active' }, { merge: true });
  await audit(req.auth.uid, suspend ? 'user.suspend' : 'user.reinstate', uid, reason || '');
  return { ok: true };
});

exports.forceSignOut = onCall({ region: 'asia-south1' }, async (req) => {
  await assertAdmin(req.auth);
  const { uid } = req.data || {};
  await admin.auth().revokeRefreshTokens(uid);
  await audit(req.auth.uid, 'user.force_signout', uid);
  return { ok: true };
});

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 10 — email
   ═══════════════════════════════════════════════════════════════════════ */
exports.onEmailChangeRequest = onDocumentCreated(
  { document: 'emailChanges/{id}', secrets: [RESEND_KEY], region: 'asia-south1' },
  async (event) => {
    const d = event.data?.data(); if (!d) return;
    const token = require('crypto').randomBytes(24).toString('hex');
    await event.data.ref.update({ token, expiresAt: Date.now() + 86400000 });
    const link = `https://rankspark.app/verify-email?id=${event.params.id}&t=${token}`;
    await sendMail(RESEND_KEY.value(), d.newEmail, 'Confirm your new RankSpark email',
      `<p>Confirm this address to finish the change.</p><p><a href="${link}">Confirm email</a></p>
       <p style="color:#888;font-size:12px">Link expires in 24 hours. If you did not
       request this, ignore this email — nothing changes.</p>`);
  });

/* Resend chosen over SendGrid: two-line SDK, HTML templates instead of a
   proprietary builder, and a free tier that covers transactional volume. */
async function sendMail(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'RankSpark <no-reply@rankspark.app>', to, subject, html })
  });
  if (!r.ok) console.error('mail failed', await r.text());
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 7 — presence pruning
   Clients cannot reliably delete their own session on close (a killed tab
   sends nothing), so stale rows are swept server-side.
   ═══════════════════════════════════════════════════════════════════════ */
exports.pruneSessions = onSchedule(
  { schedule: 'every 5 minutes', region: 'asia-south1' }, async () => {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000);
    const stale = await db.collection('sessions').where('lastSeen', '<', cutoff).limit(500).get();
    const batch = db.batch();
    stale.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`pruned ${stale.size} stale sessions`);
  });

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 13 — nightly rollups
   Pre-aggregating means the dashboard reads ~30 docs instead of scanning
   every user and attempt on each page load.
   ═══════════════════════════════════════════════════════════════════════ */
exports.buildRollups = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'Asia/Kolkata', region: 'asia-south1' }, async () => {
    const now = new Date();
    const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const date = start.toISOString().slice(0, 10);

    const [signups, attempts, pays, users] = await Promise.all([
      db.collection('users').where('createdAt', '>=', start).where('createdAt', '<', end).count().get(),
      db.collection('rankedAttempts').where('receivedAt', '>=', start).where('receivedAt', '<', end).count().get(),
      db.collection('payments').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
      db.collection('users').where('lastActive', '>=', start).count().get()
    ]);

    await db.doc(`analyticsRollups/${date}`).set({
      date,
      signups: signups.data().count,
      sessions: attempts.data().count,
      dau: users.data().count,
      revenue: pays.docs.reduce((t, d) => t + (d.data().amount || 0), 0),
      conversions: pays.size,
      builtAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('rollup written for', date);
  });

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 8 — notification fan-out (FCM scaffold)
   ═══════════════════════════════════════════════════════════════════════ */
exports.sendNotification = onCall({ region: 'asia-south1' }, async (req) => {
  await assertAdmin(req.auth);
  const { title, body, audience, link } = req.data || {};
  if (!title || !body) throw new HttpsError('invalid-argument', 'title and body required');

  let q = db.collection('users');
  if (audience === 'paid') q = q.where('plan', 'in', ['blaze', 'inferno']);
  else if (audience === 'spark') q = q.where('plan', '==', 'spark');
  else if (audience === 'inactive7')
    q = q.where('lastActive', '<', new Date(Date.now() - 7 * 86400000));

  const targets = await q.select('fcmToken').get();
  const tokens = targets.docs.map(d => d.data().fcmToken).filter(Boolean);

  const ref = await db.collection('notifications').add({
    title, body, audience, link: link || null, status: 'sent',
    delivered: tokens.length, opens: 0,
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });

  /* Push is optional — the in-app bell works without FCM. Sending only if
     tokens exist keeps this a no-op until FCM is configured. */
  if (tokens.length) {
    for (let i = 0; i < tokens.length; i += 500) {
      await admin.messaging().sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        notification: { title, body },
        data: { link: link || '' }
      });
    }
  }
  await audit(req.auth.uid, 'notification.send', ref.id);
  return { ok: true, delivered: tokens.length };
});
