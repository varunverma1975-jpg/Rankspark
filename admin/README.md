# RankSpark Admin

Companion admin dashboard for RankSpark. Ships as static files — no build step,
no `node_modules`, no bundler. Open `index.html` and it runs.

```
admin/
├── rankspark-admin.html    ★ SINGLE FILE — double-click this to open
├── build.py                   regenerates the single file from source below
├── index.html                 app shell, auth gate, router bootstrap
├── css/admin.css              design system (ink + c1..c5 ramp, Sora/JetBrains Mono)
├── js/core.js                 Firebase wiring, data layer, router, primitives
├── js/views-a.js              Dashboard · Books · Pricing
├── js/views-b.js              Users · Live · Notifications · Banners · Email
│                              Content · Maintenance · Payments · Settings
├── firestore.rules            security rules (34 emulator tests pass)
├── firestore.rules.test.mjs   the tests themselves
└── functions/index.js         Cloud Functions (Stripe, email, rollups, presence)
```

---

## Read this first — a blocker I found in RankSpark

The prompt pack assumes `window.rankSparkFirebase` exists. **It does not.**

The app declares that surface and nine call sites guard on
`window.rankSparkFirebase?.enabled`, but it is loaded through three relative
`<script src>` tags — `firebase-config.js`, `idb-cache.js`,
`firebase-adapter.js` — and:

1. none of those files were ever shipped, and
2. the app runs from a **`blob:` URL** inside the landing shell's iframe, where
   a relative `src` has no resolvable base and can never load.

Verified at runtime: `typeof window.rankSparkFirebase === 'undefined'`. Cloud
sync, Google auth and the leaderboard have been silently dead, and every
Section 2–12 integration snippet would have targeted a hook that never exists.

**Fixed.** The adapter is now written into the base64 payload
(`work/parts/part7.js`) and imports the SDK from an absolute `https://` URL, so
it works from a `blob:` origin. It also carries the client half of the admin
contract: batched remote config with TTL + last-known-good, announcement
banners with per-message dismissal, and the maintenance takeover.

With no keys present it installs in **local mode** (`enabled: false`) where
every method resolves against `localStorage` — so nothing regressed before you
add real config.

```js
// point the app at your project (from the app's console, once):
RankSparkCloud.setConfig({ apiKey: '…', authDomain: '…', projectId: '…',
                           storageBucket: '…', appId: '…' });
RankSparkCloud.status();   // { enabled, mode, configVersion }
```

---

## Setup

**1 — Open the dashboard.**

**Easiest:** double-click **`rankspark-admin.html`**. That is the whole app in
one self-contained file — no server, no install.

> The modular `index.html` **cannot** be opened this way. Browsers apply CORS
> to ES module scripts even on `file://` (origin `null`), so it hangs on
> "Checking your session…". Verified. Serve it instead:
>
> ```bash
> cd admin && python3 -m http.server 8080     # → http://localhost:8080
> ```
>
> Edit the modular source, then run `python3 build.py` to regenerate the
> single file.

It boots on **demo data** so every screen is reviewable immediately. The badge
in the top bar reads `Demo data` until Firebase is attached.

**2 — Attach Firebase.** Settings → *Firebase connection* → paste your web
config JSON. Stored in `localStorage` only; never committed. Alternatively set
`window.RANKSPARK_FIREBASE_CONFIG` before the module script.

**3 — Grant yourself admin.** Create `admins/{your-uid}`:

```
/admins/AbC123...   { email: "you@rankspark.app", role: "owner" }
```

Signing in is not enough — without this doc you get the *Not authorised*
screen and are signed out.

**4 — Deploy rules and functions.**

```bash
firebase deploy --only firestore:rules
cd functions && npm install && cd ..
firebase functions:secrets:set STRIPE_SECRET STRIPE_WEBHOOK_SECRET RESEND_KEY
firebase deploy --only functions
```

**5 — Point Stripe at the webhook.** Add
`https://<region>-<project>.cloudfunctions.net/stripeWebhook` and subscribe to
`checkout.session.completed`, `invoice.paid`,
`customer.subscription.updated`, `customer.subscription.deleted`.

---

## Wiring checklist (RankSpark side)

