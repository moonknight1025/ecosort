# AGENTS.md — EcoSort operating rules

Instructions for any coding agent working in this repository. Read this file
before your first edit; it narrows what the PRD allows and records what is
already built.

Status: current · Owner: Pi Agent · Milestone: M1-M5 complete; camera + AI vision + rate limiting shipped.

## 1. What this project is

EcoSort is a mobile-first, gamified waste-classification web app: scan or pick
an item, get disposal guidance, toss it into a virtual bin, earn Eco Points,
unlock badges, complete a 7-day challenge, and climb individual/campus
leaderboards.

Stack, fixed by the PRD: Python 3.10+ · Flask 3.1+ · Werkzeug · SQLite
(`database.db`) · semantic HTML5 · responsive CSS3 · vanilla ES6+ JS.

## 2. Mode of operation

1. **One milestone at a time, in order.** M1 scaffold → M2 identification →
   M3 disposal/bins → M4 gamification/leaderboards → M5 tests/polish. Do not
   polish UI while an earlier gate is unverified.
2. **Verify before you claim.** Every milestone ends with a command whose real
   output you paste into the commit or PR. Never report "done" from reading
   code. If a check cannot run, say which one and why.
3. **Build surgically.** Smallest change that satisfies the current milestone.
   No ORM, no bundler, no CSS framework, no extra service, no build step.
4. **Offline-first.** Zero external APIs, zero cloud DB, zero OAuth. The
   classifier is deterministic substring matching over `waste_catalog` so a
   vision model can replace it later without touching routes.
5. **One source of truth for domain literals.** Categories, bin colours, point
   values, badges and challenge tasks are declared once in `app.py`
   (`BIN_META`, `CATALOG_SEED`, `BADGES`, `CHALLENGE_TASKS`) and handed to the
   frontend as JSON (`#domain-config`). Never re-type these strings in HTML,
   CSS or JS.

## 3. Permission boundaries

Allowed without asking:

- Reading and editing files inside this repository.
- Creating a virtualenv and installing exactly `requirements.txt`.
- Running the app locally (`python app.py`), the Flask test client, and
  `python tests/verify_api.py`.
- Inspecting `database.db` schema and rows; deleting the local `database.db`
  to prove bootstrap idempotency.

Requires explicit human approval:

- Adding any third-party package beyond Flask/Werkzeug.
- Committing API keys, tokens or secrets.
- Destructive commands outside this repository.
- **Pushing to the remote or opening GitHub issues/PRs** (see section 7).
- Deploying anywhere.

## 4. Canonical domain rules

Categories and bins — exact literals:

| Category | Bin colour | Base points |
| --- | --- | --- |
| `Wet Waste` | Green | 10 |
| `Recyclable Waste` | Blue | 10–15 |
| `Dry Waste` | Gray | 10 (also the fallback) |
| `E-Waste` | Purple | 20–25 |
| `Hazardous Waste` | Red | 25 |

Campuses: `North Campus`, `South Hostel`, `Science Block`, `Main Campus`.

Scoring: each disposal adds the catalog item's points; each first-time claim of
a challenge day adds `+15`. Badges are computed from `disposal_logs` and
`users.eco_points`, never stored as a flag.

The classifier's matching rule is **token-first** (`_match_score` in `app.py`): a
keyword matches only as a whole token, or as a substring once the keyword is at
least `MIN_SUBSTRING_KEYWORD_LENGTH` (5) characters. That is what stops the
3-character `med` keyword from firing on `media_player.png`. Want a new everyday
word (`medicine`, `laptop`, `earbuds`)? Add it to `CATALOG_ALIASES`, not to
`CATALOG_SEED` — aliases keep the 13-row contract intact. Do not "simplify" the
classifier back to a bare substring search; the regression cases are recorded in
the PR #6 review comment.

## 5. Schema (four tables, do not add a fifth)

- `users(id, username UNIQUE, campus, eco_points, streak_days)`
- `waste_catalog(id, keyword UNIQUE, display_name, category, bin_color, instructions, points)`
- `disposal_logs(id, user_id, item_name, category, points_earned, timestamp)`
- `user_challenges(id, user_id, day_number, completed, UNIQUE(user_id, day_number))`

