"""Does Google sign-in actually reach Google from the built ranksparks.html?

Regression guard for the origin-preserving mount. With the old blob:/srcdoc
mount, location.hostname === "" and Firebase rejects sign-in as
auth/unauthorized-domain before any network call is made. No Firebase Console
setting can whitelist an empty hostname, so this is the test that proves the
mount fix, not a configuration change, is what makes auth reachable.

PASS means: the app frame reports the real hostname AND a popup navigated to
Google's auth handler AND the promise is still pending (waiting on a human)
rather than instantly rejected.
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
    out = {}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context()
            pg = ctx.new_page()
            pops = []
            ctx.on('page', lambda pp: pops.append(pp.url[:110]))
            pg.goto('http://localhost:%d/ranksparks.html' % port, wait_until='load')
            pg.wait_for_timeout(1200)
            pg.evaluate("() => { if (typeof preloadApp === 'function') preloadApp(); }")
            pg.wait_for_timeout(7000)

            out['mount'] = pg.evaluate("""() => {
              const f = document.getElementById('appFrame'), w = f && f.contentWindow;
              return { hostname: w && w.location.hostname,
                       origin:   w && w.location.origin,
                       src:      f && f.getAttribute('src'),
                       fbEnabled: !!(w && w.rankSparkFirebase && w.rankSparkFirebase.enabled) };
            }""")

            # Fire-and-forget: awaiting would block until a human finishes the
            # Google form. pg.evaluate() awaits returned promises, so `void`.
            pg.evaluate("""() => {
              const w = document.getElementById('appFrame').contentWindow;
              w.__probe = { state: 'pending' };
              void w.rankSparkFirebase.signInWithGoogle()
                .then(() => { w.__probe = { state: 'resolved' }; })
                .catch(e => { w.__probe = { state: 'rejected', code: e && e.code,
                                            msg: (e && e.message || '').slice(0, 130) }; });
            }""")
            pg.wait_for_timeout(6000)
            out['probe'] = pg.evaluate(
                "() => document.getElementById('appFrame').contentWindow.__probe")
            out['popups'] = pops
            b.close()
    finally:
        srv.terminate()

    checks = [
        ('frame has a real hostname',
         out.get('mount', {}).get('hostname') == 'localhost'),
        ('firebase adapter enabled',
         out.get('mount', {}).get('fbEnabled') is True),
        ('not rejected as unauthorized-domain',
         out.get('probe', {}).get('code') != 'auth/unauthorized-domain'),
        ('sign-in pending on user, not failed',
         out.get('probe', {}).get('state') == 'pending'),
        ('popup reached Google auth handler',
         any('auth/handler' in u or 'accounts.google' in u
             for u in out.get('popups', []))),
    ]
    out['checks'] = {k: ('PASS' if v else 'FAIL') for k, v in checks}
    out['VERDICT'] = 'PASS' if all(v for _, v in checks) else 'FAIL'
    print(json.dumps(out, indent=2))
    return 0 if out['VERDICT'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
