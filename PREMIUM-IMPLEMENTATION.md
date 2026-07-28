# RankSpark Premium — Implementation Notes

The pricing strategy is implemented in **`ranksparks.html`** (the file you uploaded, rebuilt
in place). 113 automated browser tests pass; the build adds **zero** new console or page errors.

---

## How the file is structured

`ranksparks.html` is a two-layer artefact, which dictated where the code had to go:

```
ranksparks.html                    ← awwwards landing shell (loader, hero, nav)
  └── const APP_HTML_B64 = "…"     ← the real app, base64-encoded, ~1.17 MB
        ├── </head>  → injected CSS  (part2.css + part3.css)
        └── </body>  → injected JS   (part1 → part2 → part3)
```

The premium system lives **inside the encoded payload**, so it ships as one self-contained
file with no external assets. Source lives in `work/parts/`; `work/build.py` re-encodes it.

```bash
cd work && python3 build.py     # rebuild ranksparks.html from parts/
python3 test.py                 # 91 integration tests
```

The build is idempotent — it strips any previous injection before re-injecting, so you can
run it repeatedly without stacking copies.

---

## Part 1 — Entitlement engine  (`parts/part1.js`)

The truth layer. No UI, no DOM.

- **Tiers** — Spark (₹0) / Blaze (₹149) / Inferno (₹399), with the full 7/30/90/180/365-day
  price matrix from the strategy doc.
- **23 entitlement keys** (`mock.completed_per_month`, `pack.volume_access`,
  `analytics.history_days`, …), each carrying its per-tier limit, reset period, the copy shown
  when it blocks, and the outcome it unlocks. Adding a capability = adding one object.
- **`canUse(key, qty)`** returns `{allowed, limit, used, remaining, pct, resetAt,
  upgradeTarget, …}` — including *which tier is the cheapest that would satisfy this request*,
  so the paywall never over-sells Inferno when Blaze would do.
- **`record()` / `recordOnce(key, id)`** — usage is written only *after* an action succeeds,
  and `recordOnce` is idempotent so a page refresh can't double-spend a mock or an export.
- **Periods reset lazily on read** (ISO weeks start Monday). No timers, no drift, correct
  after the tab has been closed for a month.
- **Trial clock** — 7 days of Blaze, one per account, no card. Expiry auto-downgrades to Spark
  and **never touches study data**.
- **Migration** off the legacy `free|pro|gold` flag, guarded by a marker so it runs exactly once.
- **`getPlanTier()` / `getPlanLimits()` are retrofitted** onto the engine, so Paper Lab's
  existing gold-tier branding checks keep working unmodified.

## Part 2 — UI surfaces  (`parts/part2.js`, `part2.css`)

- **`#page-pricing`** — a new full page injected into `<main>`: hero, billing-period switch with
  a sliding thumb, three tier cards with pointer-tracked glow, a live usage panel, a
  23-row comparison matrix, the "never behind a paywall" guarantees, and six FAQs.
- **Sidebar plan card** replaces the static "Pro Plan" block — shows your real tier, trial
  countdown, and the two allowances closest to their limit.
- **Home banner** — trial active / ending / expired / renewal-due, dismissible per state.
- **Router patch** wraps the app's own `showView`, so the page re-renders with fresh numbers
  on every visit rather than going stale.
- Every legacy `[data-upgrade]` button in the app now routes here.

## Part 3 — Paywalls & checkout  (`parts/part3.js`, `part3.css`)

- **Paywall sheet** states *what* is blocked, shows a **live meter of your actual usage**
  ("4 of 4 used, resets 1 Aug"), lists concrete outcomes, and presents **one** recommended plan
  plus a secondary "see all plans" — per §6D of the strategy.
- **Gates wired to real product surfaces**: practice start (mock/custom/random/PYQ),
  Paper Lab export, bookmarks, advanced bank filters, analytics history range, leaderboard
  tabs, data export. Lock badges appear on Home's quick-start tiles before you commit to a flow.
- **Analytics veil** — blurs a realistic topic-diagnosis card so Inferno's value is visible,
  not just described.
- **Checkout** — duration picker with effective ₹/month and savings, UPI/card/net-banking/wallet,
  order summary with the GST split, expiry-date preview, and a success screen with an order ID.
  Extension semantics are correct: rebuying your current tier *adds* days rather than replacing.
- Focus trap, Escape-to-close, `aria-modal`, scroll lock, and it registers as a
  `.modal-backdrop` so the app's existing back-button stack closes it correctly.

---

## Decisions worth flagging

