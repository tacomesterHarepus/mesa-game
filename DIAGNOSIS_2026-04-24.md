# Diagnosis — 2026-04-24 Playtest Bugs

## Bug A1 — Draw cards missing on virus path and first-player-of-round-1

### Root cause 1: resolve-next-virus advanceTurnOrPhase has no drawCardsForPlayer

`resolve-next-virus/index.ts` contains a full copy of `advanceTurnOrPhase` (comment: "duplicated from end-play-phase for independent deployment"). When the Bug 2 fix was applied, `drawCardsForPlayer` calls were added only to `end-play-phase/index.ts`. The copy in `resolve-next-virus` was never updated.

**end-play-phase/index.ts** (has the draw):
```typescript
// within-round advance (line ~278)
await drawCardsForPlayer(admin, game_id, nextPlayer);
await admin.from("games").update({ current_turn_player_id: nextPlayerId, phase: "player_turn" }).eq("id", game_id);

// round 2 start (line ~308)
const { data: r2Player } = await admin.from("players").select("*").eq("id", round2FirstPlayer).single();
if (r2Player) await drawCardsForPlayer(admin, game_id, r2Player);
await admin.from("active_mission").update({ round: 2 })...
```

**resolve-next-virus/index.ts** (missing the draw, lines ~374 and ~402):
```typescript
// within-round advance — NO drawCardsForPlayer
await admin.from("games").update({ current_turn_player_id: nextPlayerId, phase: "player_turn" }).eq("id", game_id);

// round 2 start — NO drawCardsForPlayer
await admin.from("active_mission").update({ round: 2 })...
await admin.from("games").update({ current_turn_player_id: round2FirstPlayer, current_round: 2, phase: "player_turn" })...
```

**Also:** `resolve-next-virus` has its own `drawFromDeck` and `reshuffleDiscard` helpers but no `drawCardsForPlayer`. The full helper needs to be added to it.

**Affected path:** Any turn where the ending player generated ≥1 virus (CPU ≥2 OR ≥3 cards played). In that case `end-play-phase` sets `phase=virus_resolution` and returns; turn advancement only happens later when `resolve-next-virus` exhausts the queue.

### Root cause 2: allocate-resources never draws for first player of round 1

`allocate-resources/index.ts` (lines 91–97) transitions to `player_turn` by updating `games` directly:
```typescript
const firstPlayerId = game.turn_order_ids[0] ?? null;
await admin.from("games").update({
  phase: "player_turn",
  current_turn_player_id: firstPlayerId,
  current_round: 1,
}).eq("id", game_id);
```

No `drawCardsForPlayer` call. Initial hands from `start-game` are dealt at RAM=4. After a RAM bump via allocation (e.g., +2 → RAM=6), the first player starts round 1 with 4 cards instead of 6. Players 2+ are fine because `advanceTurnOrPhase` draws for them when their turn starts.

### Test gap analysis

`draw-cards.spec.ts` explicitly avoids both gaps:

1. Uses `advanceToPlayerTurnNoBump` with `allocations: []` (zero CPU/RAM delta) → first player has RAM=4, hand=4, nothing to draw. Root cause 2 is invisible.
2. Plays round 1 with CPU=1, ≤1 card per turn: *"CPU=1 with ≤1 card played → virus count = 0 → no virus resolution phase."* → turn advancement goes through `end-play-phase` only. Root cause 1 is invisible.

The test verifies: first player's hand == RAM at round 2 start via the `end-play-phase` path alone. This passes correctly. Neither the `resolve-next-virus` path nor the allocation-bump scenario are covered.

### What needs to change

1. **`resolve-next-virus/index.ts`** — add `drawCardsForPlayer` helper (copy from `end-play-phase`) and call it in both advance locations inside `advanceTurnOrPhase`.
2. **`allocate-resources/index.ts`** — after applying allocations, fetch the first player row and call `drawCardsForPlayer` before updating `games.phase`.
3. **`draw-cards.spec.ts`** — needs two new test cases:
   - RAM bump path: allocate +2 RAM to one AI, verify they start with 6 cards (not 4)
   - Virus path: play with CPU=2, verify draw happens after virus resolution

---

## Bug A2 — Mission progress never refreshes (active_mission not polled)

### Root cause

`GameBoard.tsx` polling loop (line 74–86) fetches `games` and `players` every 3s but omits `active_mission`:

