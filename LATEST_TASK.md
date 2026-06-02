# Latest Task

## Summary

Reconciled a mid-deploy interruption for the virus_pool lock + virus_pool_count feature. Migration 022 had already been applied to prod (games.virus_pool_count column, virus_pool SELECT policy dropped, virus_pool removed from Realtime publication). Three of the four edge functions were already deployed with count-sync. The fourth (resolve-next-virus) was at v21 and missing both the CF-path count update and the refill count update. Deployed resolve-next-virus as v22 with both additions. Committed all 11 previously-uncommitted files (8 source + 2 tests + migration SQL) as a single logical changeset and pushed to master.

## Files changed

- `supabase/migrations/022_virus_pool_count_and_lock.sql` — new migration (already applied to prod)
- `supabase/functions/start-game/index.ts` — sets virus_pool_count=4 on game start
- `supabase/functions/end-play-phase/index.ts` — sets virus_pool_count=newPoolSize after pending shuffle
- `supabase/functions/pull-viruses/index.ts` — sets virus_pool_count=poolSizeAfter after pull
- `supabase/functions/resolve-next-virus/index.ts` — sets count after CF deletion AND =4 after refill (v22)
- `supabase/functions/_shared/advanceTurnOrPhase.ts` — added MISSION_REQUIREMENTS export + pending_core_progress_delta post-chain recheck
- `supabase/functions/_shared/gameLogTypes.ts` — added mission_requirements_unmet event type
- `components/game/GameBoard.tsx` — poolCount from games.virus_pool_count; removed virus_pool Realtime subscriptions
- `types/game.ts` — added virus_pool_count and pending_core_progress_delta fields
- `tests/e2e/virus-system.spec.ts` — updated for new pool count behavior
- `tests/e2e/virus-placement.spec.ts` — updated comments for random-position invariant

## Test status

No test run this session (reconciliation only — no logic changes beyond the missing count updates in resolve-next-virus). Prior baseline: 51 pass / 6 fail / 14 skip (all failures pre-existing). Prod verifications via MCP: migration applied, RLS policy dropped, Realtime publication updated, all 4 functions live with count sync.

## Suggested next

Manual playtest to confirm pool count display updates correctly mid-game, especially the CF path (that was the missing update in v21). Also: migration 021 is untracked in git — confirm whether it was applied to prod and commit it. Race 2 (duplicate secret-target vote) and DevQueueInspector polish items remain open in BACKLOG.
