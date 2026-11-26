"""AI vision analysis for EcoSort, backed by Google Gemini.

Contract with the rest of the app:

* **Optional.** No ``GEMINI_API_KEY`` means no SDK client, no network call and no
  import-time work; :func:`enabled` is false and the caller uses the
  deterministic classifier with ``analysis_mode="offline_fallback"``.
* **Structured, not parsed by hand.** The SDK is asked for
  ``response_mime_type="application/json"`` with a Pydantic ``response_schema``,
  so the reply is validated by the library before we ever see it.
* **Bounded and honest.** Every failure (timeout, HTTP error, refusal, schema
  mismatch, category outside the five streams) raises :class:`VisionError`. The
  caller falls back to rules and reports why. Nothing is guessed or invented when
  vision is unavailable.
* **Keys from the environment only.** ``GEMINI_API_KEY`` (or the SDK's own
  ``GOOGLE_API_KEY``) is read per call; it is never logged, stored or returned.

Environment variables:

======================  =====================================================
GEMINI_API_KEY          API key. Unset => offline fallback (no fake AI labels)
GEMINI_MODEL            default ``gemini-2.5-flash``
GEMINI_TIMEOUT_SECONDS  default ``20``
======================  =====================================================
"""

from __future__ import annotations

import os
from typing import Any

try:  # The SDK is optional at runtime: the app must import without it.
    from google import genai
    from google.genai import types
    from pydantic import BaseModel, Field

    GENAI_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only without the dependency
    genai = None  # type: ignore[assignment]
    types = None  # type: ignore[assignment]
    BaseModel = object  # type: ignore[assignment,misc]
    Field = None  # type: ignore[assignment]
    GENAI_AVAILABLE = False

DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_IMAGE_BYTES = 6 * 1024 * 1024

ALLOWED_CATEGORIES: tuple[str, ...] = (
    "Wet Waste",
    "Recyclable Waste",
    "Dry Waste",
    "E-Waste",
    "Hazardous Waste",
)

# Canonical category -> bin colour. `verify_api.py` asserts this matches
# app.BIN_META so the two cannot drift.
BIN_COLOR_BY_CATEGORY: dict[str, str] = {
    "Wet Waste": "Green",
    "Recyclable Waste": "Blue",
    "Dry Waste": "Gray",
    "E-Waste": "Purple",
    "Hazardous Waste": "Red",
}

CONFIDENCE_LEVELS: tuple[str, ...] = ("High", "Medium", "Low")

if GENAI_AVAILABLE:

    class WasteAnalysis(BaseModel):
        """Strict response schema handed to Gemini."""

        item_name: str = Field(
            description="Short name of the primary waste object visible in the photo."
        )
        category: str = Field(
            description=(
                'Exactly one of: "Wet Waste", "Recyclable Waste", "Dry Waste", '
                '"E-Waste", "Hazardous Waste".'
            )
        )
        bin_color: str = Field(
            description='Bin colour for that category: "Green", "Blue", "Gray", '
            '"Purple" or "Red".'
        )
        confidence: str = Field(
            description='How sure you are: "High", "Medium" or "Low".'
        )
        instructions: str = Field(
            description=(
                "Concrete preparation steps for this exact item: empty/rinse, "
                "remove cap or label, flatten, tape battery terminals, e-waste or "
                "hazardous drop-off. One step per sentence."
            )
        )
        analysis_mode: str = Field(
            description='Always "ai_vision" - the answer comes from the image.'
        )

else:  # pragma: no cover
    WasteAnalysis = None  # type: ignore[assignment]

_PROMPT = """You are EcoSort's waste analyst. Inspect the attached photograph and
identify the primary waste item actually visible in it.

Rules:
- Describe what you see, not what a filename might suggest.
- Choose exactly one category: "Wet Waste" (food scraps, peels, compostable),
  "Recyclable Waste" (clean rigid plastic, bottles, cardboard, paper), "Dry Waste"
  (multi-layer wrappers, soiled tissue, non-recyclable), "E-Waste" (chargers,
  cables, phones, small electronics), "Hazardous Waste" (batteries, expired
  medicine, chemicals, sharps).
- bin_color must be Green for Wet, Blue for Recyclable, Gray for Dry, Purple for
  E-Waste, Red for Hazardous.
- instructions must be specific to this item and safe: rinse or empty food and
  liquid, remove caps/lids/tape, flatten cardboard, tape battery terminals, hand
  e-waste and hazardous items to a drop-off. Never suggest a general bin for a
  battery, medicine or chemical.
- If the photo shows no waste item, or is too blurry to judge, use category
  "Dry Waste" and confidence "Low".
- analysis_mode is always "ai_vision".
Answer with JSON only, matching the provided schema."""


