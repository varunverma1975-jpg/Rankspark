/* Security tests for POST /api/razorpay/verify.
 *
 * The route is the only thing standing between "someone opened devtools" and
 * "someone has an Inferno plan". These tests assert the forgery vectors are
 * rejected, and — the case that motivated this pass — that a VALID signature
 * paired with an INFLATED tier/days in the body cannot escalate the grant,
 * because the server re-reads the plan from the Razorpay order's notes.
 *
 * Run:  node work/tests/verify_route.mjs
 */
import crypto from 'crypto';

const SECRET = 'test_secret_do_not_use';
const KEY_ID = 'rzp_test_dummy';

process.env.RAZORPAY_KEY_SECRET = SECRET;
process.env.RAZORPAY_KEY_ID = KEY_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT;   // exercise the degraded path

/* Stub the Razorpay orders API. The real order is the source of truth for
   tier/days, so the test controls what it returns. */
let ORDER = { id: 'order_TEST1', amount: 14900, notes: { tier: 'blaze', days: '30' } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.razorpay.com/v1/orders/')) {
    if (!ORDER) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ORDER };
  }
  return realFetch(url, opts);
};

const { default: handler } = await import('../../api/razorpay/verify.js');

function sign(orderId, paymentId, secret = SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

async function call(body, method = 'POST') {
  const res = {
    _status: 0, _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; }
  };
  await handler({ method, body }, res);
  return { status: res._status, body: res._json };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

console.log('\n== accepts a genuine payment ==');
{
  const o = 'order_TEST1', p = 'pay_ABC';
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('valid signature accepted', r.status === 200 && r.body.valid === true, r.body);
  check('tier read from order notes', r.body.tier === 'blaze', r.body);
  check('days read from order notes', r.body.days === 30, r.body);
  check('reports it did not persist (no service account)',
        r.body.persisted === false && r.body.reason === 'no_service_account', r.body);
}

console.log('\n== rejects forgeries ==');
{
  const o = 'order_TEST1', p = 'pay_ABC', good = sign(o, p);
  const cases = [
    ['tampered order id',   { razorpay_order_id: 'order_EVIL', razorpay_payment_id: p, razorpay_signature: good }],
    ['tampered payment id', { razorpay_order_id: o, razorpay_payment_id: 'pay_EVIL', razorpay_signature: good }],
    ['wrong secret',        { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p, 'other') }],
    ['swapped fields',      { razorpay_order_id: p, razorpay_payment_id: o, razorpay_signature: good }],
    ['empty signature',     { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: '' }],
    ['short signature',     { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: 'ab' }],
    ['signature of a different pair',
                            { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign('order_X', 'pay_Y') }],
  ];
  for (const [name, body] of cases) {
    const r = await call(body);
    check(name + ' rejected', r.status === 400 && r.body.valid === false, r.body);
  }
  const miss = await call({ razorpay_order_id: o });
  check('missing fields rejected', miss.status === 400, miss.body);
  const get = await call({}, 'GET');
  check('GET rejected', get.status === 405, get.body);
}

console.log('\n== privilege escalation ==');
{
  const o = 'order_TEST1', p = 'pay_ESC';
  /* Genuine ₹149 Blaze payment, but the client claims Inferno/365 (₹2,999). */
  const r = await call({
    razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p),
    tier: 'inferno', days: 365
  });
  check('client-sent tier ignored', r.body.tier === 'blaze', r.body);
  check('client-sent days ignored', r.body.days === 30, r.body);
  check('forged uid in body cannot be used',
        !('uid' in (r.body || {})) || r.body.persisted === false, r.body);
}

console.log('\n== order integrity ==');
{
  const o = 'order_TEST1', p = 'pay_AMT';
  ORDER = { id: o, amount: 100, notes: { tier: 'inferno', days: '365' } };  // ₹1 for Inferno
  const r = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('amount/plan mismatch rejected',
        r.status === 400 && r.body.error === 'amount_mismatch', r.body);

  ORDER = { id: o, amount: 14900, notes: { tier: 'wizard', days: '30' } };
  const r2 = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('unknown tier rejected', r2.status === 400 && r2.body.error === 'unknown_plan', r2.body);

  ORDER = { id: o, amount: 14900, notes: {} };
  const r3 = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('order without notes rejected', r3.status === 400, r3.body);

  ORDER = null;                                   // order lookup fails
  const r4 = await call({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
  check('unresolvable order rejected', r4.status === 400, r4.body);
}

console.log('\n== unconfigured ==');
{
  delete process.env.RAZORPAY_KEY_SECRET;
  const r = await call({ razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'x' });
  check('503 without a secret', r.status === 503, r.body);
  process.env.RAZORPAY_KEY_SECRET = SECRET;
}

console.log('\n' + '='.repeat(56));
console.log(`  ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
