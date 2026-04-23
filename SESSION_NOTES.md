# Session Notes

## Current Phase
**Phase 5 — Card Data Layer** (NEXT UP)

## Phase 4 Complete ✓

All 12 E2E tests pass (5 lobby + 7 mission-flow). Full test run: `12 passed (43.4s)`.

### What Was Built in Phase 4
- `components/game/GameBoard.tsx` — main game screen with Realtime + polling fallback
- `components/game/TrackerBar.tsx`, `MissionBoard.tsx`, `PlayerRoster.tsx`, `Hand.tsx`, `GameLog.tsx`
- Phase components: `ResourceAdjustment`, `MissionSelection`, `CardReveal`, `ResourceAllocation`, `PlayerTurn`, `VirusResolution`, `SecretTargeting`, `GameOver`
- `components/chat/PublicChat.tsx`, `MisalignedPrivateChat.tsx`
- 5 edge functions deployed: `start-game`, `adjust-resources`, `select-mission`, `reveal-card`, `allocate-resources`
- `supabase/migrations/006_service_role_grants.sql` — `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`

### Key Fixes Applied
1. **ES256 JWT** — All edge functions use `atob()` to decode JWT manually (Supabase switched from HS256 to ES256)
2. **Service role grants** — Migration 006 added `GRANT ALL` to `service_role` (was missing from 004_grants.sql)
3. **Realtime delivery** — Realtime `postgres_changes` events require JWT loaded BEFORE subscribing. Fixed by adding polling fallback (3s interval) in both `LobbyPhase` and `GameBoard`
4. **Lobby polling** — Also checks game phase so all players navigate to the game board even if Realtime subscription was established before they had a session

## Next: Phase 5 — Card Data Layer

The card constants and mission constants already exist in `lib/game/cards.ts` and `lib/game/missions.ts` (used by start-game edge function and UI components). What's missing:

- `lib/game/deck.ts` — client-side deck helpers if needed for UI
- Verify all card keys in `CARD_MAP` and `MISSION_MAP` are correct and match the DB/edge function usage

Actually, looking at the build sequence: `start-game` already builds and deals the deck server-side. The client just reads cards from the `hands` table. Phase 5 might be largely done already.

**Next concrete actions:**
1. Check what `lib/game/cards.ts` and `lib/game/missions.ts` currently contain
2. Check what `lib/game/deck.ts` needs to contain (or if it even needs to exist)
3. If Phase 5 is already done by the start-game implementation, move to Phase 6 (Mission flow — play-card edge function)

## Architecture Reminder

The key Realtime/polling pattern used throughout:
```typescript
// Polling fallback (runs every 3s, ensures session loaded first)
useEffect(() => {
  const supabase = createClient();
  const poll = async () => {
    await supabase.auth.getSession();
    const { data } = await supabase.from("...").select("*").eq("...", id);
    if (data) setState(data);
  };
  const id = setInterval(poll, 3000);
  return () => clearInterval(id);
}, [id]);

// Realtime subscription (runs in parallel, faster but unreliable without loaded session)
useEffect(() => {
  const supabase = createClient();
  const setup = async () => {
    await supabase.auth.getSession(); // critical: load JWT before subscribing
    channel = supabase.channel("...").on("postgres_changes", ...).subscribe();
  };
  setup();
  return () => supabase.removeChannel(channel);
}, [id]);
```