Bootstrap is idempotent by construction: `CREATE TABLE IF NOT EXISTS` plus
`INSERT OR IGNORE` against those UNIQUE constraints. `init_db()` runs on import,
so both `python app.py` and `flask --app app run` seed identically. Never add a
seed that needs a manual `DELETE` before it can run twice.

## 6. Commands

```bash
# dependencies (already satisfied by the system interpreter in this checkout)
python -m pip install -r requirements.txt

# run the app (bootstraps database.db and static/uploads/)
python app.py                       # http://127.0.0.1:5000

# automated API verification (11 checks, isolated temp database)
python tests/verify_api.py
```

## 7. Milestones and gates

| Milestone | Scope | Gate |
| --- | --- | --- |
| **M1 — done** | scaffold, SQLite bootstrap, seed data, 3-tab shell | `GET /` = 200; 13 catalog rows + 4 users after two boots |
| **M2 — done** | `/api/user`, `/api/identify`, `classify_waste()`, scan UI | preset/upload/fallback classification < 300 ms |
| **M3 — done** | `/api/dispose` (server-derived points, `client_token`), bins + toasts | log row + score + bin count persist across reload |
| **M4 — done** | badges, `/api/challenge/complete`, `/api/leaderboard` | badge unlock, +15 once, campus totals |
| **M5 — done** | `tests/verify_api.py` (11 checks), browser E2E at 375 px, CI | all checks pass, no horizontal overflow |

Milestone drafts ready to become GitHub issues live in
`docs/planning/milestones.md`. **Do not** open issues, push branches or open
PRs without human approval — the remote is `moonknight1025/ecosort` and the
`gh` CLI is currently unauthenticated.

## 8. Implemented API surface

| Route | Body | Returns |
| --- | --- | --- |
| `GET /` | — | the single-page shell |
| `POST /api/user` | `{username, campus}` | `{user, badges, challenges, bin_counts}` |
| `POST /api/identify` | multipart `image` and/or `preset_keyword` | `{display_name, category, bin_color, instructions, points, matched_keyword, fallback, image_url}` |

| `POST /api/dispose` | `{user_id, item_name, client_token?}` | `{new_points, badges, bin_counts, logged, duplicate}` |
| `POST /api/challenge/complete` | `{user_id, day_number}` | `{new_points, challenges, awarded, awarded_points}` |
| `GET /api/leaderboard` | — | `{users[up to 10], campuses[]}` |

All six PRD routes exist. `POST /api/dispose` deliberately **ignores** the
contract's `category`/`points` fields and re-derives both through
`classify_waste()`; `client_token` (generated when absent) plus the partial
unique index `idx_disposal_token` makes a retry a no-op instead of a double
credit. The challenge claim is one conditional `UPDATE ... AND completed = 0`
with a `rowcount` check, so a double click returns +0 rather than a 500.

There is no auth, so any client can act as any user — accepted V1 risk.
CORS is wide open (`Access-Control-Allow-Origin: *`) so the Flutter Web client
can call the API from a different dev origin. Tighten both before real use.

`classify_waste(keyword_text, image_path=None)` is the only place waste is
classified. Replace its body with a vision call later; do not move matching
into a route.

## 9. Known gaps at M2 (honest status)

- No authentication (out of scope in the PRD). Any client can act as any user,
  and `/api/user` lets a caller move an existing username to another campus.
  Do not treat the leaderboard as evidence of real behaviour.
- `streak_days` exists in the `users` table but is never written and is no
  longer returned by `/api/user`. Implement it or drop the column.
- Uploads are extension-checked, not content-checked, and re-uploading the
  same sanitized name overwrites the previous file. Non-ASCII names fall back
  to `upload_<hex8><ext>`.
- `tests/verify_api.py` covers the API only. The browser flow was verified with
  a Playwright script against installed Chrome (13 checks at 375x812, zero
  console errors); that script is **not** in the repo and is not run by CI.
- The Flutter client's backend mode now has all five routes to call, but its
  end-to-end path is exercised by `flutter test` in local mode only — a
  Flutter web canvas app cannot be asserted through the DOM.
- No `LICENSE` file yet. Choosing one is the Product Owner's call.
- `database.db` and `static/uploads/*` are gitignored generated state, not
  source.

## 10. The Flutter client (`ecosort_flutter/`)

A second application lives in this repository: a Flutter Web client that
implements the same product against the same domain rules.

