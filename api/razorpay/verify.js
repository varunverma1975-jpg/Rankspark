/* POST /api/razorpay/verify
   { razorpay_order_id, razorpay_payment_id, razorpay_signature, idToken }

   This is the ONLY place a purchase becomes real. Razorpay signs
   "order_id|payment_id" with your key_secret; recomputing that HMAC is what
   proves the callback came from Razorpay and not from a devtools console.

   THREE THINGS THIS REFUSES TO TRUST FROM THE CLIENT
     1. the signature      → recomputed with the secret, constant-time compared
     2. the tier and days  → re-read from the Razorpay order's own notes, which
                             only the server could have set at creation time.
                             Taking them from the body would let anyone verify
                             a ₹49 payment and claim {tier:'inferno',days:365}.
     3. the identity       → taken from a verified Firebase ID token, never a
                             uid string in the body.

   Replay is blocked by writing /payments/{payment_id} with create-only
   semantics: a second verify of the same payment id finds the doc already
   there and grants nothing. */
import crypto from 'crypto';
import { admin, uidFromIdToken, isConfigured } from '../_lib/firebase-admin.js';

/* Mirror of the table in order.js. Kept here too so a tampered order that
   somehow carried bogus notes still cannot mint an unpriced plan. */
const PRICES = {
  blaze:   { 7: 49, 30: 149, 90: 399, 180: 699,  365: 1199 },
  inferno: { 7: 99, 30: 399, 90: 999, 180: 1799, 365: 2999 }
};

async function fetchOrder(orderId, keyId, keySecret) {
  const r = await fetch('https://api.razorpay.com/v1/orders/' + encodeURIComponent(orderId), {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    }
  });
  if (!r.ok) return null;
  return await r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const KEY_ID = process.env.RAZORPAY_KEY_ID;
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!KEY_SECRET) return res.status(503).json({ error: 'not_configured' });

  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    idToken
  } = req.body || {};

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ valid: false, error: 'missing_fields' });
  }

  /* ── 1. signature ──────────────────────────────────────────────────── */
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  /* Constant-time compare: a plain === leaks timing information that can be
     used to forge a signature byte by byte. */
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    console.warn('[razorpay] signature mismatch', { orderId, paymentId });
    return res.status(400).json({ valid: false });
  }

  /* ── 2. authoritative plan, from the order Razorpay is holding ─────── */
  let tier = null, days = null, amountPaise = null;
  const order = KEY_ID ? await fetchOrder(orderId, KEY_ID, KEY_SECRET) : null;
  if (order && order.notes) {
    tier = order.notes.tier || null;
    days = Number(order.notes.days) || null;
    amountPaise = order.amount;
  }
  const expectedRupees = tier && days ? PRICES[tier]?.[days] : null;
  if (!tier || !days || !expectedRupees) {
    console.warn('[razorpay] verified payment with unusable order notes', { orderId, tier, days });
    return res.status(400).json({ valid: false, error: 'unknown_plan' });
  }
  if (amountPaise != null && amountPaise !== expectedRupees * 100) {
    console.warn('[razorpay] amount mismatch', { orderId, amountPaise, expectedRupees });
    return res.status(400).json({ valid: false, error: 'amount_mismatch' });
  }

  const grant = {
    valid: true, orderId, paymentId, tier, days,
    expiresAt: new Date(Date.now() + days * 864e5).toISOString()
  };

  /* ── 3. persist the entitlement ────────────────────────────────────── */
  if (!isConfigured()) {
    /* Payment is genuine, but with no service account the server cannot be
       the source of truth. Say so instead of implying it was recorded. */
    return res.status(200).json({ ...grant, persisted: false, reason: 'no_service_account' });
  }

  const uid = await uidFromIdToken(idToken);
  if (!uid) {
    return res.status(200).json({ ...grant, persisted: false, reason: 'not_signed_in' });
  }

  try {
    const fb = await admin();
    const db = fb.firestore();
    const payRef = db.doc(`payments/${paymentId}`);
    const userRef = db.doc(`users/${uid}`);

    const outcome = await db.runTransaction(async (tx) => {
      const seen = await tx.get(payRef);
      if (seen.exists) return 'replay';       // idempotent: already granted

      const snap = await tx.get(userRef);
      const cur = snap.exists ? (snap.data().subscription || {}) : {};
      /* Stack onto an unexpired subscription of the same tier, mirroring the
         client engine, so a renewal extends rather than truncates. */
      const curEnd = cur.expiresAt ? Date.parse(cur.expiresAt) : 0;
      const base = (cur.tier === tier && curEnd > Date.now()) ? curEnd : Date.now();
      const expiresAt = new Date(base + days * 864e5).toISOString();

      tx.set(payRef, {
        uid, orderId, paymentId, tier, days,
        amount: expectedRupees, currency: 'INR',
        provider: 'razorpay', status: 'captured',
        createdAt: fb.firestore.FieldValue.serverTimestamp()
      });
      tx.set(userRef, {
        plan: tier,
        subscription: {
          tier, status: 'active', durationDays: days,
          startsAt: new Date().toISOString(), expiresAt,
          orderId, paymentId, source: 'razorpay-verified'
        },
        updatedAt: fb.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      grant.expiresAt = expiresAt;
      return 'granted';
    });

    return res.status(200).json({ ...grant, persisted: true, outcome });
  } catch (e) {
    /* The money is taken and the signature is valid — never fail the user
       here. Report it so the client still activates locally and support has
       a log line to reconcile from. */
    console.error('[razorpay] entitlement write failed', { paymentId, uid }, e);
    return res.status(200).json({ ...grant, persisted: false, reason: 'write_failed' });
  }
}
