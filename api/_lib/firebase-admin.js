/* Lazily-initialised Firebase Admin, shared by the API routes.

   WHY LAZY: Vercel imports every route module in a serverless bundle. If this
   threw at import time whenever the service account is absent, adding
   Razorpay without Firebase would break the whole /api surface. Instead
   `admin()` returns null when unconfigured and callers degrade explicitly.

   CREDENTIALS: FIREBASE_SERVICE_ACCOUNT holds the service-account JSON, either
   raw or base64-encoded (base64 is easier to paste into a Vercel env var
   without newline mangling — both are accepted).

   This module is the ONLY place with privileged Firestore access. The web
   Firebase keys shipped in the client are public identifiers; this private key
   is not, and must never be imported from anything the browser can reach. */

let _app = null;
let _tried = false;

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  let text = raw.trim();
  // Accept base64 as well as raw JSON.
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); }
    catch { return null; }
  }
  try {
    const json = JSON.parse(text);
    if (!json.project_id || !json.private_key || !json.client_email) return null;
    // Vercel stores newlines as literal \n in single-line env vars.
    if (typeof json.private_key === 'string') {
      json.private_key = json.private_key.replace(/\\n/g, '\n');
    }
    return json;
  } catch { return null; }
}

export function isConfigured() {
  return parseServiceAccount() !== null;
}

/** @returns the firebase-admin namespace, or null when unconfigured. */
export async function admin() {
  if (_app) return _app;
  if (_tried) return null;
  _tried = true;

  const svc = parseServiceAccount();
  if (!svc) return null;

  let mod;
  try {
    mod = await import('firebase-admin');
  } catch (e) {
    console.error('[firebase-admin] package not installed', e && e.message);
    return null;
  }
  const fb = mod.default || mod;
  try {
    if (!fb.apps.length) {
      fb.initializeApp({ credential: fb.credential.cert(svc) });
    }
    _app = fb;
    return fb;
  } catch (e) {
    console.error('[firebase-admin] init failed', e && e.message);
    return null;
  }
}

/** Verify a Firebase ID token and return its uid, or null. */
export async function uidFromIdToken(idToken) {
  if (!idToken) return null;
  const fb = await admin();
  if (!fb) return null;
  try {
    const decoded = await fb.auth().verifyIdToken(String(idToken));
    return decoded && decoded.uid ? decoded.uid : null;
  } catch (e) {
    console.warn('[firebase-admin] bad ID token', e && e.code);
    return null;
  }
}