```bash
cd ecosort_flutter
flutter pub get
flutter analyze        # must stay at "No issues found"
flutter test           # 26 tests, must stay green
flutter run -d chrome
flutter build web --release
```

Rules for this tree:

- `package:material_ui/material_ui.dart`, **not** `package:flutter/material.dart`
  (deprecated after Flutter 3.47; using the old import fails `flutter analyze`).
- Domain literals are duplicated from `app.py` by necessity. `README.md` has the
  file-to-file map; change both sides in the same commit and re-run both suites.
- The classifier in `lib/data/classifier.dart` must keep the same token-first
  rule as `classify_waste()`, including `CATALOG_ALIASES`.
- Never `Size.fromHeight(...)` in a shared button style: it is an infinite
  minimum width and throws inside a `Row`.
- Widget tests set a phone viewport (`usePhoneViewport`) because a `ListView`
  inside the default 800x600 test surface never builds its off-screen children.
- Uploads are classified from the file name; no pixel analysis, no vision API.

## 11. Camera, AI vision and rate limiting

Three subsystems that all follow one rule: **the feature degrades, the app does
not**.

### Camera (`static/js/app.js`, `ecosort_flutter/lib/screens/scan_tab.dart`)

- Live preview is `getUserMedia({ facingMode: { ideal: 'environment' } })` in the
  browser and the `camera` plugin in Flutter. Both expose Capture / Switch /
  Stop (Flutter also has Retake via the preview).
- Every failure path must stay usable: permission denied, no device, device busy,
  insecure origin (anything but `localhost`/`127.0.0.1` over http), and the
  `capture="environment"` file input all fall back to upload + the six presets.
  Never let a camera error remove the upload path.
- A capture is one JPEG frame, sent as multipart `image`. Nothing is recorded,
  stored or streamed anywhere else.

### AI vision (`vision.py`, `analyze_waste()` in `app.py`)

- No key means no network call and no import-time work. `vision.enabled()` is
  evaluated per request, so `RATE_LIMIT_*`/`ECOSORT_AI_*` changes apply live.
- The model answer is **untrusted input**: `vision._validate()` checks it, and
  `analyze_waste()` re-checks category + steps at the boundary. An unknown
  category is a rejected answer, not a new stream.
- Points from the model are clamped to the catalog range for that stream
  (`category_point_bounds()`), so the model can never mint points.
- Failures (timeout, HTTP error, bad JSON, unknown category, analyser crash) fall
  back to `classify_waste()` and surface `vision_error`. A scan must answer 200
  with rules rather than 500.
- Every identify response carries `source` (`ai_vision` | `rules`),
  `confidence`, `preparation_steps`, `why`, `ai_model`, `vision_error`,
  `vision_available`. The UI must render the provenance, not hide it.

### Rate limiting (`rate_limit.py`)

- In-process sliding windows, no dependency. Buckets: `identify`, `ai_vision`,
  `general`; configured by `RATE_LIMIT_*_PER_MIN`; `RATE_LIMIT_ENABLED=0` kills
  enforcement.
- Over the limit returns `429` + JSON (`error`, `bucket`, `limit`,
  `retry_after`) + a `Retry-After` header. The UI shows it as a toast, never an
  exception.
- Exhausting the **AI** bucket is not a 429 for the scan: it degrades that one
  request to rules so the user still gets guidance. Never let a paid-call guard
  break the free path.
- Counters are per process; multiple workers multiply the limit. Documented, not
  hidden.
- `rate_limit.reset_rate_limits()` exists so `tests/verify_api.py` can prove both
  the 200 and the 429 path in one run. Any test that touches identify must pin
  `RATE_LIMIT_IDENTIFY_PER_MIN` first.

### Configuration

`.env` is parsed by `_load_dotenv()` in `app.py` (stdlib, no python-dotenv);
real environment variables win. Never commit `.env`; keep `.env.example` current.

## 12. Style

- Python: 4-space indent, typed public helpers, docstrings that state why.
- Every mutation route validates input and returns JSON errors, never HTML.
- Never `except: pass`; if a fallback is intentional (unmatched upload → Dry
  Waste), name it in a comment and in the API response.
- JS: `const`/`let`, early returns, no inline handlers, no globals beyond
  `state`/`DOMAIN`.
- CSS: mobile-first; the 375 px breakpoint at `max-width: 500px` must stay
  clean with zero horizontal overflow.
