# Diagnosis 2026-04-26 — Three Post-Phase-10.5 Playtest Bugs

All three bugs were observed after Phase 10.5 shipped. Investigation finds **no shared root cause** — they are independent gaps, all pre-existing (not introduced by Phase 10.5), all only visible from Mission 2 onward.

---

## Bug 1 — Mission cards don't show allocation amounts

### Root cause

`MissionSelection.tsx` renders name, reward, requirements, and special rule for each mission card, but **never renders `def.allocation`**.

The allocation data exists in `missions.ts` (the `MissionDefinition` interface has `allocation: { cpu: number; ram: number }` and every mission constant has it populated), but the component simply doesn't read it.

```tsx
// MissionSelection.tsx lines 52–83 — what is rendered:
const reqs = [def.requirements.compute && `...`, ...].filter(Boolean).join(", ");
<div className="text-xs font-mono text-faint">{reqs}</div>
{def.specialRule && <div ...>{def.specialRule}</div>}
// def.allocation is never referenced
```

### Phase 10.5 implicated?
No. `MissionSelection.tsx` and `missions.ts` were not touched by Phase 10.5.

### Independence
Fully independent of Bugs 2 and 3. Display-only gap.

### Proposed fix

In `components/game/phases/MissionSelection.tsx`, add an allocation line to each card, after the requirements div (current line 78):

```tsx
<div className="text-xs font-mono text-muted mt-1">
  Allocate: +{def.allocation.cpu} CPU, +{def.allocation.ram} RAM
  {" · "}<span className="text-virus">Fail: +{def.failTimerPenalty} Timer</span>
</div>
```

File: `components/game/phases/MissionSelection.tsx` — frontend only, no edge function change.

---

## Bug 2 — AIs don't refill hands to RAM before card reveal

### Root cause

**`select-mission` transitions to `card_reveal` without drawing cards for any AI player.** 

Tracing all `drawCardsForPlayer` call sites:

| Where | When | Who |
|-------|------|-----|
| `advanceTurnOrPhase` (turn advance) | Between turns within a mission | Next player only |
| `advanceTurnOrPhase` (round 2 start) | Round 1 → Round 2 | First player of round 2 only |
| `allocate-resources` | Mission start (after resource allocation) | First player of the mission only |

No call site draws for **all AIs** at any point between missions. For Mission 1, this is invisible — `start-game` deals full hands (RAM=4 cards each), so AIs always enter card_reveal with full hands. For Mission 2+, AIs entered the previous mission's last turn with partial hands (having played and staged cards) and `advanceTurnOrPhase` only drew for the *next* player on each turn advance, not all players. So AIs enter Mission 2's card_reveal with whatever remained at the end of their last turn in Mission 1.

The right insertion point is **`select-mission`**, immediately before setting `phase = card_reveal`. This is the earliest moment when all AIs are committed to the same mission and guaranteed to need a full hand for the reveal decision.

### Phase 10.5 implicated?
No. `select-mission` was not changed in Phase 10.5. The draw gap has existed since the card reveal phase was implemented. It was masked because Mission 1 is always entered from `start-game` (full hands).

### Independence
Independent of Bugs 1 and 3.

### Proposed fix

In `supabase/functions/select-mission/index.ts`:

1. Add import at top:
```typescript
import { drawCardsForPlayer } from "../_shared/advanceTurnOrPhase.ts";
```

2. Before the `games.update({ phase: "card_reveal", ... })` call, draw cards for all AI players:
```typescript
// Refill all AI hands to RAM before card_reveal — hands may be depleted from the previous mission.
const { data: aiPlayersForDraw } = await admin
  .from("players").select("*")
  .eq("game_id", game_id).neq("role", "human");
if (aiPlayersForDraw) {
  for (const ai of aiPlayersForDraw) {
    await drawCardsForPlayer(admin, game_id, ai);
  }
}
```

`drawCardsForPlayer` is already idempotent (draws up to RAM, does nothing if already full), so this is safe for Mission 1 too (AIs already have full hands → no-ops).

Requires: **redeploy `select-mission`**.

---

## Bug 3 — Mission 2 has no resources to allocate and no progress display (one root cause, two symptoms)

### Root cause

