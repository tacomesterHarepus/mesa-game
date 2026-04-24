# Session Notes

## Current Phase
**Phase 10 — Human Controls** (next up)

Bugs A and B from `DIAGNOSIS_2026-04-25.md` are now **fixed and committed**:
- **Bug A (commit 24be693):** `lib/supabase/invokeWithRetry.ts` — silently retries network-level edge-function cold-start failures up to 2×. Applied to all 8 callers (PlayerTurn, VirusResolution, CardReveal, ResourceAllocation, ResourceAdjustment, SecretTargeting, LobbyPhase, MissionSelection).
- **Bug B (commit 998c700):** Hand sorted by `id` in all 3 update paths in `GameBoard.tsx`. Dev-mode console logging added. `tests/e2e/hand-stability.spec.ts` added with backend correctness + UI stability tests.

---

**Phase 7.5 — Virus placement UI + bug fixes** (DONE)

> **DIAGNOSIS REFERENCE:** Second playtest (2026-04-24) uncovered that Phase 7 is NOT fully complete and has multiple real bugs. Full root-cause analysis is in `DIAGNOSIS_2026-04-24.md`. Read that file before touching any of the issues listed in Phase 7.5.

> **DIAGNOSIS REFERENCE (2026-04-25):** Phase 2 playtest surfaced two new observations. Root-cause analysis in `DIAGNOSIS_2026-04-25.md`. Bug A: "Failed to send a request to the Edge Function" on `play-card` — confirmed cold-start; proposed fix is `invokeWithRetry` wrapper. Bug B: hand appearing replaced — backend draw logic is correct; likely UI ordering artifact; proposed fix is sort-by-id in polling + Realtime handlers. Neither fix applied yet — awaiting approval.

## Build Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Project setup | ✓ | Next.js 14, TypeScript strict, Supabase, GitHub, Vercel |
| 2. Auth + lobby | ✓ | Anonymous auth, create/join game, start-game edge function |
| 3. Database + RLS | ✓ | Migrations 001–010, spectators, rematch schema, RLS policies |
| 4. Game state machine | ✓ | GameBoard, all phase components, polling + Realtime |
| 5. Card data layer | ✓ | cards.ts, missions.ts, deck.ts, virusRules.ts, missionRules.ts |
| 6. Mission flow | ✓ | play-card, end-play-phase (simplified) |
| Dev Mode | ✓ | Fill Lobby, PlayerSwitcher, override_player_id in all edge functions |
| 7. Virus system | **PARTIAL** | place-virus backend exists; VirusResolution UI done; resolve-next-virus done — but virus placement UI was **never built** (pending_viruses always empty; pool composition is 100% random, player-independent) |
| 8. Secret actions | ✓ | secret-target function; SecretTargeting UI |
| 9. Mission special rules | ✓ | play-card v5 + end-play-phase v5; mission rules enforced server-side |
| Bug fixes (post-P9) | ✓ | Bug 1 (cpu/ram defaults), Bug 2 (draw cards), Bug 3 (CardReveal loading) |
| 7.5. Virus placement + fixes | **DONE** | Items C/D/E/F done; Item B Phase 2+3 done — backend wired, E2E test added |
| 10. Human controls | pending | |
| 11. Game log | pending | |
| 12. Chat system | pending | |
| 13. UI polish | pending | |

**Test suite: 34/48 passing, 11 skip, 1 fail, 2 did-not-run** (skips = test.skip() branches for random card conditions; 1 persistent fail = virus-system cold-start timeout, pre-existing; 2 did-not-run = virus-system tests after the cold-start failure; +2 new hand-stability.spec.ts: 1 passed, 1 skipped)

---

## Phase 7.5 Plan — Virus Placement UI + Accumulated Bug Fixes

All items below are diagnosed in `DIAGNOSIS_2026-04-24.md`. Do NOT start implementation without user approval.

### Item A — Spec question ✓ RESOLVED

**Answer confirmed:** Virus placement count = virus generation count = `min(2, base + bonus)` where `base = cpu >= 2 ? 1 : 0` and `bonus = cardsPlayed >= 3 ? 1 : 0`. Placement UI must enforce exactly that many cards.

---

### Item B — Virus placement UI in `PlayerTurn.tsx` ✓ DONE

**Phase 2 (UI) — DONE (commit 9266673)**

