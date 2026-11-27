# EcoSort — smart waste segregation for everyone

One repository, two applications that share one set of domain rules:

| Path | What it is | Stack |
| --- | --- | --- |
| `app.py`, `templates/`, `static/` | Server-rendered web app with a REST API, camera capture and SQLite | Python 3.10+, Flask 3.1+, SQLite |
| `ecosort_flutter/` | Mobile-first Flutter Web client (Material 3) with an offline mode | Dart 3.14 / Flutter 3.50, `material_ui`, `camera` |

Both classify waste into the same five streams, award the same points, evaluate
the same four badges, run the same 7-day challenge, and rank contributions by
**community / group** — with no campus assumption anywhere.

### Who it is for

Anyone: a single household, a family, a street or ward, an apartment society, a
workplace floor, a school club, or a whole city. A profile is a name plus a
free-text **community / group** and **city / region** (defaults:
`General Community` and `Local Area`). The five group presets are suggestions,
not a whitelist — type `My Flat 4B` and the standings will rank it.

The Flask UI uses a forest, moss and sage layout with two tabs:
**Scan & bin** and **Badges & 7-day** — the Flask screen intentionally has no
leaderboard. The API still exposes `/api/leaderboard` for other clients, and
the Flutter client can render the individual and community standings.

## Live Demo (Cloudflare Pages)

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Cloudflare%20Pages-F38020?logo=cloudflare)](https://ecosort.pages.dev)

**Static demo:** <https://ecosort.pages.dev>

> Replace `ecosort` with your Cloudflare Pages project name after the first
> deploy. The static build runs entirely in local demo mode: profile, scanning,
> category override, bins, badges, recent activity and the 7-day challenge work
> without a Python server. The full Flask app with SQLite, Gemini vision and
> server-side idempotency still runs at **http://127.0.0.1:5000**.

The Pages output is committed in `public/` with relative `./static/...` assets.
Regenerate it after UI changes:

```bash
python scripts/build_pages.py
npx wrangler pages deploy public --project-name ecosort
```

For the full backend locally:

```bash
python -m pip install -r requirements.txt
python app.py        # http://127.0.0.1:5000
```

## 1. Preview it in your browser (fastest path)

**One URL: http://127.0.0.1:5000.** The Flask app is the single web interface;
no second server or Flutter dev server is needed for normal preview.

```bash
cd ecosort
python -m pip install -r requirements.txt   # Flask, Werkzeug, google-genai
python app.py                                # -> http://127.0.0.1:5000
```

The layout is a forest/moss/sage interface: a single column on mobile with a
fixed bottom navigation bar (verified to 320px with zero horizontal overflow)
and a two-column capture card above 768px inside a 960px desktop shell.

Open **http://127.0.0.1:5000** and:

1. Fill **Eco-citizen**, choose a **Community hub** preset (or *Custom…*
   for free text), choose a **City / region** preset (or *Other / custom city*),
   then press **Apply**. The header shows the live Eco points balance and
   engine status; **Settings** reports the scan engine (**AI Vision: on/off**,
   model and provider), the active rate limits, falling-leaf motion,
   auto-read guidance, the current profile, and a **Reset local profile** action.
2. **Camera scan** → allow the permission prompt → **Capture frame**, or use
   **Upload photo**, or choose a **Quick-pick sample items** entry from the
   dropdown (choosing one scans it immediately) / tap one of the six chips.
3. Read the sorting guide. The result card shows an **AI Vision** or
   **Offline Rules** badge, a confidence band, numbered preparation steps, a
   **Prep check** mini-checklist, the regional note, and a **Category override**
   dropdown. Correct the stream if needed, then press **Toss into virtual bin**
   — the server still derives the points for the chosen stream.
   The card also has **Read aloud** and **Auto-read** controls. Auto-read is off
   by default; it speaks only the item name, category/bin, and preparation
   steps, never toasts, badges, challenge updates, the header, or profile text.
   **Read aloud** cancels any current speech and reads the visible guide; the
   same button becomes **Stop** while speaking.
4. The five **virtual target bins** update from the server's `bin_counts`;
   the **Recent sorting activity** strip keeps the latest session disposals.
   Badges unlock from the server's `badges` payload.
5. **Badges & 7-day** shows a sprint progress rail and filter
   (*All days / Pending only / Completed only*). Claim each day once for **+15**
   points; a second claim is disabled and the server returns `awarded: false`.
   The badge grid has an *All / Unlocked / Locked* status filter.

If the rate limiter answers **429**, the UI shows a friendly toast with the
retry window instead of failing silently or double-submitting. Camera needs a
secure context: `http://127.0.0.1` and `http://localhost` count as secure, a LAN
IP (`http://192.168.x.x`) does **not** — the UI tells you and falls back to
upload/samples instead of failing silently.

### Preview on your phone (same Wi-Fi)

```bash
# macOS/Linux
ECOSORT_HOST=0.0.0.0 python app.py
# Windows PowerShell
$env:ECOSORT_HOST="0.0.0.0"; python app.py
```

Find your computer's LAN IPv4 address (`ipconfig` on Windows, `ip addr` on
Linux/macOS) and open `http://<LAN-IP>:5000` on the phone. The profile, upload,
sample presets, bins, badges and challenge all work over plain HTTP. **Live
camera needs HTTPS**, so on a LAN IP the app shows the friendly camera fallback
and you use **Upload photo** / **Quick samples** instead.

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

