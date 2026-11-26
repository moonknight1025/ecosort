#!/usr/bin/env python3
"""Run real photographs through EcoSort's vision path and print the verdict.

This is the tool to use once ``GEMINI_API_KEY`` is configured: it answers the
question the unit tests cannot, namely "does Gemini actually recognise my
photos?".

Usage
-----
    python tests/live_vision_check.py photo1.jpg photo2.jpg
    python tests/live_vision_check.py --url http://127.0.0.1:5000 photo.jpg

Default mode drives the Flask test client in-process (no server needed). With
``--url`` it posts to a running server instead, which also exercises CORS,
rate limiting and the real socket path.

Exit code is 0 only when every image came back with ``analysis_mode: ai_vision``
- a fallback answer is reported as a failure, because that is the whole point of
running it.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}

FIELDS = (
    "analysis_mode",
    "item_name",
    "category",
    "bin_color",
    "confidence",
    "points",
    "ai_model",
)


def post_via_test_client(path: Path) -> dict:
    import app as app_module

    client = app_module.app.test_client()
    client.get("/")  # bootstrap
    with path.open("rb") as handle:
        response = client.post(
            "/api/identify",
            data={"image": (io.BytesIO(handle.read()), path.name)},
            content_type="multipart/form-data",
        )
    return {"status": response.status_code, "body": response.get_json()}


def post_via_http(path: Path, base_url: str) -> dict:
    boundary = "----EcoSortLiveCheck"
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
    ).encode()
    body += (
        f"Content-Type: {MIME_BY_SUFFIX.get(path.suffix.lower(), 'image/jpeg')}\r\n\r\n"
    ).encode()
    body += path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/identify",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            import json

            return {"status": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as error:
        import json

        try:
            body_json = json.load(error)
        except Exception:  # noqa: BLE001
            body_json = {"error": error.read().decode("utf-8", "replace")}
        return {"status": error.code, "body": body_json}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="+", type=Path, help="photo files to analyse")
    parser.add_argument("--url", help="POST to a running server instead of the test client")
    args = parser.parse_args()

    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        env_file = ROOT / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("GEMINI_API_KEY="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if value:
                        os.environ["GEMINI_API_KEY"] = value
                        break

    import vision

    status = vision.status()
    print(f"vision: enabled={status['enabled']} model={status['model']} "
          f"sdk={status['sdk_installed']}")
    if not status["enabled"]:
        print(
            "\nNo key visible to this process. Set GEMINI_API_KEY in the environment\n"
            f"or in {ROOT / '.env'} (the app loads that file at startup).",
            file=sys.stderr,
        )
        return 2

    failures = 0
    for path in args.images:
        if not path.exists():
            print(f"\n{path}: file not found", file=sys.stderr)
            failures += 1
            continue

        result = (
            post_via_http(path, args.url) if args.url else post_via_test_client(path)
        )
        body = result["body"] or {}
        print(f"\n{path.name}  (HTTP {result['status']})")
        for field in FIELDS:
            print(f"  {field:<14} {body.get(field)!r}")
        instructions = (body.get("instructions") or "").strip()
        if instructions:
            print(f"  instructions   {instructions[:160]}")

        if body.get("analysis_mode") != "ai_vision":
            failures += 1
            reason = body.get("vision_error") or "no vision answer"
            print(f"  RESULT         offline fallback - {reason}")

    print(f"\n{len(args.images) - failures}/{len(args.images)} analysed by AI vision")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
