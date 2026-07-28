# RankSpark — Deployment Guide

Covers the four workstreams added in this pass: on-demand question packs,
Razorpay, live Firebase, and the admin connection.

**Verified: 177 automated checks, 0 failures.**

---

## 1. Two findings that changed the plan

I tested the requested approach against live endpoints before writing code.
Two parts of it cannot work as specified, so I built around them.

### GitHub cannot serve your packs directly to a browser

| Endpoint | Range/resume | CORS | Size cap | Usable? |
|---|---|---|---|---|
| GitHub **Release assets** | ✅ `206 accept-ranges` | ❌ **no `access-control-allow-origin`** | none | **No** — `fetch()` is blocked |
| **raw.githubusercontent** | ✅ | ✅ | **100 MB/file** | **No** — packs are 200–800 MB |

A browser download straight from GitHub fails no matter how it is written.
So the storage layer is a **pluggable driver** — swapping backends is one
config line, which also satisfies the "switch to R2 later without changing
application logic" requirement:

```js
window.RANKSPARK_PACKS = {
  driver: "r2",                                  // r2 | proxy | github-split | local
  baseUrl: "https://packs.yourdomain.com",
  manifestUrl: "https://packs.yourdomain.com/manifest.json"
};
```

| Driver | When to use | Trade-off |
|---|---|---|
| **`r2`** ← recommended | Cloudflare R2 or any CORS+Range bucket | ~**$0.07/mo** for 4.5 GB, **zero egress fees** |
| `proxy` | GitHub Releases via `/api/pack` on Vercel | Vercel free tier caps at 100 GB/mo ≈ **125 downloads** of an 800 MB pack |
| `github-split` | Packs split into <100 MB parts on raw.github | Free and unlimited, but you must re-upload in parts |
| `local` | Dev / self-hosting | Same-origin `/packs` |

### Razorpay: you supplied the public key only

`rzp_test_THqLxD5yExvZjw` is a **key_id**. Verification requires HMAC-SHA256
over `order_id|payment_id` using the **key_secret**, which can only run on a
server — a secret in browser JS is not a secret.

The app therefore detects its own mode at runtime:

- **Server mode** (secure) — used automatically once `/api/razorpay/health`
  responds. Signature verified server-side.
- **Client mode** (fallback) — a real payment is taken, but the signature is
  unverifiable, so anyone can call the success handler from devtools and
  unlock a paid plan for free. The success screen **says so explicitly**.

Adding the secret upgrades you to server mode with **no code change**.

---

## 2. Setup

### Hugging Face (packs) ← simplest free option

Verified from a real browser against the live CDN: CORS survives the
`/resolve/` redirect, `206 Partial Content` works, and resumed byte ranges
match a full read (`npm run test:hf`, 8/8).

```bash
pip install -U "huggingface_hub[cli]"
hf auth login
hf repo create rankspark-packs --repo-type dataset
git lfs install
git clone https://huggingface.co/datasets/<you>/rankspark-packs
cd rankspark-packs
cp /path/to/*.zip . && cp manifest.json .
git add . && git commit -m "packs" && git push
```

Then in `work/build.py` → `RUNTIME_CFG`:

```js
window.RANKSPARK_PACKS = { driver: "hf",
  repoId: "<you>/rankspark-packs", revision: "main" };
```

`revision` accepts a commit SHA — pin one for immutable releases so a re-upload
can never change a pack under a client that already cached it.

Two caveats worth knowing before you commit to this:

- **Keep the repo public.** A private repo needs an `Authorization` header,
  and any token shipped in client JS is public the moment you deploy it.
- **It is a git repo.** Every version of an 800 MB ZIP is retained in LFS
  history, so re-uploading the same pack five times costs ~4 GB, not 800 MB.
  Prefer a new filename + a manifest `version` bump over rewriting in place.

| Backend | Cost for 4.5 GB | CORS + Range | Notes |
|---|---|---|---|
| **Hugging Face** | free | ✅ verified | public only; LFS keeps history |
| Cloudflare R2 | ~$0.07/mo | ✅ configurable | zero egress; private-capable |
| GitHub Releases | free | ❌ **blocked** | unusable direct from a browser |
| Vercel `proxy` | free tier | ✅ | 100 GB/mo ≈ 125 pack downloads |

### Cloudflare R2 (packs)

```bash
# 1. Create a bucket, enable public access via a custom domain
# 2. CORS policy on the bucket:
[{ "AllowedOrigins": ["https://your-app.vercel.app"],
   "AllowedMethods": ["GET","HEAD"],
   "AllowedHeaders": ["Range"],
   "ExposeHeaders":  ["Content-Range","Content-Length","Accept-Ranges"] }]
# 3. Upload each ZIP + its cover.png + manifest.json
```

`manifest.json` — the **only** thing fetched on startup (~2 KB):

