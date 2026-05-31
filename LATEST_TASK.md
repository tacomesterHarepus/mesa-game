# Latest Task

## Summary
Closed the `secret_targeting` concurrency race in `resolve-next-virus`. Two concurrent calls could both pass the top-of-function `phase='virus_resolution'` guard: the empty-queue CAS winner would claim `between_turns`, then the targeting branch (which had no CAS condition) would overwrite with `secret_targeting`, then `advanceTurnOrPhase` would overwrite again with `player_turn` — leaving targeting fields orphaned and no `targeting_resolved` log. Confirmed by DB forensics on repro game (413ms gap between `virus_effect` and `turn_start`, `targeting_deadline` still set, zero `secret_target_votes`). Fix: CAS condition added to the targeting UPDATE; loser exits immediately via the `pauseForTargeting` early-return path (no further writes). Secondary fix: removed spurious `overridePlayerId` from `VirusResolution.tsx` auto-resolve useEffect dep array, which was the DevMode-specific trigger for the race.

## Files changed
- `supabase/functions/resolve-next-virus/index.ts` — targeting UPDATE in `applyVirusEffect` now has `.eq("phase", "virus_resolution").select("id")` CAS; loser returns `true` for immediate no-op exit
- `components/game/phases/VirusResolution.tsx` — `overridePlayerId` removed from auto-resolve useEffect dep array (line 97); comment added explaining the exclusion
- `DIAGNOSIS_2026-05-31-targeting-playerswitch.md` — new file: full root-cause analysis, DB verification results, fix design, status CLOSED
- `BACKLOG.md` — targeting race marked resolved; Double-CF race entry retained (separate, still open)

## Test status
- `next build`: clean
- Full Playwright suite: **72 pass / 1 fail (pre-existing game-log:535 flake) / 14 skip** (13.1 min)
- virus-system.spec.ts tests 85-87 all pass (including test 87: phase auto-advances away from virus_resolution within 30s — directly exercises the changed code path)
- Baseline was 71/1/15; +1 pass, -1 skip (conditional skip resolved as pass)
- Concurrent-race E2E test: not added — staging two simultaneous server calls with precise DB timing is not feasible in Playwright without artificial delays. Noted as manual-verification item in DIAGNOSIS file.

## Suggested next
**User applies migration 018 to prod** — abort-vote flow goes fully live after this (the one pending action from the abort-vote task).

After that, candidates from BACKLOG:
- Chat system (Phase 12) — public + misaligned private chat
- End game screen + rematch flow
- Double-CF application race (backlogged concurrency bug — see BACKLOG.md and DIAGNOSIS_2026-05-30.md §VERIFICATION)
