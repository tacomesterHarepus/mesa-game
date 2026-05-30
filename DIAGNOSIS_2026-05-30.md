# DIAGNOSIS 2026-05-30 — Playtest Bug Report (game_over run)

No code changes applied. All findings are analysis only; fixes require explicit approval.

---

## BUG 1 — Card reveal cards vanish after phase transition

### Root cause

`revealSlots` in `GameBoard.tsx:609` is built only when `isRevealPhase = game.phase === "card_reveal"`:

```ts
const isRevealPhase = game.phase === "card_reveal";
const revealSlots: Record<string, RevealChipConfig> | undefined = isRevealPhase
  ? Object.fromEntries(aiPlayers.map(...))
  : undefined;
```

When all AIs have revealed, `reveal-card` calls `advanceTurnOrPhase` which transitions `phase → resource_allocation`. The instant the Realtime UPDATE arrives on the client, `isRevealPhase = false`, `revealSlots = undefined`, and `CentralBoard` receives no reveal slot props → chips render without revealed cards.

The underlying data survives the transition. `players.has_revealed_card` and `players.revealed_card_key` are only cleared by `resetPlayersForNextMission` inside `end-play-phase` (called on mission complete/fail, well after resource allocation). The data is present — it is just not being rendered.

**Responsible files:** `GameBoard.tsx:608–621` (revealSlots derivation), `CentralBoard.tsx:532–535` (RevealSlotGroup conditional render).

### Proposed fix

Extend `isRevealPhase` to remain active through `resource_allocation` (and `mission_selection` if desired):

```ts
const isRevealPhase =
  game.phase === "card_reveal" ||
  game.phase === "resource_allocation" ||
  game.phase === "mission_selection";
```

The `revealSlots` map reads from `player.has_revealed_card` and `player.revealed_card_key`, which stay populated until mission resolution, so no data-layer change is needed.

Note: This fix interacts with Bug 2 (layout). During `resource_allocation`, the chips show `[-]/[+]` buttons at chip-local x=171/185. The reveal slot is at chip-local x=165 — a 6px overlap. See Bug 2 Option B which eliminates this conflict.

---

## BUG 2 — Revealed card occluded by adjacent chip and firewall

### Root cause

`RevealSlotGroup` renders inside `AIChipGroup`'s chip-body group (`<g transform="translate(chipX, chipY)">`). With `SLOT_SIDES` all `"right"`, the slot x-offset is `slotX = 165`, placing it at chip-local x=165, SVG-local x = chipX + 165.

**Occlusion by sibling chip (chip A / slot overlapped by chip B):**

- Chip A is at SVG x=25; its reveal slot occupies SVG x=190–250.
- Chip B is at SVG x=225; its chip body occupies SVG x=225–385.
- In `CentralBoard`, CHIP_SLOTS are rendered as `CHIP_SLOTS.map((slot, i) => ...)` — chip B (i=1) renders AFTER chip A (i=0) in SVG document order. SVG paints in source order, so chip B's body paints on top of chip A's slot in the overlap zone x=225–250. Approximately 25px of chip A's slot (42% of its 60px width) is covered.
- Chip D (i=3) renders AFTER chip C (i=2), so chip D's slot is on top of chip C's body — no occlusion issue for D.

**Occlusion by firewall (chips B and C):**

- Chips B and C are at SVG x=225; their reveal slots occupy SVG x=390–450.
- The firewall group (`<g>`) renders after all chip groups in `CentralBoard.tsx:791–808`. Its main rect starts at SVG x=425. The rightmost 25px of chips B and C's slots (x=425–450) are covered by the firewall.

**Responsible files:** `CentralBoard.tsx:115–161` (`RevealSlotGroup`, `slotX` calculation), `CentralBoard.tsx:164–165` (`SLOT_SIDES`), `CentralBoard.tsx:786–808` (firewall render order), `CentralBoard.tsx:759–785` (chip render loop order).

### Proposed options (do not pick — user to decide)

**Option A — Move firewall right**
Shift firewall from x=421–449 to approximately x=455–483. Expand the SVG from 695px to ~730px wide. Shift the human hologram group (currently at SVG x=475+) by the same delta. This resolves firewall occlusion for chips B and C. It does NOT resolve the sibling-chip occlusion of chip A by chip B (that requires either changing SLOT_SIDES for A to `"left"` or moving the slot below).

**Option B — Relocate reveal slot below the chip body**
Place the slot below the chip body (and below contribution counters) rather than to the side. For top chips (isTop=true, chipY=80): there is space between counterY=182 and the bottom row starting at y=320. A slot rendered at chip-local y=105 (SVG y = chipY+105 = 185) would sit in this gap, clear of the firewall and clear of all sibling chips. For bottom chips (isTop=false, chipY=320): contribution counters are at counterY=298; a slot could go above the chip at y≈-100 (SVG y=220) in that gap, or below the chip body at y≈95. This approach eliminates all sibling/firewall conflicts and also eliminates the overlap with the resource-allocation `[-]/[+]` buttons (which live at chip-local x=171/185). However it requires a layout redesign and spacing verification between the two chip rows. UX_DESIGN §5.6 specifies the slot "to the outside edge" of each chip — Option B deviates from the spec and would require a §5.6 update.

---

## BUG 3 — "×? cards" hand-stack count unresolved; only top two chips

### Root cause (two distinct issues)

**Issue 1 — literal `?` placeholder:**
`CentralBoard.tsx:478` hardcodes `×? cards`:
```tsx
<text x="22" y="86" fontFamily="monospace" fontSize="9" fill="#9cb4a4">×? cards</text>
```
There is no `handCounts` prop on `CentralBoard.Props`, no `handCount` parameter on `AIChipGroup`, and no data path threading counts from GameBoard through to CentralBoard. The `?` was a placeholder that was never wired.

Additionally, GameBoard only receives the **current player's own hand** (`hand` state). Other AI players' hands are RLS-restricted (read only by the owning player). Showing accurate counts for all chips requires either: (a) a server-written `hand_count int` column on `players` (readable by all, updated by draw/discard/play/stage edge functions), or (b) a per-player count visible only on the player's own chip.

