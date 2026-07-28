/* GET /api/razorpay/health
   Existence of this route is how the browser detects SERVER MODE. It must
   NOT reveal whether the secret is valid — only whether verification is
   available at all. */
export default function handler(req, res) {
  const configured = Boolean(process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_KEY_ID);
  res.status(configured ? 200 : 503).json({
    ok: configured,
    mode: configured ? 'server' : 'unconfigured',
    // never echo the secret, not even its length
    keyId: configured ? process.env.RAZORPAY_KEY_ID : null
  });
}