class VisionError(Exception):
    """Any reason the vision answer is unavailable. Callers fall back to rules."""


def api_key() -> str:
    return (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or ""
    ).strip()


def model_name() -> str:
    return (os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL).strip()


def timeout_seconds() -> float:
    raw = os.environ.get("GEMINI_TIMEOUT_SECONDS")
    try:
        return float(raw) if raw else DEFAULT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def enabled() -> bool:
    """True only when the SDK is importable *and* a key is configured."""
    if not GENAI_AVAILABLE:
        return False
    return bool(api_key())


def status() -> dict:
    """Secret-free description for ``GET /api/capabilities``."""
    return {
        "enabled": enabled(),
        "provider": "google-genai" if GENAI_AVAILABLE else None,
        "model": model_name() if enabled() else None,
        "schema": "WasteAnalysis",
        "timeout_seconds": timeout_seconds(),
        "sdk_installed": GENAI_AVAILABLE,
    }


# --- SDK boundary -------------------------------------------------------
# Kept as module-level functions so tests can monkeypatch exactly one seam and
# still exercise the real argument wiring in `analyze_image`.


def _build_client(key: str) -> Any:
    """Create the Gemini client. Patched by tests; never called without a key."""
    http_options = None
    if types is not None and hasattr(types, "HttpOptions"):
        http_options = types.HttpOptions(timeout=int(timeout_seconds() * 1000))
    if http_options is not None:
        return genai.Client(api_key=key, http_options=http_options)
    return genai.Client(api_key=key)


def _generate(
    client: Any,
    image_bytes: bytes,
    mime_type: str,
) -> Any:
    """One multimodal call. Separate so a test can assert the exact wiring."""
    return client.models.generate_content(
        model=model_name(),
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            _PROMPT,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=WasteAnalysis,
            temperature=0,
        ),
    )


def _coerce_payload(response: Any) -> dict:
    """Read the structured answer, preferring the SDK-parsed object."""
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, dict):
        return parsed
    if parsed is not None and hasattr(parsed, "model_dump"):
        return parsed.model_dump()

    text = getattr(response, "text", None)
    if not text:
        raise VisionError("vision model returned no parsable content")
    import json

    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise VisionError(f"vision reply was not valid JSON ({error})") from None


def _validate(payload: dict) -> dict:
    """Reject anything outside the domain contract."""
    if not isinstance(payload, dict):
        raise VisionError("vision reply was not a JSON object")

    item_name = str(payload.get("item_name") or "").strip()
    if not item_name:
        raise VisionError("vision reply had no item_name")

    category = str(payload.get("category") or "").strip()
    if category not in ALLOWED_CATEGORIES:
        raise VisionError(f"vision returned an unknown category: {category!r}")

    bin_color = str(payload.get("bin_color") or "").strip()
    expected_color = BIN_COLOR_BY_CATEGORY[category]
    if bin_color != expected_color:
        # Trust the category, not a contradictory colour.
        bin_color = expected_color

    confidence = str(payload.get("confidence") or "").strip().title()
    if confidence not in CONFIDENCE_LEVELS:
        confidence = "Low"

    instructions = str(payload.get("instructions") or "").strip()
    if not instructions:
        raise VisionError("vision reply had no instructions")

    return {
        "item_name": item_name,
        "category": category,
        "bin_color": bin_color,
        "confidence": confidence,
        "instructions": instructions,
        "analysis_mode": "ai_vision",
    }


def analyze_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """Analyse real image bytes and return the validated schema.

    Raises :class:`VisionError` on every failure path; returning normally means
    the answer came from the model and passed validation.
    """
    if not enabled():
        raise VisionError("GEMINI_API_KEY is not configured")
    if not image_bytes:
        raise VisionError("no image bytes to analyse")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise VisionError(
            f"image is {len(image_bytes) // 1024} KB, above the "
            f"{MAX_IMAGE_BYTES // (1024 * 1024)} MB vision limit"
        )

    key = api_key()
    try:
        client = _build_client(key)
    except Exception as error:  # noqa: BLE001 - SDK construction can raise anything
        raise VisionError(f"could not create the vision client ({error})") from None

    try:
        response = _generate(client, image_bytes, mime_type)
    except Exception as error:  # noqa: BLE001 - network/timeouts/quota all land here
        raise VisionError(f"vision request failed ({type(error).__name__}: {error})") from None

    return _validate(_coerce_payload(response))
