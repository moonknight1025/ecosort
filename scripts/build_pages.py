#!/usr/bin/env python3
"""Build the static Cloudflare Pages bundle in ``public/``.

The Flask app remains the source of truth for the rendered shell and the
domain config. This script renders ``/`` with an isolated temporary database,
rewrites Flask's ``/static/`` URLs to relative ``./static/`` URLs, injects the
static-mode flag, and copies the CSS/JS into ``public/``.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

sys.path.insert(0, str(ROOT))

import app as app_module  # noqa: E402  (needs sys.path first)


def main() -> int:
    workdir = pathlib.Path(tempfile.mkdtemp(prefix="ecosort-pages-"))
    app_module.DATABASE_PATH = str(workdir / "database.db")
    app_module.UPLOAD_DIR = str(workdir / "uploads")
    app_module._bootstrapped = False

    with app_module.app.test_client() as client:
        response = client.get("/")
    if response.status_code != 200:
        raise SystemExit(f"GET / returned {response.status_code}")

    html = response.data.decode("utf-8")
    html = html.replace('href="/static/', 'href="./static/')
    html = html.replace('src="/static/', 'src="./static/')

    app_script = '<script src="./static/js/app.js" defer></script>'
    if app_script not in html:
        raise SystemExit("could not find the app.js script tag in the rendered shell")
    html = html.replace(
        app_script,
        '<script>window.__ECOSORT_STATIC__ = true;</script>\n  ' + app_script,
        1,
    )

    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    (PUBLIC / "static" / "css").mkdir(parents=True)
    (PUBLIC / "static" / "js").mkdir(parents=True)

    (PUBLIC / "index.html").write_text(html, encoding="utf-8", newline="\n")
    shutil.copy2(ROOT / "static" / "css" / "style.css", PUBLIC / "static" / "css" / "style.css")
    shutil.copy2(ROOT / "static" / "js" / "app.js", PUBLIC / "static" / "js" / "app.js")
    (PUBLIC / "_headers").write_text(
        "/static/*\n  Cache-Control: public, max-age=31536000, immutable\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"wrote {PUBLIC / 'index.html'}")
    print(f"wrote {PUBLIC / 'static' / 'css' / 'style.css'}")
    print(f"wrote {PUBLIC / 'static' / 'js' / 'app.js'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
