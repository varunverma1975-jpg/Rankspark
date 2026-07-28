# RankSpark

Competitive-exam practice PWA. The whole app is one self-contained HTML file;
the `/api` routes exist only for payment verification and entitlement writes.

## Deploy (Vercel)

Drag this folder into Vercel, or:

```bash
npm i -g vercel && vercel --prod
```

`npm install` runs automatically and installs `firebase-admin`, which the
verify route needs.

### Environment variables

| Variable | Needed for | Without it |
|---|---|---|
| `RAZORPAY_KEY_ID` | server-side order creation | falls back to insecure client mode |
| `RAZORPAY_KEY_SECRET` | signature verification | **payments are forgeable from devtools** |
| `FIREBASE_SERVICE_ACCOUNT` | writing the plan to Firestore | plan is local-only; route reports `persisted:false` |

`FIREBASE_SERVICE_ACCOUNT` accepts raw JSON or base64 (`base64 -w0 key.json`).

### One-time Firebase setup

1. Authentication → Sign-in method → enable **Google**
2. Authentication → Settings → Authorized domains → add your deployed domain
3. `firebase deploy --only firestore:rules` (from `admin/firestore.rules`)

Full detail, including the question-pack backends, is in **DEPLOY.md**.

## What deploys vs. what doesn't

| Deployed | Build-time only |
|---|---|
| `index.html`, `ranksparks.html` | `work/parts/*.js` — already baked into the HTML |
| `api/` | `work/tests/` — run locally |
| `package.json`, `vercel.json` | `work/build.py`, `uploads/` |
| `admin/` (dashboard) | `admin/functions/` — separate `firebase deploy` |

`.vercelignore` enforces this. `work/parts/part1.js` and friends are **sources**:
they are base64-embedded inside `ranksparks.html`, not fetched at runtime.

## Rebuilding (optional)

**You do not need to rebuild to deploy.** `index.html` and `ranksparks.html`
are already built and ready to ship. Rebuilding is only for when you edit
something in `work/parts/`.

```bash
npm run build      # decodes the app, injects work/parts/, re-encodes
```

The build injects into a pristine copy of your **original** `ranksparks.html`,
expected at `uploads/ranksparks.html`. That original is yours and is not
included in this bundle — drop it back in if you want to rebuild. Injecting
into a clean copy each time is what keeps the build idempotent. If the file is
missing the build says so and stops rather than producing a broken artifact.

Emits `ranksparks.html` and an identical `index.html` (Vercel serves the repo
root, so a bare `/` needs the latter).

The build is idempotent and asserts its assumptions: if the shell's `mount()`
stops matching, it fails loudly rather than shipping a build where Google
sign-in silently cannot work.

## Tests

```bash
npm run test:premium   # 92 — entitlements, paywalls, no host regressions
npm run test:mount     # 14 — boot, storage continuity, remount, no 404s
npm run test:auth      #  5 — sign-in popup genuinely reaches Google
npm run test:verify    # 21 — signature + plan-integrity forgery vectors
npm run test:grant     # 17 — Firestore grant, replay, identity
npm run test:hf        #  8 — Hugging Face CORS + Range + resume (live CDN)
```

Playwright suites need a browser once per machine:

```bash
pip install playwright && python3 -m playwright install chromium
```

## Layout

```
index.html / ranksparks.html   the app (identical; index.html is the entry point)
api/razorpay/                  health · order · verify
api/_lib/firebase-admin.js     lazy Admin SDK
admin/                         admin dashboard + firestore.rules
work/build.py                  build script
work/parts/                    injected sources (part1–part9)
work/tests/                    test suites
DEPLOY.md                      full deployment guide
```
