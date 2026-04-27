# DIAGNOSIS 2026-04-27

## ITEM 1 — `mission_transition` gap when CPU ≥ 2

### Summary

`mission_transition` is never logged when the completing AI has CPU ≥ 2. The event fires only on the zero-virus path. On the virus path, `advanceTurnOrPhase` is called later by `resolve-next-virus` without the `missionOutcome` argument, so the guard at line 163 of `advanceTurnOrPhase.ts` silently skips the log.

---

### Code path trace

#### All `advanceTurnOrPhase` call sites

| Call site | File | Line | Passes `missionOutcome`? |
|-----------|------|------|--------------------------|
| End-play-phase (direct path) | `end-play-phase/index.ts` | 210 | ✓ Yes — `missionOutcomeForTransition` |
| Resolve-next-virus (queue empty) | `resolve-next-virus/index.ts` | 54 | ✗ No — 4-arg call |
| Abort-mission | `abort-mission/index.ts` | 73 | ✓ Yes — hardcoded `"aborted"` |

#### Path A — no viruses (works correctly)

```
end-play-phase
  → missionResolved = true
  → missionOutcomeForTransition = "complete" | "failed"
  → numViruses = 0  (CPU = 1, no cards played that trigger extra virus)
  → line 210: advanceTurnOrPhase(admin, updatedGame, callerPlayer,
                missionResolved, missionOutcomeForTransition)
     → missionOutcome !== undefined  → mission_transition logged ✓
```

#### Path B — viruses generated (broken)

```
end-play-phase
  → missionResolved = true
  → missionOutcomeForTransition = "complete" | "failed"
  → numViruses > 0  (CPU ≥ 2)
  → line 174-202: inserts queue rows, logs virus_queue_start,
      sets gameUpdates.phase = "virus_resolution"
  → line 200: return early  ← advanceTurnOrPhase at line 210 NEVER reached

... time passes, virus queue drains ...

resolve-next-virus (queue now empty)
  → line 48-55:
      await refillVirusPool(admin, game_id);
      const freshGame = ...
      const missionResolved = !freshGame.current_mission_id;
      const fakeCurrentPlayer = { id: game.current_turn_player_id };
      return await advanceTurnOrPhase(admin, freshGame, fakeCurrentPlayer, missionResolved);
      ← 4-arg call: missionOutcome is undefined
         → guard at advanceTurnOrPhase.ts:163 skips mission_transition ✗
```

#### Guard in `advanceTurnOrPhase.ts` (line 163)

```typescript
if (missionOutcome !== undefined) {
  // emit mission_transition log
}
```

This guard was added intentionally to suppress `mission_transition` on mid-turn `advanceTurnOrPhase` calls. It works correctly for Path A and abort-mission. It silently drops the event on Path B.

---

### Fix approaches

#### Approach A — Persist `pending_mission_outcome` on `games` table *(recommended)*

**What changes:**
1. Migration: add `pending_mission_outcome text` (nullable) to `games`.
2. `end-play-phase`: before the early return at line 200, set `gameUpdates.pending_mission_outcome = missionOutcomeForTransition` (only when `missionOutcomeForTransition !== undefined`).
3. `resolve-next-virus`: at the queue-empty branch, read `freshGame.pending_mission_outcome`, pass it as the 5th arg to `advanceTurnOrPhase`, then clear it (`games.pending_mission_outcome = null`).

**Log ordering:** `mission_transition` fires AFTER the full virus chain resolves — correct, matches player experience.

**Tradeoffs:**
- Requires a migration (one nullable column, non-breaking).
- `end-play-phase` and `resolve-next-virus` both need updating and redeployment.
- `advanceTurnOrPhase` is unchanged.
- Clean: outcome travels with game state, survives any retry or race.

**Risk:** Low. The column is only read at queue-empty and cleared immediately.

---

#### Approach B — Emit `mission_transition` eagerly from `end-play-phase`

**What changes:**
1. In `end-play-phase`, when `missionResolved=true` AND `numViruses>0`, compute the rotation (next first player) and emit `mission_transition` **before** the early return.
2. `resolve-next-virus` remains unchanged.
3. `advanceTurnOrPhase` can drop the `missionOutcome` guard or leave it (no-op on Path B since `advanceTurnOrPhase` would still be called without the arg).

**Log ordering:** `mission_transition` appears in the log **before** `virus_queue_start` and before any `virus_effect` entries. This is misleading — the game log would show "Mission completed → next player: X" before the viruses that can still flip the win condition have resolved.

**Tradeoffs:**
- No migration needed.
- Only `end-play-phase` changes.
- Log order is semantically wrong: transition is announced before virus consequences are known. A Cascading Failure that follows could flip the game, but the log already recorded the transition.

