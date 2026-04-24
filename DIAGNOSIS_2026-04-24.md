# Diagnosis — 2026-04-24 Playtest Session

This file records the full triage, architectural investigation, and root-cause analysis from the second playtest session. It is a historical record — read it for context on decisions made during the Phase 7.5 planning session.

---

## Triage Table

| Item | Category | Verdict |
|------|----------|---------|
| 1 — Cards not drawn between turns | **A** | Two root causes: `resolve-next-virus` copy of `advanceTurnOrPhase` never got `drawCardsForPlayer`; `allocate-resources` never draws for first player after RAM bump. Test only covers no-virus / no-bump path. |
| 2 — Mission progress bar never updates | **A** | `active_mission` excluded from 3s poll; Realtime-only — one missed event leaves board permanently stale. |
| 3 — Virus placement UI missing | **A + B** | `place-virus` backend exists but `PlayerTurn` has no UI to call it (A). Manual Resolve button and progress-card-in-pool are expected design (B). |
| 4 — No log entries / no targeting UI | **B** | Log entries are Realtime-only (pre-Phase 11, expected). No targeting UI is correct: Compute doesn't trigger `secret_targeting`; user expected targeting for a progress card. |
| 5 — Cannot see own alignment | **A** | `roleDisplay()` returns `"AI"` for both alignments everywhere. No way to see own role in production. |
| 6 — No active turn indicator | **UX fix** | Implemented: `ring-2 ring-amber/40` added to `isActive` branch in `PlayerRoster.tsx`. |

---

## Q1 — Why are there two copies of `advanceTurnOrPhase`?

### Why they exist

Supabase edge functions are independent Deno deployments with no cross-function module resolution at runtime. When `resolve-next-virus` needed turn advancement logic, it could not call `end-play-phase`'s function. The comment in the file is explicit: *"duplicated from end-play-phase for independent deployment."*

### Are they meaningfully different?

No. They implement identical intended logic. The actual differences are:

| | `end-play-phase` | `resolve-next-virus` |
|---|---|---|
| `drawCardsForPlayer` (within-round) | ✓ line 278 | **missing** |
| `drawCardsForPlayer` (round 2 start) | ✓ line 308 | **missing** |
| `r2Player` fetch | ✓ (needed for draw) | absent |
| `corsHeaders` | re-declared inside function | uses module-scope constant |
| `export` keyword | yes | no |

The first two rows are bugs introduced when the Bug 2 fix was applied only to `end-play-phase`. The last two are cosmetic. There is no intentional divergence.

### How to consolidate (correct approach)

Supabase CLI supports `_shared/` directory imports. When deploying with `supabase functions deploy`, the CLI bundles each function with all relative imports resolved. This is the designed solution for shared logic.

Proposed structure:
```
supabase/functions/_shared/
  advanceTurnOrPhase.ts    ← advanceTurnOrPhase + drawCardsForPlayer + shuffle
end-play-phase/index.ts    ← imports from ../_shared/advanceTurnOrPhase.ts
resolve-next-virus/index.ts ← same import
```

**Constraint:** This requires CLI deployment (`supabase functions deploy`), not Dashboard file-upload (Dashboard only accepts a single file). SESSION_NOTES confirms CLI is available.

**Why this matters beyond the immediate fix:** Every future change to turn advancement will automatically apply to both functions. The Bug 2 regression was caused precisely by this duplication — the fix went to one copy, not both.

---

## Q2 — What other tables are Realtime-only with no polling backup?

### The 3s polling loop (GameBoard.tsx lines 74–86) covers exactly two tables

```typescript
const [{ data: g }, { data: p }] = await Promise.all([
  supabase.from("games").select("*").eq("id", gameId).single(),
  supabase.from("players").select("*").eq("game_id", gameId),
]);
```

Everything else depends entirely on Realtime.

### Full inventory of Realtime-only dependencies

