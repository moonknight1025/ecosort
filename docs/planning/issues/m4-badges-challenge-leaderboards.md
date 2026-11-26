**Milestone:** M4 · **Window:** 115–145 min · **Depends on:** M3

## Deliverables

- Dynamic badge evaluator (no stored flags):
  `First Step` (≥ 1 log) · `Plastic Warrior` (Recyclable + Dry ≥ 3) ·
  `Hazard Hero` (E-Waste + Hazardous ≥ 1) · `Green Champion` (eco_points ≥ 100).
  Render as a 2-column grid: dimmed when locked, highlighted when unlocked.
- `POST /api/challenge/complete` — award `+15` once per `(user_id, day_number)`,
  guarded by `UNIQUE(user_id, day_number)` **and** a `completed == 0` check;
  return `{new_points, challenges}`.
- `GET /api/leaderboard` — top 10 users by `eco_points DESC`, plus campuses
  aggregated by `SUM(eco_points) DESC` with member counts.
- Campus Rank tab renders the campus battle above the individual leaderboard.

## Exit criteria (gate)

- [ ] The first disposal immediately unlocks `First Step`.
- [ ] Claiming Day 1 adds +15 on the first call and +0 on a repeat call.
- [ ] Leaderboard users are sorted descending by `eco_points`.
- [ ] Every campus total equals the exact sum of its members' scores.
- [ ] Claim buttons are disabled/hidden after a successful claim.
