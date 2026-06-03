# Latest Task

## Summary

Phase 4 of the polling → Realtime migration. Hand fetch moved from the 3s `setInterval` into the SUBSCRIBED reconnect-refresh on the `game-${gameId}` channel. The hand is fetched in the same `Promise.all` as game/players/mission/log, and applied under the same generation-counter guard (skipped if any subscription event fired during the async window). The 3s hand-only poll `useEffect` is removed in full. The phase-keepalive (2s `games.phase + current_turn_player_id` poll) and the dev-mode hand-switch effect are untouched.

This completes the polling → Realtime migration. No data polling remains in the GameBoard except the intentional phase-keepalive.

## Files changed

- `components/game/GameBoard.tsx` — Removed hand-only poll `useEffect` (33 lines); added `handPlayerId`/`handPlayerRole` + hand fetch to the reconnect-refresh `Promise.all`; added `setHand` apply under generation-counter guard

## Test status

- `next build`: clean (0 errors; pre-existing lint warnings unchanged)
- E2E suite: not run — pre-existing environment issue blocks Playwright on this machine. User must run from Windows terminal.

## Suggested next

1. **Manual hand-recovery reconnect test** (the real close-out for Phase 4): in two browser windows, mid-turn for an AI player, disable network on one window for ~5s, re-enable. Confirm hand reappears without page refresh.
2. **Run full Playwright suite** from Windows terminal. Compare against BASELINE_2026-04-28.md. Phase 4 touches only the reconnect path — no subscription events or edge functions changed.
3. If both pass: migration is fully closed. Next logical work is from BACKLOG (UI polish, chat system, or email invites).
