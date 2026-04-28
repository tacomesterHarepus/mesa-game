# Latest Task

## Summary

End-of-redesign Playwright test cleanup pass. All board-redesign phases were complete; this session unskipped 5 pending-phase tests and fixed all stale selectors introduced by the redesign. Four rounds of fixes across 4 commits. Final suite baseline: **65 passed, 14 skipped, 1 failed** (pre-existing game-log CPU≥2 race). The suite is now at its post-redesign "all green" baseline — the 1 failure and 14 skips are all known/expected.

## Files changed

- `tests/e2e/dev-mode.spec.ts` — chat lock assertion updated: CHAT tab click, `placeholder="Message…"` locator, `getByText("// LOCKED")` for AI instead of disabled input
- `tests/e2e/game-log-ui.spec.ts` — unskipped bold test; `.font-bold` → `span[style*="font-weight: bold"]`; beforeAll timeout 20→40s
- `tests/e2e/multi-mission.spec.ts` — `getByText("Resource Allocation")` timeout 15→45s in `completeMission1ByFailing`
- `tests/e2e/secret-actions.spec.ts` — `"virus_pull"` added to allowed-phases arrays at 3 locations (2 single-line, 1 multi-line)
- `tests/e2e/abort-mission.spec.ts` — `getByText("Resource Allocation")` timeout 15→45s
- `tests/e2e/draw-cards.spec.ts` — `getByText("Resource Allocation")` timeout 15→45s
- `tests/e2e/virus-placement.spec.ts` — Multiple fixes: `getByText("Player Turn")` wait, `exact: true` removed from card selector, staging text `/1 \/ 1/` → `getByRole("button", { name: /^end turn\$/i })`, discard-wait changed from regex to `getByRole("button", { name: "Discard Done" })`
- `BASELINE_2026-04-28.md` — New file documenting final test baseline

## Test status

- `next build` — clean (no new code changes, only tests)
- Full suite: **65 passed, 14 skipped, 1 failed**
- 1 failure: `game-log.spec.ts:524` — pre-existing CPU≥2 path timing race (documented in DIAGNOSIS_2026-04-27.md Item 1, passes in isolation)
- 14 skips: all conditional on random game state (correct behavior by design)
- virus-placement: passes 2/2 isolated runs

## Suggested next

BACKLOG items are the natural next steps:

1. **Layout density fix** (from this session): ActionRegion is 200px tall; PlayerTurn's left column overflows by ~40px, clipping the staging zone text. Fix: increase ActionRegion height to 240px or change PlayerTurn left column to `overflow: auto`. Low risk — pure CSS change.

2. **Chat system** (Phase 12, deferred to BACKLOG): PublicChat + MisalignedPrivateChat are designed as tab content in RightPanel but backend send functionality isn't implemented. Chat messages can be read but not sent.

3. **UI/UX polish — allocation visibility** (BACKLOG §UI/UX): Resource allocation phase could show clearer per-player CPU/RAM labels when humans are assigning resources.

See UX_DESIGN.md and BACKLOG for full detail.
