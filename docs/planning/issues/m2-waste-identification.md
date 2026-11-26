**Milestone:** M2 · **Window:** 30–75 min · **Depends on:** M1 (done, `feat/m1-scaffold-bootstrap`)

## Deliverables

- `POST /api/user` — upsert by `username`, default `campus` to `Main Campus`,
  ensure the 7 `user_challenges` rows exist, return
  `{user, badges, challenges, bin_counts}`. A repeat call returns the existing
  record with its `eco_points` intact.
- `classify_waste(keyword_text, image_path=None)` — the only place
  classification logic lives, so a vision model can replace the body later
  without touching route signatures or SQL.
- `POST /api/identify` — multipart `image` and/or `preset_keyword`; sanitize
  uploads with `werkzeug.utils.secure_filename` into `static/uploads/`; match
  lowercase filename + keyword against `waste_catalog`; fall back to
  `Dry Waste` / Gray / 10 pts for empty or unmatched input; return
  `{display_name, category, bin_color, instructions, points, image_url}`.
- Frontend: wire the dropzone (`accept="image/*"`) and the 6 preset buttons to
  `/api/identify`; render the result card (full styling lands in M3).

## Exit criteria (gate)

- [ ] `POST /api/user` creates a user at 0 points with 7 uncompleted challenge
      rows; a second call returns the same record unchanged.
- [ ] `preset_keyword=battery` → `Hazardous Waste` / Red / 25 pts.
- [ ] Upload named `plastic_bottle_01.jpg` → `Recyclable Waste` / Blue / 15 pts.
- [ ] Upload named `mystery_object.png` → `Dry Waste` / Gray / 10 pts, HTTP 200.
- [ ] Empty upload / empty keyword / unknown filename never returns `500`.
- [ ] Every identify response resolves in < 300 ms locally.

## Constraints

No Pillow, numpy, or any vision/ML dependency. Matching is case-insensitive
substring over `waste_catalog.keyword`; longest keyword wins, so
`plastic_bottle_01.jpg` is deterministic. Keep every domain literal in `app.py`.
