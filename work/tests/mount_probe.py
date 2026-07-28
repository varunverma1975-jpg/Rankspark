"""Regression guard for the same-origin mount in the shipped ranksparks.html.

Covers the things the mount change could plausibly break:
  1. the app still boots through the real user path (clicking the CTA)
  2. no phantom 404s (the three <script src> files that never existed)
  3. storage written by the app is visible on the page origin (no data loss)
  4. window.__rsRemount() re-mounts a working document, because
     location.reload() inside a written document lands on a blank about:blank
     and Location.prototype.reload is non-configurable so it cannot be patched
  5. RSP.reload() routes to the shell helper instead of the broken reload
"""
import subprocess, time, sys, json, socket
import os
# Serve the repo this test lives in, not a hardcoded path, so the suite works
# from a checkout or an extracted archive anywhere on disk.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))



def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    port = free_port()
    srv = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port),
         '--bind', '127.0.0.1', '--directory', ROOT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    res, checks = {}, []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            pg = b.new_page(viewport={'width': 1440, 'height': 940})
            failed = []
            pg.on('requestfailed', lambda r: failed.append(r.url))
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:160]))

            pg.goto('http://localhost:%d/ranksparks.html' % port, wait_until='load')
            pg.wait_for_timeout(1500)

            # --- 1. boot via the real CTA, not an internal function call ----
            pg.evaluate("() => { const c=document.getElementById('ctaSpark'); if(c) c.click(); }")
            pg.wait_for_timeout(8000)

            info = pg.evaluate("""() => {
              const f = document.getElementById('appFrame');
              const w = f && f.contentWindow, d = f && f.contentDocument;
              return { hostname: w && w.location.hostname,
                       bodyLen: d && d.body ? d.body.innerHTML.length : 0,
                       hasApp: !!(w && w.__rsApp), hasRSP: !!(w && w.RSP),
                       rspReload: !!(w && w.RSP && typeof w.RSP.reload === 'function'),
                       remount: typeof window.__rsRemount,
                       fbEnabled: !!(w && w.rankSparkFirebase && w.rankSparkFirebase.enabled) };
            }""")
            res['afterCtaBoot'] = info
            checks += [
                ('app boots from the CTA', info['bodyLen'] > 100000),
                ('host app API present', info['hasApp']),
                ('entitlement engine present', info['hasRSP']),
                ('real hostname in frame', info['hostname'] == 'localhost'),
                ('firebase adapter live', info['fbEnabled']),
                ('shell exposes __rsRemount', info['remount'] == 'function'),
                ('RSP.reload() shim present', info['rspReload']),
            ]

            # --- 2. phantom script 404s are gone ----------------------------
            phantom = [u for u in failed
                       if any(n in u for n in ('firebase-config.js', 'idb-cache.js',
                                               'firebase-adapter.js'))]
            res['phantom404s'] = phantom
            checks.append(('no phantom <script src> 404s', not phantom))

            # --- 3. storage continuity --------------------------------------
            pg.evaluate("""() => { document.getElementById('appFrame').contentWindow
                                     .localStorage.setItem('rsp-mount-probe','kept'); }""")
            seen = pg.evaluate("() => localStorage.getItem('rsp-mount-probe')")
            res['storageSharedWithPage'] = seen
            checks.append(('frame storage == page origin storage', seen == 'kept'))

            # --- 4/5. remount actually rebuilds a working document ----------
            pg.evaluate("""() => { const w=document.getElementById('appFrame').contentWindow;
                                   w.RSP.reload(); }""")
            pg.wait_for_timeout(7000)
            after = pg.evaluate("""() => {
              const f = document.getElementById('appFrame');
              const w = f && f.contentWindow, d = f && f.contentDocument;
              return { bodyLen: d && d.body ? d.body.innerHTML.length : 0,
                       hostname: w && w.location.hostname,
                       hasApp: !!(w && w.__rsApp),
                       kept: (() => { try { return w.localStorage.getItem('rsp-mount-probe'); }
                                      catch(e){ return 'ERR'; } })() };
            }""")
            res['afterRemount'] = after
            checks += [
                ('RSP.reload() re-mounts a live document', after['bodyLen'] > 100000),
                ('remounted frame keeps real hostname', after['hostname'] == 'localhost'),
                ('remounted app re-initialises', after['hasApp']),
                ('data survives remount', after['kept'] == 'kept'),
            ]

            res['pageErrors'] = errs[:5]
            # 'Invalid or unexpected token' pre-exists in the ORIGINAL upload.
            new_errs = [e for e in errs if 'Invalid or unexpected token' not in e]
            checks.append(('no new page errors', not new_errs))
            b.close()
    finally:
        srv.terminate()

    print(json.dumps(res, indent=2))
    print('\n' + '=' * 58)
    for name, ok in checks:
        print(('  PASS ' if ok else '  FAIL ') + name)
    npass = sum(1 for _, o in checks if o)
    print('=' * 58)
    print('  %d passed / %d failed' % (npass, len(checks) - npass))
    return 0 if npass == len(checks) else 1


if __name__ == '__main__':
    sys.exit(main())