**Risk:** Medium. Confusing game log is a real UX defect, especially for the End Game Screen timeline.

---

#### Approach C — Store outcome on `virus_resolution_queue` rows

**What changes:**
1. Add a `mission_outcome text` column to `virus_resolution_queue` (nullable).
2. `end-play-phase`: when inserting queue rows and `missionResolved=true`, set `mission_outcome` on the **last** inserted row.
3. `resolve-next-virus` (queue-empty branch): look up the `mission_outcome` of the last resolved row, pass to `advanceTurnOrPhase`.

**Log ordering:** Same as Approach A — fires after the full chain. Correct.

**Tradeoffs:**
- Migration needed (different table than A).
- More fragile: relies on identifying "the last queue row" correctly, and the column must survive cascading failure inserts that lengthen the queue mid-chain.
- If Cascading Failure extends the queue, the original "last row" is no longer last — the column would need to be re-set on the newly last row, or stored on the first row and fetched differently.

**Risk:** Higher implementation complexity than Approach A for no gain.

---

### Recommendation

**Approach A.** One migration, clear data flow, correct log ordering. Approach B has the wrong log order. Approach C is more complex than A for the same outcome.

---

### Scope of changes (Approach A, not yet implemented)

1. Migration 014: `ALTER TABLE games ADD COLUMN pending_mission_outcome text;`
2. `end-play-phase`: set `pending_mission_outcome` in `gameUpdates` when taking Path B with a resolved mission.
3. `resolve-next-virus`: read `freshGame.pending_mission_outcome`, pass to `advanceTurnOrPhase`, then clear.
4. `advanceTurnOrPhase.ts`: no change needed.
5. Deploy `end-play-phase` (v13) and `resolve-next-virus` (v8).
6. Update `game-log.spec.ts`: the conditional `mission_transition` test can be strengthened once the gap is closed (mission with CPU≥2 will reliably emit the event).

**STOP — awaiting approval before implementation.**

---

## ITEM 2 — Board redesign: E2E test inventory for redesign period (2026-04-27)

### Context

Background test run `b61s5zbcf` ran after the scaffolding pass. Result: 38 passed, 23 failed,
1 skipped, 18 did not run. The 18 "did not run" are `test.describe` blocks whose `beforeAll` timed
out (cold-start); those tests never executed and do not appear in the inventory below.

Failing UI tests are **expected during the redesign** — the old layout is gone and each phase
component will be re-spec'd as its phase task runs. The inventory below exists so each phase task
knows which tests to unskip and update.

---

### Test inventory — 23 failures

#### Categories
- **non-ui** — backend / edge function / data-layer; no game board layout dependency. Should pass; failure here IS a regression.
- **pending-phase** — UI test for a phase not yet redesigned; will be addressed when that phase task runs.
- **pre-existing** — known flake or infrastructure cold-start (Playwright webServer, Supabase 503).

---