**`end-play-phase` never deletes the `active_mission` row when a mission resolves.** Old rows accumulate. When `select-mission` INSERTs a new `active_mission` row for Mission 2, there are now **2 rows** in `active_mission` for the same `game_id`.

`GameBoard.tsx` polls every 3s with:
```typescript
supabase.from("active_mission").select("*").eq("game_id", gameId).maybeSingle()
```

With 2 rows, Supabase returns PGRST116 (multiple rows found) → `{ data: null, error: ... }`. The poll handler:
```typescript
if (m !== undefined) setMission(m);
```
…calls `setMission(null)` because `null !== undefined`.

**Symptom A — no resources to allocate:**
`ResourceAllocation` receives `missionKey = mission?.mission_key ?? ""` from GameBoard. With `mission = null`, `missionKey = ""` → `MISSION_MAP[""] = undefined` → `def = undefined` → `cpuPool = def?.allocation.cpu ?? 0 = 0`, `ramPool = 0`. The UI shows no allocation controls and no pool.

**Symptom B — no progress display:**
`GameBoard.tsx` line ~381: `{mission && game.phase !== "game_over" && <MissionBoard ... />}`. With `mission = null`, `MissionBoard` is suppressed entirely.

These are two symptoms of one root cause. The Realtime INSERT subscription briefly sets the correct Mission 2 data, but the next 3s poll overwrites it with null.

### Why active_mission rows are never deleted

`end-play-phase` marks the mission as resolved by setting `games.current_mission_id = null` (lines ~101 and ~118), but never issues a DELETE on `active_mission`. `advanceTurnOrPhase` (missionResolved branch) transitions to `resource_adjustment` and sets the new `pending_mission_options`, but also doesn't delete the row. `select-mission` INSERTs a new row without checking for or cleaning up old ones.

Server-side code that queries by `game.current_mission_id` (e.g. `allocate-resources`, `end-play-phase` itself) is unaffected — they use `eq("id", current_mission_id)` which is ID-specific. Only the broad `eq("game_id", gameId)` client-side poll breaks.

### Phase 10.5 implicated?

No. Phase 10.5 modified the `missionResolved` branch of `advanceTurnOrPhase` to add rotation logic, but the branch never deleted the `active_mission` row before Phase 10.5 either. The gap was pre-existing.

**Important caveat:** the bug was never observable before Phase 10.5 because no multi-mission play had been tested with the new seat-order code. The playtest that surfaced it was the first real multi-mission game run after Phase 10.5 shipped. Per Pattern B: "masked by lack of multi-mission testing" ≠ "caused by Phase 10.5."

### Independence

Independent root cause from Bugs 1 and 2. No shared fix.

### Proposed fix (client-side only — no edge function redeploy needed)

**Why not delete server-side:** `mission_contributions.mission_id` has a FK to `active_mission.id`. Deleting the `active_mission` row would require either cascading (destroying stats needed for the end-game screen) or a migration to change FK behavior. The client-side fix is simpler and complete.

In `GameBoard.tsx` polling (`useEffect` around line 73), restructure the `active_mission` fetch to use `current_mission_id` from the freshly-fetched game row, instead of `game_id`:

```typescript
const poll = async () => {
  await supabase.auth.getSession();
  
  // Fetch game first — we need current_mission_id to query active_mission correctly.
  // Using game_id alone with maybeSingle() breaks when multiple active_mission rows
  // accumulate (one per completed mission), causing PGRST116 → mission = null.
  const { data: g } = await supabase.from("games").select("*").eq("id", gameId).single();
  if (g) setGame((prev) => ({ ...prev, ...g }));
  
  const missionId = g?.current_mission_id ?? null;
  const [{ data: p }, { data: m }] = await Promise.all([
    supabase.from("players").select("*").eq("game_id", gameId),
    missionId
      ? supabase.from("active_mission").select("*").eq("id", missionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  
  if (p && p.length > 0) setPlayers(p);
  if (m !== undefined) setMission(m);

  // Hand poll backup (unchanged) ...
};
```

**Trade-off:** The game fetch is now serial before the mission+players parallel fetch. This adds one roundtrip (~50ms) per 3s poll. Negligible cost; the polling is a fallback for missed Realtime events.

File: `components/game/GameBoard.tsx` — frontend only, Vercel auto-deploys on push.

