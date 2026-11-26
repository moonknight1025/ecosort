"""Dependency-free sliding-window rate limiting.

Deliberately in-process and small: EcoSort is a single-process Flask app with
SQLite, and pulling in Flask-Limiter/redis for a campus MVP would add deployment
requirements the PRD explicitly avoids. The trade-off is stated in AGENTS.md:
counters are per process, so running multiple workers multiplies the limit.

Buckets and their defaults (all overridable by environment variable):

================================  =======  ==================================
Bucket                            Default  Env var
================================  =======  ==================================
identify (image analysis)            20     RATE_LIMIT_IDENTIFY_PER_MIN
ai_vision (paid model calls)          8     RATE_LIMIT_AI_PER_MIN
general (user/dispose/challenge)     60     RATE_LIMIT_GENERAL_PER_MIN
================================  =======  ==================================

Kill switch: ``RATE_LIMIT_ENABLED=0`` disables all buckets (useful for load
tests). ``reset_rate_limits()`` clears state so an isolated test suite can prove
both the 200 path and the 429 path in one run.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60

DEFAULT_LIMITS: dict[str, int] = {
    "identify": 20,
    "ai_vision": 8,
    "general": 60,
}

_ENV_KEYS: dict[str, str] = {
    "identify": "RATE_LIMIT_IDENTIFY_PER_MIN",
    "ai_vision": "RATE_LIMIT_AI_PER_MIN",
    "general": "RATE_LIMIT_GENERAL_PER_MIN",
}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def configured_limits() -> dict[str, int]:
    """Current limits, re-read from the environment on every call."""
    return {
        bucket: _int_env(_ENV_KEYS[bucket], default)
        for bucket, default in DEFAULT_LIMITS.items()
    }


def is_enabled() -> bool:
    return (os.environ.get("RATE_LIMIT_ENABLED") or "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


class RateLimiter:
    """Sliding-window counters keyed by ``(bucket, client)``."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def hit(self, bucket: str, client: str) -> int | None:
        """Record one request.

        Returns ``None`` when the request is allowed, or the number of seconds
        the caller should wait before retrying.
        """
        if not is_enabled():
            return None

        limits = configured_limits()
        limit = limits.get(bucket)
        if limit is None or limit <= 0:
            return None

        now = time.monotonic()
        cutoff = now - WINDOW_SECONDS
        key = (bucket, client)

        with self._lock:
            window = self._hits[key]
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= limit:
                retry_after = max(1, int(round(window[0] + WINDOW_SECONDS - now)))
                return retry_after
            window.append(now)
        return None

    def snapshot(self) -> dict[str, int]:
        """Current per-bucket counts, used by tests and diagnostics."""
        now = time.monotonic()
        cutoff = now - WINDOW_SECONDS
        counts: dict[str, int] = defaultdict(int)
        with self._lock:
            for (bucket, _client), window in self._hits.items():
                counts[bucket] += sum(1 for stamp in window if stamp > cutoff)
        return dict(counts)


limiter = RateLimiter()


def reset_rate_limits() -> None:
    """Clear all counters — the hook automated tests call between scenarios."""
    limiter.reset()


def client_key(remote_addr: str | None, explicit: str | None = None) -> str:
    """Identify a caller. An explicit header wins so tests and multi-tab demos
    can be separated; otherwise the peer address is used."""
    if explicit and explicit.strip():
        return explicit.strip()[:64]
    return (remote_addr or "anonymous").strip()[:64]
