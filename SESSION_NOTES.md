# Session Notes

## Current Phase
**Phase 7 — Virus System** (NEXT UP)

## Phase 6 Complete ✓

All 15 E2E tests pass (5 lobby + 10 mission-flow). Full test run: `15 passed (52.6s)`.

### What Was Built in Phase 6
- `supabase/functions/play-card/index.ts` — AI plays a progress card to active mission. Validates caller = current turn player, card in hand (progress only), CPU limit. Updates mission contribution counts.
- `supabase/functions/end-play-phase/index.ts` — AI ends their turn. Checks mission complete, advances turn order (skipping `skip_next_turn` players), handles round 2 start, mission success/failure. Phase 6 simplified: no virus resolution, advances turn order directly.
- `components/game/phases/PlayerTurn.tsx` — Full AI turn UI: hand filtered to progress cards, Play Card button, End Turn button.

### Key Fixes Applied
1. **verify_jwt: false on all edge functions** — Supabase switched to ES256 JWT. All functions must use verify_jwt: false and do manual atob() JWT decode.
2. **reveal-card `.single()` bug** — Changed to `.limit(1).maybeSingle()` for hand card lookup. `.single()` fails if player has duplicate cards with same key.
3. **allocate-resources host-only restriction** — Removed `host_user_id` check. Any human can submit allocation (host may be AI). Updated `ResourceAllocation` component to show "Start Mission" to any human, not just host.
4. **Test timing** — Test 10 (End Turn) uses a retry loop (30 × 500ms) instead of per-page timeout to find the "End Turn" button efficiently.

### Deployed Edge Functions (all verify_jwt: false)
- start-game: v6
- adjust-resources: v2
- select-mission: v2
- reveal-card: v3 (fixed .single() → .limit(1).maybeSingle())
- allocate-resources: v3 (removed host-only restriction)
- play-card: v2 (verify_jwt: false)
- end-play-phase: v2 (verify_jwt: false)

## Next: Phase 7 — Virus System

The current `end-play-phase` is simplified (Phase 6): it skips virus resolution entirely and advances turn order directly. Phase 7 needs to implement the full virus pipeline:

1. `place-virus` edge function — AI places virus cards face-down next to pool during their turn (simultaneously with playing progress cards)
2. `end-play-phase` update — after AI plays cards, shuffle pending viruses into pool, then trigger virus resolution instead of advancing turn directly
3. `resolve-next-virus` edge function — resolves one card from the virus_resolution_queue, checks win conditions, handles Cascading Failure chaining
4. `VirusResolution` phase component — UI for watching virus cards resolve one by one

### Virus generation rules
- CPU ≥ 2 → +1 virus per turn
- Every 3rd card played that turn → +1 additional virus (max total: 2 per turn)

### Win conditions (after every state change)
- Escape Timer reaches 8 → Misaligned AIs win immediately
- Core Progress reaches 10 → Humans win after active AI's full virus chain resolves

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