---

## Fix order and dependencies

| Order | Bug | Files changed | Deploy required |
|-------|-----|---------------|-----------------|
| 1 | Bug 3 | `GameBoard.tsx` | Frontend (Vercel push) |
| 2 | Bug 2 | `select-mission/index.ts` | Edge function redeploy |
| 3 | Bug 1 | `MissionSelection.tsx` | Frontend (can bundle with Bug 3) |

**Bug 3 must go first** — it blocks all of Mission 2+ gameplay. No code dependencies between fixes; they can be implemented in any order but Bug 3 is the only one that blocks testing the others.

**Bug 1 and Bug 3 are both frontend** — they can be committed and deployed together in one Vercel push, saving a deploy slot.

## Risk flags

- **Bug 3 fix:** Changes polling structure in `GameBoard.tsx` — the most-called component. Test that Mission 1 still shows MissionBoard correctly, and that `resource_adjustment` / `mission_selection` phases correctly show `mission = null` (no MissionBoard). Also verify the hand poll still runs correctly after the restructure.
- **Bug 2 fix:** Redeploying `select-mission` could affect any ongoing dev game. The draw call is a for-loop (sequential per AI, not parallel) — this is safe but slower. Could be parallelized with `Promise.all` if latency matters.
- **No fix touches `advanceTurnOrPhase.ts`** — the Phase 10.5 rotation logic is not involved in any of these fixes.

---

# Diagnosis 2026-04-26 (Appendix) — Missing Discard Step

## Root cause

The discard step has never been built. The turn spec in CLAUDE.md is clear:

> DISCARD → DRAW → PLAY CARDS + VIRUS PLACEMENT → RESOLVE VIRUSES

In the current implementation `PlayerTurn.tsx` shows only the play/stage UI — there is no discard step. AIs go directly from turn-start to playing cards.

**Why this matters beyond UX:** Draw happens server-side at turn-start (`drawCardsForPlayer` is called in two places before presenting the player_turn phase). Without a discard step, the AI's hand is already full when their turn begins. `drawCardsForPlayer` only draws `RAM - currentHandSize` cards, so a full hand produces a no-op draw. The AI never refreshes their hand — they're stuck with whatever cards they were dealt at game start (mission 1) or refilled with at the previous `select-mission` call (mission 2+). **Cycling bad cards — the core hand management mechanic — is completely absent.**

---

## Q1 — Is discard partially built anywhere?

**No.** The grep for `discard` finds only:

| Location | What it is |
|----------|-----------|
| `supabase/migrations/001_initial_schema.sql:46` | `deck_cards.status` enum includes `'discarded'` |
| `types/supabase.ts:101,109` | Generated type for that enum |
| `supabase/functions/_shared/advanceTurnOrPhase.ts:38–55` | Reshuffle logic in `drawCardsForPlayer`: when the draw pile runs dry, reshuffles all `status='discarded'` rows back to `in_deck` |
| `supabase/functions/resolve-next-virus/index.ts:296–307` | Duplicate `reshuffleDiscard` helper — same logic as above, for the virus pool refill path |
| `supabase/functions/play-card/index.ts:116` | Marks a Pipeline Breakdown victim's `deck_cards` row as `'discarded'` |

There is no `discard-cards` edge function, no discard UI in `PlayerTurn.tsx`, no discard state anywhere.

The `discarded` status on `deck_cards` is already in use — but only for the reshuffle mechanic and Pipeline Breakdown. The discard step itself was simply never built.

---

## Q2 — Natural insertion point for discard

Two server paths produce a `phase = player_turn` transition:

**Path A — mission start (first player of round 1):**
`allocate-resources/index.ts:93–106`
```typescript
await admin.from("games").update({
  phase: "player_turn",
  current_turn_player_id: firstPlayerId,
  current_round: 1,
}).eq("id", game_id);
if (firstPlayerId) {
  const { data: firstPlayer } = ...
  if (firstPlayer) await drawCardsForPlayer(admin, game_id, firstPlayer); // ← draw here
}
```

**Path B — subsequent turns and round 2 start:**
`_shared/advanceTurnOrPhase.ts:172–173` and `:201`
```typescript
await drawCardsForPlayer(admin, game_id, nextPlayer); // ← draw here
await admin.from("games").update({ current_turn_player_id: nextPlayerId, phase: "player_turn" }).eq("id", game_id);
```

