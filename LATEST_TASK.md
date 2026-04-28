# Latest Task

## Summary

Fixed Realtime delivery for chat unread badges. Both `PublicChat.tsx` and `MisalignedPrivateChat.tsx` were subscribing to Supabase Realtime without first awaiting `supabase.auth.getSession()`. Because Mesa uses anonymous auth, the JWT is loaded lazily — the channel JOIN fired before the token was ready, so Realtime evaluated `chat_messages` RLS policies with `auth.uid() = null`, `is_player_in_game()` returned false, and all INSERT events were silently dropped. `game_log` Realtime worked because it shares the `game-${gameId}` channel created in GameBoard.tsx which already awaited the session (lines 167-170). Applied the identical async IIFE pattern with `cancelled` guard and outer-scope `channel` ref for safe cleanup. Stripped four diagnostic logs added during diagnosis.

## Files changed

- `components/chat/PublicChat.tsx` — Realtime `useEffect` wrapped in async `setup()` function; `await supabase.auth.getSession()` before `channel.subscribe()`; `let cancelled`/`let channel` pattern for safe cleanup; diagnostic logs stripped
- `components/chat/MisalignedPrivateChat.tsx` — identical fix

## Test status

- `next build` — clean
- Full Playwright suite: **65 passed, 14 skipped, 1 failed**
- 1 failure: `game-log.spec.ts:524` — pre-existing CPU≥2 path race (known flake, passes in isolation)
- No regressions from this change

## Suggested next

1. **Manual browser verification**: open dev game in two tabs as different players; on LOG tab, have another player post a public message — CHAT badge should increment. For private badge: misaligned player on LOG tab, another misaligned player posts to private channel — PRIVATE badge increments. This is the first time Realtime actually delivers these events, so confirming it live is worth the 2 minutes.

2. **Chat Phase 12 send functionality** (BACKLOG): backend send is already implemented (direct Supabase insert from client); what's "deferred" in BACKLOG is the full Phase 12 polish pass (read receipts, timestamps, etc.). The basic send/receive loop is functional.

3. **Layout density fix** (BACKLOG): ActionRegion 200px → 240px or PlayerTurn left column `overflow: auto` to fix staging zone text clipping.
