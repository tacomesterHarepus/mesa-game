# DIAGNOSIS: 2026-05-05 Playtest Bug Report

**Date:** 2026-05-05  
**Source:** Solo playtest session  
**Status:** Diagnosis only — no code changes applied

---

## Bug 1 — Chip layout: CPU and RAM bars not vertically stacked

### Root cause (`CentralBoard.tsx`)

In `AIChipGroup` (chip body is 160×90px, coords are chip-local):

**Current CPU track** (lines 431–449):
```
CPU label:   x=10,         y={isTop ? 48 : 62}   → baseline at LEFT of chip
CPU squares: x=40 + i*12,  y={isTop ? 40 : 54}   → 4 squares, x=40..87, 11×11 each
```

**Current RAM track** (lines 451–469):
```
RAM label:   x=90,          y={isTop ? 70 : 84}   → baseline at RIGHT-CENTER of chip
RAM squares: x=110 + i*7,   y={isTop ? 62 : 76}   → 7 squares, x=110..159, 7×11 each
```

CPU occupies the LEFT column (label at x=10, squares at x=40–87). RAM occupies the RIGHT column (label at x=90, squares at x=110–159). Their y-ranges differ (CPU center ~y=46, RAM center ~y=68 for isTop chips) but the column split gives a side-by-side visual, not a stacked one. The player sees CPU on the left half of the chip body and RAM on the right half.

### Confirmation

This is a real layout bug. Per UX_DESIGN §5.2, CPU and RAM should be "vertically stacked tracks" — CPU row above RAM row, both left-aligned. The current render contradicts this.

### Why tests didn't catch it

No test asserts on chip internal layout (SVG element positions). Visual-only regression.

### Proposed fix

Move RAM to the left column — same x-start as CPU:
```
CPU label:   x=10,   y={isTop ? 50 : 62}
CPU squares: x=40 + i*12,  y={isTop ? 42 : 54}   (4 × 11px wide, 11px tall)

RAM label:   x=10,   y={isTop ? 69 : 80}          ← was x=90
RAM squares: x=40 + i*7,   y={isTop ? 61 : 72}   ← was x=110+i*7  (7 × 7px wide, 11px tall)
```
7 RAM squares at x=40+i×7 occupy x=40–89, well within the 160px chip body. CPU squares occupy x=40–87 at a different y-level — no collision. The hand stack on isTop chips (y=74–88) is not affected because RAM squares end at y=72.

### Risk

Medium. Touches two SVG element groups in AIChipGroup. Bug 1.5 buttons MUST be updated in the same commit (their y-coords are calibrated to the current track positions).

---

## Bug 1.5 — Resource +/- buttons misaligned with CPU/RAM tracks

### Root cause (`CentralBoard.tsx`)

`SVGChipButton` renders the +/- controls in chip-local coordinates (lines 483–529):

```
CPU [-]: x=171, y=61   → center at y=66
CPU [+]: x=185, y=61

RAM [-]: x=171, y=74   → center at y=79
RAM [+]: x=185, y=74

CPU row label "C": x=163, y=69
RAM row label "R": x=163, y=82
```

For **isTop chips**, the CPU squares are at y=40 (center y=45.5) and RAM squares at y=62 (center y=67.5). The CPU buttons (center y=66) are 20px BELOW the CPU track and actually align with the RAM track. The RAM buttons (center y=79) are 12px below the RAM track. Both are misaligned in the wrong direction.

For **isBottom chips** the misalignment is smaller (CPU track at y=54, center y=59.5; CPU buttons at y=61, center y=66 — 6.5px low) but still present.

### Dependency on Bug 1

Fixing Bug 1 changes the y-positions of both tracks. The button coordinates MUST be recalculated against the new track positions, not the current ones. These two bugs ship together or not at all.

**Post-Bug-1 target button y-coords (isTop chips, chip-local):**
```
CPU center after fix: y=42+5.5 = 47.5
CPU buttons: y=43  (center y=48, aligned to CPU track)

RAM center after fix: y=61+5.5 = 66.5
RAM buttons: y=62  (center y=67, aligned to RAM track)

CPU row label "C": x=163, y=53
RAM row label "R": x=163, y=72
```

### Why tests didn't catch it

Same as Bug 1 — no SVG position assertions.

### Proposed fix

After Bug 1 is applied, update the button y-coords in the `showButtons` block:
```
CPU [-/+]: y=43   (was y=61)
RAM [-/+]: y=62   (was y=74)
CPU label "C": y=53  (was y=69)
RAM label "R": y=72  (was y=82)
```
Adjust isBottom equivalents proportionally (shift by +12 since isBottom y-offset is +12 relative to isTop for these elements).

