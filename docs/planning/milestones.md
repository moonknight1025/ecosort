# Milestone issues (drafts) — EcoSort MVP

Status: draft · Owner: Pi Agent · Created: 2026-11-26 · Milestone: M1 shipped

These are the issue bodies for M2–M5, written to the PRD contract so they can be
filed verbatim once the repository remote is writable. **Nothing here has been
opened on GitHub yet** — `gh` is unauthenticated on this machine and the PRD
reserves "pushing to a remote / creating issues" for human approval.

Filing commands (run after `gh auth login` and approval):

```bash
gh issue create --repo moonknight1025/ecosort --title "<title>" --body-file <file>
```

Each body is delimited below by a `---` rule; the heading above each block is
the issue title.

---

## M2 — Waste identification engine (profiles + deterministic classifier)

**Milestone:** M2 · **Window:** 30–75 min · **Depends on:** #M1

### Deliverables

- `POST /api/user` — upsert by `username`, default `campus` to `Main Campus`,
  ensure 7 `user_challenges` rows exist, return
  `{user, badges, challenges, bin_counts}`.
- `classify_waste(keyword_text, image_path=None)` helper — the only place
  classification logic lives, so a vision model can replace the body later
  without touching route signatures.
- `POST /api/identify` — multipart `image` and/or `preset_keyword`; save
  sanitized uploads (`werkzeug.utils.secure_filename`) into `static/uploads/`;
  match lowercase filename + keyword against `waste_catalog`; fall back to
  `Dry Waste` / Gray / 10 pts when nothing matches or the upload is empty.
- Frontend: wire the dropzone (`accept="image/*"`) and the 6 preset buttons
  (Plastic Bottle, Banana Peel, Used Battery, Cardboard Box, Broken Charger,
  Chip Wrapper) to `POST /api/identify`; Render a result card stub.
- Handle repeat `POST /api/user` for the same username as an idempotent fetch
  (existing `eco_points` preserved).

### Exit criteria (gate)

- [ ] `POST /api/user` creates a user at 0 points with 7 uncompleted challenge
      rows; a second call returns the same record unchanged.
- [ ] `preset_keyword=battery` → `Hazardous Waste` / Red / 25 pts.
- [ ] Upload named `plastic_bottle_01.jpg` → `Recyclable Waste` / Blue / 15 pts.
- [ ] Upload named `mystery_object.png` → `Dry Waste` / Gray / 10 pts, HTTP 200.
- [ ] Every identify response returns in < 300 ms locally.
- [ ] No `500` on empty upload, empty keyword, or unknown filename.

### Notes

Do not add Pillow, numpy or any vision dependency. Matching is case-insensitive
substring against `waste_catalog.keyword`, longest keyword wins so
`plastic_bottle_01.jpg` is deterministic.

---

## M3 — Disposal guidance and virtual recycling bins

**Milestone:** M3 · **Window:** 75–115 min · **Depends on:** M2

### Deliverables

- `POST /api/dispose` — insert into `disposal_logs`, increment
  `users.eco_points`, recompute per-category bin counts and badges, return
  `{new_points, badges, bin_counts}`.
- Result card: item name, category badge, bin colour, disposal instructions,
  point reward, "Toss into Virtual Bin" CTA — populated from `POST /api/identify`.
- Five color-coded virtual bins with live counters and a pulse animation on
  increment; header Eco Score updates in place.
- Toast notification on a successful disposal.
- Guard the CTA against double submit (disable during the request).

### Exit criteria (gate)

- [ ] Tossing an item writes exactly one `disposal_logs` row with the right
      `category` and `points_earned`.
- [ ] Header Eco Score increments by the catalog points.
- [ ] The matching bin counter increments and keeps its value after a reload
      (state read back from SQLite).
- [ ] Rapid double-click on the CTA does not double-count points.

---

## M4 — Badges, 7-day challenge and leaderboards

**Milestone:** M4 · **Window:** 115–145 min · **Depends on:** M3

### Deliverables

- Dynamic badge evaluator for `First Step` (≥1 log), `Plastic Warrior`
  (Recyclable + Dry ≥ 3), `Hazard Hero` (E-Waste + Hazardous ≥ 1),
  `Green Champion` (eco_points ≥ 100). Render a 2-column grid: dimmed when
  locked, highlighted when unlocked.
- `POST /api/challenge/complete` — award `+15` once per `(user_id, day_number)`,
  guarded by `UNIQUE(user_id, day_number)` **and** a `completed == 0` check;
  return `{new_points, challenges}`.
- `GET /api/leaderboard` — top 10 users by `eco_points DESC`, plus campuses
  aggregated by `SUM(eco_points) DESC` with member counts.
- Campus Rank tab renders both lists.

### Exit criteria (gate)

- [ ] First disposal immediately unlocks `First Step`.
- [ ] Claiming Day 1 adds +15 on the first call and +0 on a repeat call.
- [ ] `GET /api/leaderboard` users are sorted descending; each campus total
      equals the exact sum of its members' scores.

---

## M5 — Automated verification, responsive polish and demo readiness

**Milestone:** M5 · **Window:** 145–180 min · **Depends on:** M4

### Deliverables

- `tests/verify_api.py` asserting all six PRD conditions: idempotent seeding,
  user bootstrap, preset/file/fallback classification, disposal + badge
  unlock, challenge idempotency, leaderboard aggregation. Uses the Flask test
  client so it needs no live server.
- 375 px responsive audit: bins wrap to 3 columns, presets to 2 columns, zero
  horizontal overflow.
- Clean-restart check: delete `database.db`, boot twice, confirm seed counts.
- Demo script for the end-to-end flow.

### Exit criteria (gate)

- [ ] `python tests/verify_api.py` exits 0 with every assertion passing.
- [ ] Two consecutive boots leave 13 catalog rows and 4 seeded users.
- [ ] No broken assets and no console errors on `/`.
- [ ] Set Profile → Identify → Toss in Bin → Claim Challenge → View
      Leaderboard completes without a reload.
