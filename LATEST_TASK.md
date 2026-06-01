# Latest Task

## Summary
PlayerTurn: removed client-side compute gray-out so Compute behaves consistently with all other mission-blocked cards. Previously `isDisabled` included `|| (computeBlocked && key === "compute")`, making Compute the only card grayed out and unclickable when a mission rule temporarily blocks it (dataset_preparation until 4 Data; dataset_integration when slots full). All 10 other conditional rules — including dependency_error, which is semantically identical — are server-only: card selectable, server rejects illegal play, error shown. The gray-out also blocked staging Compute for virus placement, which has no mission restriction. Removed the compute term from isDisabled so Compute is always selectable; server still rejects and returns the mission-specific error. Also relocated the mission-constraint hint span from below the card row to between `<h3>Your Hand</h3>` and the card row so it stays visible when a card is lifted (previously hidden by the card's translateY lift). Updated mission-rules.spec.ts test 4b to reflect the new design: PART 1 now asserts aria-disabled absent + server rejects the play attempt.

## Files changed
- `components/game/phases/PlayerTurn.tsx` — removed `|| (computeBlocked && key === "compute")` from isDisabled (one line); moved constraint hint span from after the card row wrapper to between h3 and card row div (adds display:block + marginBottom:4)
- `tests/e2e/mission-rules.spec.ts` — test 4b: rename + PART 1 flipped from aria-disabled present → absent, added server-rejection assertion (expects "Dataset Preparation" error)

## Test status
- `next build` clean
- Canary (mission-rules + multi-mission): 6 passed / 7 skipped (mission-key guards on random-mission shared game) / 1 failed (test 11 genome_simulation — pre-existing shared-state CPU exhaustion issue: prior tests in chain exhaust the AI's CPU limit, leaving "CPU limit reached" instead of "Genome Simulation" error; skips in isolation; unrelated to this change)

## Suggested next
Commit and push `supabase/functions/end-play-phase/index.ts` v18 — this is the CAS sentinel + staging pool reshuffle that was incorrectly recorded as committed in the docs from session 2026-05-31/06-01. The working tree has the correct v18 code; it just needs `git add` + commit + push + Supabase deploy. After that, the pool shuffle fix is fully on master. Then apply migrations 018 and 019 to prod (abort-vote and Race 1 CAS). See SESSION_NOTES PENDING ACTIONS for the full ordered list.
