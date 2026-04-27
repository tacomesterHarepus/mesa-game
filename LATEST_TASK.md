# Latest Task

**Task:** Board redesign — virus_pull phase
**Date:** 2026-04-27
**Status:** DONE

## What shipped

- `supabase/migrations/015_pending_pull_count.sql` — `pending_pull_count int default 0` added to games.
- `types/game.ts` — `virus_pull` added to Phase union; `pending_pull_count: number` added to Game interface.
- `types/gameLog.ts` + `supabase/functions/_shared/gameLogTypes.ts` — `virus_pull_initiated` event type added to both mirrors.
- `PHASE_11_METADATA_SCHEMA.md` — `virus_pull_initiated` section added; `virus_queue_start` source note updated to `pull-viruses`.
- `supabase/functions/end-play-phase/index.ts` — v14: numViruses>0 + pool non-empty now forks to `virus_pull` (logs `virus_pull_initiated`, sets `pending_pull_count`, returns early). Pool-empty fallthrough unchanged.
- `supabase/functions/pull-viruses/index.ts` — v1 (new): reads `pending_pull_count`, pulls top N from pool into `virus_resolution_queue`, logs `virus_queue_start`, sets `phase=virus_resolution, pending_pull_count=0`. Full `override_player_id` support.
- `components/game/phases/VirusPull.tsx` — new phase component: active AI (current_turn_player_id match) sees amber "Pull N from virus pool" button; others see waiting message.
- `components/game/board/ActionRegion.tsx` — `virus_pull` added to `isActionPhase`; amber header "PULL FROM VIRUS POOL" / "WAITING — [name] PULLING".
- `components/game/GameBoard.tsx` — imports VirusPull, adds `case "virus_pull"` to `renderPhase()`, adds `virus_pull` to `isActivePlayer` condition.
- `tests/e2e/virus-system.spec.ts` — `endCurrentPlayerTurn` helper now chains `end-play-phase → pull-viruses` when phase lands on `virus_pull` (300ms settle + REST check, then calls pull-viruses if needed).

## Commits

- `aa80e81` Add virus_pull phase: migration, types, and log schema
- `570bc44` Add pull-viruses edge function; update end-play-phase to virus_pull
- `eba0b43` Board redesign: virus_pull phase UI
- `cb2adcf` Tests: update virus-system endCurrentPlayerTurn to chain pull-viruses
- (docs commit follows)

## Test status

Build clean. Canary suite 8/8 pass (abort-mission 3, error-handling 1, multi-mission 3, turn-order 1). abort-mission test 1 got a cold-start 503 on first run (freshly deployed function) — clears on re-run, pre-existing pattern.

## Suggested next step

Per UX_DESIGN.md ordering, virus_resolution visual pass is next. The existing VirusResolution.tsx still uses the old non-redesigned layout — it needs the same visual treatment as the other phase components (styled within the 1064×200 ActionRegion). Check UX_DESIGN §7.x for the spec.
