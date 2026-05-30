# Latest Task

## Summary
Resolved Bug 3 by removing the hand-stack visual entirely from AI chips. The face-down card-stack rects and the `×? cards` label (previously gated by `isTop`) are deleted from `AIChipGroup` in `CentralBoard.tsx`. No replacement count or badge added — hand size is intentionally not displayed. CPU governs playable cards and is already visible on the chip. UX_DESIGN §5.3 updated to document the removal as intentional deviation. Bug 3 marked RESOLVED in SESSION_NOTES.

## Files changed
- `components/game/board/CentralBoard.tsx` — removed 10-line hand-stack block (isTop guard + card rects + ×? text) from AIChipGroup
- `UX_DESIGN.md` — §5.3 rewritten: hand-stack visual removed by design, rationale documented
- `SESSION_NOTES.md` — Bug 3 marked RESOLVED (removed by design)

## Test status
- `next build`: clean
- UI-only change; no game logic or edge functions touched — full Playwright suite not required

## Suggested next
1. **Manual playtest**: verify no freeze + pool stays ≤4 through a Cascading Failure chain (Bugs 5+8 + Bug 6 post-v14 confirmation).
2. **Double-CF application race** (BACKLOG): two concurrent 2s-resolve calls both reading CF as resolved=false and both applying applyVirusEffect. Low priority until playtesting surfaces it.
3. All tracked bugs from DIAGNOSIS_2026-05-30.md are now resolved except the double-CF backlog item.
