# Latest Task

## Summary

Added a "Fill Lobby" button to the lobby waiting screen. Visible only when `devMode=true` and the viewer is the host; hidden from non-hosts and in production. When clicked, inserts Bot2–Bot10 (skipping any names already taken by real players) until the player count reaches the 6-player minimum. Uses the same direct Supabase-insert pattern as the create-game page's existing Fill Lobby button — no edge function, all bots share the host's `user_id`. The button disappears once 6+ players are in the lobby.

Intended workflow: create lobby in normal Chrome → share invite link to Incognito → Incognito joins as player 2 → host clicks Fill Lobby in normal Chrome → tops up to 6 → Start Game enables.

## Files changed

- `components/game/phases/LobbyPhase.tsx` — added `fillLoading` state, `handleFillLobby()` async function, and Fill Lobby button in `PlayerPanel` (gated: `devMode && playerCount < MIN_PLAYERS`)

## Test status

- `next build` — clean
- Canary suite (abort-mission, error-handling, turn-order, multi-mission, mission-rules, lobby): **17 passed / 9 skipped / 0 failed**
- 9 skips are all random-card conditionals in mission-rules — correct baseline behavior

## Suggested next

1. **Manual verification**: open dev lobby, confirm host sees Fill Lobby button, non-host (Incognito tab) does not; click Fill Lobby, confirm 5 bots appear, Start Game enables and works.

2. **Chat badge manual verification**: while here, test the Realtime fix — be on LOG tab, have another player post to public chat, confirm CHAT badge increments without a page reload.

3. **BACKLOG — UI/UX polish**: ActionRegion height or PlayerTurn overflow fix for staging zone text clipping.
