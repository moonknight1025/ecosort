**Milestone:** M3 · **Window:** 75–115 min · **Depends on:** M2

## Deliverables

- `POST /api/dispose` — insert into `disposal_logs`, increment
  `users.eco_points`, recompute per-category `bin_counts` and badges, return
  `{new_points, badges, bin_counts}`.
- Result card populated from `POST /api/identify`: item name, category badge,
  bin colour, step-by-step disposal instructions, point reward, and the
  "Toss into Virtual Bin" CTA.
- Five colour-coded virtual bins (Green/Blue/Gray/Purple/Red) with live
  counters and a pulse animation on increment.
- Header Eco Score updates in place; toast on successful disposal.
- CTA disabled while the request is in flight (double-click guard).

## Exit criteria (gate)

- [ ] Tossing an item writes exactly one `disposal_logs` row with the correct
      `category` and `points_earned`.
- [ ] Header Eco Score increments by the catalog points.
- [ ] The matching bin counter increments and survives a page reload (values
      read back from SQLite).
- [ ] Rapid double-click on the CTA does not double-count points.
- [ ] No `500` when `user_id` is unknown — return a JSON 4xx instead.