**Issue 2 — top two chips only:**
Line 473: `{isTop && (...)}` gates the hand-stack visual to chips where `isTop=true` — chips A and B (the top row in `CHIP_SLOTS`). Chips C and D (`isTop=false`) render no hand-stack UI. The comment ("only fits in top chips (bottom chips' RAM track reaches y=87/90)") identifies a real layout conflict: the card-stack rects at chip-local y=74–88 would overlap the RAM track (y=72, height=11, ending at y=83) on bottom chips.

**Responsible files:** `CentralBoard.tsx:472–479` (hand-stack render + literal `?`), `CentralBoard.tsx:55–60` (`CHIP_SLOTS` isTop values).

### Proposed fix

For the `?` count: Add `handCounts?: Record<string, number>` to `CentralBoard.Props` (keyed by player.id). Thread from GameBoard: own player's count from `hand.length`, leave other AIs as `undefined` (show `?`). Longer term, add `hand_count` to `players` table updated server-side, making actual counts visible to all.

For the positional constraint on bottom chips: instead of the stacked card rects (which clash with the RAM track), show a compact count-only label above the chip body at chip-local y=-30 (in the gap between the contribution counter row and the chip top), using a `rect` badge + count text. This avoids the y=74–88 conflict.

---

## BUG 4 — Secret targeting votes to top-left AI regardless of chip nomination

### Root cause

This is a dev-mode only bug (production has one device per player; no player switching).

Two competing `useEffect` calls manage `selectedTargetId` in `SecretTargeting.tsx`:

```ts
// Effect A — syncs chip nomination
useEffect(() => {
  if (localNominationId) setSelectedTargetId(localNominationId);
}, [localNominationId]);

// Effect B — resets on dev-mode player switch
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  setSelectedTargetId(aiTargets[0]?.id ?? "");
}, [currentPlayer?.id]);
```

**Race sequence:**
1. Misaligned AI player 1 is active. User clicks chip to nominate Bot5 → `setLocalNominationId(Bot5.id)` (GameBoard).
2. Effect A fires → `setSelectedTargetId(Bot5.id)`. UI shows "▸ Bot5" nomination, amber button.
3. User switches to Misaligned AI player 2 via DevMode → `currentPlayer?.id` changes.
4. Effect B fires → `setSelectedTargetId(aiTargets[0].id)` = TEST (top-left AI). **Nomination silently reset.**
5. `localNominationId` is still `Bot5.id` (GameBoard only resets it on phase exit, not player switch) → button remains amber (appears to confirm Bot5).
6. User clicks "APPROVE & VOTE" → `handleVote` sends `target_player_id: selectedTargetId` = TEST.
7. Server records vote for TEST. Effect lands on top-left AI.

The timer/deadline path (`force_resolve: true`) is unaffected because it does not use `selectedTargetId`. That path correctly picks a random AI, which is why timeout works but voted path does not.

**Responsible files:** `SecretTargeting.tsx:57–65` (Effects A and B), `SecretTargeting.tsx:119–134` (`handleVote`).

### Proposed fix

Change Effect B to re-apply the existing nomination if one exists:
```ts
useEffect(() => {
  // On player switch: if a nomination is already shared via chip-click, restore it;
  // otherwise default to first AI so the button is enabled
  setSelectedTargetId(localNominationId ?? aiTargets[0]?.id ?? "");
  // localNominationId intentionally omitted from deps (stale-closure suppressed below)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentPlayer?.id]);
```

This aligns `selectedTargetId` with `localNominationId` on player switch, eliminating the mismatch. Alternatively, use a `localNominationIdRef` to read the latest value inside the effect without adding it to deps.

---

## BUGS 5 + 8 — Pool count display anomalies (shared root cause)

### Root cause

`poolCount` state in `GameBoard.tsx:77–79` is maintained by incremental Realtime +1/−1 events:

```ts
.on("postgres_changes", { event: "INSERT", table: "virus_pool" },
  () => { setPoolCount((prev) => prev + 1); })
.on("postgres_changes", { event: "DELETE", table: "virus_pool" },
  () => { setPoolCount((prev) => Math.max(0, prev - 1)); })
```

Any missed, duplicated, or out-of-order Realtime event permanently drifts the displayed count until the next 3-second poll overrides it with the actual DB value. Supabase Realtime can replay events on reconnect, causing duplicates.

