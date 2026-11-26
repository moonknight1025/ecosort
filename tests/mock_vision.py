#!/usr/bin/env python3
"""Tiny OpenAI-compatible endpoint used to exercise the real vision HTTP path.

`tests/verify_api.py` stubs `vision.analyze_image` for speed, which leaves the
urllib request/response code itself untested. Point the app at this server to
cover it end to end:

    python tests/mock_vision.py &            # serves http://127.0.0.1:5099/v1
    ECOSORT_AI_API_KEY=test \\
    ECOSORT_AI_BASE_URL=http://127.0.0.1:5099/v1 \\
    python app.py &

Modes (``MOCK_VISION_MODE``):
  ok       valid JSON answer (default)
  wrapped  answer inside a ```json fence plus prose, exercising the extractor
  badjson  unparseable message content
  http500  the endpoint itself fails
  slow     sleeps past the client timeout

Every request is logged so a test can assert the image actually reached the wire.
"""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_VISION_PORT", "5099"))
MODE = os.environ.get("MOCK_VISION_MODE", "ok")

ANSWER = {
    "item": "Used alkaline battery",
    "category": "Hazardous Waste",
    "confidence": 0.93,
    "is_single_item": True,
    "steps": [
        "Tape both terminals with clear tape",
        "Keep it away from heat and water",
        "Drop it in the red hazardous-waste bin",
    ],
    "why": "Alkaline cells are hazardous and must not go in general waste.",
    "suggested_points": 25,
}

REQUEST_LOG: list[dict] = []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        return

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            request = {}

        messages = request.get("messages") or []
        has_image = any(
            isinstance(part, dict) and part.get("type") == "image_url"
            for message in messages
            for part in (message.get("content") or [])
            if isinstance(message, dict)
        )
        REQUEST_LOG.append(
            {
                "path": self.path,
                "authorized": bool(self.headers.get("Authorization")),
                "model": request.get("model"),
                "has_image": has_image,
                "bytes": length,
            }
        )

        if MODE == "http500":
            return self._send(500, {"error": "mock failure"})
        if MODE == "slow":
            time.sleep(15)
        if MODE == "badjson":
            content = "sorry, I cannot help with that"
        elif MODE == "wrapped":
            content = "Here is the analysis:\n```json\n" + json.dumps(ANSWER) + "\n```"
        else:
            content = json.dumps(ANSWER)

        return self._send(
            200,
            {"choices": [{"message": {"role": "assistant", "content": content}}]},
        )

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/_log":
            return self._send(200, {"requests": REQUEST_LOG})
        return self._send(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"mock vision on http://127.0.0.1:{PORT}/v1 (mode={MODE})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
