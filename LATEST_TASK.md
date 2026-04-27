# Latest Task

## Summary
Board redesign — virus_resolution visual pass. CentralBoard gains a `VirusCardOverlay` SVG component that renders the resolving virus card at board position (650, 350) — dark red theme (`#1a0a0a` bg, `#a32d2d` border), pacing bar using SMIL `<animate>`, per-card type label / display name / icon / effect lines from lookup tables, and a `↳ TRIGGERED` badge when the card cascaded. A `dimCore` prop dims the CoreChipGroup to 30% opacity during resolution. GameBoard adds `virusQueue` state with a phase-gated Realtime subscription to `virus_resolution_queue`, threading `currentCard` / `remaining` props down to VirusResolution and `dimCore` / `virusResolvingCard` to CentralBoard. VirusResolution is fully rewritten: no more internal subscription or manual "Resolve Virus" button — a `useEffect` keyed on `currentCard?.id` fires `resolve-next-virus` after 2s (matching the pacing bar) or 500ms for the empty-queue advance. Error fallback shows a manual Continue button. ActionRegion already had the muted-red "AUTO-RESOLVING" header from a prior partial commit. virus-system.spec.ts rewired: removed old button-click assertions, added three new assertions (no Resolve button visible, valid phase via REST, phase auto-advances within 30s).

## Files changed
- `components/game/board/CentralBoard.tsx` — added `VirusResolvingCard` interface, lookup tables (`VIRUS_TYPE_LABEL`, `VIRUS_DISPLAY_NAME`, `VIRUS_EFFECT_LINES`), `VirusCardOverlay` component, `dimCore` + `virusResolvingCard` props; `CentralBoard` body updated to use them
- `components/game/board/ActionRegion.tsx` — `virus_resolution` header case + muted-red `headerColor`
- `components/game/GameBoard.tsx` — import `VirusResolvingCard`; `QueueCard` interface; `virusQueue` state; phase-gated subscription `useEffect`; `dimCore` + `virusResolvingCard` → CentralBoard; `currentCard` + `remaining` → VirusResolution
- `components/game/phases/VirusResolution.tsx` — full rewrite: auto-resolve loop, CSS pacing bar, error fallback, props from GameBoard
- `tests/e2e/virus-system.spec.ts` — removed manual button tests, added `sharedGameId`, three new phase-polling assertions

## Test status
- virus-system.spec.ts: 3/3 pass
- Canary (error-handling, turn-order, multi-mission, abort-mission): 8/8 pass
- build: clean

## Suggested next
Per UX_DESIGN ordering, the next board redesign tasks are the **end-game screen** (§10 — game_over phase visual) or the **end-of-redesign test cleanup pass** (unskip all `.skip`'d UI tests, run full suite, fix remaining stale selectors). The test cleanup pass is the safer next step: it validates the whole redesign end-to-end before adding more. See CLAUDE.md "End of redesign" section for the procedure.
