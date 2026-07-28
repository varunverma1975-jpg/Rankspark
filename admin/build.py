#!/usr/bin/env python3
"""
Bundle the admin app into ONE self-contained HTML file.

Why: index.html uses ES modules (`import ./js/core.js`). Browsers apply CORS to
module scripts even on file:// (origin "null"), so double-clicking the file
gives a stuck boot screen and a console full of CORS errors. Verified.

This inlines the CSS and concatenates the three modules into a single classic
<script> so the result opens by double-click with no server at all.

The modular source stays the real codebase; this is a distribution artifact.

    python3 build.py     ->  rankspark-admin.html
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "rankspark-admin.html"


def read(p):
    return (ROOT / p).read_text(encoding="utf-8")


# Patterns kept as module constants so escaping is written once, correctly.
RE_DYN         = r"""import\(\s*['"][^'"]*core\.js['"]\s*\)\.then\(\s*(\w+)\s*=>"""
RE_BAD_DYN     = r"""import\(\s*['"]\."""
RE_IMPORT_FROM = r"""^[ \t]*import\s[\s\S]*?from\s*['"]\.[^'"]*['"]\s*;?"""
RE_IMPORT_BARE = r"""^[ \t]*import\s*['"]\.[^'"]*['"]\s*;?"""
RE_EXPORT_DECL = r"""^[ \t]*export\s+(?=(const|let|var|function|async|class)\b)"""
RE_EXPORT_LIST = r"""^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$"""
RE_LEFTOVER    = r"""from\s*['"]\."""

def strip_module_syntax(src, name):
    """Flatten an ES module into plain script body.

    Static imports of local modules are removed (everything shares one scope
    after bundling) and the single dynamic import of core.js is rewritten.
    Anything else is rejected loudly rather than silently mangled.
    """
    # import('./core.js').then(m => m.go(..)) exists only to reach go() without
    # a circular static import. After merging, go() is already in scope.
    src = re.sub(RE_DYN, r"Promise.resolve({go:go}).then(\1 =>", src)

    if re.search(RE_BAD_DYN, src):
        sys.exit("FATAL: %s has an unhandled dynamic local import" % name)

    # No trailing $ anchor: a multi-line destructured import ends mid-line
    # relative to its opening token, so anchoring to EOL leaves the tail.
    src = re.sub(RE_IMPORT_FROM, "", src, flags=re.M)
    src = re.sub(RE_IMPORT_BARE, "", src, flags=re.M)

    src = re.sub(RE_EXPORT_DECL, "", src, flags=re.M)
    src = re.sub(RE_EXPORT_LIST, "", src, flags=re.M)

    if re.search(r"^[ \t]*export\b", src, flags=re.M):
        sys.exit("FATAL: %s still has an unhandled export" % name)
    if re.search(RE_LEFTOVER, src):
        sys.exit("FATAL: %s still has a local import specifier" % name)
    return src

def main():
    html = read("index.html")
    css = read("css/admin.css")

    parts = []
    for f in ("js/core.js", "js/views-a.js", "js/views-b.js"):
        parts.append(f"/* ===== {f} ===== */\n" + strip_module_syntax(read(f), f))
    bundle = "\n\n".join(parts)

    # The page's own inline module becomes the last chunk of the same script.
    m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    if not m:
        sys.exit("FATAL: inline module script not found in index.html")
    boot = strip_module_syntax(m.group(1), "index.html inline")

    combined = (
        "<script>\n(function(){\n'use strict';\n"
        + bundle + "\n\n/* ===== boot ===== */\n" + boot
        + "\n})();\n</script>"
    )

    # ORDER MATTERS: m.start()/m.end() are offsets into the ORIGINAL html.
    # Inlining the CSS first shifts every later offset, so the slice below
    # would cut in the wrong place and leave the import statement behind.
    # Splice the script first, then inline the CSS.
    out = html[:m.start()] + combined + html[m.end():]
    out = out.replace('<link rel="stylesheet" href="css/admin.css">',
                      "<style>\n" + css + "\n</style>")

    # Guard: no stale relative references left behind.
    for ref in ('href="css/', 'src="js/', "from './"):
        if ref in out:
            sys.exit(f"FATAL: unresolved local reference {ref!r} in bundle")

    OUT.write_text(out, encoding="utf-8")
    print(f"wrote {OUT.name}  ({len(out):,} chars) — open by double-click, no server needed")


if __name__ == "__main__":
    main()
