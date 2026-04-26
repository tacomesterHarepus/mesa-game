# BACKLOG

Ideas and polish items that aren't blocking current phases. Add freely; prioritize before each sprint.

---

## UX Polish

- **Draw cards animation** — When an AI's turn starts, cards should visibly draw from a deck into the hand rather than snapping in. Reinforces the physical card game metaphor and makes draw-count bugs obvious to observers without checking the DB. Priority: medium. Scope: part of the broader game-feel pass, not a standalone feature. *(Reported: 2026-04-25 playtest)*

- **Active turn indicator** — *(Resolved: ring-2 ring-amber/40 added to isActive branch in PlayerRoster.tsx, 2026-04-24)*

- **ResourceAllocation base-stat clarity** — The allocation UI only shows the delta controls (+CPU / +RAM, starting at 0), which caused playtester to misread AI stats as 0/0. Should clearly show each AI's current CPU/RAM, plus a live preview of the post-allocation value (current + delta) as the human adjusts. *(Reported: first dev-mode playthrough)*

- **VirusResolution should auto-resolve without user clicks** — The VirusResolution UI requires a manual "Resolve Virus" button click per card. Per spec: "Cards equal to viruses generated are revealed and resolved one at a time from the top of the pool." The intended UX is automatic sequential resolution with brief delays between cards (for log/drama), not a manual click-to-advance flow. Each card should be revealed and its effect applied automatically; only the final state (next phase) requires acknowledgement. *(Reported: Phase 2 playtest 2026-04-25)*

- **Abort Mission timing window** — The "Abort Mission" button is only visible between AI turns in round 2, but the next AI's turn begins immediately when the previous one ends. The window is too short for deliberation in practice. Options to consider: (a) add a brief frozen/paused state between AI turns in round 2 where the abort button is active and the next turn cannot start; (b) require at least one human to explicitly confirm "no abort" before the next AI turn proceeds; (c) widen the window to all of round 2, not just between turns, so humans can abort at any point mid-turn. Each option has trade-offs around game pacing and how AI turns are gated server-side. *(Added 2026-04-26)*

---

- **GameLog initial load capped at 100 rows** — `app/game/[gameId]/page.tsx` fetches game_log with `.limit(100)`. Long games (3+ missions with virus chains) can easily generate 150+ events. Earliest entries drop off silently — there is no pagination, infinite-scroll, or "load more" control. Options: (a) raise the limit (200–300) as a short-term fix; (b) lazy-load older entries when the user scrolls to the top of the log container; (c) split the log into per-mission pages. The Realtime subscription is not affected (it appends new rows indefinitely). *(Added Phase 11 Session B, 2026-04-27)*

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

- **`hands` table has no stable ordering column** — Using sort-by-id as a UI workaround to prevent card reordering across polling cycles. If we ever want meaningful ordering (draw order, card type grouping), add a `position` column to `hands` and update `drawCardsForPlayer` to assign sequential positions on INSERT. Low priority while the sort-by-id UX is acceptable. *(Added during Bug B fix, 2026-04-25)*

- **ResourceAdjustment and ResourceAllocation initialise from stale props** — Both components initialise their adjustment/delta state from `aiPlayers` props at mount time. If the component is reused across missions without unmounting (or if player stats change between mount and interaction), the initial values may be stale. No regression path identified yet; worth verifying when ResourceAdjustment is first exercised in a multi-mission playtest. *(Surfaced during Bug 3 audit)*

---

## Future Features

- **End game early** — Host or unanimous-player vote to terminate an in-progress game without a winner. Should set `games.winner = 'aborted'` (new enum value) or similar, transition to `game_over`, and handle the end screen gracefully (role reveal and stats may be suppressed or shown as-is). Useful for: abandoned games that started by mistake, dev testing cleanup, players who need to quit before completion. Open questions: who can trigger it (host-only vs. unanimous vote), what the end screen shows, whether the game counts toward stats. *(Added 2026-04-26)*

- **Captain role for humans** — Consider restricting human actions (resource adjustment, allocation, mission abort) to a single "captain" human rather than any human. Needs design decisions: captain selection (random/voted/rotating), mid-game reassignment, scope (which actions are captain-only vs. all-humans). Rationale: clearer decision-making, reduced coordination friction, more social-deduction-game feel. Defer until after first multi-human playtest confirms coordination is actually a problem. *(Reported: design review, not yet tested)*
