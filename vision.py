"""Optional AI vision analysis for EcoSort.

Design rules:

* **Never required.** No key configured means no import-time work, no network
  call, and the deterministic classifier answers instead. The app must behave
  identically offline.
* **No new dependency.** The call is a plain JSON POST over ``urllib`` to an
  OpenAI-compatible ``/chat/completions`` endpoint, so ``requirements.txt`` stays
  at Flask + Werkzeug and the offline test suite cannot break.
* **Bounded.** Every failure mode (timeout, HTTP error, unparseable body,
  category outside the five streams) raises :class:`VisionError`; the caller
  falls back to rules and reports why.
* **Keys from the environment only.** Nothing is ever written to disk or logged.

Environment variables:

===========================  ==========================================
ECOSORT_AI_API_KEY           API key; without it vision is disabled
ECOSORT_AI_BASE_URL          default ``https://api.openai.com/v1``
ECOSORT_AI_MODEL             default ``gpt-4o-mini``
ECOSORT_AI_TIMEOUT_SECONDS   default ``10``
===========================  ==========================================
"""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_TIMEOUT_SECONDS = 10.0

# The only categories the model may answer with. Anything else is a model error,
# not a new stream.
ALLOWED_CATEGORIES: tuple[str, ...] = (
    "Wet Waste",
    "Recyclable Waste",
    "Dry Waste",
    "E-Waste",
    "Hazardous Waste",
)

MAX_IMAGE_BYTES = 6 * 1024 * 1024

_SYSTEM_PROMPT = """You are EcoSort's waste-sorting analyst for an Indian campus.
Identify the single dominant waste item in the image and classify it into exactly
one of these categories (copy the literal string):
- "Wet Waste"        (food scraps, peels, compostable)
- "Recyclable Waste" (clean plastic bottles, rigid plastic, cardboard, paper)
- "Dry Waste"        (multi-layer wrappers, soiled tissue, non-recyclable)
- "E-Waste"          (chargers, cables, phones, small electronics)
- "Hazardous Waste"  (batteries, expired medicine, chemicals, sharps)

Reply with JSON only, no markdown, no prose outside the object:
{
  "item": "short human name of the item",
  "category": "<one of the five literals>",
  "confidence": 0.0-1.0,
  "is_single_item": true/false,
  "steps": ["specific preparation step", "..."],
  "why": "one sentence on why it belongs to that stream",
  "suggested_points": integer
}

Rules for the content:
- steps must be concrete and safe: rinse food or liquid, remove caps/lids/tape,
  flatten cardboard, tape battery terminals, hand e-waste to a drop-off, or say
  plainly why the item is not recyclable.
- never suggest putting a battery, medicine or chemical in a general bin.
- if the image shows no waste item or is unreadable, set confidence below 0.3
  and category "Dry Waste".
- suggested_points must sit inside the stream's usual range (Wet 10, Recyclable
  10-15, Dry 10, E-Waste 20-25, Hazardous 25)."""


class VisionError(Exception):
    """Any reason the AI answer is unavailable. Callers fall back to rules."""


def api_key() -> str:
    return (os.environ.get("ECOSORT_AI_API_KEY") or "").strip()


def base_url() -> str:
    return (os.environ.get("ECOSORT_AI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def model() -> str:
    return (os.environ.get("ECOSORT_AI_MODEL") or DEFAULT_MODEL).strip()


def timeout_seconds() -> float:
    raw = os.environ.get("ECOSORT_AI_TIMEOUT_SECONDS")
    try:
        return float(raw) if raw else DEFAULT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def enabled() -> bool:
    """Vision is available only when a key is configured and the toggle is on."""
    if (os.environ.get("ECOSORT_AI_ENABLED") or "1").strip().lower() in {"0", "false", "no"}:
        return False
    return bool(api_key())


def status() -> dict:
    """Small, secret-free description for ``GET /api/capabilities`` and the UI."""
    return {
        "enabled": enabled(),
        "model": model() if enabled() else None,
        "base_url": base_url() if enabled() else None,
        "timeout_seconds": timeout_seconds(),
    }


def _extract_json(text: str) -> dict:
    """Pull a JSON object out of a model reply that may be wrapped in prose."""
    text = (text or "").strip()
    if not text:
        raise VisionError("model returned an empty message")
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            raise VisionError("model reply contained no JSON object") from None
        try:
            parsed = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError as error:
            raise VisionError(f"model reply was not valid JSON ({error})") from None
    if not isinstance(parsed, dict):
        raise VisionError("model reply JSON was not an object")
    return parsed


def _validate(payload: dict) -> dict:
    category = str(payload.get("category") or "").strip()
    if category not in ALLOWED_CATEGORIES:
        raise VisionError(f"model returned an unknown category: {category!r}")

    item = str(payload.get("item") or "").strip() or "Unidentified item"

    try:
        confidence = float(payload.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    steps_raw = payload.get("steps")
    if isinstance(steps_raw, str):
        steps = [steps_raw]
    elif isinstance(steps_raw, list):
        steps = [str(step).strip() for step in steps_raw if str(step).strip()]
    else:
        steps = []
    if not steps:
        raise VisionError("model returned no preparation steps")

    why = str(payload.get("why") or "").strip()

    try:
        suggested_points = int(payload.get("suggested_points"))
    except (TypeError, ValueError):
        suggested_points = 0

    return {
        "item": item,
        "category": category,
        "confidence": round(confidence, 2),
        "steps": steps[:6],
        "why": why,
        "suggested_points": suggested_points,
    }


def analyze_image(
    image_bytes: bytes,
    media_type: str = "image/jpeg",
    *,
    timeout: float | None = None,
) -> dict:
    """Ask the vision model about one image.

    Returns a validated dict, or raises :class:`VisionError`. Never returns a
    partially-filled result, so callers can treat "no exception" as "trustworthy
    structured answer".
    """
    if not enabled():
        raise VisionError("AI vision is not configured")
    if not image_bytes:
        raise VisionError("no image bytes to analyse")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise VisionError(
            f"image is {len(image_bytes) // 1024} KB, above the "
            f"{MAX_IMAGE_BYTES // (1024 * 1024)} MB vision limit"
        )

    encoded = base64.b64encode(image_bytes).decode("ascii")
    body = {
        "model": model(),
        "temperature": 0,
        "max_tokens": 512,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Identify this waste item and return the JSON object.",
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{encoded}"},
                    },
                ],
            },
        ],
    }

    request = urllib.request.Request(
        f"{base_url()}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request, timeout=timeout or timeout_seconds()
        ) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = error.read().decode("utf-8", "replace")[:200]
        except Exception:  # noqa: BLE001 - diagnostics only
            detail = ""
        raise VisionError(f"vision API returned HTTP {error.code} {detail}".strip()) from None
    except urllib.error.URLError as error:
        raise VisionError(f"vision API unreachable ({error.reason})") from None
    except TimeoutError:
        raise VisionError("vision API timed out") from None
    except OSError as error:
        raise VisionError(f"vision API request failed ({error})") from None

    try:
        envelope = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise VisionError("vision API returned a non-JSON envelope") from None

    try:
        content = envelope["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise VisionError("vision API envelope had no message content") from None

    return _validate(_extract_json(content if isinstance(content, str) else str(content)))