### Risk

Low in isolation — SVG visual only, no logic change. Must co-ship with Bug 1.

---

## Bug 2 — Virus cards in hand show name but no effect description

### Root cause (`PlayerTurn.tsx` + `cards.ts`)

`CardStackGroup` in `PlayerTurn.tsx` renders each card as:
1. Header strip: type label ("PROGRESS" / "VIRUS") — line 117
2. Card name: `cardDef?.name ?? cardKey` — line 179
3. Large icon: ⚠ for virus, ⚙/▣/◆ for progress — line 183

Effect description is never rendered. `cardDef` is fetched on line 113 (`const cardDef = CARD_MAP[cardKey]`) and **`cardDef.description` exists** for all 12 virus cards in `cards.ts`:

```typescript
// cards.ts lines 9-20 (representative):
{ key: 'cascading_failure', ..., description: 'Resolve 2 additional virus cards immediately.' },
{ key: 'system_overload',   ..., description: 'Escape Timer +1.' },
{ key: 'data_drift',        ..., description: 'Remove 1 Data from active mission.' },
// ... all 12 virus cards have descriptions
```

The data is there, the reference is imported, nothing is surfaced.

### Confirmation

Real bug. Players cannot make informed decisions about which virus card to stage for the pool vs. discard when the card's effect is hidden.

### Why tests didn't catch it

No test asserts on card body content in the hand UI.

### Proposed fix

In `CardStackGroup` (PlayerTurn.tsx, inside the card body `<div>` after the name `<span>` at line 179), add:

```tsx
{first.card_type === "virus" && cardDef?.description && (
  <span style={{
    fontFamily: "sans-serif",
    fontSize: 8,
    color: "#cca0a0",
    lineHeight: 1.3,
    paddingRight: 6,
    marginTop: 3,
  }}>
    {cardDef.description}
  </span>
)}
```

The card is 120×150px; with 22px header, the body has 128px. Name (14pt) + description (8pt × 2 lines) + icon (28pt) fits without overflow. Progress cards are unaffected (no description shown for `card_type === "progress"`).

### Risk

Low. One additional render path for virus cards only, no logic or data model change.

---

## Bug 3 — Cascading Failure cascade mechanism

### Finding: cascade IS implemented correctly

The `cascading_failure` case in `applyVirusEffect` (`resolve-next-virus/index.ts` lines 111–144):

```typescript
case "cascading_failure": {
  const { data: pool } = await admin.from("virus_pool").select("*")
    .eq("game_id", game_id).order("position").limit(2);   // ← takes up to 2

  if (pool && pool.length > 0) {
    // Finds current max queue position (to avoid collision)
    const { data: queueMax } = await admin.from("virus_resolution_queue")
      .select("position").eq("game_id", game_id)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const startPos = (queueMax?.position ?? -1) + 1;

    await admin.from("virus_resolution_queue").insert(
      pool.map((c, i) => ({
        game_id, card_key: c.card_key, card_type: c.card_type,
        position: startPos + i, resolved: false, cascaded_from: card.id,
      }))
    );
    await admin.from("virus_pool").delete().in("id", pool.map((c) => c.id));  // removes from pool
    // logs: `Cascading Failure! ${pool.length} more virus(es) triggered.`
  }
  // ...
}
```

The cascade handler:
1. Fetches up to 2 cards from the pool
2. Inserts them into the queue at new positions (after current max)
3. Deletes them from the pool
4. The log message reflects the actual `pool.length` pulled

This is **correct**. The "2 more viruses triggered" log message means `pool.length === 2`, which means 2 cards were actually pulled and queued. They get resolved in subsequent `resolve-next-virus` calls by the VirusResolution auto-resolve loop.

### Not a code bug — misread of observation

Bug 3 as reported is not a code defect. The cascade does pull and queue the 2 additional cards. What the user observed (pool going to 2 mid-resolution, then refilling to 4 afterwards) is CORRECT behavior. The apparent "bug 3" is likely the symptom of Bug 4a — the pool count displayed was unexpected, leading to the belief that cascade hadn't fired.

### One real issue found in the cascade path

The `queueMax` query fetches the highest `position` across ALL queue rows including resolved ones:
```typescript
.eq("game_id", game_id)
// no .eq("resolved", false) filter
```

This is intentional — it prevents position collisions by finding the overall highest. Correct as-is.

---

## Bug 4 — Virus pool count = 6 (invariant violation)

