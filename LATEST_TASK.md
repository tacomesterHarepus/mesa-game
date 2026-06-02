# Latest Task

## Summary

Phase 2 of the polling → Realtime migration (from MIGRATION_PLAN_websocket.md). Removed the 2-second setInterval backup poll from LobbyPhase.tsx and added a reconnect-refresh to the existing Realtime subscription. The lobby subscription already covered all three data sources (players INSERT/DELETE, spectators INSERT/DELETE, games UPDATE); the poll was pure redundancy.

Reconnect-refresh pattern: `.subscribe(async (status) => ...)` callback fires on every 'SUBSCRIBED' transition — including reconnects after a network drop or tab backgrounding. On SUBSCRIBED it re-fetches players, spectators, and games.phase in parallel, applies results to state, and checks for the lobby-exit navigation case (game started while disconnected). A double `cancelled` guard (before and after the async Promise.all) prevents state updates after component unmount.

## Files changed

- `components/game/phases/LobbyPhase.tsx` — removed 21-line setInterval poll block (lines 58–78); changed `.subscribe()` to `.subscribe(async (status) => ...)` with reconnect-refresh body (15 lines added)

## Test status

Scoped run — `lobby.spec.ts` + `dev-mode.spec.ts` against port 3010:
**11 passed / 1 failed**

All 5 lobby.spec.ts tests passed (home page, create game, lobby ID display, second player join, start game enable).
All 7 dev-mode.spec.ts tests passed (fill lobby visible, player switcher, active highlight, banner, chat input), including the Phase 1 chat regression test (dev-mode:144).

1 failure: `dev-mode.spec.ts:38 — Fill Lobby creates 6 players...` — cold-start Supabase timing flake on the fresh port 3010 server. Page navigated to `/game/create` twice instead of reaching the lobby. The same test passed cleanly (2.0s) in the Phase 1 full suite on port 3002. Not caused by Phase 2 change (failure occurs on `/game/create` before LobbyPhase.tsx ever mounts).

Build clean.

## Suggested next

Manual verify: open a lobby from two browser tabs, confirm joins/leaves appear live; have host start game, confirm all tabs navigate to game board. Then briefly disable/re-enable network in one tab and confirm lobby state recovers. Once verified, approve Phase 3 (GameBoard core state + game-over teardown). See MIGRATION_PLAN_websocket.md for Phase 3 scope.