**Gating is non-blocking by default.** Per your instruction, paywalls surface but the action
still proceeds, and the sheet says so honestly rather than faking a block. One switch changes it:

```js
RSP.config.enforce = true;   // limits become binding
```

**Payments are UI-only, as requested.** `confirmPayment()` simulates the round trip. The server
contract it should be replaced with (order creation → Razorpay checkout → signature verification
→ idempotent `payment.captured` webhook as source of truth) is documented inline at the call site.
No key, no network call, nothing to leak.

**One inconsistency in the strategy doc, implemented as written.** §3 gives Spark **40** Paper Lab
exports/month but Blaze only **5** — the paid tier is strictly worse on that line, and §6A repeats
it, so it isn't a typo in a single place. I implemented your numbers and left a one-line switch:

```js
RSP.config.fixPaperLabInversion = true;   // → Spark 5, Blaze 40, Inferno ∞
```

I'd recommend flipping it before launch; it's currently the only row in the matrix where
upgrading takes something away.

**Annual rate rounding.** `₹1,199 ÷ 365 days` renders as ₹99/mo, but the doc quotes **₹100**.
Durations are divided by their *marketed* month count (12, not 12.17) so the UI matches your
pricing table exactly.

**Two bugs found and fixed during testing** — worth knowing about if you touch this file again:

1. The app declares `const state = {…}` at top level, which is a *script-scope* binding, **not**
   `window.state`. Any injected script reading `window.state` silently gets `undefined`. There's
   now a `hostState()` resolver that handles it safely.
2. Injecting at the *last* `</head>` corrupts the file — Paper Lab builds a whole HTML document
   inside a JS string literal, so the final `</head>` is inside JavaScript. The build script now
   asserts it's splicing into the real document head.

---

## Dev console

```js
RSP.dev.usage()              // every entitlement's current state
RSP.dev.grant('inferno', 90) // jump to a tier
RSP.dev.fill('mock.completed_per_month')  // burn an allowance to see the paywall
RSP.dev.paywall('filters.advanced')       // preview any paywall
RSP.dev.enforce(true)        // make limits binding
RSP.dev.reset()              // clear billing state, keep study data
```

---

# Part 4 — Analytics redesign  (`parts/part4.js`, `part4.css`)

## The page was invisible

Before any layout work: **Analytics rendered blank for every user except those
with "reduce motion" enabled.** Verified against your pristine upload — child
element opacities read `0,0,0,0`; after the fix, `1,1,1,1`.

Cause: `.x-in` sets `opacity:0` with `animation: xIn … forwards`. The motion
layer later declares `#anx>*{animation: mLift … backwards}`. An ID selector
outranks a class, so `animation` — including its fill mode — is replaced.
A `backwards` fill reverts to the base style once the animation ends, so every
panel animated in and then snapped back to `opacity:0`.

The redesign renders into a new `#anx2` container with `both` fill and
delays scoped so no ID-level rule can outrank them.

## Two more bugs found

- **`classify()` returns four verdicts** — `strong | weak | neutral |
  insufficient` — but the UI handled three. Every `neutral` row (the majority)
  fell through to the `insufficient` branch and rendered **"NEEDS 0 MORE
  ATTEMPTS"**. Each verdict now has its own label, plus a `MIXED` filter.
- **Contradictory summaries.** Because `neutral` was excluded from `weak`, the
  page could show *"Nothing is failing"* directly above rows reading 42%.
  Focus now falls back to sub-60% rows with enough attempts when nothing is
  statistically confirmed, and says which basis it used.

## Layout changes

| Before | After |
|---|---|
| Hub-and-spoke: 8 tiles, each **replacing** the page | One scrollable page; comparing weak vs slow needs no navigation |
| Filters in two places (range in header, books in body) | One **sticky bar**: range + book + group-by + section jump |
| Weak / Strong / Low-data / Breakdown as 4 destinations | **One table**, filter chips + sortable columns |
| Totals only — no "am I improving?" | **Period-over-period deltas** on every KPI |
| Numbers, no interpretation | **Verdict headline** + ranked "Fix these next" with one-tap Practise |

Ordered by the questions a student actually asks: *How am I doing → What do I
fix → Show me everything → Trends*.

Everything from the old page is preserved — donut, accuracy trend, 30-day
heatmap, exam analysis, chapter/topic/exercise breakdown, pace, session log,
per-book scoping, Wilson-score ranking. Recomposed, not removed. The statistics
layer (`RS_META`) is reused verbatim.

**Priority ranking** uses the Wilson lower bound weighted by evidence, so a
1-of-2 fluke never outranks a 40-question weakness.

