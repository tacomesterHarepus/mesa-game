# Latest Task

## Summary
Pool shuffle fix: virus_pool position now encodes nothing. After any mutation, positions are a random permutation of {0..N-1}. This eliminates the information leak where FIFO append let observers infer which AI staged which card. Four commits: (1) end-play-phase CAS sentinel + reshuffle — concurrent callers serialized by player_turn→between_turns CAS before any work begins; pool reshuffle replaces the old maxPos+1 append; (2) refillVirusPool in resolve-next-virus — same DELETE-all+INSERT-shuffled pattern, 23505 catch removed (now impossible under between_turns CAS); (3) GameBoard.tsx — pool count handlers switched from delta-counting (prev+1/prev-1) to re-fetch-on-event so batch reshuffle doesn't transiently zero the display; (4) virus-placement.spec.ts — FIFO comment updated to reflect random-position invariant. Both edge functions deployed. Migration 020 (virus_pool added to supabase_realtime publication) was applied in the preceding session.

## Files changed
- `supabase/functions/end-play-phase/index.ts` — CAS phase claim (player_turn→between_turns) moved to top of function; pending→pool logic replaced with DELETE-all-pool + INSERT (survivors+pending) shuffled 0..N-1; removed maxPoolRow query
- `supabase/functions/resolve-next-virus/index.ts` — refillVirusPool: replaced maxPos+1 append + 23505 catch with DELETE-all-survivors + INSERT (survivors+drawn) shuffled 0..N-1
- `components/game/GameBoard.tsx` — virus_pool INSERT/DELETE handlers: delta counting replaced with async re-fetch of exact count
- `tests/e2e/virus-placement.spec.ts` — lines 205-208 comment: FIFO "highest pool position / lowest position 0" assumption replaced with random-position explanation
- `supabase/migrations/020_virus_pool_realtime.sql` — (applied prior session) `ALTER PUBLICATION supabase_realtime ADD TABLE virus_pool`

## Test status
Full Playwright suite: 52 pass / 12 fail / 2 skip / 21 did not run.
All 12 failures are pre-existing (same set as `.last-run.json` before this session):
- game-log:535 — pre-existing CPU≥2 path flake (listed in CLAUDE.md)
- card-reveal:132, mission-flow:215 — DevQueueInspector fixed overlay blocking Reveal Card button (pre-existing, in .last-run.json before session)
- 9 remaining — infrastructure cold-start timeouts (`locator.fill: Test ended` at game creation); not caused by code changes
virus-placement:151 and virus-system:251 failures are both cold-start timeouts — the tests never reached pool assertion logic.

## Suggested next
Apply pending migrations to prod: migration 018 (abort_vote tables) and migration 019 (being_processed columns on virus_resolution_queue). Both are written and tested but not yet applied. After 018, the abort-vote mechanic is fully live in production. After 019, the Race 1 per-card CAS claim is live. See SESSION_NOTES for the explicit PENDING USER ACTIONS entries.
