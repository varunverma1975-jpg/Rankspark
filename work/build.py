#!/usr/bin/env python3
"""
Rebuild ranksparks.html with the RankSpark Premium system (Parts 1-3)
injected into the base64-embedded inner app.

  outer ranksparks.html
    └── <script>const APP_HTML_B64="..."</script>   <- inner app, 1.17 MB
          ├── </head>  <- inject CSS (part2.css + part3.css)
          └── </body>  <- inject JS  (part1 -> part2 -> part3, in order)
"""
import base64, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC_OUTER = ROOT.parent / "uploads" / "ranksparks.html"
OUT_OUTER = ROOT.parent / "ranksparks.html"
PARTS = ROOT / "parts"


def read(p):
    return pathlib.Path(p).read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# ORIGIN-PRESERVING MOUNT
#
# MEASURED PROBLEM (not theorised — see work/verify_origin.py):
#   The shell mounted the app with `frame.src = URL.createObjectURL(blob)`.
#   In a blob: document `location.hostname` is the empty string; in a srcdoc
#   document it is also "" and `origin` is "null". Firebase Auth compares
#   location.hostname against the project's Authorized-domains list, so
#   signInWithPopup() rejects with auth/unauthorized-domain every single time.
#   Control test, same config, same second:
#       http://localhost:8899        hostname "localhost" -> popup OPENS
#       blob:http://localhost:8899/… hostname ""          -> auth/unauthorized-domain
#   No Firebase Console setting can whitelist "", so "add your Vercel domain"
#   could never have fixed Google sign-in. The mount had to change.
#
# FIX: write the app into a same-origin iframe. It then reports the page's real
# hostname and auth works. Verified side effects:
#   • localStorage / IndexedDB are UNCHANGED — a blob: iframe already inherited
#     the parent origin's storage, so no user data migrates or is lost.
#   • classic <script> and <script type="module"> both still execute.
#   • relative URLs resolve against the real page instead of failing silently.
#   • no extra document fetch (unlike a ?rsapp=1 self-reload variant).
# ─────────────────────────────────────────────────────────────────────────────
MOUNT_OLD = """function mount(html){
  const frame = document.getElementById('appFrame');
  if(!frame) return;
  try{
    const blob = new Blob([html], {type:'text/html'});
    const url  = URL.createObjectURL(blob);
    frame.addEventListener('load', () => {
      /* Release the object URL once the document has taken ownership. */
      setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(_){} }, 4000);
    }, {once:true});
    frame.src = url;
  }catch(_){
    frame.srcdoc = html;
  }
}"""

MOUNT_NEW = """/* ══ ORIGIN-PRESERVING MOUNT ═══════════════════════════════════════════
   The app used to be mounted from a blob: URL. A blob: document reports
   location.hostname === "" (srcdoc reports "" / origin "null"), and Firebase
   Auth matches hostname against the Authorized-domains list — so Google
   sign-in failed with auth/unauthorized-domain on every load and no console
   setting could ever whitelist an empty hostname.

   Writing the document into a same-origin iframe gives the app the page's
   real hostname, so auth works once the deploy domain is authorized.
   Storage is unaffected: a blob: iframe already shared the parent origin's
   localStorage and IndexedDB, so nothing migrates and no user data is lost.
   ═══════════════════════════════════════════════════════════════════════ */
let __rsAppHTML = null;

function __rsWrite(frame, html){
  const doc = frame.contentDocument ||
              (frame.contentWindow && frame.contentWindow.document);
  if(!doc) throw new Error('iframe document unavailable');
  doc.open();
  doc.write(html);
  doc.close();
}

function mount(html){
  const frame = document.getElementById('appFrame');
  if(!frame) return;
  __rsAppHTML = html;
  try{
    __rsWrite(frame, html);
  }catch(_){
    /* Last-resort fallback. Auth stays broken here, but the app still runs —
       strictly better than a blank screen. */
    try{ frame.srcdoc = html; }catch(__){}
  }
}

/* location.reload() inside a written document navigates to a blank
   about:blank (verified), and Location.prototype.reload cannot be patched.
   The app calls this instead so "restart" genuinely restarts. */
window.__rsRemount = function(){
  const old = document.getElementById('appFrame');
  if(!old || !__rsAppHTML){ location.reload(); return; }
  const next = document.createElement('iframe');
  next.id = old.id;
  next.title = old.title || 'RankSpark App';
  old.replaceWith(next);
  try{ __rsWrite(next, __rsAppHTML); }
  catch(_){ try{ next.srcdoc = __rsAppHTML; }catch(__){} }
};"""

# Relative <script src> tags for files that were never shipped. Under blob:
# they failed silently; with a real origin restored they would become genuine
# 404s on every load. part7.js supersedes all three (it loads the Firebase SDK
# from an absolute gstatic URL, which is the only form that works here).
DEAD_SRC = [
    '<script src="firebase-config.js"></script>',
    '<script src="idb-cache.js"></script>',
    '<script type="module" src="firebase-adapter.js"></script>',
]


