# Latest Task

**Task:** VirusPoolPanel live count
**Date:** 2026-04-27
**Status:** DONE

## What shipped

- `components/game/board/VirusPoolPanel.tsx` — now accepts `{ poolCount, pendingPullCount, phase }` props. Header renders `"VIRUS POOL · N CARD(S)"` dynamically; during `virus_pull` appends `"· M TO DRAW"` from `pendingPullCount`. Count label `×N` uses live `poolCount`.
- `components/game/GameBoard.tsx` — virus_pool count added to the 3s poll (`head: true` count query, no full rows). Realtime channel now subscribes to `virus_pool` INSERT and DELETE for live increment/decrement; poll corrects any drift within 3s. `VirusPoolPanel` receives `poolCount`, `game.pending_pull_count`, and `game.phase`.

## Commits

- `8acaf29` VirusPoolPanel live count: poll + Realtime

## Test status

Build clean. Canary suite 20/21 pass — only failure was `abort-mission:164` Chromium worker crash (`0xC0000409`) in the combined run; isolated run 3/3 pass (pre-existing Windows Chromium flake). `mission-rules` 10/10 pass (1 pre-existing flaky test skipped).

## Suggested next step

Per UX_DESIGN.md ordering, `virus_resolution` visual pass is next. The existing `VirusResolution.tsx` still uses the old non-redesigned layout — it needs the same treatment as the other phase components (styled within the 1064×200 ActionRegion). Check UX_DESIGN §7.x for the spec.