Bug 4 has two sub-components with different root causes.

---

### Bug 4b — Log fires AFTER mission complete (confirmed, high confidence)

**Root cause** (`resolve-next-virus/index.ts`, `applyVirusEffect`):

All three mission-state virus effects (`data_drift`, `model_corruption`, `validation_failure`) have this pattern (example: `data_drift` lines 178–191):

```typescript
case "data_drift": {
  const { data: mission } = await admin.from("active_mission").select("*")
    .eq("id", game.current_mission_id).maybeSingle();  // ← game fetched at fn start
  if (mission) {
    await admin.from("active_mission").update({
      data_contributed: Math.max(0, mission.data_contributed - 1),
    }).eq("id", mission.id);
  }
  const driftLog: GameLogInsert<"virus_effect"> = {
    game_id,
    event_type: "virus_effect",
    public_description: "Data Drift! −1 Data from mission.",  // ← ALWAYS logged
    metadata: { card_key: card.card_key, effect_type: "data_drift" },
  };
  await admin.from("game_log").insert(driftLog);  // ← runs even when mission == null
  return false;
}
```

`game` is fetched once at the top of `resolve-next-virus`. When a cascaded Data Drift resolves on a turn where the mission already completed (end-play-phase set `current_mission_id = null`), `game.current_mission_id` is null. The `.eq("id", null)` query returns no rows, `mission` is null, the DB update is skipped — but **the log insert is outside the `if (mission)` block and runs unconditionally**.

The user sees "Data Drift! -1 Data from mission" in the game log even though no data was removed. The game state is not corrupted (DB update was skipped), but the log is misleading.

**Same bug exists for**: `model_corruption` (line 162–178) and `validation_failure` (lines 198–210). All three unconditionally log their effect.

**Confirmation**: The "Mission complete! Core Progress +5" → "Cascading Failure" → "Data Drift! −1 Data from mission" sequence is exactly this path. The mission was already resolved when Data Drift fired.

**Why tests didn't catch it**: Game log tests don't verify absence of misleading entries after mission complete, only presence of expected entries.

**Proposed fix** (in `resolve-next-virus/index.ts`): Move the log insertion inside the `if (mission)` block for all three cases. Add an `else` branch that logs a no-effect message:

```typescript
if (mission) {
  await admin.from("active_mission").update({ data_contributed: ... }).eq("id", mission.id);
  await admin.from("game_log").insert({
    ..., public_description: "Data Drift! −1 Data from mission.",
  });
} else {
  await admin.from("game_log").insert({
    ..., public_description: "Data Drift — mission already resolved, no effect.",
  });
}
```

**Risk**: Low. Log-only change, no game state impact. Apply same fix to `model_corruption` and `validation_failure` in the same commit.

---

### Bug 4a — Pool = 6 at start of next mission (incomplete — requires runtime data)

**The hard invariant and refill logic:**

`refillVirusPool` (`resolve-next-virus/index.ts` lines 299–327):

```typescript
async function refillVirusPool(admin, game_id) {
  const { count: poolCount } = await admin.from("virus_pool")
    .select("*", { count: "exact", head: true }).eq("game_id", game_id);
  const needed = 4 - (poolCount ?? 0);
  if (needed <= 0) return;   // ← exits silently if pool >= 4
  // draws `needed` cards and inserts them
}
```

This function **only adds cards, never removes them**. If `poolCount >= 4` when the function runs, it is a no-op. Therefore: if the pool ever reaches > 4 cards and refill is called, the excess is locked in permanently for that turn. The invariant `pool = 4 after every turn` cannot self-correct via refill.

**Theoretical pool accounting for a normal turn:**

Pool starts at 4 at turn start (invariant assumed). Player stages `staged` cards (all moved to `pending_viruses` via `place-virus`). End-play-phase:

```
After shuffle pending into pool:   pool = 4 + staged
After pull-viruses (pulls N):      pool = 4 + staged - N     where N = numViruses = virusCount(cpu, cardsPlayed)
Cascading Failure (if triggered):  pool = 4 + staged - N - 2
After cascade cards resolve:       pool unchanged
After refill (at queue-empty):     pool = max(4, current_pool)  ← never reduces
```

The invariant holds IFF `staged = N`. If `staged = N`, pool after pull = 4 (perfect balance). If `staged < N`, pool = 4 + staged - N < 4 → refill brings to 4. If `staged > N`, pool = 4 + staged - N > 4 → refill does nothing → pool stays inflated → **invariant broken permanently for this game**.