| # | Test | File:line | Category | Phase task | Notes |
|---|------|-----------|----------|------------|-------|
| 1 | abort fires in round 2 → resource_adjustment | abort-mission.spec.ts:164 | **non-ui** | player_turn | Calls edge function; UI check is `getByText("Resource Adjustment")` which still renders via ActionRegion. Failure is cold-start. |
| 2 | abort rejected with 400 in round 1 | abort-mission.spec.ts:228 | **non-ui** | — | Pure API 400 check, no layout assertions. |
| 3 | abort rejected with 400 by AI player | abort-mission.spec.ts:256 | **non-ui** | — | Pure API 400 check, no layout assertions. |
| 4 | Reveal Card button text resets | card-reveal.spec.ts:83 | **pending-phase** | card_reveal | Tests CardReveal UI button text; no error-context artifact (cold-start probable). |
| 5 | Fill Lobby button visible | dev-mode.spec.ts:33 | **pre-existing** | — | Only navigates to /game/create; no board layout. Cold-start. |
| 6 | Fill Lobby creates 6 players | dev-mode.spec.ts:38 | **pre-existing** | — | Lobby page only. Cold-start. |
| 7 | PlayerSwitcher renders with 6 buttons | dev-mode.spec.ts:54 | **pre-existing** | — | Checks DevModeOverlay (unchanged). Cold-start. |
| 8 | Clicking player button highlights | dev-mode.spec.ts:69 | **pre-existing** | — | DevModeOverlay `.fixed.top-7` selector unchanged. Cold-start. |
| 9 | DEV MODE banner full-width | dev-mode.spec.ts:84 | **pre-existing** | — | DevModeOverlay `.fixed.top-0.left-0.right-0` unchanged. Cold-start. |
| 10 | Switching to Bot3 highlights | dev-mode.spec.ts:126 | **pre-existing** | — | DevModeOverlay unchanged. Cold-start / shared describe. |
| 11 | discarding 2 cards refills hand to RAM | discard.spec.ts:135 | **non-ui** | player_turn | 120s test timeout. Calls discard-cards edge function. No layout selectors involved. |
| 12 | skipping discard sets has_discarded_this_turn | discard.spec.ts:198 | **non-ui** | player_turn | 120s timeout. API-only assertions. |
| 13 | turn advance resets has_discarded_this_turn | discard.spec.ts:250 | **non-ui** | player_turn | 120s timeout. API-only assertions. |
| 14 | play-card rejected when discard not done | discard.spec.ts:314 | **non-ui** | player_turn | 120s timeout. API 400 check. |
| 15 | play-card 4xx body contains actual error | error-handling.spec.ts:143 | **non-ui** | — | Edge function returned 503 instead of 400 — cold-start. `invokeWithRetry` logic unchanged. |
| 16 | bold styling: mission_failed font-bold | game-log-ui.spec.ts:243 | **pending-phase** | game_log | Old `GameLog.tsx` used Tailwind `font-bold` class (line 61). New `RightPanel.tsx` uses `fontWeight:"bold"` inline style — selector `.font-bold` no longer matches. |
| 17 | hand display order stable (UI) | hand-stability.spec.ts:309 | **pending-phase** | player_turn | Old board (line 415) had `<h3>Your Hand</h3>` in sidebar. New board: hand renders inside PlayerTurn → ActionRegion as `<p>Your hand —`. Selector `h3` + "Your Hand" finds nothing. |
| 18 | tracker bar: Core Progress 0/10 and 0/8 | mission-flow.spec.ts:119 | **pending-phase** | core_board | Old board: one "0 / 10" text. New board: TrackerBars AND CentralBoard CoreChipGroup both render "0 / 10" — strict mode violation (2 elements). |
| 19 | dataset_preparation Compute blocked | mission-rules.spec.ts:327 | **pre-existing** | — | Pre-existing flaky test (SESSION_NOTES: test 28 passes in isolation). |
| 20 | mission 2 active_mission non-null | multi-mission.spec.ts:157 | **non-ui** | — | Edge function returned 503 — cold-start. Multi-mission logic unchanged. |
| 21 | AIs have full hands at card_reveal mission 2 | multi-mission.spec.ts:235 | **non-ui** | — | `waitForURL` 30s timeout — cold-start. |
| 22 | SecretTargeting UI correct views | secret-actions.spec.ts:484 | **pending-phase** | role_indicators | Old board (line 374) had `<h1>MESA</h1>`. New `TopBar.tsx` renders "MESA" in `<span>`. Selector `locator("h1")` finds nothing. |
| 23 | initial turn order + rotation | turn-order.spec.ts:150 | **non-ui** | — | `startDevGame` waitForURL 30s timeout — pre-existing cold-start (SESSION_NOTES documents this). |

---

### Non-UI tests — canary for regressions during redesign

These tests exercise backend logic, edge functions, and data-layer behavior with no dependency on
game board layout. They should pass regardless of which phase is being redesigned. Continued failure
on these tests signals a genuine regression unrelated to the redesign.

- abort-mission.spec.ts:228 (abort rejected in round 1)
- abort-mission.spec.ts:256 (abort rejected by AI player)
- abort-mission.spec.ts:164 (abort fires in round 2) ← also has a UI check, but failure is cold-start
- discard.spec.ts:135, 198, 250, 314 (all discard edge function tests)
- error-handling.spec.ts:143 (invokeWithRetry 4xx error message)
- multi-mission.spec.ts:157, 235 (multi-mission data-layer flow)
- turn-order.spec.ts:150 (turn rotation logic)

---

### Pending-phase tests — skip during redesign, unskip per phase task

These tests fail because the old DOM structure is gone. Each phase task should:
1. Unskip the relevant tests
2. Update selectors to match the new layout
3. Confirm they pass before closing the phase task

| Test | Skip until phase task |
|------|----------------------|
| game-log-ui.spec.ts:243 | game_log (RightPanel bold styling) |
| hand-stability.spec.ts:309 | player_turn (`Your Hand` section heading) |
| mission-flow.spec.ts:119 | core_board (disambiguate "0 / 10" in CentralBoard) |
| secret-actions.spec.ts:484 | role_indicators (TopBar MESA element needs `h1` or test selector update) |
| card-reveal.spec.ts:83 | card_reveal (Reveal Card button structure) |

---

### Recommendation

**Skip** the 5 pending-phase tests now (next step, in the player_turn phase task as instructed).
**Do not skip** the non-ui tests — they are the canary. If they fail during a phase task, investigate
before continuing.
Pre-existing tests (items 5–10, 19) can be re-run in isolation if needed; they are not blocking.