RUNTIME_CFG = """<script id="rsp-runtime-config">
/* Runtime configuration — the only place deployment values live.
   Firebase web keys identify the project and are safe in client code; the
   security boundary is Firestore rules, not key secrecy. */
window.RANKSPARK_FIREBASE_CONFIG = window.RANKSPARK_FIREBASE_CONFIG || {
  apiKey: "AIzaSyBbTKlc4A3gkRbG8xe6CAbZTHvnhr8hcww",
  authDomain: "sparkrank-9d990.firebaseapp.com",
  projectId: "sparkrank-9d990",
  storageBucket: "sparkrank-9d990.firebasestorage.app",
  messagingSenderId: "365829881540",
  appId: "1:365829881540:web:8e733c319c337b02981391",
  measurementId: "G-LH3WM3Q8XD"
};
/* Razorpay: public key_id only. The secret lives in a Vercel env var and is
   used exclusively by /api/razorpay/*. */
window.RANKSPARK_RAZORPAY = Object.assign(
  { keyId: "rzp_test_THqLxD5yExvZjw", apiBase: "/api/razorpay" },
  window.RANKSPARK_RAZORPAY || {});
/* Question packs. Swap `driver` to move backends with no code change:
     hf            Hugging Face dataset repo  (free, CORS+Range verified)
     r2            Cloudflare R2 / any CORS+Range bucket
     proxy         GitHub Releases behind /api/pack   (bandwidth-capped)
     github-split  <100MB parts on raw.githubusercontent
   For Hugging Face, set repoId and upload the ZIPs + manifest.json to it:
     { driver: "hf", repoId: "yourname/rankspark-packs", revision: "main" }
   Pin `revision` to a commit SHA for immutable releases.
   Left blank so the app stays on device-import until you publish a manifest. */
window.RANKSPARK_PACKS = Object.assign(
  { driver: "hf", repoId: "", revision: "main", repoType: "datasets",
    baseUrl: "", manifestUrl: "" },
  window.RANKSPARK_PACKS || {});
</script>
"""


