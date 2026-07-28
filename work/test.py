#!/usr/bin/env python3
"""Runtime verification of the RankSpark Premium system in a real browser."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

# Relative to this file, so the suite works from a checkout or an extracted
# archive anywhere on disk rather than only in the original sandbox.
APP = (pathlib.Path(__file__).resolve().parent / "app.built.html")
FAILS, PASSES = [], []


def check(name, cond, extra=""):
    (PASSES if cond else FAILS).append(name)
    print(("  PASS " if cond else "  FAIL ") + name + ((" :: " + str(extra)) if extra and not cond else ""))


with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 940})
    errs, cons = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: cons.append((m.type, m.text[:200])) if m.type == "error" else None)

    def dismiss_splash():
        """The host app shows a first-run onboarding splash that overlays the
        page. Mark onboarding done and close it so clicks reach the UI."""
        pg.evaluate("""
          localStorage.setItem('rankspark-onboarded','true');
          const s=document.getElementById('splash-screen');
          if(s){s.classList.remove('open');s.setAttribute('aria-hidden','true');}
          document.body.style.overflow='';
        """)

    pg.goto(APP.as_uri())
    pg.wait_for_timeout(3500)
    dismiss_splash()

    print("\n== console/page errors ==")
    rel = [e for e in errs if "firebase" not in e.lower() and "idb-cache" not in e.lower()]
    for e in rel[:10]:
        print("  ERR", e[:220])
    ce = [t for t in cons if "firebase" not in t[1].lower()
          and "ERR_FILE_NOT_FOUND" not in t[1] and "Failed to load resource" not in t[1]]
    for t in ce[:10]:
        print("  CON", t[1][:200])

    print("\n== 1. engine ==")
    check("RSP namespace", pg.evaluate("!!window.RSP && !!window.RSP.plan"))
    check("default tier = spark", pg.evaluate("RSP.plan.tier()") == "spark")
    check("3 tiers", pg.evaluate("RSP.TIER_ORDER.length") == 3)
    ents = pg.evaluate("Object.keys(RSP.ENTITLEMENTS).length")
    check("entitlements registered (>=20)", ents >= 20, ents)
    check("canUse returns shape", pg.evaluate(
        "(()=>{const r=RSP.plan.canUse('mock.completed_per_month',1);"
        "return ['allowed','limit','used','remaining','upgradeTarget','pct'].every(k=>k in r)})()"))
    check("spark mock limit = 4/mo", pg.evaluate("RSP.plan.limit('mock.completed_per_month')") == 4)
    check("blaze mock limit = 8", pg.evaluate("RSP.ENTITLEMENTS['mock.completed_per_month'].limit.blaze") == 8)
    check("inferno unlimited mocks", pg.evaluate("RSP.ENTITLEMENTS['mock.completed_per_month'].limit.inferno===Infinity"))
    check("legacy getPlanTier bridged", pg.evaluate("getPlanTier()") == "free")

    print("\n== 2. pricing math ==")
    check("blaze 30d = 149", pg.evaluate("RSP.TIERS.blaze.price[30]") == 149)
    check("inferno 30d = 399", pg.evaluate("RSP.TIERS.inferno.price[30]") == 399)
    check("blaze 365 rate = 100/mo", pg.evaluate("RSP.monthlyRate('blaze',365)") == 100)
    check("inferno 365 rate = 250/mo", pg.evaluate("RSP.monthlyRate('inferno',365)") == 250)
    sav = pg.evaluate("RSP.savingPct('blaze',365)")
    check("blaze annual saving ~33%", 30 <= sav <= 35, sav)

    print("\n== 3. metering ==")
    pg.evaluate("RSP.plan.record('mock.completed_per_month',3)")
    r = pg.evaluate("RSP.plan.canUse('mock.completed_per_month',1)")
    check("used=3 after record", r["used"] == 3, r)
    check("still allowed at 3/4", r["allowed"] is True)
    check("pct = 75", r["pct"] == 75, r["pct"])
    pg.evaluate("RSP.plan.record('mock.completed_per_month',1)")
    r = pg.evaluate("RSP.plan.canUse('mock.completed_per_month',1)")
    check("denied at limit", r["allowed"] is False)
    check("upgradeTarget = blaze", r["upgradeTarget"] == "blaze", r["upgradeTarget"])
    check("resetAt present", bool(r["resetAt"]))
    check("guard() non-enforcing returns true", pg.evaluate(
        "RSP.plan.guard('mock.completed_per_month')") is True)
    pg.evaluate("RSP.paywall.close()")
    pg.evaluate("RSP.config.enforce=true")
    check("guard() enforcing returns false", pg.evaluate(
        "RSP.plan.guard('mock.completed_per_month')") is False)
    pg.evaluate("RSP.config.enforce=false; RSP.paywall.close(); RSP.plan.resetUsage()")

    print("\n== 4. persistence ==")
    pg.evaluate("RSP.plan.record('paper_lab.exports_per_month',5)")
    pg.reload(); pg.wait_for_timeout(2500); dismiss_splash()
    check("usage survives reload", pg.evaluate("RSP.plan.used('paper_lab.exports_per_month')") == 5)
    pg.evaluate("RSP.plan.resetUsage()")

    print("\n== 5. pricing page ==")
    pg.evaluate("RSP.ui.go('pricing')")
    pg.wait_for_timeout(900)
    check("#page-pricing active", pg.evaluate("document.querySelector('#page-pricing').classList.contains('active')"))
    check("3 tier cards", pg.locator(".rsp-tier").count() == 3)
    check("hero rendered", pg.locator(".rsp-hero h1").count() == 1)
    check("5 duration options", pg.locator("[data-rsp-dur]").count() == 5)
    check("usage meters", pg.locator(".rsp-meter").count() >= 5)
    check("matrix rows", pg.locator(".rsp-matrix tbody tr.rsp-row").count() >= 18)
    check("faq present", pg.locator(".rsp-faq details").count() == 6)
    check("never-gated list", pg.locator(".rsp-never-item").count() == 5)
    seg_w = pg.evaluate("document.querySelector('.rsp-seg-thumb').style.width")
    check("seg thumb positioned", seg_w not in ("", "0px"), seg_w)

    # price shown for blaze monthly
    txt = pg.locator('.rsp-tier[data-t="blaze"] .rsp-price-num').inner_text()
    check("blaze shows 149", "149" in txt, txt)
    pg.click('[data-rsp-dur="365"]'); pg.wait_for_timeout(700)
    txt = pg.locator('.rsp-tier[data-t="blaze"] .rsp-price-num').inner_text()
    check("switch to 365 shows 1,199", "1,199" in txt or "1199" in txt, txt)
    note = pg.locator('.rsp-tier[data-t="blaze"] .rsp-price-note').inner_text()
    check("annual note shows /mo rate", "100" in note, note)
    pg.click('[data-rsp-dur="30"]'); pg.wait_for_timeout(500)

    print("\n== 6. sidebar + nav ==")
    check("nav entry added", pg.locator('.nav-link[data-view="pricing"]').count() == 1)
    check("sidebar card replaced", pg.locator("#rsp-side").count() == 1)
    check("old .plan-card gone", pg.locator(".plan-card").count() == 0)
    check("sidebar shows tier", "Spark" in pg.locator("#rsp-side .rsp-side-name").inner_text())

    print("\n== 7. paywall ==")
    pg.evaluate("RSP.plan.record('mock.completed_per_month',4); RSP.dev.paywall('mock.completed_per_month')")
    pg.wait_for_timeout(700)
    check("overlay open", pg.evaluate("document.querySelector('#rsp-overlay').classList.contains('open')"))
    check("paywall shows real usage", "4 of 4 used" in pg.locator(".rsp-pw-meter-top").inner_text(),
          pg.locator(".rsp-pw-meter-top").inner_text())
    check("recommends blaze", "Blaze" in pg.locator(".rsp-pw-plan-t b").inner_text())
    check("offers trial (eligible)", pg.locator("[data-rsp-trial]").count() == 1)
    check("has see-all-plans", pg.locator("[data-rsp-plans]").count() == 1)
    check("demo notice shown", pg.locator(".rsp-pw-demo").count() == 1)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    check("escape closes", not pg.evaluate("document.querySelector('#rsp-overlay').classList.contains('open')"))

    print("\n== 8. checkout ==")
    pg.evaluate("RSP.checkout.open('blaze',30)")
    pg.wait_for_timeout(700)
    check("checkout open", pg.locator(".rsp-co-dur").count() == 5)
    check("4 pay methods", pg.locator(".rsp-co-pay").count() == 4)
    tot = pg.locator(".rsp-co-total b").inner_text()
    check("total = 149", "149" in tot, tot)
    pg.click('[data-rsp-setdur="365"]'); pg.wait_for_timeout(500)
    tot = pg.locator(".rsp-co-total b").inner_text()
    check("total updates to 1,199", "1,199" in tot, tot)
    check("gst line present", pg.locator(".rsp-co-line", has_text="GST").count() == 1)
    check("expiry preview", pg.locator(".rsp-co-expiry").count() == 1)
    pg.click('[data-rsp-setpay="card"]'); pg.wait_for_timeout(400)
    check("pay method switches", pg.locator(".rsp-co-pay.on .rsp-co-pay-t b").inner_text() == "Card")

    print("\n== 9. purchase flow ==")
    # Payment is now REAL Razorpay, so clicking Pay opens their hosted modal
    # instead of simulating success. Activation is exercised directly against
    # the entitlement engine, which is what the simulated flow used to prove.
    check("razorpay hooked into checkout", pg.evaluate("!!(RSP.checkout && RSP.checkout.__rzp)"))
    check("pay() exposed", pg.evaluate("typeof RankSparkPay.pay") == "function")
    check("no plan granted without payment", pg.evaluate("RSP.plan.tier()") == "spark")
    pg.evaluate("RSP.plan.activate('blaze', 365, {orderId:'RS-TEST', source:'test'})")
    pg.wait_for_timeout(300)
    check("tier is blaze", pg.evaluate("RSP.plan.tier()") == "blaze")
    dl = pg.evaluate("RSP.plan.daysLeft()")
    check("365 days granted", 363 <= dl <= 365, dl)
    check("legacy flag synced to pro", pg.evaluate("getPlanTier()") == "pro")
    check("blaze lifts mock cap to 8", pg.evaluate("RSP.plan.limit('mock.completed_per_month')") == 8)
    pg.evaluate("if (window.RSP && RSP.ui && RSP.ui.sidebarCard) RSP.ui.sidebarCard()")
    pg.wait_for_timeout(300)
    check("sidebar updated", "Blaze" in pg.locator("#rsp-side .rsp-side-name").inner_text())
    pg.evaluate("RSP.checkout.close()")

    print("\n== 10. trial flow ==")
    pg.evaluate("RSP.dev.reset(false)")
    pg.reload(); pg.wait_for_timeout(2500); dismiss_splash()
    check("back to spark", pg.evaluate("RSP.plan.tier()") == "spark")
    check("trial eligible", pg.evaluate("RSP.plan.trialEligible()") is True)
    pg.evaluate("RSP.checkout.trial()")
    pg.wait_for_timeout(800)
    check("trial grants blaze", pg.evaluate("RSP.plan.tier()") == "blaze")
    check("isTrial true", pg.evaluate("RSP.plan.isTrial()") is True)
    check("7 days", pg.evaluate("RSP.plan.daysLeft()") == 7)
    check("not re-eligible", pg.evaluate("RSP.plan.trialEligible()") is False)
    pg.evaluate("RSP.checkout.close(); RSP.ui.go('home')")
    pg.wait_for_timeout(600)
    check("trial banner on home", pg.locator("#rsp-banner").count() == 1)

    print("\n== 11. expiry / downgrade (data safety) ==")
    pg.evaluate("""
      const s=JSON.parse(localStorage.getItem('rankspark-subscription'));
      s.expiresAt=new Date(Date.now()-864e5).toISOString();
      localStorage.setItem('rankspark-subscription',JSON.stringify(s));
      localStorage.setItem('rankspark-bookmarks',JSON.stringify([{question_code:'q1'},{question_code:'q2'}]));
    """)
    pg.reload(); pg.wait_for_timeout(2500); dismiss_splash()
    check("auto-downgraded to spark", pg.evaluate("RSP.plan.tier()") == "spark")
    check("status = trial-ended", pg.evaluate("RSP.plan.sub().status") == "trial-ended")
    check("bookmarks preserved", pg.evaluate("JSON.parse(localStorage.getItem('rankspark-bookmarks')).length") == 2)
    check("trial not reusable after expiry", pg.evaluate("RSP.plan.trialEligible()") is False)
    check("derived bookmark count", pg.evaluate("RSP.plan.used('bookmarks.max_count')") == 2)

    print("\n== 12. gates in product ==")
    pg.evaluate("RSP.ui.go('home')"); pg.wait_for_timeout(700)
    locked = pg.evaluate("document.querySelectorAll('.quick-card[data-rsp-locked]').length")
    check("no locks when under limit", locked == 0, locked)
    pg.evaluate("RSP.dev.fill('mock.completed_per_month'); RSP.ui.go('home')")
    pg.wait_for_timeout(700)
    locked = pg.evaluate("document.querySelectorAll('.quick-card[data-rsp-locked]').length")
    check("mock tile locks at limit", locked >= 1, locked)

    print("\n== 13. a11y / polish ==")
    pg.evaluate("RSP.dev.paywall('analytics.topic_diagnosis')")
    pg.wait_for_timeout(600)
    check("dialog role", pg.evaluate("document.querySelector('.rsp-ov-panel').getAttribute('role')") == "dialog")
    check("aria-modal", pg.evaluate("document.querySelector('.rsp-ov-panel').getAttribute('aria-modal')") == "true")
    check("focus trapped inside", pg.evaluate(
        "document.querySelector('#rsp-overlay').contains(document.activeElement)"))
    check("body scroll locked", pg.evaluate("document.body.style.overflow") == "hidden")
    check("inferno recommended for topic diag",
          "Inferno" in pg.locator(".rsp-pw-plan-t b").inner_text())
    pg.evaluate("RSP.paywall.close()"); pg.wait_for_timeout(500)
    check("body scroll restored", pg.evaluate("document.body.style.overflow") == "")

    print("\n== 14. responsive ==")
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.evaluate("RSP.ui.go('pricing')"); pg.wait_for_timeout(900)
    ow = pg.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+2")
    check("no horizontal overflow @390", ow)
    cols = pg.evaluate("getComputedStyle(document.querySelector('.rsp-tiers')).gridTemplateColumns")
    check("tiers stack on mobile", len(cols.split()) == 1, cols)
    pg.evaluate("RSP.checkout.open('inferno',90)"); pg.wait_for_timeout(700)
    check("checkout fits mobile", pg.evaluate(
        "document.querySelector('.rsp-ov-panel').getBoundingClientRect().width<=390"))
    pg.evaluate("RSP.checkout.close()")
    pg.set_viewport_size({"width": 1440, "height": 940})

    print("\n== 15. no regressions in host app ==")
    for v in ["home", "question-bank", "practice", "analytics", "bookmarks", "profile", "pricing"]:
        pg.evaluate(f"RSP.ui.go('{v}')"); pg.wait_for_timeout(260)
        ok = pg.evaluate(f"!!document.querySelector('#page-{v}.active')")
        check(f"nav → {v}", ok)
    check("no new page errors", len(rel) == 0, rel[:3])

    # screenshots
    pg.evaluate("RSP.ui.go('pricing')"); pg.wait_for_timeout(1100)
    pg.screenshot(path="/home/user/work/shot-pricing.png", full_page=True)
    pg.evaluate("RSP.dev.paywall('mock.completed_per_month')"); pg.wait_for_timeout(800)
    pg.screenshot(path="/home/user/work/shot-paywall.png")
    pg.evaluate("RSP.paywall.close();RSP.checkout.open('inferno',180)"); pg.wait_for_timeout(800)
    pg.screenshot(path="/home/user/work/shot-checkout.png")
    pg.evaluate("RSP.checkout.close();RSP.ui.go('home')"); pg.wait_for_timeout(800)
    pg.screenshot(path="/home/user/work/shot-home.png")

    b.close()

print(f"\n{'='*60}\n  {len(PASSES)} passed / {len(FAILS)} failed")
if FAILS:
    print("  FAILURES:")
    for f in FAILS:
        print("   -", f)
sys.exit(1 if FAILS else 0)