```json
{ "packs": [
  { "id": "pack-physics-vol-1", "name": "PHYSICS VOL 1",
    "file": "PHYSICS_VOL_1.zip", "cover": "PHYSICS_VOL_1_cover.png",
    "size": 734003200, "version": "1.0",
    "sha256": "…", "subject": "Physics", "exam": "JEE Main",
    "questionCount": 812 }
]}
```

> `version` drives the **Update** button — bump it and clients offer an update.
> `sha256` is optional; when present the download is verified before opening.
> Generate both with `sha256sum PACK.zip` and `stat -c%s PACK.zip`.

### Razorpay (secure mode)

In Vercel → Settings → Environment Variables:

```
RAZORPAY_KEY_ID      = rzp_test_THqLxD5yExvZjw
RAZORPAY_KEY_SECRET  = <from Razorpay dashboard — never commit this>
```

The three routes in `api/razorpay/` deploy automatically. Prices live in a
**server-side table** in `order.js` — the client-sent amount is ignored, which
is what stops someone buying a ₹2,999 plan for ₹1.

### Server-side entitlements (recommended)

Without this, a verified payment is still only recorded in the browser, so a
determined user can grant themselves a plan from devtools. With it, the plan is
written to Firestore by the server and the client is no longer the source of
truth.

1. Firebase Console → Project settings → **Service accounts** → *Generate new
   private key*.
2. Base64-encode it (avoids newline mangling in a single-line env var):
   ```bash
   base64 -w0 serviceAccount.json
   ```
3. Vercel → Environment Variables:
   ```
   FIREBASE_SERVICE_ACCOUNT = <the base64 string>
   ```

`verify.js` then writes `/users/{uid}` and `/payments/{payment_id}` inside a
transaction. Raw JSON is accepted too. Without the variable the route still
verifies the signature and reports `persisted: false` rather than pretending.

### Firebase

Already wired to `sparkrank-9d990`, and `1784898820658.vercel.app` is already
in the authorized-domains list.

**Add whatever domain you actually serve from** under
Firebase Console → Authentication → Settings → Authorized domains.

> This alone was never enough. Until this pass the app was mounted from a
> `blob:` URL, where `location.hostname` is the empty string — the value
> Firebase matches against that list. No console setting can whitelist `""`,
> so Google sign-in failed on every load regardless of configuration. The
> mount is now same-origin; see §7.

Then deploy the rules:
```bash
firebase deploy --only firestore:rules
```

Also enable **Authentication → Sign-in method → Google**, and create the
Firestore database, if you have not already.

---

## 3. Files changed

| File | Change |
|---|---|
| `work/parts/part8.js` | **New** — pack storage drivers, chunked resumable download, IndexedDB, SHA-256 verification |
| `work/parts/part8b.js` | **New** — Download/Open/Delete/Update UI on the existing cards |
| `work/parts/part8.css` | **New** — progress ring, action bar, storage meter |
| `work/parts/part9.js` | **New** — Razorpay, mode detection, failure handling |
| `work/build.py` | Injects the three parts + a runtime config block |
| `api/razorpay/health.js` | **New** — server-mode probe |
| `api/razorpay/order.js` | **New** — order creation with a server-side price table |
| `api/razorpay/verify.js` | **New** — HMAC signature verification, constant-time compare |
| `admin/index.html` | Firebase config injected |
| `admin/rankspark-admin.html` | Rebuilt |
| `ranksparks.html` | Rebuilt with everything above |
| **This pass** | |
| `work/build.py` | Same-origin mount (asserted, idempotent); strips 3 phantom `<script src>` tags |
| `work/parts/part1.js` | `RSP.reload()` — routes to the shell remount instead of a reload that blanks the frame |
| `work/parts/part7.js` | Distinct sign-in errors (unauthorised domain / blocked popup / cancelled) surfaced instead of one generic toast |
| `work/parts/part9.js` | Sends a Firebase ID token so the server can identify the buyer |
| `api/razorpay/verify.js` | Rewritten — reads the plan from the Razorpay order, verifies the ID token, writes the entitlement transactionally, idempotent on replay |
| `api/_lib/firebase-admin.js` | **New** — lazy Admin SDK, raw or base64 service account |
| `package.json` | **New** — so Vercel installs `firebase-admin`; test scripts |
| `.gitignore`, `.vercelignore` | **New** — keep credentials out of git, build sources out of the deploy |
| `admin/firestore.rules` | `/payments` comment corrected to match who actually writes it |
| `work/tests/*` | **New** — 57 tests across 4 suites |
| `work/test.py` | Purchase test updated — real Razorpay replaces the simulation |

**Unchanged:** the question engine, `loadBookFull()`, `detectDatasetFamily()`,
all six dataset families, the practice/runtime/analytics UI, and navigation.
A downloaded pack is handed to the existing parser as a Blob in
`state.packFiles[id]` — the engine cannot tell it apart from a device import.

---

## 4. Behaviour

**Startup** — fetches `manifest.json` only. Verified: zero `.zip` requests on
boot. Covers load lazily via `IntersectionObserver` when a card scrolls near.