**Bug 5 — transient 5 and +1 refill:**
The 3→5→3→+1 sequence is the intended server-side lifecycle made visible:
- Pool=3 (depleted by previous turn's pull)
- `end-play-phase` flushes 2 pending_viruses into pool → INSERTs fire → count=5 (temporarily above 4)
- `pull-viruses` pulls 2 → DELETEs fire → count=3
- `refillVirusPool` (after virus queue empties) adds 1 card → INSERT fires → count=4

The transient 5 is correct and expected — the pool exceeds 4 briefly during the pending flush because the pull happens afterwards. The +1 refill is `refillVirusPool` correctly restoring to 4. These appear anomalous only because Realtime surfaces the intermediate states. The DB state was correct throughout.

**Bug 8 — 8 cards after two Cascading Failures:**
Two CF chains followed by a subsequent turn's pending flush could produce a display count of 8 via Realtime drift:
- Post-cascade: pool=0, `refillVirusPool` inserts 4 → Realtime: +4
- Next turn: flush 2 pending → Realtime: +2 → displayed 4+4+2 = 10?

More likely: one or more DELETE events (from cascade deletions during the CF chain) were missed by Realtime, causing the displayed count to never decrement. After the subsequent turn's flush and refill, the display shows the accumulated sum rather than the actual count. The 3-second poll was the correction mechanism the user observed.

**Residual double-refill risk (not confirmed, worth noting):** If the `resolveInFlightRef` reset (Bug 6's root cause) causes two concurrent empty-queue calls to both reach `refillVirusPool`, both could read the same `poolCount` concurrently (before either's inserts are visible), compute the same `needed`, and both insert `needed` cards → pool double-fills. In practice the 500ms debounce makes this rare, but the window exists.

**Responsible files:** `GameBoard.tsx:217–224` (Realtime pool count handlers), `supabase/functions/resolve-next-virus/index.ts:353–381` (`refillVirusPool`).

### Proposed fix

Replace the incremental Realtime handler with an absolute DB query on each change event:
```ts
.on("postgres_changes", { event: "INSERT", table: "virus_pool" }, async () => {
  const { count } = await supabase.from("virus_pool")
    .select("id", { count: "exact", head: true }).eq("game_id", gameId);
  if (count !== null) setPoolCount(count);
})
// same for DELETE
```

This eliminates drift — every event results in a fresh absolute count. The 3s poll remains as a fallback. Alternatively, replace both Realtime handlers with a single `"postgres_changes"` subscription that uses an explicit count query, and rely solely on the 3s poll (removing the Realtime increment entirely).

---

## BUG 6 — "AUTO-RESOLVE FAILED" error at mission end

### Root cause

**File:** `VirusResolution.tsx:49–96`

The auto-resolve `useEffect` resets `resolveInFlightRef.current = false` unconditionally at the top on every `currentCard?.id` change (line 51):

```ts
useEffect(() => {
  setAutoResolveError(null);
  resolveInFlightRef.current = false;  // reset on every card change

  if (currentCard) {
    // ... schedule 2s resolve timer
  } else {
    // ... schedule 500ms advance timer
  }
}, [currentCard?.id, ...]);
```

**Race sequence (last card in queue):**
1. `currentCard = last_card` → 2s timer scheduled.
2. 2s timer fires → `resolveInFlightRef = true` → Call A starts (server marks card resolved, fast).
3. Server marks card resolved → DB write → Realtime UPDATE fires (quickly, often < 2s).
4. Client: `virusQueue` updated → `currentCard = null` → `currentCard?.id` changes.
5. `useEffect` re-runs: **`resolveInFlightRef = false`** (reset) + 500ms advance timer scheduled.
6. Call A may still be in-flight (server is running `advanceTurnOrPhase` within the resolve).
7. 500ms timer fires → `resolveInFlightRef` is false → Call B starts (advance turn).
8. If Call A has ALREADY completed and transitioned `phase → resource_adjustment` before Call B starts, Call B hits `if (game.phase !== "virus_resolution") throw new Error("Not in virus_resolution phase")` → returns HTTP 400.
9. Client: `data.error = "Not in virus_resolution phase"` → `setAutoResolveError(...)` → error banner visible at bottom of ActionRegion.
10. Shortly after: Realtime UPDATE for `games` table arrives → `game.phase` changes on client → GameBoard re-renders → `VirusResolution` unmounts → error disappears.

**Why "at mission end":** `advanceTurnOrPhase` (called in the empty-queue branch) transitions away from `virus_resolution` when the mission or turn is complete. This transition is what creates the window where Call B sees the wrong phase. For mid-chain resolutions, `resolve-next-virus` does NOT call `advanceTurnOrPhase`, so no phase transition occurs and Call B proceeds normally.

**Benign:** game state is fully correct. Mission points awarded, pool refilled, turn advanced. The error is cosmetic and transient (disappears on component unmount).

### Proposed fix

Move the `resolveInFlightRef.current = false` reset to fire only when `currentCard` changes to a **new non-null card**, not when it becomes null:

```ts
useEffect(() => {
  setAutoResolveError(null);

  if (currentCard) {
    resolveInFlightRef.current = false;  // only reset when a new card appears
    // ... schedule 2s resolve timer
  } else {
    // Do NOT reset ref here — if a 2s call is in-flight, let it finish.
    // Only schedule the advance timer if no call is active.
    if (!resolveInFlightRef.current) {
      const advanceTimer = setTimeout(async () => {
        resolveInFlightRef.current = true;
        ...
      }, 500);
      return () => clearTimeout(advanceTimer);
    }
  }
}, [currentCard?.id, ...]);
```

This prevents the 500ms advance timer from firing while a 2s resolve call is still in-flight, closing the race window.

---

## BUG 7 — Dataset Preparation compute block missing client-side

### Root cause

`computeBlocked` in `PlayerTurn.tsx:289–291` only covers `dataset_integration`:

```ts
const computeBlocked =
  activeMission?.mission_key === "dataset_integration" &&
  (activeMission.compute_contributed ?? 0) >= (activeMission.data_contributed ?? 0) * 2;
```

No equivalent check exists for Dataset Preparation's mission rule: "Compute cannot be played until all 4 Data are contributed."

**Consequence on the client:**
- Compute cards are NOT visually disabled on Dataset Preparation when `data_contributed < 4`. Users can select them and click "PLAY CARD".
- The hint text "Play Data to unlock Compute slots." (line 478) gates on `computeBlocked`, so it never renders for Dataset Preparation.

**Server-side enforcement is correct:** `play-card/index.ts:252` has:
```ts
case "dataset_preparation":
  if (cardKey === "compute" && mission.data_contributed < 4) {
    return "Dataset Preparation: Compute cannot be played until all 4 Data are contributed";
  }
```
The attempt is rejected server-side with HTTP 400 → `invokeWithRetry` returns `fnError.message` → `setError(...)` → error `<p>` renders in the hand area.

**"Appears after staging" observation:** The error `<p>` renders at the bottom of the left flex column (`PlayerTurn.tsx:485–490`), below the card display, adjacent to the staging/action area. It may visually appear to coincide with the staging step if the user has already staged cards before attempting to play Compute, or if they interpret the error's bottom-of-panel position as "appearing after staging."

**Responsible files:** `PlayerTurn.tsx:289–291` (`computeBlocked` derivation), `PlayerTurn.tsx:457–458` (`isDisabled` in card group), `PlayerTurn.tsx:477–481` (hint text), `supabase/functions/play-card/index.ts:252–255` (server block, correct).

### Proposed fix

Extend `computeBlocked` to cover Dataset Preparation:

```ts
const computeBlocked =
  (activeMission?.mission_key === "dataset_integration" &&
    (activeMission.compute_contributed ?? 0) >= (activeMission.data_contributed ?? 0) * 2) ||
  (activeMission?.mission_key === "dataset_preparation" &&
    (activeMission.data_contributed ?? 0) < 4);
```

Extend the hint text with a conditional message:
```tsx
{hasDiscarded && computeBlocked && (
  <span ...>
    {activeMission?.mission_key === "dataset_preparation"
      ? "All 4 Data must be contributed before Compute can be played."
      : "Play Data to unlock Compute slots."}
  </span>
)}
```

This makes Compute visually disabled before the play attempt and shows the correct reason, eliminating the need for a server round-trip to surface the rule.

---

## Shared root-cause note

**Bugs 5 and 8** share the same root cause: incremental Realtime pool count without deduplication or absolute ground-truth verification.

**Bugs 1 and 2** interact: fixing Bug 1 (extending reveal slots to `resource_allocation`) exposes the Bug 2 overlap with the `[-]/[+]` buttons at chip-local x=171/185. Option B for Bug 2 (slot below chip body) resolves both conflicts simultaneously.

---

## Impact ranking (descending)

| Rank | Bug | Impact |
|------|-----|--------|
| 1 | Bug 4 — wrong targeting target (voted path) | Breaks core gameplay mechanic (secret targeting always lands on TEST) |
| 2 | Bug 7 — Dataset Preparation compute allowed + late warning | Wrong play allowed; rule only enforced after server round-trip |
| 3 | Bug 1 — reveal cards vanish after phase transition | Humans miss card-type information during resource allocation |
| 4 | Bug 3 — hand count shows `?` / only top chips | Incomplete information display; all chips should show count |
| 5 | Bug 2 — reveal card occluded | Cards visible but partially covered; cosmetic but confusing |
| 6 | Bug 6 — auto-resolve error flash at mission end | Cosmetic/transient; game state is correct, error is briefly alarming |
| 7 | Bugs 5+8 — pool count display drift | Cosmetic; self-corrects in ≤3s; DB state is correct |

---

## VERIFICATION 2026-05-30

Ground-truth checks against the actual code and live DB. Performed after initial diagnosis was written.

---

### Task 1 — Bug 4: SecretTargeting.tsx code vs. diagnosis

**Verdict: DIAGNOSIS CONFIRMED.**

`SecretTargeting.tsx` was read in full. The described mechanism matches the actual file exactly.

**Confirmed code (lines 57–65):**
```ts
// Effect A — sync nomination from chip-click in CentralBoard
useEffect(() => {
  if (localNominationId) setSelectedTargetId(localNominationId);
}, [localNominationId]);

// Effect B — reset on player switch (dev mode PlayerSwitcher)
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  setSelectedTargetId(aiTargets[0]?.id ?? "");
}, [currentPlayer?.id]);
```

- `localNominationId` prop exists at line 32 (`localNominationId: string | null`).
- Chip-click `onNominate` wiring confirmed in `GameBoard.tsx:586–605` (`targetingChips` config).
- `handleVote` (lines 119–134) sends `target_player_id: selectedTargetId` — the per-component state, not `localNominationId`.
- APPROVE & VOTE button confirmed at lines 234–253.

**Git log:** `a483937 fix(SecretTargeting): reset selected target on dev-mode player switch` (2026-05-06). Effect B was added to fix a prior bug where `selectedTargetId` was never reset on player switch at all. The fix introduced the current mismatch (Effect B resets to `aiTargets[0].id`, overwriting whatever Effect A had just set via `localNominationId`).

**BACKLOG cross-check:** `~~SecretTargeting selectedTargetId not reset on dev-mode player switch~~ — ✅ Resolved 2026-05-06 (commit a483937)` — consistent. The prior bug was absence of any reset; Effect B fixed that but introduced the new ordering mismatch.

**Production reachability correction from initial diagnosis:**

The initial diagnosis called this "dev-mode only." That is only partially correct. In production (one device per player), Effect B fires once at mount, initialising `selectedTargetId = aiTargets[0].id`. A misaligned player who opens the SecretTargeting panel and clicks APPROVE & VOTE without first clicking a chip will vote for `aiTargets[0]` (the first AI in the `players.filter` array). The chip-click nomination is optional — the button is enabled from mount because `selectedTargetId` defaults to a valid ID. This is a **production-reachable UX gap**: a player who does not know they need to click a chip first will silently vote for the first AI in the list.

In dev-mode the impact is worse (player switch overwrites the nomination mid-flow), but production is not fully protected.

---

### Task 2 — Bugs 5+8: DB ground truth vs. display-only drift

**Verdict: ORIGINAL DIAGNOSIS WAS INCORRECT. The DB IS over-filled.**

DB queries against game `8ef6f048-bde9-465b-8ece-760e9eda6ce1` (today's playtest, phase=game_over):

**virus_pool row count: 8** (expected max 4)

**virus_pool rows in detail:**
```
position 1: validation     (progress)
position 2: dependency_error (virus)   ← DUPLICATE
position 2: dependency_error (virus)   ← DUPLICATE
position 3: cascading_failure (virus)  ← DUPLICATE
position 3: cascading_failure (virus)  ← DUPLICATE
position 4: compute        (progress)
position 5: pipeline_breakdown (virus)
position 6: cpu_drain      (virus)
```

Duplicate `position` values at 2 and 3 are the smoking gun. `refillVirusPool` computes `startPos = maxRow.position + 1` from a `SELECT MAX(position)` and inserts `needed` rows at sequential positions. If two calls run concurrently and both read `MAX(position)` before either's inserts commit, both compute the same `startPos` and both insert `needed` cards starting from that position — resulting in 8 rows with positions 1,2,2,3,3,4,5,6.

**Mechanism (confirmed):**

1. Last virus in queue resolves → `virusQueue` emptied → Realtime UPDATE fires.
2. Bug 6's `resolveInFlightRef.current = false` unconditional reset fires on the `currentCard?.id` change.
3. With `resolveInFlightRef` now false, the 500ms advance timer starts.
4. Simultaneously: another Realtime event (or the same event on reconnect) arrives → a second `useEffect` run starts the 500ms timer again (or the first call finishes and Realtime fires before the 500ms timer clears).
5. Both empty-queue calls pass the idempotency guard (queue is already empty; `!nextCard` branch reached for both).
6. Both call `refillVirusPool`. Both execute `SELECT MAX(position) FROM virus_pool` before either's `INSERT` commits.
7. Both compute `startPos = 0 + 1 = 1`, `needed = 4 - 0 = 4`. Both insert 4 rows starting at position 1.
8. Pool ends up with 8 rows, positions 1–4 duplicated.

This is a real DB-level corruption, not display drift. The original note in the diagnosis called it a "residual double-refill risk (not confirmed, worth noting)." **It is confirmed.**

**Game log context:** `mission_complete` at 17:09:32 → `viruses_placed` at 17:09:32 → `virus_queue_start: "TEST pulled 2 viruses"` at 17:09:37 → two `virus_no_effect` resolutions at 17:09:40 and 17:09:43 → `game_over` at 17:09:44. The 2 viruses resolved were `validation` and `data` (progress cards, no effect), so the over-full pool did not cause game-state corruption in this specific run. However, the 8-card pool had been inflating virus dilution probabilities throughout the late game.

**Second game confirmed:** Game `14891e14` (phase=player_turn, active game at time of query) also had 8 virus_pool rows, confirming this is reproducible and not isolated to the playtest game.

**Impact ranking correction:**

The original rank 7 description read "Cosmetic; self-corrects in ≤3s; DB state is correct." **This is wrong.** The DB state is NOT correct. The pool persists with 8 rows; it does not self-correct. When 2 viruses are pulled next turn, 6 remain instead of 2, and after resolution the refill inserts to a pool that already has excess rows. The dilution maths are wrong for the remainder of the game from the point of double-fill.

Revised impact for Bugs 5+8: **DB-level bug causing persistent virus pool inflation after any run of Cascading Failure into empty-queue advance.** Should be ranked 2 or 3, not 7. The cosmetic display drift (from Realtime incremental counting) is a separate minor issue; the DB corruption is the real problem and shares the same fix as Bug 6 (moving the `resolveInFlightRef` reset).

**Correction note on mechanism:** The Task 2 analysis above stated startPos=1 and positions 1–4 duplicated. Both are wrong. The follow-up below derives the correct mechanism from the game_log and code.

---

### Follow-up: position pattern

**Context:** `virus_pool` has no `created_at` column. Write sequence was reconstructed from game_log timestamps cross-referenced with all three candidate writers' position logic read from source. The virus_resolution_queue table (which does persist all rows) provided additional confirmation of the cascade chain structure.

---

#### 1. Write sequence reconstruction

Three batches wrote to the pool after Mission 3 started (16:56), in the order reconstructed below.

**Batch A — ~17:04:34 (double refillVirusPool, two concurrent rows)**

Immediately following Bot3 M3R1's cascade chain. The game_log shows:
```
17:02:59.011  virus_effect: "Cascading Failure! 2 more viruses triggered."
17:02:59.115  virus_effect: "Cascading Failure! 2 more viruses triggered."   ← 104ms later, duplicate
17:03:02.018  virus_effect: "Cascading Failure! 2 more viruses triggered."
17:03:02.085  virus_effect: "Cascading Failure! 2 more viruses triggered."   ← 67ms later, duplicate
17:03:04.975  virus_effect: "Cascading Failure! Pool was empty — chain stops here."
...6× virus_no_effect: compute (17:04:25–32)...
17:04:34.649  turn_start: "Bot2's turn."
17:04:34.679  turn_start: "Bot2's turn."   ← duplicate, 30ms later
```

The cascade chain ran two pairs of concurrent CF applications (confirmed by virus_resolution_queue: CF_35b099e0 produced 4 cascade rows at positions 4,5,6,7 = two separate 2-card pulls; CF_599093bc also produced 4 rows at positions 8,8,9,9 = two separate 2-card pulls). This created 8 extra queue entries instead of 4. All 8 resolved one by one (~3s each from auto-resolve, in pairs due to duplicate positions), the pool was fully emptied by the chain ("chain stops here" event), and the queue emptied at 17:04:32.

The double `turn_start` at 17:04:34 is the signature: two concurrent calls to `resolve-next-virus` both reached the empty-queue path, both called `refillVirusPool`, both called `advanceTurnOrPhase`.

Pool state entering Batch A: **0 rows** (fully emptied by cascade chain).

Both `refillVirusPool` calls:
- `COUNT = 0` → `needed = 4`
- `MAX(position) = null` → `startPos = (null ?? -1) + 1 = 0`
- Each inserts 4 cards at positions **0, 1, 2, 3**

Result after Batch A: **8 rows at positions 0, 0, 1, 1, 2, 2, 3, 3** (all four positions duplicated).

---

**Batch B — 17:06:40 (Bot2 M3R1 end-play-phase pending flush, 1 card)**

`end-play-phase` pending flush (single call, one pending card):
- `MAX(position) = 3` → `startPos = 4`
- Inserts 1 card at position **4**

Pool after Batch B: 0, 0, 1, 1, 2, 2, 3, 3, 4 (9 rows).

Bot2 pull-viruses (1 virus, CPU≥2, 1 card played): `ORDER BY position LIMIT 1` → picks one of the two position-0 rows, deletes it by ID.
Pool: 0, 1, 1, 2, 2, 3, 3, 4 (8 rows).

Bot2's empty-queue refillVirusPool: `COUNT = 8` → `needed = -4` → returns early (single turn_start Bot5, no double).

Bot5 turn: 0 pending, 0 viruses (CPU=1, 0 cards played), end-play-phase calls `advanceTurnOrPhase` directly — pool untouched.

Pool entering Batch C: **0, 1, 1, 2, 2, 3, 3, 4** (8 rows).

---

**Batch C — 17:09:32 (TEST M3R1 end-play-phase pending flush, 2 cards)**

`end-play-phase` pending flush (single call, 2 pending cards):
- `MAX(position) = 4` → `startPos = 5`
- Inserts 2 cards at positions **5, 6**

Pool: 0, 1, 1, 2, 2, 3, 3, 4, 5, 6 (10 rows).

TEST pull-viruses (2 viruses, CPU=4, 3 cards played): `ORDER BY position LIMIT 2` → picks the one row at position 0 and one of the two rows at position 1, deletes both by ID.
Pool: **1, 2, 2, 3, 3, 4, 5, 6** (8 rows). ✓ Matches actual DB state exactly.

Both resolved queue cards (data, validation) were no-effect. Empty-queue refillVirusPool: `COUNT = 8` → `needed = -4` → no-op. Single turn_start (game_over — no double). Final pool unchanged.

---

#### 2. Which code path issued each batch and its position logic

| Batch | Writer | Trigger | Position logic |
|-------|--------|---------|----------------|
| A (×2 concurrent) | `resolve-next-virus → refillVirusPool` | Queue emptied at end of Bot3 M3R1 cascade chain | `SELECT COUNT` → needed; `SELECT MAX(position)` → startPos; INSERT needed rows at startPos+i |
| B | `end-play-phase` pending flush | Bot2 M3R1 turn end | `SELECT MAX(position)` → startPos; INSERT N rows at startPos+i |
| C | `end-play-phase` pending flush | TEST M3R1 turn end | `SELECT MAX(position)` → startPos; INSERT N rows at startPos+i |

`refillVirusPool` and `end-play-phase` use the **same MAX(position)+1 scheme**. The critical difference: `refillVirusPool` also reads COUNT before MAX, giving two separate reads neither of which is atomic with the other.

Cascading failure in `applyVirusEffect` writes to `virus_resolution_queue`, not `virus_pool` — it removes from the pool (DELETE) rather than adding. It is not a pool writer.

---

#### 3. Why duplicates land at positions 2 and 3 only

Batch A produced **all four positions** duplicated: 0,0,1,1,2,2,3,3. Positions 2 and 3 are the survivors; positions 0 and 1 had their duplicates consumed:

- **Position 0 (×2 → ×0):** Bot2's pull removed one row; TEST's first pull (lowest position in pool at that time = 0) removed the other. Both rows at position 0 were consumed.
- **Position 1 (×2 → ×1):** TEST's second pull picked the next-lowest position = 1 (one row). One position-1 row was consumed; the other survived.
- **Positions 2 and 3 (×2 → ×2):** Never the lowest two positions at any pull time — never reached. Both rows at each position survived.
- **Positions 4, 5, 6 (×1):** Added by Batch B (position 4, Bot2's flush) and Batch C (positions 5 and 6, TEST's flush). Unique single rows.

The 2,3 pattern is purely the outcome of three turns of pulls progressively consuming the low-position duplicates while leaving the high-position ones intact.

---

#### 4. Whether Bug 6's resolveInFlightRef reset is the trigger; whether they share a fix

**Bug 6's reset is the direct trigger for the double refill (Batch A).** The double `turn_start` at 17:04:34 is the same signature as Bug 6: two concurrent `resolve-next-virus` calls both reached the empty-queue path, called `refillVirusPool`, and called `advanceTurnOrPhase`. The `resolveInFlightRef.current = false` unconditional reset in the `currentCard?.id` useEffect allows the 500ms advance timer to start a second concurrent call while an in-flight 2s resolve call is completing its phase transition. This is the identical mechanism described for Bug 6.

**However, there is a separate contributing race upstream that Bug 6 does NOT fix.** The double CF applications at 17:02:59 and 17:03:02 (each pair 67–104ms apart) are NOT from the empty-queue path. They are from two concurrent 2s-resolve-timer calls both reading the same CF card as unresolved and both calling `applyVirusEffect`. The v11 TOCTOU fix prevents one sub-race (Call B observing a CF as `resolved=true` before its cascade rows are written) but does NOT prevent two calls from both reading CF as `resolved=false` and both applying the effect. This is a separate vulnerability in the card-resolution path.

**On the fix relationship:**

The Bug 6 fix (moving `resolveInFlightRef.current = false` to fire only when a new non-null card appears) closes the empty-queue double-advance path. Pool corruption from double `refillVirusPool` would be eliminated. In this specific game, without Batch A's double refill, the pool would have stayed at 0 rows after the cascade chain until the next turn's refill, and the 2,3 duplicates would never have formed.

The double CF application race remains open after the Bug 6 fix. It creates excess queue entries (positions 8,8,9,9) which cause near-simultaneous Realtime events and extra resolutions — but if the empty-queue path fires only once (Bug 6 fixed), only one `refillVirusPool` call runs and no duplication occurs in the pool. The double CF application would still produce duplicate queue rows (cosmetic — extra `virus_no_effect` log events) but would not corrupt the pool.

**Summary:** Bugs 5+8 DB corruption and Bug 6 error flash share the same immediate root cause (the empty-queue concurrent calls) and the same fix target (`resolveInFlightRef` reset location). The double CF application is a separate race that contributes to the conditions for the corruption but has an independent fix path.

---

## VERIFICATION 2026-05-30 (TOCTOU re-check)

Post-playtest verification: does the deployed resolve-next-virus match the v11 fixes noted in SESSION_NOTES, or did something regress?

---

### 1. Deployed version

`mcp__supabase__list_edge_functions` queried live project `qpoakdiwmpaxvvzpqqdh`.

- **Supabase internal version: 12**
- **Last updated: 2026-05-07T21:45:54.346Z**
- Status: ACTIVE

SESSION_NOTES records the v11 deploy with annotation "(Supabase internal version 12)". The timestamps match. No deploy gap, no regression window.

---

### 2. v11 fixes in current source

Both fixes are **PRESENT** in `supabase/functions/resolve-next-virus/index.ts`.

**Fix (a) — applyVirusEffect runs BEFORE mark-resolved for cascading_failure (lines 75–80):**

```ts
if (nextCard.card_key === "cascading_failure") {
  await applyVirusEffect(admin, game, nextCard);
}

await admin.from("virus_resolution_queue")
  .update({ resolved: true }).eq("id", nextCard.id);
```

CF effect (which writes cascade rows to the queue) runs first. The mark-resolved write comes after, so a concurrent call that races in after the cascade rows are inserted will see CF as resolved and will find the cascade rows — it will not double-apply the CF effect.

**Fix (b) — idempotency guard re-fetches queue before empty-queue branch (lines 48–61):**

```ts
if (!nextCard) {
  // Idempotency guard: re-fetch to confirm queue is truly empty before advancing.
  // Defends against TOCTOU race where cascading_failure is being processed concurrently
  // and its cascade cards have not yet been written to the queue.
  const { data: queueCheck } = await admin
    .from("virus_resolution_queue").select("id")
    .eq("game_id", game_id).eq("resolved", false)
    .limit(1).maybeSingle();
  if (queueCheck) {
    console.log(`[resolve-next-virus] stale empty-queue — unresolved card ${queueCheck.id} found on re-fetch, exiting`);
    return new Response(JSON.stringify({ success: true, skipped: "stale_empty_check" }), { ... });
  }
  // Queue confirmed empty — refill pool and advance turn.
  await refillVirusPool(admin, game_id);
  ...
}
```

If a concurrent call reaches `!nextCard` while a CF application is mid-flight (cascade rows not yet inserted), the re-fetch catches the cascade rows and exits early.

---

### 3. Deployed vs source

Live deployed function is **Supabase internal v12, updated 2026-05-07**. SESSION_NOTES records the v11 fix shipped 2026-05-07 with annotation "(Supabase internal version 12)". Both v11 fixes are present in source. Deployed matches source. No regression.

---

### 4. Classification of 30 May Bug 5+8

**Classification: (B) — v11 fix is present and deployed but INSUFFICIENT.**

The idempotency guard (fix b) re-checks `virus_resolution_queue` for `resolved=false` entries. It defends this specific scenario:

> Concurrent call C2 arrives while C1 is applying a CF effect. C2 sees `!nextCard` (CF not yet resolved in queue), re-fetches, finds CF's cascade rows now written → exits early.

It does **NOT** defend this scenario:

> Two concurrent end-of-chain calls C1 and C2 both arrive **after** the CF cascade chain is fully resolved. Queue is genuinely empty. Both re-fetch and both see 0 unresolved items. Both pass the guard. Both reach line 64's `await refillVirusPool(...)`.

Inside `refillVirusPool` (lines 353–381):

```ts
// Read 1: count
const { count: poolCount } = await admin.from("virus_pool")
  .select("*", { count: "exact", head: true }).eq("game_id", game_id);
const needed = 4 - (poolCount ?? 0);
if (needed <= 0) return;

// Read 2: max position (separate query — not atomic with Read 1)
const { data: maxPoolRow } = await admin.from("virus_pool")
  .select("position").eq("game_id", game_id)
  .order("position", { ascending: false }).limit(1).maybeSingle();
const startPos = (maxPoolRow?.position ?? -1) + 1;

await admin.from("virus_pool").insert(
  drawCards.map((card, i) => ({ ..., position: startPos + i }))
);
```

Two concurrent calls that both reach this function before either's INSERT commits will both read the same COUNT and the same MAX(position). Both compute `needed = 4` and `startPos = 0`. Both insert 4 cards at positions 0–3. Pool ends up with 8 rows at positions 0,0,1,1,2,2,3,3 — exactly the Batch A pattern from the 30 May playtest.

The idempotency guard closes the **CF-window race** (concurrent call during cascade-insert). It does not close the **end-of-chain double-advance race** (two concurrent calls on an already-empty queue). These are two distinct races; v11 fixed one.

---

### 5. Recommendation

**Both a client-side and a server-side fix are needed.**

**Client-side (Bug 6 fix — resolveInFlightRef):** Move `resolveInFlightRef.current = false` out of the unconditional position at the top of the `useEffect` into the `if (currentCard)` branch only. This prevents the 500ms advance timer from firing while a 2s resolve call is still completing its phase transition. This closes the common case: under normal conditions only one end-of-chain call fires, so only one `refillVirusPool` runs.

**Server-side (refillVirusPool idempotency):** The client fix narrows the race window but does not eliminate it (Realtime reconnects can still cause duplicate events on timescales longer than the in-flight guard). The server needs its own protection. Two options, either sufficient:

- **Option A — pool-count re-check immediately before INSERT:** After `drawFromDeck` returns cards, re-read `COUNT` from `virus_pool` and recompute `needed`. If COUNT has changed (another call already inserted), insert only the remaining deficit or skip. This adds one extra read per refill but eliminates the double-insert path.

- **Option B — UNIQUE constraint on `(game_id, position)`:** `ALTER TABLE virus_pool ADD CONSTRAINT virus_pool_game_position_unique UNIQUE (game_id, position);` The second concurrent INSERT would fail with a unique-constraint violation rather than silently doubling the pool. The function would need to catch this error and treat it as a successful refill by the first call (retry or return OK).

Option A is less disruptive (no schema migration, no error-path handling). Option B is more defensive (the DB enforces the invariant regardless of application logic). Either closes the double-refill race.

**Priority:** Bug 6 client fix first (also closes the "AUTO-RESOLVE FAILED" flash, same root cause). Server-side Option A second (closes the residual race that Bug 6 doesn't fully cover).

---

## VERIFICATION 2026-05-30 (freeze re-test)

Post-deploy verification after commits 61ffada (server constraint) and 59ad57a (Bug 6 client fix). Manual playtest froze during `virus_resolution` on the first AI turn: UI showed "// QUEUE EMPTY — ADVANCING" but phase never transitioned, game log stopped at "data in virus pool — no effect."

---

### 1. virus-system.spec.ts results

Run after commit 59ad57a:

| Test | Result |
|------|--------|
| no manual Resolve button present — auto-resolve is active | PASS |
| game is in a valid virus-resolution-adjacent phase (REST check) | PASS |
| **phase auto-advances away from virus_resolution within 30s** | **FAIL** |

**Exact failure:**

```
Error: expect(received).toContain(expected)
Expected value: "virus_resolution"
Received array: ["player_turn", "between_turns", "resource_adjustment", "secret_targeting", "game_over"]

> 304 |     expect(advancedPhases).toContain(finalPhase);
```

The test polled REST every 2s for 30s; `finalPhase` stayed `"virus_resolution"` for the full 30 seconds. The advance never fired. **This test would have caught the freeze before push had it been run after commit 59ad57a.**

---

### 2. Code path trace — how the Bug 6 fix causes the freeze

The fix in commit 59ad57a (`components/game/phases/VirusResolution.tsx`):

**Before (original):**
```tsx
useEffect(() => {
  setAutoResolveError(null);
  resolveInFlightRef.current = false;  // unconditional reset

  if (currentCard) {
    // 2s resolve timer
  } else {
    const advanceTimer = setTimeout(async () => {
      if (resolveInFlightRef.current) return;
      resolveInFlightRef.current = true;
      // ... advance call
    }, 500);
    return () => clearTimeout(advanceTimer);
  }
}, [currentCard?.id, ...]);
```

**After (Bug 6 fix):**
```tsx
useEffect(() => {
  setAutoResolveError(null);

  if (currentCard) {
    resolveInFlightRef.current = false;  // reset only on new non-null card
    // 2s resolve timer
  } else {
    if (resolveInFlightRef.current) return;  // ← NEW GUARD
    const advanceTimer = setTimeout(async () => { ... }, 500);
    return () => clearTimeout(advanceTimer);
  }
}, [currentCard?.id, ...]);
```

**Ref state trace — normal last-card resolve path:**

1. `currentCard` = last_card → `if (currentCard)` branch → **ref reset to `false`** → 2s timer starts.
2. 2s timer callback fires → **`resolveInFlightRef.current = true`** (line 61, before the await).
3. `invokeWithRetry("resolve-next-virus", ...)` call starts. Server marks card `resolved=true`.
4. Realtime UPDATE fires (fast — often before the server call returns). Client: `virusQueue` updates → `currentCard = null` → `currentCard?.id` changes from `card-uuid` to `undefined`.
5. `useEffect` re-runs (dep changed). `currentCard` is null → `else` branch.
6. **`if (resolveInFlightRef.current) return;` — ref is `true` (set in step 2, never reset in the `else` branch) → EARLY RETURN.**
7. Server call from step 3 returns `{ success: true }`. The async callback runs, finds no error, exits. **Ref stays `true`.**
8. `currentCard?.id` is still `undefined`. Deps unchanged. `useEffect` does NOT re-run.
9. **Advance timer is never scheduled. `advanceTurnOrPhase` is never called. Phase stays `virus_resolution`. FROZEN.**

The ref is reset to `false` ONLY inside the `if (currentCard)` branch (line 54). When the queue is empty, `currentCard` stays `null` permanently — the `if (currentCard)` branch never executes again, the ref stays `true`, and the `else` guard always fires.

**This freeze is 100% reproducible** whenever the last queue card is resolved via the 2s auto-timer path. The advance timer is structurally impossible to schedule.

---

### 3. Live DB confirmation

**Game `54db59e8`** (manual playtest, created 2026-05-30 19:20 UTC):
- `virus_resolution_queue`: 1 row, `resolved=true` (0 unresolved) — queue genuinely empty
- `game_log` last entry: `virus_no_effect` — "data in virus pool — no effect." at 19:22:39 UTC
- No `turn_start`, no phase transition in log after that point

**Game `d16c51e1`** (virus-system spec's game, created 2026-05-30 19:29 UTC):
- `virus_resolution_queue`: 1 row, `resolved=true` (0 unresolved) — queue genuinely empty
- Same pattern: queue empty, server ready to advance, advance never called

Both games confirm: queue is empty (server would advance correctly if called), but the client never called the advance. The freeze is client-side.

---

### 4. Classification

**Classification: (A) — Client regression introduced by commit 59ad57a.**

The Bug 6 fix correctly identified that resetting `resolveInFlightRef` unconditionally at the top of the `useEffect` allowed a concurrent advance call to race the 2s resolve call. But the fix went too far: it removed the only mechanism that allows the empty-queue advance to fire after the last card resolves via the 2s timer.

**Classification (B) ruled out:** The 23505 catch in `refillVirusPool` (commit 61ffada) returns early from `refillVirusPool` but does NOT prevent `advanceTurnOrPhase` from being called — the server-side advance path is unaffected. Even if 23505 fired, the phase would still transition. This is not the cause.

The server-side idempotency guard (`stale_empty_check`) also does not cause this — it only fires if there are unresolved queue items, and the queue is genuinely empty here.

---

### 5. Proposed fix (NOT applied)

**Root issue:** The ref must be reset to `false` after the 2s call returns, AND the empty-queue `useEffect` must re-run to see the reset value. The deps (`currentCard?.id`) don't change when the ref resets, so a state variable must be added to the deps to force a re-run.

**Proposed fix:**

Add `const [resolveCompleted, setResolveCompleted] = useState(0);` to `VirusResolution`.

In the 2s timer callback, after `invokeWithRetry` returns:
```tsx
const resolveTimer = setTimeout(async () => {
  if (resolveInFlightRef.current) return;
  resolveInFlightRef.current = true;
  const { data, error: fnError } = await invokeWithRetry("resolve-next-virus", {
    game_id: gameId,
    override_player_id: overridePlayerId,
  });
  resolveInFlightRef.current = false;          // reset after call completes
  setResolveCompleted((n) => n + 1);           // force useEffect re-run
  if (fnError) {
    setAutoResolveError(fnError.message);
  } else if (data?.error) {
    setAutoResolveError(data.error);
  }
}, 2000);
```

Add `resolveCompleted` to the `useEffect` deps:
```tsx
}, [currentCard?.id, gameId, overridePlayerId, resolveCompleted]);
```

**Trace with fix applied:**
1. 2s timer fires → ref=true → Call A starts.
2. Realtime fires → `currentCard=null` → useEffect re-runs → `else` branch → ref=true → guard fires → return early (no duplicate advance).
3. Call A returns → `ref=false` → `resolveCompleted++` → state update.
4. useEffect re-runs (dep `resolveCompleted` changed). `currentCard` is still null → `else` branch → **ref is `false` → guard does NOT fire** → 500ms advance timer schedules.
5. Advance call fires → `advanceTurnOrPhase` → phase transitions.

The `else` branch's inner guard (`if (resolveInFlightRef.current) return;` inside the `setTimeout` callback) still prevents a duplicate advance if a race somehow fires the callback twice.

**Flag: virus-system.spec.ts test 3 would have caught this had it been run after commit 59ad57a.** It was not run because the task description noted "Full Playwright suite not run — race conditions not testable via E2E." This was incorrect — the suite has an explicit auto-advance test that directly exercises this path. Full suite must be run for any change to `VirusResolution.tsx`.