| Table | Subscribed where | Events | Poll backup | Impact if missed |
|---|---|---|---|---|
| `active_mission` | `GameBoard` | UPDATE, INSERT | **none** | Mission progress/round/special_state permanently stale. Primary game feedback mechanism. **Critical.** |
| `game_log` | `GameBoard` | INSERT | **none** | Log entries missing. Acknowledged in SESSION_NOTES as expected limitation pre-Phase 11. |
| `hands` | `GameBoard` | INSERT, DELETE | none (dev: refetch on player switch only) | Drawn cards don't appear; played cards appear as ghost cards. No recovery without page reload. **Critical.** |
| `virus_resolution_queue` | `VirusResolution` | any | initial fetch on mount | Queue display stale mid-resolution. Lower risk: refetches on any event, self-heals quickly. |

### `hands` is the most dangerous unacknowledged gap

`drawCardsForPlayer` inserts rows into `hands`. If the Realtime INSERT is missed, the player's hand display doesn't update — they can't see their new cards, with no indication that anything is wrong. When `play-card` or `end-play-phase` delete cards, if the Realtime DELETE is missed, ghost cards remain visible in the hand UI.

There is no recovery path in the current code for non-dev mode. In dev mode, switching players triggers a full hand refetch, but that only helps if the user happens to switch.

`game_log` and `virus_resolution_queue` are lower priority: log staleness is pre-Phase 11 by design, and the queue component self-heals on the next Realtime event.

### Recommended poll additions

Add `active_mission` and `hands` (for the active player) to the 3s polling block. This closes the two critical gaps with minimal code change:

```typescript
const [{ data: g }, { data: p }, { data: m }] = await Promise.all([
  supabase.from("games").select("*").eq("id", gameId).single(),
  supabase.from("players").select("*").eq("game_id", gameId),
  supabase.from("active_mission").select("*").eq("game_id", gameId).maybeSingle(),
]);
// hand poll: fetch active player's hand every 3s as backup
```

Note: `active_mission` uses `maybeSingle()` not `single()` — no active mission during lobby/resource_adjustment/etc.

---

## Q3 — How is the virus pool populated? Full flow trace.

### Three mechanisms — only one involves player placement

**Mechanism 1 — Initial seeding (start-game):**
`start-game` inserts the first 4 cards of the shuffled 60-card deck directly into `virus_pool`:
```typescript
const poolRecords = deck.slice(0, 4).map((card, pos) => ({ game_id, card_key: card.key, ... }));
await admin.from("virus_pool").insert(poolRecords);
```
These 4 cards are whatever landed at positions 0–3 in the shuffle. Any mix of progress and virus cards. A Compute card appearing as "Next virus card: Compute" during resolution is a progress card that happened to be in those first 4 slots. This is expected per spec ("Good AIs sacrifice Progress cards to dilute the pool") — the pool being seeded with progress cards is intentional.

**Mechanism 2 — Player placement (currently non-functional):**
AIs call `place-virus`, which moves selected cards from their `hands` into `pending_viruses`. Then `end-play-phase` shuffles `pending_viruses` into `virus_pool`:
```typescript
// end-play-phase lines 139–155
const { data: pending } = await admin.from("pending_viruses").select("*").eq("game_id", game_id);
if (pending && pending.length > 0) {
  await admin.from("virus_pool").insert(shuffled.map(...));
  await admin.from("pending_viruses").delete().eq("game_id", game_id);
}
```
Since there is no UI to call `place-virus`, `pending_viruses` is perpetually empty. This block runs every turn and is a no-op every time.

**Mechanism 3 — Pool refill after resolution (resolve-next-virus):**
After the virus resolution queue drains, `refillVirusPool` draws from `deck_cards (status=in_deck)` to bring the pool back to 4 cards:
```typescript
async function refillVirusPool(admin, game_id) {
  const needed = 4 - poolCount;
  let drawCards = await drawFromDeck(admin, game_id, needed);
  // ... reshuffle discards if deck exhausted ...
  await admin.from("virus_pool").insert(drawCards.map(...));
  await admin.from("deck_cards").update({ status: "drawn" }).in("id", ...);
}
```
Cards drawn here are the next `in_deck` cards by position — again, any card type.

