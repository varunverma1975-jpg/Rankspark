/* Tests the ENTITLEMENT-GRANT half of /api/razorpay/verify.
 *
 * verify_route.mjs covers signature + plan integrity with no service account.
 * This one supplies a fake one and mocks firebase-admin at the module level,
 * so the transaction logic is exercised for real: idempotent replay, renewal
 * stacking, and the refusal to grant without a verified ID token.
 *
 * Run:  node work/tests/grant_route.mjs
 */
import crypto from 'crypto';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const SECRET = 'test_secret_do_not_use';
process.env.RAZORPAY_KEY_SECRET = SECRET;
process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify({
  project_id: 'sparkrank-9d990', client_email: 'test@example.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n'
})).toString('base64');

/* ── in-memory Firestore ───────────────────────────────────────────────── */
const STORE = new Map();
let VALID_TOKENS = { 'tok-alice': 'uid-alice' };

const FieldValue = { serverTimestamp: () => '<ts>' };
function docRef(path) {
  return {
    path,
    get _data() { return STORE.get(path); }
  };
}
const fakeDb = {
  doc: (p) => docRef(p),
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      async get(ref) {
        const d = STORE.get(ref.path);
        return { exists: d !== undefined, data: () => d };
      },
      set(ref, val, opts) { writes.push([ref.path, val, opts]); }
    };
    const out = await fn(tx);
    for (const [p, v, o] of writes) {
      STORE.set(p, o && o.merge ? { ...(STORE.get(p) || {}), ...v } : v);
    }
    return out;
  }
};
const fakeAdmin = {
  apps: [{}],
  initializeApp() {},
  credential: { cert: () => ({}) },
  firestore: Object.assign(() => fakeDb, { FieldValue }),
  auth: () => ({
    verifyIdToken: async (t) => {
      const uid = VALID_TOKENS[t];
      if (!uid) { const e = new Error('bad token'); e.code = 'auth/argument-error'; throw e; }
      return { uid };
    }
  })
};

/* Intercept `import 'firebase-admin'` with a loader hook. */
const loaderSrc = `
export async function resolve(spec, ctx, next) {
  if (spec === 'firebase-admin') return { url: 'mock:firebase-admin', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'mock:firebase-admin')
    return { format: 'module', shortCircuit: true,
             source: 'export default globalThis.__FAKE_ADMIN__;' };
  return next(url, ctx);
}`;
globalThis.__FAKE_ADMIN__ = fakeAdmin;
register('data:text/javascript,' + encodeURIComponent(loaderSrc), pathToFileURL('./'));

/* ── stub the Razorpay order lookup ────────────────────────────────────── */
let ORDER = { id: 'order_G1', amount: 14900, notes: { tier: 'blaze', days: '30' } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.razorpay.com/v1/orders/'))
    return { ok: true, status: 200, json: async () => ORDER };
  return realFetch(url, opts);
};

const { default: handler } = await import('../../api/razorpay/verify.js');

const sign = (o, p) => crypto.createHmac('sha256', SECRET).update(`${o}|${p}`).digest('hex');
async function call(body) {
  const res = { _s: 0, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; } };
  await handler({ method: 'POST', body }, res);
  return { status: res._s, body: res._j };
}

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  PASS ' + n))
                             : (fail++, console.log('  FAIL ' + n + (x ? ' :: ' + JSON.stringify(x) : '')));

console.log('\n== grants an entitlement server-side ==');
{
  const o = 'order_G1', p = 'pay_G1';
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p), idToken: 'tok-alice' });
  check('persisted', r.body.persisted === true && r.body.outcome === 'granted', r.body);
  const u = STORE.get('users/uid-alice');
  check('user plan written', u && u.plan === 'blaze', u);
  check('subscription recorded', u && u.subscription && u.subscription.tier === 'blaze'
        && u.subscription.status === 'active', u && u.subscription);
  check('payment receipt written', !!STORE.get('payments/pay_G1'), null);
  check('receipt bound to the verified uid', STORE.get('payments/pay_G1').uid === 'uid-alice');
  const days = Math.round((Date.parse(u.subscription.expiresAt) - Date.now()) / 864e5);
  check('expiry ≈ 30 days out', days === 30, days);
}

console.log('\n== replay is idempotent ==');
{
  const o = 'order_G1', p = 'pay_G1';
  const before = STORE.get('users/uid-alice').subscription.expiresAt;
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p), idToken: 'tok-alice' });
  check('second verify reports replay', r.body.outcome === 'replay', r.body);
  check('expiry not extended by a replay',
        STORE.get('users/uid-alice').subscription.expiresAt === before);
}

console.log('\n== renewal stacks ==');
{
  const o = 'order_G1', p = 'pay_G2';        // new payment, same tier
  const before = Date.parse(STORE.get('users/uid-alice').subscription.expiresAt);
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p), idToken: 'tok-alice' });
  check('granted', r.body.outcome === 'granted', r.body);
  const after = Date.parse(STORE.get('users/uid-alice').subscription.expiresAt);
  check('extends from existing expiry', Math.round((after - before) / 864e5) === 30,
        Math.round((after - before) / 864e5));
}

console.log('\n== identity is required and verified ==');
{
  const o = 'order_G1', p = 'pay_G3';
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('no token → no grant', r.body.persisted === false && r.body.reason === 'not_signed_in', r.body);
  check('no user doc created', !STORE.get('users/undefined'));

  const r2 = await call({ razorpay_order_id: o, razorpay_payment_id: 'pay_G4',
                          razorpay_signature: sign(o, 'pay_G4'), idToken: 'forged-token' });
  check('forged token → no grant', r2.body.persisted === false, r2.body);

  const r3 = await call({ razorpay_order_id: o, razorpay_payment_id: 'pay_G5',
                          razorpay_signature: sign(o, 'pay_G5'), idToken: 'tok-alice', uid: 'uid-victim' });
  check('uid in body is ignored', !STORE.get('users/uid-victim'), null);
  check('grant lands on the token owner', r3.body.persisted === true);
}

console.log('\n== upgrade replaces rather than stacks ==');
{
  ORDER = { id: 'order_G9', amount: 299900, notes: { tier: 'inferno', days: '365' } };
  const o = 'order_G9', p = 'pay_G9';
  await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p), idToken: 'tok-alice' });
  const u = STORE.get('users/uid-alice');
  check('tier upgraded to inferno', u.plan === 'inferno', u.plan);
  const days = Math.round((Date.parse(u.subscription.expiresAt) - Date.now()) / 864e5);
  check('different tier starts fresh (365d)', days === 365, days);
}

console.log('\n' + '='.repeat(56));
console.log(`  ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