| # | Feature | Status |
|---|---|---|
| 0.5 | Firebase adapter | **Done** — `part7.js`, verified `enabled` flips with config |
| 3 | Remote config, TTL cache, LKG fallback | **Done** — verified |
| 9 | Announcement banners + dismissal | **Done** — verified, incl. re-show on edit |
| 12 | Maintenance takeover + bypass + countdown | **Done** — verified |
| 14 | Feature flags | **Done** — verified hiding the leaderboard |
| 2 | Published books merged into `state.loadedPacks` | Snippet below |
| 11 | `data-info` copy from `/content` | Snippet below |

### Section 2 — publish books without a redeploy

```js
// paste near loadQuestionData()
async function loadRemoteBooks() {
  const cfg = window.RS_CONFIG;                       // already fetched by part7
  const fb  = window.rankSparkFirebase;
  if (!fb?.enabled) return;                           // local mode: skip silently
  const { collection, getDocs, query, where } = fb._fs;
  const snap = await getDocs(query(collection(fb._db, 'books'),
                                   where('active', '==', true)));
  snap.forEach(d => {
    const b = { id: d.id, ...d.data() };
    if (state.loadedPacks.has(b.id)) return;          // never clobber a local import
    state.loadedPacks.set(b.id, {
      pack_id: b.id, packLabel: b.name, questionCount: b.questionCount,
      remote: true, fileUrl: b.fileUrl, family: b.family
    });
  });
  renderPackSelector();
}
```

### Section 11 — live legal copy with a fallback

```js
// replaces the hardcoded copy dict on [data-info]
const FALLBACK = {
  privacy: 'Your local study data stays in your browser until you connect a backend account.',
  terms:   'Use only content you are permitted to study and share.',
  support: 'Support: support@rankspark.example'
};
async function infoText(slug) {
  try {
    const fb = window.rankSparkFirebase;
    if (!fb?.enabled) return FALLBACK[slug];
    const { doc, getDoc } = fb._fs;
    const d = await getDoc(doc(fb._db, 'content', slug));
    return d.exists() && d.data().status === 'published' ? d.data().body : FALLBACK[slug];
  } catch { return FALLBACK[slug]; }   // network failure must never break the button
}
```

---

## Decisions worth knowing

**Why not React + Vite.** RankSpark ships as one self-contained HTML file.
Matching that means the admin hosts anywhere with no build step and no version
drift between the two codebases. Everything is plain ES modules, so porting to
Vite later is a copy-paste rather than a rewrite.

**Presence is off by default.** A 30-second heartbeat per user is roughly
**86,000 writes/day at 1,000 concurrent users** — the most expensive pattern in
this design. Enable it deliberately in Settings. At real scale, move presence
to Realtime Database (priced on bandwidth, native `onDisconnect`) or sample
1-in-N users.

**Config is one merged read.** `getConfig` returns app config + pricing +
banners in a single cacheable response (`max-age=60, stale-while-revalidate`),
rather than three Firestore reads per client per load.

**The audit log is immutable — including for admins.** An audit trail an admin
can rewrite is not an audit trail. Rules block `update` and `delete` outright.

**Admins cannot mint admins from the browser.** `/admins` is write-denied in
rules; the `setAdmin` Function is owner-only and logs every grant. A single
compromised admin session therefore cannot quietly create more.

**Email provider: Resend.** Two-line SDK from a Function, HTML templates rather
than a proprietary builder, free tier covers transactional volume. SendGrid is
the alternative once you need marketing campaigns and suppression lists.

---

## Verification

| Suite | Result |
|---|---|
| Firestore rules (real emulator) | **34 / 34** |
| Admin routes + interactions | **31 / 31** |
| Single-file build via `file://` | **24 / 24** |
| Cloud bridge in RankSpark | **20 / 20** |
| Maintenance · banners · flags | **13 / 13** |
| Prior RankSpark suites (regression) | **268 / 268** |

The rules suite is the one to re-run after any change:

```bash
npx firebase-tools emulators:start --only firestore --project rs-test
node firestore.rules.test.mjs
```

It asserts the attacks that matter: a student cannot publish a book, edit
pricing, enable maintenance, grant themselves a plan, read another student's
data, forge a payment, or tamper with the audit log.

## Not built

Sections 2 (Storage cleanup on delete), 8 (FCM token collection) and 13
(historical backfill) are scaffolded with real code paths but need a live
project to exercise. Nothing is a dead-end button — every control writes
through the same `db` layer that talks to Firestore once configured.