## 2. AI vision with Google Gemini (optional) and offline mode

`POST /api/identify` sends the **actual image bytes** to Gemini through the
`google-genai` SDK (`client.models.generate_content` +
`types.Part.from_bytes`) and asks for a strict JSON answer via
`response_mime_type="application/json"` and a Pydantic `response_schema`.

```bash
cp .env.example .env
# edit .env, or simply export in your shell:
export GEMINI_API_KEY="your-key-from-aistudio.google.com/apikey"
python app.py
```

Get a key at <https://aistudio.google.com/apikey>.

**Model names churn.** `gemini-2.5-flash` now answers `404 no longer available to
new users`; on a free-tier key the `gemini-3.x`/`gemini-4.x` premium flash models
returned `503`/`429` while **`gemini-3.5-flash-lite` answered correctly**. The
default reflects what actually worked, not what was newest. If your key behaves
differently, set `GEMINI_MODEL` and confirm with:

```bash
python tests/live_vision_check.py path/to/photo.jpg   # prints the real AI answer
``` `.env` is parsed by a small
stdlib loader in `app.py` (no `python-dotenv`), and real environment variables
always override the file.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | *(unset — vision off)* | API key, env only |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | any vision-capable Gemini model that your key can actually use |
| `GEMINI_TIMEOUT_SECONDS` | `20` | hard per-request timeout |

**No key means no fake labels.** Without a key the app never contacts Google,
never constructs a client, and answers from the deterministic classifier with
`analysis_mode: "offline_fallback"` and `confidence: null`.

The model is asked for exactly this schema:

| Field | Example |
| --- | --- |
| `item_name` | `Crushed PET Water Bottle` |
| `category` | one of the five literals |
| `bin_color` | `Green` / `Blue` / `Gray` / `Purple` / `Red` |
| `confidence` | `High` / `Medium` / `Low` |
| `instructions` | concrete preparation steps for that item |
| `analysis_mode` | `ai_vision` |

`app.py` maps that onto the API contract and still owns the scoring:

```json
{
  "item_name": "Crushed PET Water Bottle",
  "display_name": "Crushed PET Water Bottle",
  "category": "Recyclable Waste",
  "bin_color": "Blue",
  "confidence": "High",
  "instructions": "Empty and rinse the bottle. Remove the cap. Flatten it.",
  "preparation_steps": ["Empty and rinse the bottle.", "Remove the cap.", "Flatten it."],
  "points": 15,
  "analysis_mode": "ai_vision",
  "source": "ai_vision",
  "ai_model": "gemini-3.5-flash-lite",
  "vision_provider": "google-genai",
  "vision_error": null,
  "local_note": "Rules vary by municipality — check your local waste collection guidance...",
  "fallback": false
}
```

- `points` are **derived server-side** from the category's catalog range; the
  model cannot mint them, and `/api/dispose` re-derives again.
- A category outside the five literals, a contradictory bin colour, empty
  instructions or a malformed reply is rejected — the span falls back to rules.
- `source` is kept as an alias of `analysis_mode` for older clients.
- `vision_error` explains any fallback (missing key, timeout, quota, schema
  mismatch). `GET /api/capabilities` reports `enabled`, `provider`, `model`,
  `schema` and `sdk_installed` without exposing the key.

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
| `POST /api/identify` | Gemini vision on the uploaded image, or the deterministic fallback |
| `POST /api/dispose` | log a disposal; points re-derived server-side, `client_token` idempotency |
| `POST /api/challenge/complete` | claim one challenge day, +15 exactly once |
| `GET /api/leaderboard` | top 10 contributors + group/community totals |

`database.db` bootstraps itself on the first request: four tables, 13 catalog
items, 4 seeded demo users across different groups and cities, 7 challenge days,
all via `INSERT OR IGNORE`. CORS is open so the Flutter client can call the API
from another dev origin.

### Upgrading an existing database

