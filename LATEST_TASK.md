# Latest Task

## Summary
Added `dismissModal` helper + call sites to all 11 remaining E2E spec files that switch DevMode players without dismissing the RoleRevealModal. The modal (added in migration 016) is z-index 40 and intercepts all pointer events, causing click failures and strict-mode selector violations in any test that switches players via the PlayerSwitcher. Also deleted `screenshot-wall-commit3.spec.ts`, which was a one-shot visual spec marked for deletion in its own file header. Full suite went from 24/10/19/29-dnr (pre-fix) to 65/15/1 (post-fix), restoring the baseline.

## Files changed
- `tests/e2e/card-reveal.spec.ts` — added dismissModal function + call after AI1 player switch
- `tests/e2e/dev-mode.spec.ts` — added dismissModal function + 3 call sites (beforeAll, Bot3 test, human-chat test)
- `tests/e2e/discard.spec.ts` — added dismissModal function + call in advanceToPlayerTurn after human switch loop
- `tests/e2e/draw-cards.spec.ts` — added dismissModal function + call in advanceThroughCardReveal after human switch loop
- `tests/e2e/game-log-ui.spec.ts` — added dismissModal function + call in beforeAll after human switch loop
- `tests/e2e/game-log.spec.ts` — added dismissModal function + call in FIRST beforeAll + call in SECOND beforeAll (page2)
- `tests/e2e/hand-stability.spec.ts` — added dismissModal function + call in advanceThroughCardReveal
- `tests/e2e/mission-flow.spec.ts` — added dismissModal function + loop across all 6 pages in beforeAll after navigation
- `tests/e2e/secret-actions.spec.ts` — added dismissModal function + call in advanceToPlayerTurn after human switch loop
- `tests/e2e/virus-placement.spec.ts` — added dismissModal function + call in advanceThroughCardReveal + call in test body after active AI player switch
- `tests/e2e/virus-system.spec.ts` — added dismissModal function + call in advanceToPlayerTurnWithCpu2 after human switch loop
- `tests/e2e/screenshot-wall-commit3.spec.ts` — DELETED (one-shot visual spec, no regression value)

## Test status
- Full suite 2026-05-05: **65 passed / 15 skipped / 1 failed**
- 1 failure: game-log.spec.ts:527 — pre-existing CPU≥2 virus path race flake (shifted from :524 by insertion; passes in isolation per CLAUDE.md baseline)
- 15 skips vs baseline 14: one extra conditional skip from random card-type gate in game-log-ui
- Within ±3 of 65/14/1 baseline — task complete

## Suggested next
Role reveal modal UX polish (BACKLOG): the "aligned" and "human" modal variants are open questions per §12 of UX_DESIGN. The misaligned variant shipped; the other two show placeholder text. This is the natural follow-on now that the test suite is healthy and the modal is battle-tested in E2E runs.
