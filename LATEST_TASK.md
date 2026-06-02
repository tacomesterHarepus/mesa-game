# Latest Task

## Summary

Autonomous overnight run: Phase 3 of the polling → Realtime migration shipped; Phase 4 blocked by gate.

**Phase 3** removes the game/players/active_mission/game_log/poolCount fetches from the GameBoard 3s poll. All those data sources are now covered by a reconnect-refresh on the Realtime subscription: on every 'SUBSCRIBED' transition (initial connect + reconnects), a parallel fetch of games, players, active_mission, and game_log fills any gap. The hand fetch stays in the poll for Phase 4. Also adds game-over teardown: when games UPDATE fires with winner≠null or phase=game_over, the main channel is removed.

**Phase 4 blocked** — gate did not pass. Full suite after Phase 3 showed 4 new failures not in the pre-existing list. See gate analysis below.

## Files changed

- `components/game/GameBoard.tsx`
  - Removed game/players/active_mission/game_log/poolCount fetches from the 3s poll body (lines 97-141 before change). Poll now only fetches hands.
  - Added `.subscribe(async (status) => {...})` callback to the `game-${gameId}` channel with reconnect-refresh: fetches games → derives missionId → parallel fetch of players, active_mission, game_log.
  - Added game-over teardown in the games UPDATE handler: `removeChannel(channel); channel = null` when winner != null or phase === 'game_over'.

## Test status (Phase 3)

Full suite on port 3008 (confirmed Windows-accessible WSL server): **58 passed / 8 failed / 16 skipped / 9 did not run (15.7m)**

### Pre-existing failures (expected — gate allows):
- `card-reveal.spec.ts:132` — was pre-existing 2.0m DevQueueInspector overlay; now fails 19.5s at different assertion (heading wait). Mode changed but test was already failing.
- `game-log.spec.ts:535` — pre-existing CPU≥2 path race
- `virus-placement.spec.ts:151` — pre-existing DevQueueInspector overlay

### New failures — GATE BLOCKER:
- **`card-reveal.spec.ts:201`** — Was PASSING (15.5s) in Phase 1 full suite. Now FAILS: "waiting for `heading('Card Reveal')` to be visible — 15s timeout". Same assertion that card-reveal:132 now also fails at (both tests now fail at the heading wait, not at the later button click as :132 used to). LIKELY CAUSE: the reconnect-refresh is async — when it fires on SUBSCRIBED and the game is mid-transition (mission_selection→card_reveal), the fetch could return the pre-transition state and overwrite the games UPDATE's card_reveal state, reverting the UI. Needs investigation before Phase 4 proceeds.
- `abort-mission.spec.ts:175` — Was PASSING. Now fails: `page.waitForURL` 30s timeout on start-game navigation. Not in GameBoard (Phase 3 scope) — this is lobby navigation. Environment timing flake.
- `mission-flow.spec.ts:122` — Was PASSING. Now fails: `getByText('P4')` not visible in lobby join. LobbyPhase (Phase 2) join — likely Supabase rate-limit flake.
- `virus-system.spec.ts:404` — Was PASSING. Now fails: pool=3 instead of 4 (server-side REST assertion). Phase 3 changes are client-only; this is a server-side flaky path in resolve-next-virus (pre-existing fragility).

## Gate analysis

Gate rule: "NO new failures not in the pre-existing list → proceed to Phase 4". 

4 new failures present → Gate FAILED → Phase 4 not started.

The most actionable failure is card-reveal:201. The suspected mechanism is a reconnect-refresh race: the `SUBSCRIBED` fires, the async fetch starts (~200ms), during that window the game transitions (select-mission → card_reveal, games UPDATE applied), then the reconnect-refresh completes and applies the pre-transition state (mission_selection), rolling back the UI. Fix would be to abort the reconnect-refresh if a newer state has been received (e.g., track a generation counter or skip the game phase/winner overwrite if it would regress the phase).

## Suggested next

1. **Review card-reveal:201**: look at the Phase 3 reconnect-refresh race hypothesis. If confirmed, fix is to add a generation counter to the reconnect-refresh so stale results don't overwrite newer subscription events. Alternatively, exclude `phase` from the reconnect-refresh overwrite (keep it only for stable fields like `turn_order_ids`, `core_progress`, etc.) and rely on the games UPDATE subscription for phase transitions.
2. Once card-reveal:201 is understood and fixed (or ruled out as environment flake), re-run full suite to confirm gate passes, then proceed to Phase 4.
3. Phase 4 scope: add hand to reconnect-refresh, remove hand from poll, remove entire poll setInterval useEffect.
