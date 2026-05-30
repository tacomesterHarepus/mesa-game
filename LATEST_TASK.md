# Latest Task

## Summary
Three tasks completed. Task 1: removed the redundant owner-name label (fill="#888", ownerName.slice(0,8)) from the revealed-card slot in RevealSlotGroup — the card sits under its owner's chip so the label was pure noise. Task 2: updated SESSION_NOTES to mark Bugs 5+8, Bug 6, and Bug 4 as RESOLVED with caveats; Bug 3 remains open. Task 3: appended a full `## BUG 3 — verification + fix options` section to DIAGNOSIS_2026-05-30.md, confirming the three claims and laying out Option A (client-only hand.length threading) vs Option B (server hand_count column with 5 write sites), with a recommendation for Option B plus the bottom-chip badge fix.

## Files changed
- `components/game/board/CentralBoard.tsx` — removed 2-line ownerName `<text>` from RevealSlotGroup revealed branch
- `SESSION_NOTES.md` — Bugs 5+8/6/4 marked resolved with caveats; Bug 3 remains open
- `DIAGNOSIS_2026-05-30.md` — appended `## BUG 3 — verification + fix options` section (verification of 3 claims, Option A/B analysis, write-site enumeration, bottom-chip layout fix, recommendation)
- `LATEST_TASK.md` — this file

## Test status
- `next build`: clean (Task 1 commit 387120f)
- Tasks 2 and 3 are docs-only (no code changes) — full suite not required

## Suggested next
1. **Bug 3 Option B** (MEDIUM): add `hand_count int DEFAULT 0` to `players` (new migration), update 5 write sites (start-game, drawCardsForPlayer, discard-cards, play-card, place-virus), thread `handCounts` from GameBoard → CentralBoard. Fix bottom-chip badge separately (4-line SVG change). See DIAGNOSIS_2026-05-30.md §BUG 3 for full detail.
2. **Manual playtest**: verify no freeze + pool stays ≤4 through a Cascading Failure chain (if not yet done). If confirmed, both Bug 5+8 and Bug 6 remain marked RESOLVED.
3. **Double-CF application race** (BACKLOG): two concurrent 2s-resolve calls both reading CF as resolved=false and both applying applyVirusEffect. Low priority until playtesting surfaces it as disruptive.