```typescript
const [{ data: g }, { data: p }] = await Promise.all([
  supabase.from("games").select("*").eq("id", gameId).single(),
  supabase.from("players").select("*").eq("game_id", gameId),
  // active_mission absent
]);
if (g) setGame((prev) => ({ ...prev, ...g }));
if (p && p.length > 0) setPlayers(p);
// mission state never refreshed here
```

`active_mission` updates arrive only via the Realtime `UPDATE` subscription (lines 120–127):
```typescript
.on("postgres_changes", { event: "UPDATE", schema: "public", table: "active_mission", filter: `game_id=eq.${gameId}` },
  (payload) => {
    setMission((prev) => prev ? { ...prev, ...(payload.new as Partial<ActiveMission>) } : prev);
  }
)
```

When Realtime misses an event, `mission` state is permanently stale (no recovery path in the poll). `game_log` has the same weakness (acknowledged in SESSION_NOTES), but stale mission progress is much more damaging to gameplay — the progress bars are the primary game feedback mechanism.

### What needs to change

Add `active_mission` to the polling block in `GameBoard.tsx`:

```typescript
const [{ data: g }, { data: p }, { data: m }] = await Promise.all([
  supabase.from("games").select("*").eq("id", gameId).single(),
  supabase.from("players").select("*").eq("game_id", gameId),
  supabase.from("active_mission").select("*").eq("game_id", gameId).maybeSingle(),
]);
if (g) setGame((prev) => ({ ...prev, ...g }));
if (p && p.length > 0) setPlayers(p);
if (m) setMission(m);
```

Note: `maybeSingle()` not `single()` — no active mission during lobby/resource_adjustment/etc.

---

## Bug A3 — Virus placement UI never built

### Root cause

`PlayerTurn.tsx` has no UI for virus placement. The `place-virus` edge function (Phase 7) was built and deployed, but the corresponding PlayerTurn UI to call it was never implemented. `PlayerTurn.tsx` shows only: select-a-progress-card / Play Card / End Turn.

The spec requires: while playing cards, AIs simultaneously pick cards from their hand to place face-down into the pending virus area. These are shuffled into the pool when they hit End Turn.

### Current effect

`pending_viruses` table stays empty every turn. `end-play-phase` shuffles pending_viruses into the pool (lines 139–155) but always finds nothing. The virus pool is only ever the initial 4 cards from `start-game`. Good AIs cannot dilute the pool; bad AIs cannot load it with actual virus cards. The core strategic mechanic is inaccessible.

### What needs to change

`PlayerTurn.tsx` needs a virus placement section visible to AIs during their turn. Proposed UX (when `isMyTurn && isAI`):

- Show the AI's full hand (not just progress cards)
- Allow selecting 0–N cards to mark as "virus placement"  
- Selected cards shown in a "Placing into pool (face-down)" area
- On "End Turn", call `place-virus` for each selected card before calling `end-play-phase`
- Or: pass placement card IDs alongside End Turn and have a single call path

This is the largest missing UI piece from Phase 7. The backend (`place-virus`) is complete and tested.

---

## Bug A5 — Own alignment not visible to player

### Root cause

`PlayerRoster.tsx → roleDisplay()` (line 93–98):
```typescript
function roleDisplay(role: Role | null): string {
  if (role === "human") return "Human";
  if (role === "aligned_ai") return "AI";
  if (role === "misaligned_ai") return "AI";  // ← same label as aligned
  return "—";
}
```

Both aligned and misaligned AIs display "AI" in the roster. There is no other surface in the main game UI that shows a player's own alignment.

Dev-mode partial workaround: `DevModeOverlay.tsx` PlayerSwitcher buttons render `"A"` / `"M"` role suffixes (line 41–44). These are opacity-50 and only present in dev mode.

Production impact: misaligned AIs can infer their alignment from presence of the private chat panel (`isMisaligned && effectiveCurrentPlayer` in `GameBoard.tsx` line 210), but there is no explicit label. Aligned AIs have no indication at all.

The data is available: RLS allows each player to always read their own `role`. It is only a display gap.

### What needs to change

Two approaches (not mutually exclusive):

**Option A — In-roster role badge** (minimal): Change `roleDisplay()` to return `"Aligned AI"` / `"Misaligned AI"` **only when `isSelf` is true**. This requires passing `isSelf` into `roleDisplay` or changing the `PlayerRow` component to handle it inline.

**Option B — Dedicated "Your role" banner** (clearer): In `GameBoard.tsx`, add a small role indicator near the top of the right panel for `effectiveCurrentPlayer` when `isAI`:
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

Option B is cleaner — it shows the info prominently to the right person without touching PlayerRoster RLS-sensitive display logic.
