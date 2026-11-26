# EcoSort — smart waste segregation for campuses

One repository, two applications that share one set of domain rules:

| Path | What it is | Stack |
| --- | --- | --- |
| `app.py`, `templates/`, `static/` | Server-rendered web app with a REST API, camera capture and SQLite | Python 3.10+, Flask 3.1+, SQLite |
| `ecosort_flutter/` | Mobile-first Flutter Web client (Material 3) with an offline mode | Dart 3.14 / Flutter 3.50, `material_ui`, `camera` |

Both classify waste into the same five streams, award the same points, evaluate
the same four badges, run the same 7-day challenge, and rank the same four
campuses. Product goal: make every piece of waste count.

## 1. Preview it in your browser (fastest path)

```bash
cd ecosort
python -m pip install -r requirements.txt      # Flask + Werkzeug only
python app.py                                   # -> http://127.0.0.1:5000
```

Open **http://127.0.0.1:5000** and:

1. Type a name, pick a campus, press **Set profile**.
2. **Start camera** → allow the permission prompt → **Capture Photo**, or press
   **Upload photo** / tap one of the six sample chips.
3. Read the disposal guide, then **Toss into Virtual Bin**.
4. Check **Badges & 7-Day** (claim a day for +15) and **Campus Rank**.

Camera needs a secure context: `http://127.0.0.1` and `http://localhost` count as
secure, a LAN IP (`http://192.168.x.x`) does **not** — the UI tells you and falls
back to upload/samples instead of failing silently.

### Flutter Web client, mobile viewport

```bash
cd ecosort_flutter
flutter pub get
flutter run -d chrome --web-browser-flag="--window-size=390,844"
```

Wide windows render a centred 430 px phone frame; narrow ones are full-bleed.
The client starts in **local mode** (no backend needed) — switch to the Flask
backend with the ⚙️ icon in the app bar. If a call fails it falls back to local
mode and says so.

## 2. AI vision (optional) and offline mode

`POST /api/identify` prefers a vision model and always has a deterministic
fallback. **No key = no behaviour change**: the rule engine answers and the UI
labels the result `Offline rules`.

```bash
cp .env.example .env
# then edit .env and set ECOSORT_AI_API_KEY=sk-...
python app.py
```

`.env` is parsed by a small stdlib loader in `app.py` (no `python-dotenv`), and
real environment variables always override the file. Any OpenAI-compatible
`/chat/completions` endpoint works:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ECOSORT_AI_API_KEY` | *(empty — vision off)* | API key, env only |
| `ECOSORT_AI_ENABLED` | `1` | `0` disables vision even with a key |
| `ECOSORT_AI_BASE_URL` | `https://api.openai.com/v1` | any compatible endpoint |
| `ECOSORT_AI_MODEL` | `gpt-4o-mini` | vision-capable model |
| `ECOSORT_AI_TIMEOUT_SECONDS` | `10` | hard timeout per call |

What the model returns is validated, never trusted blindly:

- category must be one of the five literal streams, otherwise the answer is
  rejected and rules answer instead;
- `points` suggested by the model are clamped to the catalog's range for that
  stream (Wet 10 · Recyclable 10–15 · Dry 10 · E-Waste 20–25 · Hazardous 25);
- preparation steps must be non-empty.

Every identify response says where it came from:

```json
{
  "display_name": "Crushed PET bottle",
  "category": "Recyclable Waste",
  "bin_color": "Blue",
  "points": 13,
  "source": "ai_vision",
  "confidence": 0.91,
  "preparation_steps": ["Empty and rinse", "Remove the cap", "Flatten it"],
  "why": "PET is a high-value rigid plastic.",
  "ai_model": "gpt-4o-mini",
  "vision_error": null,
  "fallback": false
}
```

On timeout, HTTP error, rate limit, unparseable JSON or unknown category the
same shape comes back with `"source": "rules"` and a human-readable
`vision_error` — never a 500. `GET /api/capabilities` reports whether AI is on
without exposing the key.

