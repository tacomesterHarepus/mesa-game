# BACKLOG

Ideas and polish items that aren't blocking current phases. Add freely; prioritize before each sprint.

---

## UX Polish

- **Active turn indicator** — *(Resolved: ring-2 ring-amber/40 added to isActive branch in PlayerRoster.tsx, 2026-04-24)*

- **ResourceAllocation base-stat clarity** — The allocation UI only shows the delta controls (+CPU / +RAM, starting at 0), which caused playtester to misread AI stats as 0/0. Should clearly show each AI's current CPU/RAM, plus a live preview of the post-allocation value (current + delta) as the human adjusts. *(Reported: first dev-mode playthrough)*

---

## Game Balance

*(empty)*

---

## Tech Debt

- **`place-virus` leaves deck_cards rows in 'drawn' status** — When an AI places a card into the virus pool, `place-virus` removes it from `hands` but never updates the corresponding `deck_cards` row (stays `status='drawn'` indefinitely). The draw-cards reshuffle logic ignores 'drawn' rows so it won't accidentally re-deal them, but the `deck_cards` table is inconsistent. Should transition to a new status (e.g. `'in_virus_pool'`) or clean up so reshuffle logic doesn't treat virus pool cards as held-but-available. *(Surfaced during Bug 2 diagnosis)*

- **CardReveal `selectedCard` not reset on dev-mode player switch** — Fixed as part of Bug 3 (the `useEffect` reset now handles both `selectedCard` and `loading`). *(Resolved)*

- **`loading` not reset on success path — MissionSelection, ResourceAllocation, ResourceAdjustment** — All three components have the same bug as CardReveal Bug 3: `handleSelect` / `handleSubmit` / `handleConfirm` call `setLoading(true)` but the success path never calls `setLoading(false)`. In practice this is harmless because the phase changes immediately after submission (the button disappears), but it is the same root cause and should be cleaned up in the UI polish phase. *(Surfaced during Bug 3 audit)*

- **SecretTargeting `selectedTargetId` not reset on dev-mode player switch** — `SecretTargeting.tsx` initialises `selectedTargetId` to the first AI's ID at mount. When switching between misaligned AIs via PlayerSwitcher the selected target carries over, so voting as misaligned AI 2 after misaligned AI 1 could accidentally submit the same (possibly wrong) target without the user noticing. Fix: `useEffect(() => { setSelectedTargetId(aiTargets[0]?.id ?? ""); }, [currentPlayer?.id])`. Actionable before any UI-driven secret-targeting testing. *(Surfaced during Bug 3 audit)*

- **PlayerTurn `error` persists when switching away and back** — `error` state in `PlayerTurn.tsx` is not reset on player switch. If AI X gets a play-card error, switching to another player and back shows the stale error. Minor UX annoyance; only visible when `isMyTurn && isAI`, so it cannot bleed to a different player. Low priority. *(Surfaced during Bug 3 audit)*

- **ResourceAdjustment and ResourceAllocation initialise from stale props** — Both components initialise their adjustment/delta state from `aiPlayers` props at mount time. If the component is reused across missions without unmounting (or if player stats change between mount and interaction), the initial values may be stale. No regression path identified yet; worth verifying when ResourceAdjustment is first exercised in a multi-mission playtest. *(Surfaced during Bug 3 audit)*

---

## Future Features

- **Captain role for humans** — Consider restricting human actions (resource adjustment, allocation, mission abort) to a single "captain" human rather than any human. Needs design decisions: captain selection (random/voted/rotating), mid-game reassignment, scope (which actions are captain-only vs. all-humans). Rationale: clearer decision-making, reduced coordination friction, more social-deduction-game feel. Defer until after first multi-human playtest confirms coordination is actually a problem. *(Reported: design review, not yet tested)*
