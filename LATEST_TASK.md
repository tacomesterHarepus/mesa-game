# Latest Task

## Summary
Fixed Bug 7 from DIAGNOSIS_2026-05-30.md. `computeBlocked` in `PlayerTurn.tsx` covered only `dataset_integration`; Dataset Preparation's "no Compute until 4 Data" rule was enforced server-side only. Users could click Compute, trigger a round-trip, and receive an error rather than being blocked at the card. Client-side fix: `computeBlocked` now also returns `true` for `dataset_preparation` when `data_contributed < 4`. Hint text updated to be mission-specific. `aria-disabled` and `data-card-key` attributes added to `CardStackGroup` so tests can reliably select and assert disabled state. Server block in `play-card/index.ts` untouched.

## Files changed
- `components/game/phases/PlayerTurn.tsx` — `computeBlocked` extended to cover `dataset_preparation`; hint text conditional on mission key; `CardStackGroup` outer div gains `data-card-key={cardKey}`, button gains `aria-disabled={disabled ? "true" : undefined}`
- `tests/e2e/mission-rules.spec.ts` — added `endTurnViaAPI` helper; added Test 4b: asserts `[data-card-key="compute"] button[aria-disabled="true"]` present when data < 4, absent after 4 Data contributed via loop

## Test status
- `next build`: clean
- Test 4b written and syntactically verified; conditional on `dataset_preparation` being drawn — skips otherwise (same pattern as Test 4); full E2E suite not run (scoped BACKLOG fix)

## Suggested next
Continue DIAGNOSIS_2026-05-30.md — Bugs 3, 5+8, 6 remain. Priority order per diagnosis: Bug 6 (resolveInFlightRef reset allows concurrent empty-queue advances, MEDIUM), Bug 5+8 (refillVirusPool double-fill race, HIGH — Bug 6 fix closes the double-refill pool-corruption path but a separate double-CF concurrency race remains uncharacterized and is NOT closed by the Bug 6 fix — characterize before marking 5+8 resolved), Bug 3 (CentralBoard "×? cards" hand-stack: literal "?" placeholder never wired to a real count, and stack renders only on top two chips; proper fix likely needs a server-side hand_count column due to RLS, MEDIUM). Or from BACKLOG: virus resolution auto-resolve UX cleanup, abort mission timing window, multi-card play.