## Verified

147 automated checks across six suites: engine, edge cases, analytics
interactions (filter/sort/scope/jump/CTA), responsive, paywall integration, and
**WCAG AA contrast on all four themes — 0 failures**. Mobile: no horizontal
overflow at 390px, table collapses to two rows per record, all tap targets ≥34px.

Two theme bugs fixed along the way: `--surface` is never re-declared by the
light theme (stays `#0b1122`), so panels trusting it rendered dark-on-light;
and the heatmap's dark purple ramp was invisible on white.

**One caveat:** the legacy `#anx` container is hidden from JavaScript, not CSS.
Its own `#anx{display:block!important}` lives in a `<style>` block *after* our
stylesheet — equal specificity, both `!important`, so source order wins. An
inline style set on the element is the only reliable override.

---

# Part 5 — Settings redesign + typography  (`parts/part5.js`, `part5.css`)

## Audit first

Before changing anything I traced every preference key to its readers:

| Finding | Detail |
|---|---|
| **7 dead settings** | `language`, `subject`, `timer`, `solutions`, `dailyGoals`, `testReminders`, `streakAlerts` were written to storage and **never read anywhere**. They looked like working controls that changed nothing. |
| **Duplicate definitions** | `applyPreferences()` and `savePreference()` are each declared **twice** (lines ~5850 and ~6006). The first pair is dead code — the later declaration wins. |
| **Real features with no UI** | Document darkening (`rankspark-png-dark-mode`) existed only as an unlabelled `◐` button inside the runtime header. Motion reduction and keyboard shortcuts had no surface at all. |
| **Buried controls** | Theme and text size were two taps deep inside a modal. |

Dead keys were dropped rather than given fake UI. Every control that ships now
changes observable behaviour.

## What the section became

7 sections, all inline — no modal round-trips:

- **Search** across every setting (matches titles, descriptions and synonyms — "buzz" finds Haptic feedback) + **Reset to defaults**
- **Account** — reuses the app's existing sheets and auth modal, unchanged
- **Appearance** — 4 live theme swatches, interface scale, **reading width**, **motion**
- **Typography** — the font-pairing selector (below)
- **Practice** — auto-save, confirm-on-submit, default marking, **darken documents**
- **Feedback** — sound, haptics
- **Keyboard shortcuts** — documents 8 real shortcuts that were undiscoverable
- **Data & Privacy** — live storage meter, export, clear, delete

**Three genuinely new settings**, each wired to something the app already did:
`motion` (neutralises the `--m-*` tokens), `reading width` (caps measure on wide
screens), `darken documents` (the hidden runtime toggle, now labelled).

Destructive actions delegate to the original rows — so the app's own
confirmation dialogs and logic run untouched.

## Font pairing

| Option | Headings | Body | Weights requested |
|---|---|---|---|
| Editorial | Playfair Display | Source Sans 3 | `700;800` / `400;600` |
| Poster | Abril Fatface | Lato | `400` (single weight) / `400;700` |
| Modern | Young Serif | DM Sans | `400` (single weight) / `400;600` |

Applied via `--font-heading` / `--font-body`, persisted to
`rankspark-fontpair`, and re-applied before first paint so there is no flash.
Defaults are per the brief: heading line-height 1.1–1.2, body 1.6, body
16–18px. Each card previews **its own** typeface live on a light-gray card with
the sample heading and pill role tags (HEADING/BODY · SERIF/SANS/DISPLAY).

Two accuracy notes: **Abril Fatface and Young Serif ship a single 400 weight** —
requesting 700 returns the identical file, so they are loaded at 400 and painted
at 400 rather than faux-bolded. Monospace/numeric UI is excluded from the body
face so tabular figures stay aligned. If Google Fonts is unreachable the system
stack is used and nothing breaks.

## Headline style