Both paths draw cards for the incoming player **before** they can act. For the spec's DISCARD → DRAW order to hold, draw would need to move to after the discard confirmation. But that requires touching both paths and breaks existing tests (which call `end-play-phase` directly and rely on a full hand already being present).

**Recommended approach (Option B — keep draw at turn-start, add top-up in discard):**

Keep `drawCardsForPlayer` where it is. The `discard-cards` endpoint discards the selected cards, then calls `drawCardsForPlayer` again to top the hand back up to RAM. Net result:

1. Turn-start draw: hand 0 → RAM (or RAM-N → RAM if hand was partially full)
2. AI discards N cards: hand RAM → RAM-N
3. `discard-cards` refill: hand RAM-N → RAM (N new cards drawn)

Total cards drawn per turn: RAM + N. This is mechanically equivalent to DISCARD → DRAW from the AI's perspective — they end the discard step with a fresh hand of RAM cards. `drawCardsForPlayer` is idempotent (returns early if hand already full), so calling it twice is safe.

**Why not Option A (remove turn-start draw)?** Would require touching `advanceTurnOrPhase.ts` and `allocate-resources`, and would break every existing E2E test that calls `end-play-phase` directly without first calling `discard-cards` (those tests assume the hand is already populated).

---

## Q3 — Schema / data state needed

**No schema migration required** for the base implementation.

- `deck_cards.status = 'discarded'` exists (migration 001).
- The reshuffle logic in `drawCardsForPlayer` already handles refilling the draw pile from discards.
- `hands` has no FK to `deck_cards`. Matching is by `game_id + card_key + status='drawn'`. When discarding, the function finds one `drawn` `deck_cards` row per discarded `hands` row (by `card_key`), marks it `discarded`, and deletes the `hands` row. This is identical to how `play-card` handles played cards (see `play-card/index.ts:116`).

**Optional schema addition (not required for v1):** A `games.turn_discard_done boolean DEFAULT false` column would allow server-side enforcement that an AI can't discard twice in one turn. Without it, a tampered client could call `discard-cards` multiple times. Since discarding only hurts the caller (fewer cards remain), this is not a security issue — defer the guard to a later migration.

---

## Q4 — Right UI flow

`PlayerTurn.tsx` currently shows the play UI immediately for `isMyTurn && isAI`. The discard step should appear first.

**Proposed flow:**

```
Turn starts → AI sees: Discard step (selectable hand, up to 3)
  [Discard N selected] or [Skip (0 cards)]
     → calls discard-cards → hand updates via Realtime
     → hasDiscarded = true → play UI appears (unchanged)
```

Local state additions to `PlayerTurn.tsx`:
- `hasDiscarded: boolean` — starts `false`, resets in the existing `useEffect` on `currentTurnPlayer?.id` change (line 43–48).
- `discardSelectedIds: Set<string>` — which hand card UUIDs are selected for discard.

The confirm button is explicit ("Discard N cards" / "Skip discard") rather than implicit-on-play. This matters because `discard-cards` triggers the draw step — the AI must call it before playing, or they won't see fresh cards.

Both the "Discard" button and the "Skip" button invoke `discard-cards` (with `[]` for skip). After the call returns, `hasDiscarded = true` and the play UI renders. Hand updates arrive via the existing Realtime DELETE + INSERT subscriptions in `GameBoard.tsx` (lines 195–208), so the refreshed hand appears automatically.

---

## Q5 — Dev mode / test surface

**`discard-cards` needs `override_player_id`** — same pattern as all other edge functions.

**Existing tests are not broken** (because of the Option B draw-at-turn-start approach):
- `virus-system.spec.ts:160` — `endCurrentPlayerTurn` calls `end-play-phase` directly. Hand is already full from turn-start draw. No changes needed.
- `multi-mission.spec.ts:136` — `completeMission1ByFailing` calls `end-play-phase` directly in a loop. Same — hand is full, discard is optional, skipping it is legal.

**New test needed:** A test that verifies:
1. Call `discard-cards` with 2 card IDs.
2. Assert those 2 cards are gone from `hands` (REST query).
3. Assert `hand.length === player.ram` (2 new cards were drawn to replace them).
4. Assert those 2 `card_keys` appear as `status='discarded'` in `deck_cards`.

