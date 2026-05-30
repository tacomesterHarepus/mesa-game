# Latest Task

## Summary
Made the virus_resolution → next-turn advance idempotent server-side, closing the freeze introduced by commit 59ad57a and the double-advance race class. A CAS guard (`UPDATE games SET phase='between_turns' WHERE id=? AND phase='virus_resolution'`) in resolve-next-virus ensures only one concurrent caller can claim the advance; losers get zero rows affected and return no-op success. The snapshot check was changed from `throw` to no-op return so concurrent losers that arrive after the winner already transitioned don't surface AUTO-RESOLVE FAILED. The client-side resolveInFlightRef workaround (commit 59ad57a, which caused a 100% freeze) was reverted — the server CAS is now the authoritative guard. A pre-existing test regression (mission-flow:249) caused by commit 3923191's unallocated-pool dialog was fixed in the same pass.

## Files changed
- `supabase/functions/resolve-next-virus/index.ts` — CAS guard + snapshot check as no-op return; deployed v14
- `components/game/phases/VirusResolution.tsx` — reverted resolveInFlightRef changes from 59ad57a; unconditional reset at useEffect top
- `tests/e2e/mission-flow.spec.ts` — dismiss "Continue anyway" confirmation dialog after "Start Mission" click (post-3923191 regression fix)
- `SESSION_NOTES.md` — current phase updated, edge function table updated (v14), test baseline updated
- `LATEST_TASK.md` — this file

## Test status
- `next build`: clean (both code commits)
- Full Playwright suite: **66 pass / 1 fail / 16 skip** (11.6 min)
  - Only failure: `game-log.spec.ts:535` — pre-existing CPU≥2 path race, listed in BASELINE_2026-04-28.md
  - `virus-system.spec.ts:279` ("phase auto-advances away from virus_resolution within 30s") — **PASS**
  - `mission-flow.spec.ts:249` — was failing (dialog regression from 3923191), now fixed
- resolve-next-virus deployed: Supabase internal v14, 2026-05-30

## Suggested next
1. **Manual playtest: verify no freeze + pool stays ≤4 through a Cascading Failure chain.** Run a dev game, trigger CF, and confirm: (a) phase advances normally after virus resolution, (b) `SELECT position FROM virus_pool ORDER BY position` shows ≤4 rows after CF chain completes. If both hold, mark Bugs 5+8 and Bug 6 resolved in SESSION_NOTES.
2. **Bug 3** (CentralBoard "×? cards" hand-stack: literal "?" never wired, renders only on top two chips; proper fix needs server-side hand_count column due to RLS, MEDIUM).
3. **Double-CF application race** (BACKLOG): two concurrent 2s-resolve calls both read CF as resolved=false and both apply applyVirusEffect. Not closed by any of the v11/v13/v14 fixes. Uncharacterized. Low priority until playtesting surfaces it as disruptive.
