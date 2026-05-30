# Latest Task

## Summary
Fixed Bugs 5+8 (server-side) and Bug 6 (client-side) from DIAGNOSIS_2026-05-30.md. Pre-flight audit of all three virus_pool writers (start-game, end-play-phase pending flush, refillVirusPool) confirmed no legitimate duplicate-position write exists under sequential operation — safe to add the constraint. Migration 017 cleaned existing duplicate rows in three affected games (14891e14, 78922007, 8ef6f048), then added UNIQUE(game_id, position) on virus_pool. refillVirusPool now catches Postgres 23505 and returns success without re-inserting. Deployed resolve-next-virus as v13. Bug 6 client fix: moved resolveInFlightRef.current = false from unconditional useEffect top into the if (currentCard) branch; empty-queue branch skips the 500ms timer if the ref is already true. Double-CF application race backlogged. Bugs 5+8 not marked resolved — manual playtest required to confirm pool stays ≤4 through a Cascading Failure chain.

## Files changed
- `supabase/migrations/017_virus_pool_position_unique.sql` — new migration: deduplication CTE + UNIQUE(game_id, position) constraint
- `supabase/functions/resolve-next-virus/index.ts` — refillVirusPool catches 23505, treats as concurrent-refill success
- `components/game/phases/VirusResolution.tsx` — resolveInFlightRef reset moved into currentCard branch; empty-queue branch guards on ref before scheduling advance timer
- `BACKLOG.md` — double-CF application race entry added
- `SESSION_NOTES.md` — current phase updated

## Test status
- `next build`: clean (both commits)
- Full Playwright suite not run — both fixes are targeted concurrency repairs with no UI selector changes; canary subset not applicable (race conditions not testable via E2E). Manual playtest verification required before marking Bugs 5+8 resolved.
- Constraint verified live via information_schema query: `virus_pool_game_position_unique UNIQUE` present.
- Function deployed: resolve-next-virus Supabase internal v13, updated_at 2026-05-30.

## Suggested next
1. **Manual playtest: verify pool stays ≤4 through a Cascading Failure chain.** Run a dev game, trigger CF, and query `SELECT position FROM virus_pool ORDER BY position` after resolution. If no duplicates and count ≤4, mark Bugs 5+8 resolved in SESSION_NOTES.
2. **Bug 3** (CentralBoard "×? cards" hand-stack: literal "?" never wired, renders only on top two chips; proper fix needs server-side hand_count column due to RLS, MEDIUM).
3. **Double-CF application race** (BACKLOG): two concurrent 2s-resolve calls both read CF as resolved=false and both apply applyVirusEffect — separate from v11/v13 fixes, uncharacterized. Low priority until playtesting surfaces it as disruptive.
