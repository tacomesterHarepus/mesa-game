# Latest Task

## Summary
Abort-vote mechanic — Step 2 (server layer). Pre-flight proofs written and passed (both in DESIGN_abort_vote.md). Migration 018 written (not applied). Three helpers exported from `_shared`: `MISSION_FAIL_PENALTIES`, `resetPlayersForNextMission`, `applyMissionAbort`. `abort-mission` refactored to use `applyMissionAbort`. `end-play-phase` updated: abort flag cleared on both mission-resolved branches, abort vote injection on no-virus path, shared helpers imported. `resolve-next-virus` updated: same abort vote injection at CAS winner path. Two new functions created and deployed: `flag-abort` (human sets flag) and `submit-abort-vote` (vote + CAS-guarded resolution). Three new log event types added. All 5 functions deployed. `next build` clean.

## Files changed
- `DESIGN_abort_vote.md` — appended `## Step 2 pre-flight proofs` (PROOF 1: double-apply analysis, CAS guard requirement identified; PROOF 2: exhaustive current_mission_id=null write sites)
- `supabase/migrations/018_abort_vote.sql` — new migration (not yet applied to live DB)
- `types/gameLog.ts` — added `abort_flagged`, `abort_vote_started`, `abort_vote_resolved` event types
- `supabase/functions/_shared/gameLogTypes.ts` — same 3 event types added
- `supabase/functions/_shared/advanceTurnOrPhase.ts` — exported `MISSION_FAIL_PENALTIES`, `resetPlayersForNextMission`, `applyMissionAbort`
- `supabase/functions/abort-mission/index.ts` — refactored to call `applyMissionAbort`; local helpers removed
- `supabase/functions/end-play-phase/index.ts` — abort flag cleared on missionResolved branches; abort vote injection added; local helpers replaced with _shared imports
- `supabase/functions/resolve-next-virus/index.ts` — abort vote injection at CAS winner path
- `supabase/functions/flag-abort/index.ts` — new function
- `supabase/functions/submit-abort-vote/index.ts` — new function

## Test status
- `next build`: clean
- Full Playwright suite not run (no UI changes in this step; no game logic path changes — only new code paths that require the new DB columns which are not yet applied)
- Deployed: flag-abort v1, submit-abort-vote v1, resolve-next-virus v15, end-play-phase v17, abort-mission v4

## Suggested next
Step 3 — UI layer (per DESIGN_abort_vote.md §6):
1. Apply migration 018 to live DB (first, so the new columns exist)
2. `PlayerTurn.tsx` — replace ABORT MISSION button with FLAG ABORT button (`isLastTurnOfRound2` suppression from DESIGN §4)
3. `AbortVote.tsx` — new phase component: 30s countdown, Abort/Continue buttons for humans, waiting-for-vote message for AIs, live vote tally via Realtime on `abort_votes`
4. `GameBoard.tsx` — add `abort_vote` case to `renderPhase()`; pass `abort_flag_pending` state to `PlayerTurn`
5. Run full Playwright suite after UI changes
