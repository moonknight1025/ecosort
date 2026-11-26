# EcoSort — smart waste segregation for campuses

One repository, two applications that share one set of domain rules:

| Path | What it is | Stack |
| --- | --- | --- |
| `app.py`, `templates/`, `static/` | Server-rendered web app with a REST API and SQLite persistence | Python 3.10+, Flask 3.1+, SQLite |
| `ecosort_flutter/` | Mobile-first Flutter Web client (Material 3) with an offline mode | Dart 3.14 / Flutter 3.50, `material_ui` |

Both classify waste into the same five streams, award the same points, evaluate
the same four badges, run the same 7-day challenge, and rank the same four
campuses. Product goal: make every piece of waste count.

## 1. Flask app + API

```bash
python -m pip install -r requirements.txt
python app.py                     # http://127.0.0.1:5000
python tests/verify_api.py        # (milestone M5 — not written yet)
```

The database bootstraps itself on first request: `database.db` with four tables,
13 catalog items across five streams, 4 seeded campus users and 7 challenge days,
all via `INSERT OR IGNORE`, so restarting never duplicates a row.

All six PRD routes are implemented:

| Route | Purpose |
| --- | --- |
| `GET /` | the server-rendered app |
| `POST /api/user` | create/rehydrate a profile |
| `POST /api/identify` | classify a preset keyword or uploaded file name |
| `POST /api/dispose` | log a disposal; points re-derived server-side, `client_token` idempotency |
| `POST /api/challenge/complete` | claim one challenge day, +15 exactly once |
| `GET /api/leaderboard` | top 10 users + campus totals |

CORS is open so the Flutter Web client can call the API from another dev origin.

## 2. Flutter Web client

```bash
cd ecosort_flutter
flutter pub get
flutter analyze                   # clean
flutter test                      # 26 tests, all passing
flutter run -d chrome             # or: --web-browser-flag="--window-size=430,844"
flutter build web --release       # static bundle in build/web
```

The client starts in **local mode** — no backend needed, state in
`shared_preferences`, deterministic classifier. Switch to the Flask backend with
the ⚙️ icon in the app bar; if a call fails it falls back to local mode and says
so. Details, architecture and limitations: [`ecosort_flutter/README.md`](ecosort_flutter/README.md).

### Keeping the two in sync

The category literals, bin colours, point values, badge rules and challenge
tasks exist twice by necessity (Python and Dart). They must stay identical:

| Flask | Flutter |
| --- | --- |
| `BIN_META` | `lib/models/waste_category.dart` |
| `CATALOG_SEED` | `lib/data/waste_catalog.dart` |
| `CATALOG_ALIASES` | `lib/data/waste_catalog.dart` |
| `CHALLENGE_TASKS`, `CHALLENGE_REWARD` | `lib/data/challenge_catalog.dart` |
| `BADGES` | `lib/data/gamification.dart` |
| `CAMPUSES` | `lib/models/user_profile.dart` |
| `classify_waste()` | `lib/data/classifier.dart` |

Both use the same token-first matching rule (a keyword matches a whole token, or
a substring only when it is ≥ 5 characters), which is what keeps the
3-character `med` keyword from firing on `media_player.png`. Change one, change
the other, and re-run both test suites.

## 3. Status

| Milestone | State |
| --- | --- |
| M1 scaffold + SQLite bootstrap + shell | done (PR #5) |
| M2 profiles + deterministic classifier | done (PR #6), review findings fixed |
| Flutter Web client | done (this branch) |
| M3 disposal + virtual bins | done |
| M4 badges, challenge, leaderboards | done |
| M5 automated API suite + browser E2E | done |

`python tests/verify_api.py` → 11 checks pass. `.github/workflows/ci.yml` runs
that suite plus `flutter analyze` and `flutter test` on every PR.

Still open: no `LICENSE` file (a Product Owner decision).
