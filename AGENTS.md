# AGENTS.md — EcoSort operating rules

Instructions for any coding agent working in this repository. Read this file
before your first edit; it narrows what the PRD allows and records what is
already built.

Status: current · Owner: Pi Agent · Milestone: M2 complete, M3 next.

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

# automated verification (arrives in M5)
python tests/verify_api.py
```

## 7. Milestones and gates

| Milestone | Scope | Gate |
| --- | --- | --- |
| **M1 — done** | scaffold, SQLite bootstrap, seed data, 3-tab shell | `GET /` = 200; 13 catalog rows + 4 users after two boots |
| **M2 — done** | `/api/user`, `/api/identify`, `classify_waste()`, scan UI | preset/upload/fallback classification < 300 ms |
| M3 — next | `/api/dispose`, result card wiring, virtual bins, toasts | log row + score + bin count persist across reload |
| M4 | badges, `/api/challenge/complete`, `/api/leaderboard` | badge unlock, +15 once, campus totals |
| M5 | `tests/verify_api.py`, 375 px audit, demo script | 100 % pass, no horizontal overflow |

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

Still missing: `POST /api/dispose` (M3), `POST /api/challenge/complete` and
`GET /api/leaderboard` (M4).

`classify_waste(keyword_text, image_path=None)` is the only place waste is
classified. Replace its body with a vision call later; do not move matching
into a route.

## 9. Known gaps at M2 (honest status)

- `POST /api/dispose`, `POST /api/challenge/complete` and
  `GET /api/leaderboard` **do not exist yet**. The "Toss into Virtual Bin" CTA
  and the challenge buttons explain that instead of faking success.
- `POST /api/dispose` must **not** trust the client's `points`/`category` from
  the PRD contract; M3 re-derives both from `waste_catalog`. It also needs a
  `client_token` with `UNIQUE(user_id, client_token)` — a disabled button is not
  an idempotency guard.
- The challenge claim must be one conditional
  `UPDATE ... WHERE completed = 0` plus a `rowcount` check, or two concurrent
  claims raise `IntegrityError` and return 500 instead of +0.
- `streak_days` still exists in the `users` table but is **no longer returned**
  by `/api/user` until M4 actually writes it. Implement it there or drop the
  column.
- The badge evaluator already ships (two M2 responses are contractually
  required to return `badges`, so it could not be deferred), but nothing can
  unlock a badge until M3 writes to `disposal_logs`.
- `tests/verify_api.py` is still an M5 deliverable. M1/M2 gates were verified
  with the Flask test client run ad hoc — see the commit messages for output.
  For isolation, point `app.DATABASE_PATH` at a temp file and set
  `app._bootstrapped = False` before the first request.
- Uploaded files keep their sanitized original name, so re-uploading the same
  file overwrites it; non-ASCII names fall back to `upload_<hex8><ext>`.
- Browser console cleanliness and the 375 px layout remain **unverified** — no
  headless browser is installed here.
- `database.db` and `static/uploads/*` are gitignored generated state, not
  source.

## 10. Style

- Python: 4-space indent, typed public helpers, docstrings that state why.
- Every mutation route validates input and returns JSON errors, never HTML.
- Never `except: pass`; if a fallback is intentional (unmatched upload → Dry
  Waste), name it in a comment and in the API response.
- JS: `const`/`let`, early returns, no inline handlers, no globals beyond
  `state`/`DOMAIN`.
- CSS: mobile-first; the 375 px breakpoint at `max-width: 500px` must stay
  clean with zero horizontal overflow.
