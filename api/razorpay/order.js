/* POST /api/razorpay/order  { tier, days }
   Creates a Razorpay order server-side.

   The amount is looked up from a SERVER-SIDE price table, never taken from
   the request body. Trusting a client-sent amount is the classic way to let
   someone buy a ₹2,999 plan for ₹1. */
const PRICES = {
  blaze:   { 7: 49,  30: 149, 90: 399,  180: 699,  365: 1199 },
  inferno: { 7: 99,  30: 399, 90: 999,  180: 1799, 365: 2999 }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const KEY_ID = process.env.RAZORPAY_KEY_ID;
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!KEY_ID || !KEY_SECRET) return res.status(503).json({ error: 'not_configured' });

  const { tier, days } = req.body || {};
  const amount = PRICES[tier]?.[Number(days)];
  if (!amount) return res.status(400).json({ error: 'invalid_plan' });

  const receipt = `rs_${tier}_${days}_${Date.now().toString(36)}`;

  try {
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount * 100,            // paise
        currency: 'INR',
        receipt,
        notes: { tier, days: String(days) }
      })
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[razorpay] order failed', r.status, detail);
      return res.status(502).json({ error: 'gateway_error' });
    }
    const order = await r.json();
    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: KEY_ID                       // public half only
    });
  } catch (e) {
    console.error('[razorpay] order exception', e);
    return res.status(502).json({ error: 'gateway_unreachable' });
  }
}
