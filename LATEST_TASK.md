# Latest Task

## Summary
Abort-vote mechanic — Step 3 (UI layer + tests). `PlayerTurn.tsx` ABORT MISSION button replaced with FLAG ABORT; button suppressed on `isLastTurnOfRound2`; shows flagged-state message when `abortFlagPending`. New `AbortVote.tsx` phase component: 30s countdown, Abort/Continue vote buttons for humans, live vote tally via Realtime on `abort_votes`, waiting state for AIs, force_resolve at countdown 0. `ActionRegion.tsx` wired for `abort_vote`. `GameBoard.tsx` wires `abort_vote` case, computes `isLastTurnOfRound2`, passes `abortFlagPending` to PlayerTurn. `types/game.ts` updated with `abort_vote` phase and three new game fields. 4 E2E tests in `abort-vote.spec.ts` covering all four scenarios. Full suite: 71/1/15 (no regressions; pre-existing game-log:535 flake only).

## Files changed
- `types/game.ts` — `abort_vote` added to Phase union; `abort_flag_pending`, `abort_vote_deadline`, `abort_flag_player_id` added to Game interface
- `components/game/phases/PlayerTurn.tsx` — ABORT MISSION removed; FLAG ABORT button added (suppressed on `isLastTurnOfRound2`); flagged-state message; calls `flag-abort`
- `components/game/phases/AbortVote.tsx` — new file: full abort vote UI (countdown, vote buttons, tally, Realtime, force_resolve)
- `components/game/board/ActionRegion.tsx` — `abort_vote` added to `isActionPhase`; header text + red color wired
- `components/game/GameBoard.tsx` — `abort_vote` case in `renderPhase()`; `isLastTurnOfRound2` computation; props passed to PlayerTurn; `isActivePlayer` extended for abort_vote
- `tests/e2e/abort-vote.spec.ts` — new file: 4 tests (flag→abort_vote boundary, abort majority→resource_adjustment, split vote→player_turn, flag suppressed on last turn + UI check)

## Test status
- `next build`: clean
- Full Playwright suite: **71 pass / 1 fail (pre-existing game-log:535 flake) / 15 skip** (13.4 min)
- All 4 abort-vote tests pass
- Baseline was 66/1/16; +4 pass, -1 skip (one previously-skipped scenario now covered)

## Suggested next
**User applies migration 018 to prod as final manual step.** After 018 is applied, the full abort-vote flow is live: flag during AI turn in round 2 → vote window opens at boundary → 30s vote → majority abort applies penalty + goes to resource_adjustment / minority continue resumes next turn.

Candidate next features from BACKLOG:
- Chat system (Phase 12) — public + misaligned private chat (deferred earlier)
- UI polish (Phase 13) — animation, density, mobile layout
- End game screen + rematch flow
