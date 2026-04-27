# Latest Task

**Task:** game_log Realtime miss — poll backup + scroll fix
**Date:** 2026-04-27
**Status:** DONE

## What shipped

- `components/game/GameBoard.tsx` — Extended 3s poll to fetch last 50 `game_log` rows and append any not yet in state (id-dedup via `Set`). `gameId` referenced only in the fetch query (not inside `setLog` callback) to avoid stale-closure risk on game switch. Comment added noting `game_log` is append-only so dedup is safe.
- `components/game/board/RightPanel.tsx` — Replaced `mountedRef` + post-render `distFromBottom` check with `wasAtBottomRef` tracked via scroll event listener. Fixes auto-scroll for batch additions (poll catch-up): old approach measured distance *after* content grew, giving a falsely large gap. New approach captures "was at bottom?" before the render fires.

## Commits

- `2367e18` game_log poll backup + scroll fix

## Test status

Build clean. game-log-ui 3/3 pass (1 skipped per phase discipline). Canary 8/8 pass (abort-mission 3, error-handling 1, multi-mission 3, turn-order 1). abort-mission test 2 had a one-off timing flake in the full-suite run — cleared on isolated re-run, pre-existing pattern.

## Suggested next step

Per UX_DESIGN.md ordering, `virus_resolution` visual pass is next. The existing `VirusResolution.tsx` still uses the old non-redesigned layout — it needs the same visual treatment as the other phase components (styled within the 1064×200 ActionRegion). Check UX_DESIGN §7.x for the spec.