`.rs-headline` + `.rs-subtitle`, shipped on the Settings header ("Make it
*yours*."): bold Playfair serif, navy `#0b1020`, line-height 1.15, with `<em>`
rendering italic `#5b4fe8`. Subtitle is regular-weight sans, `#6b7280`,
line-height 1.6, max-width 660px, 28px below the headline.

## Bugs found and fixed while building

1. **Font stacks broke the preview.** `"Abril Fatface", Georgia, serif`
   interpolated raw into `style="…"` closes the attribute on its first quote —
   the declaration was dropped and Poster/Modern headings silently rendered in
   the *body* font. Caught by asserting computed font-family per card, not by eye.
2. **Preview text overlapped.** The card lives inside a `<button>`, so its
   children are `<span>`s and flowed inline until forced to `display:block`.
3. **Motion setting had no effect.** The app declares `--m-*` on `:root` from a
   later `<style>` block; an equal-specificity `:root` override loses on source
   order. Scoping to `body[data-motion="calm"]` wins regardless of position.
4. **Light-theme headline colour was ignored.** The theme sets
   `body[data-theme="light"] h1 { color:#17213b !important }`. Only another
   `!important` can answer it — the one place in this file where it is justified.

## Verified

**192 automated checks, 0 failures**, across nine suites: 31 settings structure
+ font pairing, 38 functional (every control's state, persistence and real
effect), 19 font loading over HTTP (all six families confirmed via
`document.fonts.check`), 17 headline spec, 15 responsive + a11y, plus all 142
prior checks re-run with **zero regressions**.

Performance: settings render **0.5 ms**, toggle handler **1.7 ms**, theme switch
**0.4 ms**, ~30 ms per search keystroke, **zero long tasks**, 359 DOM nodes.
A11y: `role="switch"`/`radio` with `aria-checked`, labelled radiogroups,
keyboard-activable rows, visible focus rings, and **WCAG AA contrast on dark and
light with no failures**. Mobile 390px: no overflow, all targets ≥32px.

---

# Part 6 — Settings corrections  (`parts/part6.js`, `part6.css`)

You reported several settings were fake and the type looked too heavy. I
measured each claim before changing anything — **all of them were correct.**

## What was verified broken

| Claim | Measured evidence |
|---|---|
| Interface scale is fake | Small **13px**, Medium **13px**, Large **16px** — Small and Medium were *identical*, and **559 hardcoded `px` font-size rules** ignored the setting entirely (only 2 used rem/em) |
| Reading width is fake | `#anx2` measured **1180px at all three** values — the element's own `max-width` beat the ancestor rule |
| Fonts too bold | Section titles **750**, pills **800** on 10–12px text |
| No photo option | `auth.photoURL` existed and was rendered, but nothing could set it |
| Country/phone not smart | Five plain `type="text"` inputs |

## Fixes

**Interface scale — now real.** Changing root font-size can never work against
559 hardcoded px rules. Uses `zoom` on the scroll container instead, which
scales every rule plus borders and spacing. Now **5 steps** (XS–XL). Measured:
row title **15.2 → 16.9 → 20.6px**, no overflow at any step.

**Reading width — now real.** Targets `#anx2`/`#stx`/`#page-pricing` directly.
Measured: **780 / 1180 / 1260px**.

**Type weights toned down.** UI dropped from 750/800 → **560–650** across
Settings and Analytics.

**Headline matched to your reference.** Playfair Display **900**, line-height
**1.04**, tighter tracking, with italic indigo emphasis and a **300-weight**
subtitle.

**Profile photo.** Upload → centre-crop → 256×256 JPEG via canvas → data URL.
A test 900×600 image stored at **1.5 KB**. Appears in sidebar, header and
settings; survives reload; has a Remove action. Rejects non-images and >12 MB,
and handles a full-quota failure gracefully.

**Interactive Personal Details.** Country is a **173-entry searchable picker**
with flag emoji that drives the phone dial code and validates digit count per
country (India 10, UK 10, Austria 10–11). Class became a dropdown; username
strips invalid characters live; the field turns green when valid and red when not.

> **I tested `restcountries.com` first and it is now DEPRECATED** — it returns
> `{"success":false,"errors":[…]}`. Shipping it would have produced an empty
> country list. The data is embedded instead (**4.8 KB**), so it works offline
> and cannot break.

## Two cascade bugs found while building

1. `body[data-fontpair] h1` (0,1,1) outranked `.rs-headline` (0,1,0), so the
   font pairing's `--lh-heading` overrode the reference leading — the headline
   silently reverted to 1.15 whenever a pairing was applied. Fixed with `:not()`.
2. The bottom nav overlapped the last settings rows on mobile — now cleared with
   `env(safe-area-inset-bottom)` padding. Verified `stxBottom=779` vs `navTop=844`.

## Verified

**308 checks across 11 suites, 0 failures** — including all 245 prior checks
re-run with **zero regressions**, and 9 end-to-end checks against the real
`ranksparks.html`.

---

## Not built (deliberately)

Server-side enforcement, real Razorpay keys, invoice email/PDF, UPI AutoPay mandates, and
Google Play Billing — all Phase 3 items that need a backend. The client is shaped so they drop
in behind `canUse()` without touching any UI code.
