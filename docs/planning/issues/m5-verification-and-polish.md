**Milestone:** M5 · **Window:** 145–180 min · **Depends on:** M4

## Deliverables

- `tests/verify_api.py` — Flask test client, no live server required, asserting
  all six PRD conditions:
  1. Idempotent seeding: two `init_db()` calls leave 13+ catalog rows and
     exactly 4 seeded users, no duplication errors.
  2. User bootstrap: new user at 0 points with 7 uncompleted challenge rows;
     second call returns the existing record intact.
  3. Classification: `battery` → Hazardous 25; `plastic_bottle_01.jpg` →
     Recyclable 15; `mystery_object.png` → Dry Waste 10.
  4. Disposal & badge: `eco_points` increments, matching `bin_counts` moves,
     `First Step` becomes unlocked.
  5. Challenge idempotency: Day 1 adds +15 once, +0 on a duplicate call.
  6. Leaderboard: users sorted descending; campus totals equal member sums.
- 375 px responsive audit: bins wrap to 3 columns, presets to 2, zero
  horizontal overflow.
- Clean-state check: delete `database.db`, boot twice, confirm identical counts.
- End-to-end demo script (Set Profile → Identify → Toss in Bin → Claim
  Challenge → View Leaderboard) with no page reloads.

## Exit criteria (gate)

- [ ] `python tests/verify_api.py` exits 0, every assertion passing.
- [ ] No broken assets and no JS console errors on `/`.
- [ ] Demo flow completes without a reload or a manual database fix.