**Download** — streamed and written to IndexedDB in 8 MB chunks, so memory
stays flat regardless of pack size. Progress shows percent, bytes, speed and
ETA, with a Pause button.

**Resume** — partial state is flushed on a chunk boundary **or** every 4
seconds **or** on abort. Verified: cancelling at 25% of a 20 MB pack persisted
5.2 MB and the retry sent `Range: bytes=5259844-`, with a matching SHA-256
after reassembly.

**Offline** — a second visit reads from IndexedDB with no network at all.
Persistent storage is requested so packs are not evicted under disk pressure.

**Memory** — opening a pack releases the previous pack's Blob, so RAM stays
flat across a 4.5 GB library.

---

## 5. Verification

| Suite | Result |
|---|---|
| Premium/entitlement regression | **92 / 92** |
| Pack lifecycle | **21 / 21** |
| Chunking, integrity, memory | **10 / 10** |
| Resume via HTTP Range | **5 / 5** |
| Firebase + Razorpay wiring | **26 / 26** |
| Admin live connection | **6 / 6** |
| Razorpay modal | **9 / 9** |
| HMAC verification | **8 / 8** |
| Sign-in reachability (`work/tests/auth_probe.py`) | **5 / 5** |
| Same-origin mount (`work/tests/mount_probe.py`) | **14 / 14** |
| Verify route security (`work/tests/verify_route.mjs`) | **21 / 21** |
| Entitlement grant (`work/tests/grant_route.mjs`) | **17 / 17** |
| **Total** | **234 / 234** |

Reproduce the new suites:
```bash
npm run test:auth     # popup genuinely reaches Google
npm run test:mount    # boot, storage, remount, no phantom 404s
npm run test:verify   # signature + plan-integrity forgery vectors
npm run test:grant    # Firestore grant, replay, identity
```

The signature suites are the ones to keep. Together they assert that a genuine
payment is accepted and that **every forgery vector is rejected** — tampered
order id, tampered payment id, wrong secret, swapped fields, empty and short
signatures, a signature belonging to a different pair, an order whose amount
does not match its plan, a forged ID token, and a `uid` planted in the request
body. The escalation case is the important one: a real ₹149 Blaze payment
whose callback claims `{tier:'inferno', days:365}` is granted **Blaze/30**,
because the server re-reads the plan from the Razorpay order it created.

---

## 6. Known limits

- **Client mode is not secure.** Add `RAZORPAY_KEY_SECRET` before taking real
  money. The UI states this rather than hiding it.
- **Entitlements are local until `FIREBASE_SERVICE_ACCOUNT` is set.** The
  route verifies the payment either way, but only writes the plan to Firestore
  when it can authenticate itself, and reports `persisted:false` when it
  cannot. It never claims to have recorded something it did not.
- **Packs stay idle until you publish a manifest.** With `manifestUrl` blank
  the app behaves exactly as before, using device import. Nothing breaks while
  you set up R2.
- **Analytics (`measurementId`) is not initialised.** The config carries it,
  but no GA module is loaded — one less third-party script on the critical
  path. Say the word if you want it wired.

---

## 7. The mount change (why sign-in was impossible before)

The landing shell decodes the app and mounts it into an iframe. It used to do
that with `URL.createObjectURL(blob)`. Measured consequence:

| Mount | `location.hostname` | `signInWithPopup()` |
|---|---|---|
| `blob:` (old) | `""` | `auth/unauthorized-domain`, instantly |
| `srcdoc` (old fallback) | `""` (origin `null`) | `auth/unauthorized-domain`, instantly |
| **same-origin write (new)** | **real host** | **popup opens** |

Control test, identical config, seconds apart: from `http://localhost:8899` the
popup opened at Google's real auth handler; from `blob:http://localhost:8899/…`
it rejected before any network call. Firebase compares `location.hostname`
against the authorized-domains list, and `""` can never be added to it.

The fix writes the decoded document into a same-origin iframe. Verified
side effects:

- **No user data moves.** A `blob:` iframe already inherited the parent
  origin's `localStorage` and IndexedDB, so subscriptions, downloaded packs and
  preferences are read from exactly the same place. Asserted in `mount_probe`.
- **One less network round trip** than the `?rsapp=1` self-reload alternative,
  which would have refetched the 2.2 MB document.
- **Three phantom `<script src>` tags removed** — `firebase-config.js`,
  `idb-cache.js`, `firebase-adapter.js` were never shipped. Under `blob:` they
  failed silently; with a real origin they would have become genuine 404s on
  every load. `part7.js` supersedes all three.
- **`location.reload()` is routed through `RSP.reload()`.** Inside a written
  document a raw reload navigates to a blank `about:blank`, and
  `Location.prototype.reload` is non-configurable so it cannot be patched. The
  shell exposes `window.__rsRemount()` instead.

If the shell's `mount()` source ever stops matching, **the build now fails
loudly** rather than silently shipping a version where sign-in cannot work.