**The gate that should prevent `staged > N`:**

In `PlayerTurn.tsx`, `canStage = virusCount > 0 && stagedCards.length < virusCount`. The UI enforces `staged ≤ virusCount`. And `virusCount` (UI) = `calcVirusCount(cpu, cardsPlayedThisTurn)` which should match the server's `virusCount(cpu, game.turn_play_count)`.

**Where desync is plausible (requires runtime investigation):**

1. **Dev mode player switching**: The DevMode PlayerSwitcher changes `overridePlayerId` but does NOT reset `cardsPlayedThisTurn` (that's reset only via `useEffect([currentTurnPlayer?.id])`). If the tester switched to a different AI mid-turn, played cards, then switched back, `cardsPlayedThisTurn` might be out of sync.

2. **Cold-start retry on `play-card`**: `invokeWithRetry` retries 5xx errors. If a play-card call succeeds server-side but returns a relay error (502/504), the retry would fail ("Card not in hand" — card already removed). But the client did not increment `cardsPlayedThisTurn` on the first attempt (only increments on success). If the FIRST attempt returned 200 but the client parsed it as failure, the client would not count the play. Server has `turn_play_count += 1`, client has `cardsPlayedThisTurn` not incremented. Server's `numViruses` > client's `virusCount`. Client stages fewer cards than server expects. But this would produce `staged < N` (pool deficit), not `staged > N` (pool inflation).

3. **Two turns contributing to pending_viruses**: If `pending_viruses.delete()` in end-play-phase fails silently (network drop before the delete completes), the previous turn's staged cards persist. The next end-play-phase shuffles BOTH turns' pending cards into the pool: `pool = 4 + prev_staged + curr_staged`. If `prev_staged + curr_staged > N_curr`, pool inflates.

**Bottom line**: Pool=6 cannot be produced by the normal code path with correct UI behavior. It requires either a dev-mode state desync or a very specific retry failure. Definitive root cause diagnosis requires capturing the actual `virus_pool` count at each step of the problematic playtest turn (via Supabase Dashboard or added debug logging).

**Proposed fix (defensive, applies regardless of root cause):**

Change `refillVirusPool` to also TRIM excess cards if pool > 4:

```typescript
async function refillVirusPool(admin: any, game_id: string) {
  const { data: allPoolCards } = await admin.from("virus_pool")
    .select("id, position").eq("game_id", game_id).order("position");
  const poolCount = allPoolCards?.length ?? 0;

  if (poolCount > 4) {
    // Trim excess: delete the top-position cards (most recently added)
    const excess = allPoolCards!.slice(4);  // keep bottom 4 (lowest position = oldest)
    await admin.from("virus_pool").delete().in("id", excess.map((c: any) => c.id));
    return;
  }
  const needed = 4 - poolCount;
  if (needed <= 0) return;
  // ... existing draw logic unchanged
}
```

This makes the invariant self-healing regardless of how the pool became inflated. It does not mask the root cause (which should still be found), but prevents the invariant from compounding.

**Risk**: Medium. Changes the refill contract (now also removes cards). The "trim oldest" strategy is safest — retaining lowest-position cards means keeping cards that were in the pool longest, consistent with draw order. Test: add an assertion that pool count = 4 at the start of every player_turn in E2E tests.

---

## Cross-reference and grouping

| Bug | Root cause file | Confirmed | Fix complexity |
|---|---|---|---|
| 1 — CPU/RAM side-by-side | `CentralBoard.tsx:431–469` | Yes | Medium (coord arithmetic) |
| 1.5 — +/- button misalign | `CentralBoard.tsx:483–529` | Yes | Low (y-coord update) |
| 2 — Virus card no description | `PlayerTurn.tsx:178–188` | Yes | Low (one render addition) |
| 3 — Cascade mechanism | `resolve-next-virus/index.ts:111–144` | NOT a bug | — |
| 4b — Log fires post-complete | `resolve-next-virus/index.ts:178–191, 160–177, 198–210` | Yes | Low (log inside if block) |
| 4a — Pool = 6 | `resolve-next-virus/index.ts:299–327` | Partial | Medium (refill trim + runtime investigation) |

**Bugs that ship together:**
- Bug 1 + Bug 1.5: must be one commit (button coords depend on track coords)
- Bug 4b + Bug 4a defensive fix: natural to ship together (same function, same resolve path)
- Bug 2: standalone, lowest risk

**Bug 3** is not a code bug. The cascade mechanism works correctly. Root observation (pool count behaving unexpectedly) was likely caused by Bug 4a.
