# Latest Task

## Summary
Fixed Bug 1 and Bug 2 from DIAGNOSIS_2026-05-30.md in two commits.

**Commit 1 — Bug 2 (reveal slot relocation):** The card reveal slot was anchored to the chip's outside edge — clipped by the firewall for chips A/D, and colliding with the resource [-]/[+] buttons during resource_allocation (which now shows the slots, per Bug 1 fix). Relocated to below the chip body, centered (slotX=chipX+50). Top chips: slotY=chipY+123 (SVG y=203), bottom: chipY+94 (SVG y=414). Verified no collision with firewall (x=421), adjacent chips, or [-]/[+] buttons (chip-local x=171–197). SLOT_SIDES constant removed; RevealSlotGroup simplified (no slotSide param). UX_DESIGN §5.6 updated with new coordinates.

**Commit 2 — Bug 1 (reveal persistence):** `isRevealPhase` in GameBoard.tsx was `phase === "card_reveal"` only. Revealed card data already persists in DB until end-play-phase — only the UI gate was wrong. Extended to include `resource_allocation`. New test in card-reveal.spec.ts asserts revealed slots visible in resource_allocation and gone at player_turn.

## Files changed
- `components/game/board/CentralBoard.tsx` — reveal slot moved outside chip body group at chipX+50 / chipY+123|+94; SLOT_SIDES removed; AIChipGroup `slotSide` prop removed; RevealSlotGroup `slotSide` param removed
- `UX_DESIGN.md` — §5.1 bullet updated; §5.6 heading and body updated with below-chip coordinates
- `components/game/GameBoard.tsx` — `isRevealPhase` extended to include `resource_allocation`
- `tests/e2e/card-reveal.spec.ts` — added `advanceThroughCardReveal` helper + new persistence test

## Test status
- `next build`: clean (both commits)
- New test written and syntactically verified; full E2E suite not run (scoped BACKLOG fix)

## Suggested next
Continue DIAGNOSIS_2026-05-30.md — Bugs 3–8 remain. Priority order per diagnosis: Bug 6 (resolveInFlightRef reset allows concurrent empty-queue advances, MEDIUM), Bug 5+8 (refillVirusPool double-fill race, HIGH — Bug 6 fix closes the double-refill pool-corruption path but a separate double-CF concurrency race remains uncharacterized and is NOT closed by the Bug 6 fix — characterize before marking 5+8 resolved), Bug 3 (CentralBoard "×? cards" hand-stack: literal "?" placeholder never wired to a real count, and stack renders only on top two chips; proper fix likely needs a server-side hand_count column due to RLS, MEDIUM). Or from BACKLOG: virus resolution auto-resolve UX cleanup, abort mission timing window, multi-card play.
