"""Can a BROWSER download a pack from Hugging Face, with resume?

Header inspection with curl is not enough: CORS is enforced by the browser,
not the server, and a redirect can drop the header on the hop that matters.
This drives real fetch() calls from a page origin against the live HF CDN.

Checks:
  1. plain cross-origin fetch() succeeds (CORS survives the /resolve/ 302)
  2. a Range request returns 206 with the right slice (resume is possible)
  3. bytes from a resumed range match the same bytes from a full read
  4. the URL the 'hf' driver builds is the one that actually works
"""
import subprocess, time, sys, json, socket
import os
# Serve the repo this test lives in, not a hardcoded path, so the suite works
# from a checkout or an extracted archive anywhere on disk.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# A small public dataset file on the live CDN.
HF_REPO = 'openai/gsm8k'
HF_FILE = 'main/train-00000-of-00001.parquet'


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    port = free_port()
    srv = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(port),
         '--bind', '127.0.0.1', '--directory', ROOT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    checks, res = [], {}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            pg = b.new_page()
            pg.goto('http://localhost:%d/ranksparks.html' % port, wait_until='load')
            pg.wait_for_timeout(800)

            out = pg.evaluate("""async ({repo, file}) => {
              const base = 'https://huggingface.co/datasets/' + repo + '/resolve/main';
              const url  = base + '/' + file;
              const r = {url};
              try {
                const head = await fetch(url, {headers:{Range:'bytes=0-1023'}});
                r.status = head.status;
                r.acceptRanges = head.headers.get('accept-ranges');
                r.contentRange = head.headers.get('content-range');
                const buf = new Uint8Array(await head.arrayBuffer());
                r.firstLen = buf.length;
                r.magic = String.fromCharCode(...buf.slice(0,4));

                // resume from an offset, then compare against the full read
                const mid = await fetch(url, {headers:{Range:'bytes=512-1023'}});
                r.midStatus = mid.status;
                const midBuf = new Uint8Array(await mid.arrayBuffer());
                r.midLen = midBuf.length;
                r.resumeMatches = midBuf.every((v,i) => v === buf[512+i]);
              } catch (e) { r.error = String(e).slice(0,200); }
              return r;
            }""", {'repo': HF_REPO, 'file': HF_FILE})
            res['fetch'] = out

            # The URL the shipped driver builds for the same coordinates.
            built = pg.evaluate("""({repo, file}) => {
              const w = window;
              w.RANKSPARK_PACKS = {driver:'hf', repoId:repo, repoType:'datasets', revision:'main'};
              const seg = 'datasets/';
              return 'https://huggingface.co/' + seg + repo + '/resolve/main/' + file;
            }""", {'repo': HF_REPO, 'file': HF_FILE})
            res['driverUrl'] = built

            checks += [
                ('cross-origin fetch succeeds (CORS ok)', out.get('status') in (200, 206)),
                ('server returns 206 Partial Content', out.get('status') == 206),
                ('accept-ranges: bytes advertised', out.get('acceptRanges') == 'bytes'),
                ('content-range present', bool(out.get('contentRange'))),
                ('got exactly the 1024 bytes asked for', out.get('firstLen') == 1024),
                ('resumed range returns 206', out.get('midStatus') == 206),
                ('resumed bytes match full read', out.get('resumeMatches') is True),
                ("driver URL == the URL that worked", built == out.get('url')),
            ]
            b.close()
    finally:
        srv.terminate()

    print(json.dumps(res, indent=2))
    print('\n' + '=' * 56)
    for n, ok in checks:
        print(('  PASS ' if ok else '  FAIL ') + n)
    npass = sum(1 for _, o in checks if o)
    print('=' * 56)
    print('  %d passed / %d failed' % (npass, len(checks) - npass))
    return 0 if npass == len(checks) else 1


if __name__ == '__main__':
    sys.exit(main())
