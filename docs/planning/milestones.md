# Milestone plan — EcoSort MVP

Status: current · Owner: Pi Agent · Verified: 2026-11-26 · Milestone: M1 complete

Five timeboxed milestones from the PRD. One issue body per remaining milestone
lives in `docs/planning/issues/`, written to be filed verbatim.

| # | Window | Focus | Gate | State |
| --- | --- | --- | --- | --- |
| M1 | 0–30 min | scaffold, SQLite bootstrap, 3-tab shell | `GET /` = 200; idempotent seed counts | **done** (`feat/m1-scaffold-bootstrap`) |
| M2 | 30–75 min | profiles + deterministic classifier | preset/upload/fallback classification < 300 ms | **done** (PR #6) |
| M3 | 75–115 min | disposal guide, virtual bins | log row + score + bin count persist across reload | **done** (PR #9) |
| M4 | 115–145 min | badges, 7-day challenge, leaderboards | badge unlock, +15 once, campus totals | **done** (PR #9) |
| M5 | 145–180 min | automated tests, 375 px polish, demo | 100 % assertions pass, no horizontal overflow | **done** (PR #9) |

## Not yet filed on GitHub

The remote `moonknight1025/ecosort` has no commits and `gh` is unauthenticated on
this machine, so nothing below has been created. The PRD also reserves "pushing
to a remote" and "opening issues" for explicit human approval.

Once approved and authenticated:

```bash
gh auth login                       # choose GitHub.com -> HTTPS -> browser
gh issue create --repo moonknight1025/ecosort \
  --title "M2 — Waste identification engine (profiles + deterministic classifier)" \
  --body-file docs/planning/issues/m2-waste-identification.md
gh issue create --repo moonknight1025/ecosort \
  --title "M3 — Disposal guidance and virtual recycling bins" \
  --body-file docs/planning/issues/m3-disposal-and-bins.md
gh issue create --repo moonknight1025/ecosort \
  --title "M4 — Badges, 7-day challenge and leaderboards" \
  --body-file docs/planning/issues/m4-badges-challenge-leaderboards.md
gh issue create --repo moonknight1025/ecosort \
  --title "M5 — Automated verification, responsive polish and demo readiness" \
  --body-file docs/planning/issues/m5-verification-and-polish.md
```

## Branch and PR sequence

One branch and one PR per milestone keeps each diff reviewable:

| Milestone | Branch | PR target |
| --- | --- | --- |
| M1 | `feat/m1-scaffold-bootstrap` (local commit `1daffb2`) | `main` |
| M2 | `feat/m2-waste-identification` | `main` |
| M3 | `feat/m3-disposal-and-bins` | `main` |
| M4 | `feat/m4-gamification-leaderboards` | `main` |
| M5 | `feat/m5-verification-polish` | `main` |

`main` currently has no commits, so the M1 branch is the first one to push.