Migrations are additive and run before any index is created, so an older
`database.db` upgrades in place:

- campus-era installs: `users.campus` is copied into `group_name`, `city` is
  filled with `Local Area`, and the legacy column is dropped (SQLite >= 3.35;
  left in place otherwise, and no longer read);
- pre-`client_token` installs: the column and its partial unique index are added;
- users, points and disposal history are preserved. Verified by check 13 in
  `tests/verify_api.py`, which boots a campus-era schema and asserts nothing is
  lost.

## 5. Tests

```bash
python tests/verify_api.py        # 19 checks, isolated temp database
cd ecosort_flutter
flutter analyze                   # clean
flutter test                      # 31 tests

# optional browser checks (drive the installed Chrome, ~1 min of setup)
cd tests/e2e && npm install
node flow.mjs                     # full demo + voice + mobile/desktop layout, 35 checks
node controls.mjs                 # control surface + 375/320 px overflow, 13 checks
node camera.mjs                   # live camera, fallbacks, 429, 11 checks
node static.mjs                   # committed public/ bundle, local demo mode, 7 checks
```

`tests/e2e/controls.mjs` covers the control surface itself: profile dropdowns
with custom entry, the settings popover, the sample dropdown, the category
override (proving the recyclable bin gets the point, not the hazardous one), the
challenge filter, and no horizontal overflow at 375px and 320px.

`tests/e2e/flow.mjs` also verifies the sorting-guide voice scope: read-aloud
speaks only item, category/bin and preparation steps; auto-read is off by
default; auto-read primes with a silent utterance; stop/end/error states reset;
and unsupported speech disables the controls without page errors.

`tests/e2e/*.mjs` use `playwright-core` against the **installed** Chrome, so no
browser is downloaded and nothing is added to the app. `camera.mjs` uses
Chrome's fake capture device, so it works without a webcam. The Gemini call is
mocked at the SDK boundary in `tests/verify_api.py`, so no network or billing
is needed in CI.
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
| `GROUP_PRESETS` / `CITY_PRESETS` / defaults | `lib/models/user_profile.dart` |
| `classify_waste()` | `lib/data/classifier.dart` |

Both use the same token-first matching rule (a keyword matches a whole token, or
a substring only when it is at least 5 characters), which is what keeps the
3-character `med` keyword from firing on `media_player.png`.

## 6. Cloudflare Pages and full-stack preview

### Static Pages build

`public/` is a deployable Cloudflare Pages bundle. It uses local demo rules and
browser storage when `/api/*` is unavailable, so the complete UI works without a
Python server. Build and deploy:

```bash
python scripts/build_pages.py
npx wrangler pages deploy public --project-name ecosort
```

`wrangler.toml` points Pages at `public/`. The generated `public/index.html`
uses relative `./static/...` paths and sets `window.__ECOSORT_STATIC__ = true`;
the shared frontend then skips API calls and uses its local classifier, points,
badge and challenge state.

### Full Flask app over Cloudflare Tunnel

Flask + SQLite is stateful, so the Pages demo cannot run Gemini vision or
server-side idempotency. For the full app, expose the local Flask process with a
Cloudflare Tunnel:

```bash
# install once (Windows)
winget install --id Cloudflare.cloudflared -e

# with the Flask app already running on 127.0.0.1:5000
cloudflared tunnel --url http://127.0.0.1:5000
```

Cloudflare prints a `https://<random>.trycloudflare.com` URL. That URL is
HTTPS, so camera access works, and it forwards to the same Flask/SQLite
process. A quick tunnel is temporary and stops when the process exits.

For a permanent full-stack deployment, use a named Cloudflare Tunnel attached
to your account and domain, or port the API to Cloudflare Workers + D1
(SQLite). The current SQLite file and Python Gemini SDK do not run directly on
Workers.

## 7. Status

| Milestone | State |
| --- | --- |
| M1 scaffold + SQLite bootstrap + shell | done |
| M2 profiles + deterministic classifier | done |
| M3 disposal + virtual bins | done |
| M4 badges, challenge, leaderboards | done |
| M5 automated API suite + browser E2E | done |
| Flutter Web client | done |
| Camera capture + AI vision + rate limiting | done |
| Universal profiles (community / group + city) | done |
| Forest/moss/sage UI, voice guide, mobile nav | done |
| Static Cloudflare Pages bundle with local demo fallback | done (this release) |

Still open: no `LICENSE` file (a Product Owner decision). No auth: any client can
act as any user, and the leaderboard is not evidence of real behaviour. Group
names are free text, so a typo creates a new group rather than being rejected —
that is the deliberate trade-off for letting anyone join without a list to
maintain.