## 3. Rate limiting

Dependency-free sliding windows per client (`X-Client-Id` header if present,
otherwise the peer address) over a 60 s window:

| Bucket | Covers | Default | Env var |
| --- | --- | --- | --- |
| `identify` | `POST /api/identify` | 20/min | `RATE_LIMIT_IDENTIFY_PER_MIN` |
| `ai_vision` | paid model calls per client | 8/min | `RATE_LIMIT_AI_PER_MIN` |
| `general` | `/api/user`, `/api/dispose`, `/api/challenge/complete` | 60/min | `RATE_LIMIT_GENERAL_PER_MIN` |

Exceeding a limit returns `429` with a JSON body (`error`, `bucket`, `limit`,
`retry_after`) and a `Retry-After` header; the UI shows it in the toast and the
camera status line instead of crashing. `RATE_LIMIT_ENABLED=0` disables all
enforcement. When only the AI bucket is exhausted, the scan still succeeds with
a rules answer — you lose the model, not the feature.

Counters are per process: running multiple workers multiplies the effective
limit. That is the deliberate trade-off for shipping without Redis.

## 4. API

| Route | Purpose |
| --- | --- |
| `GET /` | the server-rendered app |
| `GET /api/capabilities` | AI/limit/category config, secret-free |
| `POST /api/user` | create/rehydrate a profile |
| `POST /api/identify` | classify a camera frame, upload or preset keyword |
| `POST /api/dispose` | log a disposal; points re-derived server-side, `client_token` idempotency |
| `POST /api/challenge/complete` | claim one challenge day, +15 exactly once |
| `GET /api/leaderboard` | top 10 users + campus totals |

`database.db` bootstraps itself on the first request: four tables, 13 catalog
items, 4 seeded campus users, 7 challenge days, all via `INSERT OR IGNORE`.
CORS is open so the Flutter client can call the API from another dev origin.

## 5. Tests

```bash
python tests/verify_api.py        # 16 checks, isolated temp database
cd ecosort_flutter
flutter analyze                   # clean
flutter test                      # 30 tests

# optional browser checks (drive the installed Chrome, ~1 min of setup)
cd tests/e2e && npm install
node flow.mjs                     # full demo + 375 px layout, 13 checks
node camera.mjs                   # live camera, fallbacks, 429, 12 checks
```

`tests/e2e/*.mjs` use `playwright-core` against the **installed** Chrome, so no
browser is downloaded and nothing is added to the app. `camera.mjs` uses
Chrome's fake capture device, so it works without a webcam.
`.github/workflows/ci.yml` runs the API suite plus `flutter analyze` and
`flutter test` on every PR.

### Keeping the two apps in sync

These literals exist twice (Python and Dart) and must stay identical:

| Flask | Flutter |
| --- | --- |
| `BIN_META` | `lib/models/waste_category.dart` |
| `CATALOG_SEED` / `CATALOG_ALIASES` | `lib/data/waste_catalog.dart` |
| `CHALLENGE_TASKS`, `CHALLENGE_REWARD` | `lib/data/challenge_catalog.dart` |
| `BADGES` | `lib/data/gamification.dart` |
| `CAMPUSES` | `lib/models/user_profile.dart` |
| `classify_waste()` | `lib/data/classifier.dart` |

Both use the same token-first matching rule (a keyword matches a whole token, or
a substring only when it is at least 5 characters), which is what keeps the
3-character `med` keyword from firing on `media_player.png`.

## 6. Status

| Milestone | State |
| --- | --- |
| M1 scaffold + SQLite bootstrap + shell | done |
| M2 profiles + deterministic classifier | done |
| M3 disposal + virtual bins | done |
| M4 badges, challenge, leaderboards | done |
| M5 automated API suite + browser E2E | done |
| Flutter Web client | done |
| Camera capture + AI vision + rate limiting | done (this release) |

Still open: no `LICENSE` file (a Product Owner decision). No auth: any client can
act as any user, and the leaderboard is not evidence of real behaviour.