### Current end-to-end flow (no player placements)

```
start-game: virus_pool seeded with 4 random cards (deck positions 0–3)

Player turn, CPU=2, 1 card played:
  end-play-phase:
    pending_viruses = [] → shuffle step is no-op
    numViruses = 1 (CPU≥2, <3 cards)
    draws 1 card from virus_pool → virus_resolution_queue
    deletes it from virus_pool
    sets phase=virus_resolution
    → virus_pool now has 3 cards

  resolve-next-virus (resolve the 1 queued card):
    applyVirusEffect → e.g. Compute → default case → logs "Virus resolved: compute."
    queue now empty → refillVirusPool → draws 1 in_deck card → virus_pool back to 4
    → advanceTurnOrPhase → next player's turn
```

### What is actually missing strategically

The virus placement mechanic is the **core strategic layer** of the game:
- Good AIs sacrifice progress cards from their hand to dilute the pool → when viruses are drawn and resolved, more of them are harmless Compute/Data cards
- Bad AIs place actual virus cards from their hand → when viruses are drawn and resolved, more of them apply harmful effects

Neither of these is possible. The pool composition is entirely random — 4 cards cycling from the deck, player-independent. The Escape Timer and Core Progress effects from virus resolution are present and correct, but the strategic input that makes them meaningful (player agency over pool contents) is absent.

The `end-play-phase` shuffle logic is correctly implemented. It just never has anything to shuffle because `pending_viruses` is always empty. No code change is needed there — only the UI to populate `pending_viruses` before `end-play-phase` is called.

---

## Bug A1 — Draw cards missing on virus path and first-player-of-round-1

See Q1 above for the root cause of the duplicate `advanceTurnOrPhase`.

**Root cause 1:** `resolve-next-virus`'s copy of `advanceTurnOrPhase` is missing both `drawCardsForPlayer` calls. Within-round advance (line ~374) and round-2 start (line ~402) both set `current_turn_player_id` without drawing. The end-play-phase copy has both calls (lines 278, 308).

**Root cause 2:** `allocate-resources` transitions to `player_turn` with a direct `games` update (lines 91–97) and no `drawCardsForPlayer` call. Initial hands from `start-game` are dealt at RAM=4. After a +2 RAM allocation (RAM=6), the first player starts round 1 with 4 cards, not 6. Players 2+ are fine — `advanceTurnOrPhase` draws for them when their turn starts.

**Test gap:** `draw-cards.spec.ts` uses CPU=1 (no virus → no resolve-next-virus path) and zero allocation deltas (first player hand == RAM, nothing to draw). Both root causes are invisible to the test.

---

## Bug A2 — Mission progress never refreshes

See Q2 above. `active_mission` absent from 3s poll. Realtime-only. One missed event = permanently stale mission board for the session.

---

## Bug A3 — Virus placement UI never built

`place-virus` edge function deployed (Phase 7). `PlayerTurn.tsx` has no UI to call it. `pending_viruses` always empty. The `end-play-phase` shuffle step is a no-op every turn. See Q3 for the full flow and strategic impact.

**Proposed PlayerTurn UX:**
- Show full hand (not just progress cards)
- Let AI select 0–N cards to place into virus pool (face-down)
- "Placing into pool" staging area
- End Turn: call `place-virus` for each staged card, then `end-play-phase`

---

## Bug A5 — Own alignment not visible

`PlayerRoster.tsx → roleDisplay()` returns `"AI"` for both `aligned_ai` and `misaligned_ai`. No other surface shows own alignment. Dev-mode partial workaround: PlayerSwitcher shows "A"/"M" labels (opacity-50). Production: misaligned AIs can infer alignment from private chat presence; aligned AIs have no indication at all.

**Recommended fix:** Add role banner in `GameBoard.tsx` right panel for `effectiveCurrentPlayer` when `isAI`:
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
Cleaner than modifying `roleDisplay()` — shows the info prominently without touching RLS-sensitive roster display logic.