This can live in `multi-mission.spec.ts` or a new `discard.spec.ts`.

---

## Q6 — Phase-state implication

**No new phase needed in `games.phase`.** The discard step is a UI sub-step within `player_turn`. The server phase stays `player_turn` throughout.

`discard-cards` validates:
- `game.phase === 'player_turn'`
- `caller === game.current_turn_player_id`
- `card_ids.length <= 3`
- All `card_ids` are UUIDs of `hands` rows belonging to the caller

When an AI has no cards to discard (e.g. hand is empty — shouldn't happen but defensive), they can call `discard-cards` with `[]` and the draw step tops them up.

**Implicit "skip discard":** clicking "Skip" sends `discard-cards` with `card_ids: []`. The server discards nothing, calls `drawCardsForPlayer` (no-op since hand is full), returns success. `hasDiscarded = true` in the UI. This makes "skip" a network call, which is fine — it's a single lightweight request and ensures the draw step is always triggered through one code path.

**Does play-card need to reject calls before discard?** Not for the initial implementation. Server-side enforcement would require a `players.turn_discard_done` column (migration). For v1, the UI enforces the order (play UI is hidden until `hasDiscarded = true`). A tampered client that calls `play-card` before discarding isn't gaining an advantage (they keep worse cards), so this is acceptable for playtesting.

---

## Proposed implementation plan

### New: `supabase/functions/discard-cards/index.ts`

- **Body:** `{ game_id, card_ids: string[], override_player_id? }`
- **Validation:** `phase = player_turn`, caller = `current_turn_player_id`, `card_ids.length <= 3`, each ID is in caller's hand
- **Actions per card:**
  1. Fetch `hands` row by ID (validates ownership).
  2. Find one `deck_cards` row matching `game_id + card_key + status='drawn'` — same pattern as `play-card/index.ts:116`. Mark it `'discarded'`.
  3. Delete the `hands` row.
- **After all cards:** call `drawCardsForPlayer(admin, game_id, callerPlayer)` to refill to RAM.
- **No phase change.** Returns `{ success: true }`.
- **Log entry:** `{ event_type: "discard", public_description: "{name} discarded N card(s)." }` — face-down so no card_keys revealed.

### Changed: `components/game/phases/PlayerTurn.tsx`

- Add `hasDiscarded: boolean` state (reset in existing turn-change `useEffect`).
- Add `discardSelectedIds: Set<string>` state (same reset).
- When `isMyTurn && isAI && !hasDiscarded`: render discard step (selectable hand, up to 3, "Discard N" + "Skip" buttons).
- When `isMyTurn && isAI && hasDiscarded`: render existing play UI (unchanged).
- Both discard buttons call `invokeWithRetry("discard-cards", { game_id, card_ids, override_player_id })`.

### Schema changes

None required for v1.

### Test additions

- New test in `multi-mission.spec.ts` or `discard.spec.ts`: drive to `player_turn`, call `discard-cards` REST with 2 hand card IDs, assert hand size = RAM, assert `deck_cards` shows 2 new `discarded` rows.

### Risk flags

1. **`hands` → `deck_cards` matching by `card_key`:** A player may hold 2+ cards of the same key (e.g., 3 Compute). When discarding one, the function does `.limit(1)` to find an arbitrary drawn Compute row. This is correct — the deck tracks card slots, not identities. The same approach is already in `play-card/index.ts:116`.

2. **Draw at turn-start is kept:** Existing tests pass because hand is full before they act. But it means the first player of every turn draws twice if they also discard (turn-start draw + discard-cards refill). Total cards drawn per turn = RAM + discard_count. This matches the spec semantics and is correct.

3. **`discard-cards` called with `[]`** (skip): `drawCardsForPlayer` fires but hand is already at RAM — early return, no DB writes. One extra roundtrip per turn for "skip". Acceptable.

4. **Realtime hand updates:** After `discard-cards`, the hand refreshes via existing DELETE + INSERT Realtime subscriptions. If those events are dropped, the 3s poll picks them up. No new Realtime subscriptions needed.

5. **No server-side double-discard guard in v1:** A tampered client could call `discard-cards` twice. The second call would discard more cards than intended. For playtesting this is tolerable; add a `players.turn_discard_done` column in a follow-up migration if it causes problems.

6. **`end-play-phase` already resets `turn_play_count = 0` at end of turn** (`end-play-phase/index.ts:78`). No discard count needs resetting there since we're not tracking it server-side.

---

# Diagnosis 2026-04-26 (Appendix 2) — Discard Bug: Every Second AI Can't Discard

## Symptom

After shipping the discard step, every second AI in turn order cannot see the discard UI — they land directly in the play phase. Pattern: AI 1 ✓, AI 2 ✗, AI 3 ✓, AI 4 ✗ (or similar alternating). Observed in dev mode.

## Root cause 1 — UI race condition (primary, causes reported symptom)

`PlayerTurn.tsx` lines 59–61:
```typescript
useEffect(() => {
  if (currentPlayer?.has_discarded_this_turn) setHasDiscarded(true);
}, [currentPlayer?.has_discarded_this_turn]);
```

This effect is **one-directional** — it only ever sets `hasDiscarded = true`, never false. When `currentPlayer.has_discarded_this_turn` changes `true → false` (the Realtime reset from `advanceTurnOrPhase`), the dep changes, the effect fires, but `if (false) → no-op`. The local `hasDiscarded` stays `true`.

**Race condition in dev mode:** Switching from Player A to Player B in the DevModeOverlay changes `currentPlayer` from A to B. If the players Realtime event (`B.has_discarded = false`) hasn't arrived yet, `players` state still shows B's stale value from their last turn (`true`). The server-sync dep changes from A's `true` to B's stale `true` — but both are `true` so no change → effect doesn't fire. When the Realtime event finally arrives (B.has_discarded → false), the dep changes true→false, effect fires, `if (false) → no-op` → UI permanently stuck in play phase until next turn-change.

**Why "every second":** In Mission 2+, all players have `has_discarded_this_turn = true` from their last turn in the previous mission (only the first player gets reset by `allocate-resources`; subsequent players get reset by `advanceTurnOrPhase` just before their own turn starts). When the user switches quickly between players in dev mode, they hit the stale window for players 2, 4, etc.

**Fix:** Make the server-sync bidirectional. One-line change:
```typescript
// Before:
if (currentPlayer?.has_discarded_this_turn) setHasDiscarded(true);
// After:
setHasDiscarded(currentPlayer?.has_discarded_this_turn ?? false);
```

Now when the Realtime reset arrives (true→false), the effect sets `hasDiscarded = false` — self-healing.

## Root cause 2 — Backend pool-empty path never calls advanceTurnOrPhase (secondary, separate bug)

`end-play-phase/index.ts` lines 158–188:

```typescript
if (numViruses > 0) {
  const { data: pool } = await admin.from("virus_pool")...
  if (pool && pool.length > 0) {
    // ... inserts to queue, sets phase="virus_resolution"
  } else {
    gameUpdates.phase = "player_turn";  // ← BUG: doesn't advance turn
  }
  await admin.from("games").update(gameUpdates).eq("id", game_id);
  return new Response(...);  // ← advanceTurnOrPhase is never called!
}
// numViruses=0 path correctly calls advanceTurnOrPhase below
```

When `numViruses > 0` but the pool is empty (all pool cards exhausted), the game resets to `player_turn` with the SAME `current_turn_player_id`. The current player gets stuck in an infinite loop: their turn starts, they discard (can't — `has_discarded_this_turn` is still `true`), they end turn, same thing repeats.

This is triggered only when the virus pool is genuinely empty (pool started at 0, which can happen after an aggressive Cascading Failure chain). Rare but definitely wrong.

**Fix:** Move the early `return` inside the `pool.length > 0` branch, let the pool-empty path fall through to the `advanceTurnOrPhase` call at the bottom (same as `numViruses=0`).

## Files changed

| File | Change |
|------|--------|
| `components/game/phases/PlayerTurn.tsx` | 1 line: bidirectional server-sync |
| `supabase/functions/end-play-phase/index.ts` | Pool-empty path calls `advanceTurnOrPhase` |
| `tests/e2e/discard.spec.ts` | Test 4: turn advance resets has_discarded for next player |