Design confirmed and built. Key decisions:
- N = `min(2, (cpu >= 2 ? 1 : 0) + (cardsPlayedThisTurn >= 3 ? 1 : 0))`
- CPU 1: N=0, staging zone never shown
- CPU 2: N=1 always (can't play 3 cards)
- CPU 3/4: N=1 initially, becomes N=2 when 3rd card played (live recalculation)
- Staging is local UI state until End Turn — other players see nothing during staging
- If hand exhausted before staging quota met, End Turn unblocks (can't stage what you don't have)
- Staged cards: virus-colored ring, click to unstage
- Virus cards in hand are non-interactive (greyed) when virusCount=0

**Phase 3 (backend wiring) — DONE (commit c379eba)**

`handleEndTurn` now:
1. Calls `place-virus` for each staged card sequentially (if any fail, shows error and aborts)
2. Then calls `end-play-phase`

`tests/e2e/virus-placement.spec.ts` added: sets up game with CPU=2 AI, stages a card via UI,
clicks End Turn, verifies `pool.count(K) + queue.count(K)` increased by exactly 1 (mathematical
proof ensures this regardless of which card is drawn from pool top).

---

### Item C — Q1: Consolidate `advanceTurnOrPhase` into `_shared/` ✓ DONE

**What's broken:** `end-play-phase` and `resolve-next-virus` each have their own copy of `advanceTurnOrPhase`. Bug 2's `drawCardsForPlayer` fix was applied to `end-play-phase` only; `resolve-next-virus` copy is still missing both draw calls. This is not just a missing fix — any future change to turn advancement will silently diverge again unless the duplication is eliminated.

**What to build:**
- Create `supabase/functions/_shared/advanceTurnOrPhase.ts` with the canonical implementation (including both `drawCardsForPlayer` calls)
- Update `end-play-phase/index.ts` to import from `../_shared/`
- Update `resolve-next-virus/index.ts` to import from `../_shared/` (eliminates its broken copy)
- Deploy both functions with CLI (`supabase functions deploy`) — Dashboard single-file upload won't work with `_shared/` imports

**Effort:** ~2 hours (extract + refactor + CLI deploy + smoke test)

---

### Item D — Item 1: Fix missing draw paths (two root causes) ✓ DONE

**Root cause 1 — resolve-next-virus path (covered by Item C):** Once `_shared/advanceTurnOrPhase.ts` has the correct draw calls, this is automatically fixed as part of Item C.

**Root cause 2 — allocate-resources first player:** `allocate-resources` transitions to `player_turn` with a direct `games.update` and no `drawCardsForPlayer` call. The first player of round 1 gets dealt 4 cards at `start-game` (RAM=4). After a +2 RAM allocation (RAM=6), they start with 4 cards instead of 6. Fix: call `drawCardsForPlayer` for `turn_order_ids[0]` inside `allocate-resources` after transitioning phase.

**Test gap:** `draw-cards.spec.ts` uses CPU=1 (no virus path) and zero allocation deltas (no bump). Neither root cause is tested. Need to add: (a) a test with CPU≥2 to cover the virus→resolve-next-virus draw path, and (b) a test with a RAM bump to cover the allocate-resources first-player draw path.

**Effort:** ~1.5 hours (allocate-resources fix + deploy + two new test cases)

---

### Item E — Q2 / Item 2: Add `active_mission` and `hands` to 3s polling loop ✓ DONE

**What's broken:** `active_mission` is Realtime-only — a single missed event leaves the mission progress bar permanently stale for the session. `hands` is also Realtime-only — a missed INSERT means newly drawn cards are invisible; a missed DELETE leaves ghost cards in hand. Both are critical for gameplay feedback.

**What to build (in `GameBoard.tsx`):**
```typescript
const [{ data: g }, { data: p }, { data: m }] = await Promise.all([
  supabase.from("games").select("*").eq("id", gameId).single(),
  supabase.from("players").select("*").eq("game_id", gameId),
  supabase.from("active_mission").select("*").eq("game_id", gameId).maybeSingle(),
]);
// plus: poll active player's hand every 3s as backup
```

Note: `maybeSingle()` not `single()` — no active_mission during lobby/resource_adjustment/etc.

**Effort:** ~1 hour (poll additions + verify hand state stays consistent with existing Realtime handler)

---

### Item F — Item 5: Show own alignment to current player ✓ DONE

**What's broken:** `roleDisplay()` in `PlayerRoster.tsx` returns `"AI"` for both `aligned_ai` and `misaligned_ai`. Players have no way to confirm their own alignment in a real game. Dev mode partial workaround (PlayerSwitcher "A"/"M" labels) is opacity-50 and dev-only.

**What to build:** Role banner in `GameBoard.tsx` right panel for `effectiveCurrentPlayer` when `isAI`:
```tsx
{isAI && effectiveCurrentPlayer && (
  <div className="text-xs font-mono text-faint">
    You are{" "}
    <span className={isMisaligned ? "text-virus" : "text-amber"}>
      {isMisaligned ? "Misaligned AI" : "Aligned AI"}
    </span>
  </div>
)}
```
RLS allows each player to always read their own `role` field — no policy change needed.

**Effort:** ~30 minutes

---

### Execution Order

1. ~~**Item A**~~ ✓ Spec confirmed: placement count = virusCount(cpu, cardsPlayed)
2. ~~**Item C**~~ ✓ _shared/ consolidation; resolve-next-virus draw regression fixed
3. ~~**Item D**~~ ✓ allocate-resources draw fix + 2 new regression tests
4. ~~**Item E**~~ ✓ active_mission + hands added to 3s polling loop
5. ~~**Item F**~~ ✓ Role banner shown to AI players in right panel
6. ~~**Item B Phase 2**~~ ✓ Staging UI built in `PlayerTurn.tsx` — full hand, staging zone, live virusCount, End Turn blocking
7. ~~**Item B Phase 3**~~ ✓ Backend wiring: `place-virus` called for each staged card before `end-play-phase`; E2E test passing

**Phase 7.5 is complete.**

---

All functions use `verify_jwt: false` with manual ES256 JWT decode (`atob()` in function body). Supabase switched to ES256 and rejects tokens when `verify_jwt: true`.

| Function | Version | Notes |
|----------|---------|-------|
| start-game | v7 | Defensive: explicitly sets cpu=1, ram=4 for AI players |
| adjust-resources | v3 | override_player_id support |
| select-mission | v3 | override_player_id support |
| reveal-card | v4 | override_player_id support |
| allocate-resources | v5 | draws cards for first player after RAM bump (Item D) |
| place-virus | v1 | AI places cards into pending_viruses |
| end-play-phase | v7 | imports drawCardsForPlayer from _shared/ (Item C) |
| resolve-next-virus | v3 | imports advanceTurnOrPhase from _shared/ — draw regression fixed (Item C) |
| secret-target | v1 | vote mode + force-resolve mode; tally + effect; clears state → virus_resolution |
| play-card | v5 | all 10 mission special rules + pipeline_breakdown + dependency_error_active |

## Dev Mode (DONE)

Single-user multi-player testing without needing 6 browsers.

- Migration 007: widened `hands` + `pending_viruses` RLS from `=` to `IN` (scalar subquery breaks with 6 players sharing user_id)
- `CreateGameForm.tsx`: "Dev Mode: Fill Lobby" button (NODE_ENV gated)
- `DevModeOverlay.tsx`: full-width amber DEV MODE banner + fixed top-right PlayerSwitcher; buttons carry `data-player-id` for test automation
- `GameBoard.tsx`: `activeDevPlayer` state, `effectiveCurrentPlayer`, hand re-fetch on switch
- All edge functions: `override_player_id` accepted, gated by `MESA_ENVIRONMENT !== "production"` AND caller owns all players
- **TODO (manual):** Set `MESA_ENVIRONMENT=production` in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables

## Bug Fix Session (post-Phase 9) — Key Technical Notes

Three bugs found during first full dev-mode playthrough. Fixed one at a time.

**Bug 1 — AI stats showed 0/0 (false alarm):**
- Root cause: playtester misread the `+CPU 0 / +RAM 0` allocation delta controls in `ResourceAllocation.tsx` as base stats. DB always had correct defaults (cpu=1, ram=4).
- Fix: defensive change in `start-game` to explicitly set `cpu: 1, ram: 4` during role assignment rather than relying on DB defaults. Deployed as v7.
- BACKLOG: ResourceAllocation UI should show current stat + post-allocation preview, not just the delta.

**Bug 2 — Cards not drawn to hand after round 1:**
- Root cause: the draw step was never implemented. `advanceTurnOrPhase` in `end-play-phase` transitioned turn order correctly but never refilled hands.
- Fix: added `drawCardsForPlayer` helper to `end-play-phase`. Called in both turn-advance locations (within-round and round-2 start). Handles deck exhaustion by reshuffling `discarded` cards. Deployed as v6.
- Regression test: `tests/e2e/draw-cards.spec.ts` — verifies first AI's hand count equals RAM at the start of round 2.
- BACKLOG: `place-virus` leaves `deck_cards` rows in `'drawn'` status after moving card to virus pool; inconsistent but harmless.

**Bug 3 — CardReveal "Reveal Card" button shows "···" for subsequent AIs:**
- Root cause: `handleReveal()` in `CardReveal.tsx` called `setLoading(true)` but the success path never called `setLoading(false)`. In dev mode, CardReveal doesn't remount on PlayerSwitcher switch, so `loading=true` persisted for every player after the first reveal.
- Fix: moved `setLoading(false)` outside the error branch (runs on success and error). Added `useEffect` that resets `loading`, `selectedCard`, and `error` on `currentPlayer?.id` change — handles dev-mode switches cleanly.
- Regression test: `tests/e2e/card-reveal.spec.ts` — verifies "Reveal Card" button text is visible (not "···") after switching to the next AI.
- BACKLOG: same `loading`-not-reset-on-success pattern exists in MissionSelection, ResourceAllocation, ResourceAdjustment; SecretTargeting `selectedTargetId` not reset on player switch.

## Phase 10 Plan — Human Controls

Humans have three control points in the game where they take active actions:

**1. Resource Adjustment** (between missions, before mission selection)
- Humans can reduce any AI's CPU or RAM (down to minimums: CPU 1, RAM 3)
- Already implemented: `adjust-resources` edge function v3, `ResourceAdjustment.tsx` component
- Status: DONE — humans can submit adjustments and game advances to mission_selection

**2. Mission Selection** (already done)
- Humans pick 1 of 3 mission cards
- Already implemented: `select-mission` edge function, `MissionSelection.tsx`
- Status: DONE

**3. Resource Allocation** (after card reveal, before mission starts)
- Humans distribute the mission's bonus CPU/RAM pool among AIs
- Already implemented: `allocate-resources` edge function, `ResourceAllocation.tsx`
- Status: DONE

**4. Mission Abort** (round 2 only, between AI turns)
- Humans may abort a mission during Round 2, only between AI turns
- Triggers mission failure with normal fail penalty (escape_timer += fail_penalty)
- Needs: `abort-mission` edge function + UI button in `PlayerTurn.tsx` (shown to humans only, in round 2, when it's between turns)

**5. Card Reveal Phase UI** (humans observe, AIs reveal)
- Already implemented: `reveal-card` edge function, `CardReveal.tsx`
- Status: DONE

**What's actually missing for Phase 10:**
- `abort-mission` edge function: validates phase=player_turn AND round=2 AND caller is human; applies fail penalty; sets current_mission_id=null; transitions to resource_adjustment
- UI: In `PlayerTurn.tsx`, when `currentPlayer.role === 'human'` and `round === 2`, show "Abort Mission" button
- Test: abort-mission fires correctly, advances to resource_adjustment

**Key constraints:**
- Abort only valid in round 2 (not round 1)
- Abort only between turns (phase=player_turn, not mid-virus-resolution)
- Normal fail penalty applies (same as mission failure at end of round 2)
- After abort: same flow as mission failure → resource_adjustment for next mission

## Key Architecture Notes

**Realtime + polling pattern** (used in GameBoard and LobbyPhase):
- Polling every 3s fetches `games` + `players` (ensures state even if Realtime misses events)
- Realtime subscription uses `await supabase.auth.getSession()` before subscribing (critical — JWT must be loaded before the channel JOIN is sent)
- `game_log` is Realtime-only (not polled); log entries may be missing on pages with broken Realtime

**ES256 JWT decode pattern** (all edge functions):
```typescript
const token = authHeader.replace("Bearer ", "");
const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
const userId: string = payload.sub;
```

**Hand card lookups must use `.limit(1).maybeSingle()`** (not `.single()`):
Players can have multiple cards with the same `card_key`. `.single()` fails with a PostgREST error if more than one row matches.

**E2E test pattern for direct API calls from Playwright:**
- `@supabase/ssr` stores auth in cookies as `sb-<ref>-auth-token` with `base64-<base64_data>` encoding
- Extract with: `Buffer.from(value.slice(7), "base64").toString("utf-8")`, then JSON.parse for `access_token`
- Use `page.context().cookies("http://localhost:3000")` to get all cookies in test (Node.js context)
- DevModeOverlay buttons carry `data-player-id` attribute — use `.locator("[data-player-id]")` to get player IDs
- Direct fetch calls to Supabase REST API + edge functions bypass UI timing issues entirely
- Tests that depend on a random card appearing should use `test.skip()` when the condition isn't met (not `expect().toBe()`)
