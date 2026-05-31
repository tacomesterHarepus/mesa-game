# Latest Task

## Summary
Closed Race 1 (double-CF application race) in `resolve-next-virus`. Two concurrent calls could both read a `cascading_failure` card as `resolved=false` and both invoke `applyVirusEffect`, inserting duplicate cascade rows (observed in playtest: positions 4+5 each duplicated, Bot4 CPU over-drained by 1). Fix: atomic per-card CAS claim inserted between the `nextCard` SELECT and the CF/non-CF branch. `UPDATE virus_resolution_queue SET being_processed=true, being_processed_at=now() WHERE id=X AND resolved=false AND (being_processed=false OR being_processed_at < now()-5s) RETURNING id`. Loser (0 rows) returns `{skipped:"card_claimed"}` immediately. Winner proceeds to unchanged CF/non-CF branches. v11 CF ordering (cascade INSERT before `resolved=true`) preserved — the CAS is purely a gate before existing logic, nothing after the gate changes. Migration 019 adds the two claim columns.

## Files changed
- `supabase/migrations/019_virus_queue_claim.sql` — new: adds `being_processed boolean NOT NULL DEFAULT false` and `being_processed_at timestamptz` to `virus_resolution_queue`
- `supabase/functions/resolve-next-virus/index.ts` — CAS claim block inserted at line 122–142 (was line 122–127); v11 comment updated; deployed as v17
- `DIAGNOSIS_2026-05-31-virus-cascade-loop.md` — Race 1 fix design + being_processed cleanup sections appended; Race 1 status marked CLOSED
- `BACKLOG.md` — double-CF entry closed; Race 2 (duplicate secret-target) entry added as still open

## Test status
- `next build`: clean
- Full Playwright suite: **71 pass / 1 fail (pre-existing game-log:535 flake) / 15 skip** (13.8 min)
- Baseline was 72/1/14; the one extra skip is the conditional game-log CPU≥2 path test flipping on deck randomness — documented pre-existing, not a regression
- virus-system.spec.ts tests pass (directly exercises the changed code path)
- Race 1 concurrent-race E2E test: not added — staging two simultaneous server calls with DB-timing precision is not feasible in Playwright. Manual verification: cross-browser CF chain, confirm exactly N cascade rows per CF card in `virus_resolution_queue`, no duplicate positions.

## Suggested next
**User applies migration 019 to prod** — Race 1 CAS claim goes fully live. (Migration 018 for abort-vote is also still pending prod apply.)

After that, candidates from BACKLOG:
- **Race 2 (duplicate secret-target resolution)** — `secret-target` phase guard is read-then-check; CAS on the phase transition `WHERE phase='secret_targeting'` closes it. Small fix, similar pattern to the targeting CAS already in place. See `DIAGNOSIS_2026-05-31-virus-cascade-loop.md §Race 2`.
- Chat system (Phase 12) — public + misaligned private chat
- End game screen + rematch flow
