# Latest Task

## Summary

Density pass for the player_turn view. Three ordered commits:

**Commit 1 (ac72949):** Removed the staging zone banner (orphaned text that was clipped by overflow:hidden in ActionRegion). Added a compact inline hint below the "Stage for Pool" button: `staged ×N · M more` or `staged ×N · ready`, 9pt amber monospace. Updated UX_DESIGN §7.1 to reference the new mockup.

**Commit 2 (fabaa06):** CentralBoard SVG height 500→470 (shrank internal coordinate space to reclaim vertical room). ActionRegion top 688→658, height 200→230 — gives the hand 30px more vertical room and matches the shortened SVG.

**Commit 3 (7329767):** Visual bumps throughout — cards 110×120→120×150 with restructured body (type label 9pt header, name 14pt + icon 28pt in body), flex gap 10→24 (stride 144px). CPU track 10×10→11×11 stride 12, RAM 6×10→7×11, chip labels 10→11pt. Contribution row 11→13pt bold, separator dots removed. TrackerBars values 11→14pt bold, bars 6→8px height. MissionPanel: name 16→15pt, description 11→12pt, req labels+values 11→13pt (values bold). Fixed unused `dotSep` variable that caused build error.

## Files changed

- `components/game/phases/PlayerTurn.tsx` — staging banner removed, inline hint added; card 120×150 + body restructure + gap 24
- `components/game/board/CentralBoard.tsx` — SVG height 470, corner traces updated, ellipse ry adjusted; chip tracks bumped; contribution row fontSize 13 bold no dots; dotSep removed
- `components/game/board/ActionRegion.tsx` — top 658, height 230
- `components/game/board/TrackerBars.tsx` — value fontSize 14 bold, bars height 8
- `components/game/board/MissionPanel.tsx` — name 15, description 12, req labels+values 13 (values bold)
- `UX_DESIGN.md` — §7.1 staging hint + mockup reference updated
- `mesa_mockups/mockups/mockup_player_turn_density_pass.html` — committed as visual reference (453749d)

## Test status

- `next build` — clean (3 commits, each verified)
- Canary + hand-stability + abort-mission: pending (running at time of this write)

## Suggested next

1. **Right-side whitespace** — RightPanel could be wider, or the board left+central region could shift. Currently both density BACKLOG items are PARTIAL (player_turn done); other phases and the right-side real estate issue remain.
2. **Text size in other phases** — game log entries still small; other phase component text not bumped.
3. **Manual playtest** — verify hand cards render correctly at 1440×900, no overflow clipping, staging hint visible.