def main():
    # The build injects into a pristine copy of the original app rather than
    # editing in place, which is what makes it idempotent. That copy is not
    # redistributed with the source bundle, so say plainly what is missing
    # instead of throwing a FileNotFoundError traceback.
    if not SRC_OUTER.exists():
        sys.exit(
            "FATAL: build input missing — %s\n"
            "  This is your ORIGINAL unmodified ranksparks.html.\n"
            "  Put it at uploads/ranksparks.html and re-run.\n"
            "  Rebuilding is only needed if you edit work/parts/*; the\n"
            "  already-built index.html / ranksparks.html work as they are."
            % SRC_OUTER)
    outer = read(SRC_OUTER)

    m = re.search(r'(const APP_HTML_B64=")([A-Za-z0-9+/=]+)(")', outer)
    if not m:
        sys.exit("FATAL: APP_HTML_B64 not found in outer shell")

    app = base64.b64decode(m.group(2)).decode("utf-8")
    print(f"inner app decoded: {len(app):,} chars")

    # ---- drop <script src> tags for files that do not exist --------------
    # Harmless under blob: (they could never resolve), but a real 404 once the
    # origin-preserving mount is in place. part7.js replaces all three.
    for tag in DEAD_SRC:
        n = app.count(tag)
        if n != 1:
            sys.exit(f"FATAL: expected exactly 1 of {tag!r}, found {n}")
        app = app.replace(tag, "<!-- removed: superseded by rsp-part-7 -->")
    print(f"removed {len(DEAD_SRC)} phantom <script src> tags")

    # ---- idempotency: strip any previous injection -----------------------
    app = re.sub(
        r"\n?<!-- RSP:BEGIN -->.*?<!-- RSP:END -->\n?",
        "\n",
        app,
        flags=re.S,
    )

    css = "\n".join([read(PARTS / "part2.css"), read(PARTS / "part3.css"),
                      read(PARTS / "part4.css"), read(PARTS / "part5.css"), read(PARTS / "part6.css"), read(PARTS / "part7.css"), read(PARTS / "part8.css")])
    js1 = read(PARTS / "part1.js")
    js2 = read(PARTS / "part2.js")
    js3 = read(PARTS / "part3.js")
    js4 = read(PARTS / "part4.js")
    js5 = read(PARTS / "part5.js")
    js6 = read(PARTS / "part6.js")
    js7 = read(PARTS / "part7.js")
    js8 = read(PARTS / "part8.js")
    js8b = read(PARTS / "part8b.js")
    js9 = read(PARTS / "part9.js")

    # Guard: a literal "</script>" inside JS strings would break the tag.
    for name, js in (("part1", js1), ("part2", js2), ("part3", js3), ("part4", js4), ("part5", js5), ("part6", js6), ("part7", js7), ("part8", js8), ("part8b", js8b), ("part9", js9)):
        if "</script" in js.lower():
            sys.exit(f"FATAL: {name}.js contains a literal </script>")

    css_block = (
        "<!-- RSP:BEGIN -->\n"
        + RUNTIME_CFG +
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        "<style id=\"rsp-styles\">\n" + css + "\n</style>\n"
        "<!-- RSP:END -->\n"
    )

    js_block = (
        "<!-- RSP:BEGIN -->\n"
        "<script id=\"rsp-part-1\">\n" + js1 + "\n</script>\n"
        "<script id=\"rsp-part-2\">\n" + js2 + "\n</script>\n"
        "<script id=\"rsp-part-3\">\n" + js3 + "\n</script>\n"
        "<script id=\"rsp-part-4\">\n" + js4 + "\n</script>\n"
        "<script id=\"rsp-part-5\">\n" + js5 + "\n</script>\n"
        "<script id=\"rsp-part-6\">\n" + js6 + "\n</script>\n"
        "<script id=\"rsp-part-7\" type=\"module\">\n" + js7 + "\n</script>\n"
        "<script id=\"rsp-part-8\">\n" + js8 + "\n</script>\n"
        "<script id=\"rsp-part-8b\">\n" + js8b + "\n</script>\n"
        "<script id=\"rsp-part-9\">\n" + js9 + "\n</script>\n"
        "<!-- RSP:END -->\n"
    )

    # ---- inject CSS before the DOCUMENT </head> --------------------------
    # NOTE: rfind() is wrong here. Paper Lab's print routine builds a whole
    # document inside a JS string literal ("...</head><body>..."), so the LAST
    # </head> sits inside JavaScript. Splicing there produces an unterminated
    # string ("Invalid or unexpected token"). The real head is the FIRST one,
    # and we assert it precedes <body> to be certain.
    i = app.find("</head>")
    body_at = app.find("<body")
    if i < 0:
        sys.exit("FATAL: no </head> in inner app")
    if not (0 < i < body_at):
        sys.exit(f"FATAL: </head>@{i} is not the document head (<body>@{body_at})")
    app = app[:i] + css_block + app[i:]

    # ---- inject JS before the DOCUMENT </body> ---------------------------
    # Here the last occurrence IS correct (the in-string one comes earlier),
    # but verify it is followed only by </html> and whitespace.
    j = app.rfind("</body>")
    if j < 0:
        sys.exit("FATAL: no </body> in inner app")
    tail = app[j:].replace("</body>", "", 1).strip()
    if tail not in ("</html>", "</html>\n", ""):
        sys.exit(f"FATAL: </body>@{j} is not the document body; tail={tail[:80]!r}")
    app = app[:j] + js_block + app[j:]

    print(f"inner app after inject: {len(app):,} chars (+{len(css)+len(js1)+len(js2)+len(js3)+len(js4)+len(js5)+len(js6)+len(js7)+len(js8)+len(js8b)+len(js9):,})")

    b64 = base64.b64encode(app.encode("utf-8")).decode("ascii")
    outer = outer[: m.start(2)] + b64 + outer[m.end(2) :]

    # ---- outer shell: origin-preserving mount ----------------------------
    # Must run on the OUTER shell (the mount function lives there, not in the
    # inner app). Asserted rather than best-effort: if the shell text ever
    # changes, fail the build instead of silently shipping broken auth.
    if MOUNT_NEW in outer:
        pass                                  # already applied (idempotent)
    elif MOUNT_OLD in outer:
        outer = outer.replace(MOUNT_OLD, MOUNT_NEW, 1)
        print("outer shell: blob: mount -> same-origin mount")
    else:
        sys.exit("FATAL: mount() in the outer shell does not match the "
                 "expected source; refusing to ship a blob: mount that "
                 "breaks Google sign-in")

    # ---- outer shell: wire the dead "Pricing" nav link -------------------
    outer = re.sub(
        r"\n?<!-- RSP-OUTER:BEGIN -->.*?<!-- RSP-OUTER:END -->\n?",
        "\n",
        outer,
        flags=re.S,
    )
    bridge = read(PARTS / "outer-bridge.js")
    if "</script" in bridge.lower():
        sys.exit("FATAL: outer-bridge.js contains a literal </script>")
    block = (
        "\n<!-- RSP-OUTER:BEGIN -->\n"
        "<script id=\"rsp-outer-bridge\">\n" + bridge + "\n</script>\n"
        "<!-- RSP-OUTER:END -->\n"
    )
    k = outer.rfind("</body>")
    if k < 0:
        sys.exit("FATAL: no </body> in outer shell")
    outer = outer[:k] + block + outer[k:]

    OUT_OUTER.write_text(outer, encoding="utf-8")
    print(f"wrote {OUT_OUTER}  ({len(outer):,} chars)")

    # Vercel serves the repo root as the site root, so a bare visit to
    # https://<app>.vercel.app/ needs index.html or it 404s. Written by the
    # build rather than copied by hand, so it can never drift from the app.
    (ROOT.parent / "index.html").write_text(outer, encoding="utf-8")
    print("wrote index.html (deploy entry point, identical to ranksparks.html)")

    # ---- also emit the standalone inner app for direct testing -----------
    (ROOT / "app.built.html").write_text(app, encoding="utf-8")
    print("wrote work/app.built.html (standalone inner app)")


if __name__ == "__main__":
    main()
