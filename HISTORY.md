# HISTORY — Completed Phase Details

Reference material for completed work. Read when revisiting past decisions; not needed on every session start.

## Index

- [Phase 7.5 — Virus Placement UI + Bug Fixes](#phase-75--virus-placement-ui--bug-fixes)
  - [Item A: Spec confirmation (virus count formula)](#item-a--spec-question)
  - [Item B: Virus placement UI in PlayerTurn.tsx](#item-b--virus-placement-ui)
  - [Item C: _shared/advanceTurnOrPhase consolidation](#item-c--advanceturnorphase-consolidation)
  - [Item D: Missing draw paths (two root causes)](#item-d--missing-draw-paths)
  - [Item E: active_mission + hands in 3s polling loop](#item-e--polling-loop-additions)
  - [Item F: Own alignment shown to AI players](#item-f--own-alignment-display)
- [Bug Fix Session (post-Phase 9)](#bug-fix-session-post-phase-9)
  - [Bug 1: AI stats showed 0/0 (false alarm)](#bug-1--ai-stats-showed-00)
  - [Bug 2: Cards not drawn after round 1](#bug-2--cards-not-drawn-after-round-1)
  - [Bug 3: CardReveal button stuck on "···"](#bug-3--cardreveal-button-stuck)

---

## Phase 7.5 — Virus Placement UI + Bug Fixes

*Diagnosed in `DIAGNOSIS_2026-04-24.md`. All items complete.*

### Item A — Spec question

**Answer confirmed:** Virus placement count = virus generation count = `min(2, base + bonus)` where `base = cpu >= 2 ? 1 : 0` and `bonus = cardsPlayed >= 3 ? 1 : 0`. Placement UI enforces exactly that many cards.

---

### Item B — Virus placement UI

**Phase 2 (UI) — commit 9266673**

Staging zone added to `PlayerTurn.tsx`. Key design decisions:
- N = `min(2, (cpu >= 2 ? 1 : 0) + (cardsPlayedThisTurn >= 3 ? 1 : 0))`
- CPU 1: N=0, staging zone never shown
- CPU 2: N=1 always (can't play 3 cards with CPU=2)
- CPU 3/4: N=1 initially, becomes N=2 when 3rd card played (live recalculation)
- Staging is local UI state until End Turn — other players see nothing during staging
- If hand exhausted before quota met, End Turn unblocks (can't stage what you don't have)
- Staged cards: virus-colored ring, click to unstage
- Virus cards in hand are non-interactive (greyed) when virusCount=0

**Phase 3 (backend wiring) — commit c379eba**

`handleEndTurn` calls `place-virus` for each staged card sequentially before `end-play-phase`. On any `place-virus` failure, shows error and aborts without calling `end-play-phase`.

`tests/e2e/virus-placement.spec.ts`: stages a card via UI, clicks End Turn, verifies `pool.count(K) + queue.count(K)` increased by exactly 1. Mathematical proof: staged card added at highest pool position, 1 drawn card comes from lowest — net count always +1 regardless of card key overlap.

---

### Item C — advanceTurnOrPhase consolidation

**Problem:** `end-play-phase` and `resolve-next-virus` each had a full copy of `advanceTurnOrPhase`. Bug 2's `drawCardsForPlayer` fix applied to `end-play-phase` only — the copy in `resolve-next-virus` was missing both draw calls, so the virus-path turn advancement never drew cards.

**Fix:**
- Created `supabase/functions/_shared/advanceTurnOrPhase.ts` with canonical implementation (both `drawCardsForPlayer` calls)
- Updated both functions to import from `../_shared/`
- Deployed via CLI — Dashboard single-file upload doesn't support `_shared/` imports

---

### Item D — Missing draw paths

**Root cause 1 — resolve-next-virus:** Fixed by Item C (shared `drawCardsForPlayer`).

**Root cause 2 — allocate-resources first player:** `allocate-resources` transitioned to `player_turn` via direct `games.update` with no `drawCardsForPlayer` call. After a RAM bump (e.g. +2 RAM), the first player started their turn with fewer cards than their new RAM allowed. Fix: call `drawCardsForPlayer` for `turn_order_ids[0]` at the end of `allocate-resources`. Deployed as v5.

New tests in `draw-cards.spec.ts`:
- CPU≥2 test: covers the virus → resolve-next-virus draw path
- RAM bump test: covers the allocate-resources first-player draw path

---

### Item E — Polling loop additions

**Problem:** `active_mission` and `hands` were Realtime-only. A missed INSERT/UPDATE event left the mission progress bar permanently stale or newly drawn cards invisible for the session.

**Fix (in `GameBoard.tsx`):** Added `active_mission` and current player's hand to the 3s `Promise.all` poll. Uses `maybeSingle()` for `active_mission` — the row doesn't exist during lobby/resource_adjustment/etc. Hand sorted by `id` to maintain stable display order across polls.

---

### Item F — Own alignment display

**Problem:** `roleDisplay()` in `PlayerRoster.tsx` returned `"AI"` for both `aligned_ai` and `misaligned_ai`. Players had no way to confirm their own alignment in a real game.

**Fix:** Role banner in `GameBoard.tsx` right panel, shown to `effectiveCurrentPlayer` when `isAI`. RLS allows each player to always read their own `role` field — no policy change needed.

---

## Bug Fix Session (post-Phase 9)

*Three bugs found during first full dev-mode playthrough.*

### Bug 1 — AI stats showed 0/0

- **Root cause:** Playtester misread `+CPU 0 / +RAM 0` allocation delta controls in `ResourceAllocation.tsx` as base stats. DB always had correct defaults (cpu=1, ram=4).
- **Fix:** Defensive change in `start-game` v7: explicitly sets `cpu: 1, ram: 4` during role assignment rather than relying on DB defaults.
- **BACKLOG:** ResourceAllocation should show current stat + post-allocation preview, not just the delta.

### Bug 2 — Cards not drawn after round 1

- **Root cause:** Draw step never implemented. `advanceTurnOrPhase` in `end-play-phase` transitioned turn order correctly but never refilled hands.
- **Fix:** Added `drawCardsForPlayer` helper to `end-play-phase`. Called in both turn-advance locations (within-round advance and round-2 start). Handles deck exhaustion by reshuffling `discarded` cards. Deployed as v6 (later extracted to `_shared/` in Item C → v7).
- **Regression test:** `tests/e2e/draw-cards.spec.ts` — verifies first AI's hand count equals RAM at start of round 2.
- **BACKLOG:** `place-virus` leaves `deck_cards` rows in `'drawn'` status; inconsistent but harmless (reshuffle logic ignores them).

### Bug 3 — CardReveal button stuck on "···"

- **Root cause:** `handleReveal()` called `setLoading(true)` but the success path never called `setLoading(false)`. `CardReveal` doesn't remount when DevModeOverlay player switches, so `loading=true` persisted for every subsequent AI.
- **Fix:** Moved `setLoading(false)` outside the error branch (runs on both success and error). Added `useEffect` that resets `loading`, `selectedCard`, and `error` on `currentPlayer?.id` change.
- **Regression test:** `tests/e2e/card-reveal.spec.ts` — verifies "Reveal Card" button text visible after switching to next AI.
- **BACKLOG:** Same pattern in MissionSelection, ResourceAllocation, ResourceAdjustment (`loading` not reset on success). `SecretTargeting` `selectedTargetId` not reset on player switch.
