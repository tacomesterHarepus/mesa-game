# DIAGNOSIS 2026-06-02 — Virus Pool Drift: pool=3 at RP's turn after Bot4 CF chain

## Status
CLOSED. Fix applied 2026-06-02 — see commits for resolve-next-virus v19.

The transient trigger (PostgREST short read returning 1 row when 2 were requested) is not reproducible in CI.
Part 1 (runtime invariant throw) is the live defence: it fires at the moment of under-fill regardless of mechanism.
Parts 2 and 3 prove the recovery logic is correct: the supplement-draw loop produces pool==4 whenever
drawFromDeck returns a partial result, and the E2E invariant tests assert pool==4 after every settled
resolution across 12 turns including natural deck-depletion paths.

## Game reference
- game_id: `8b5e8141-eb28-4d93-bc6d-dafed7c0bedc`
- Phase at investigation: `virus_pull`, escape_timer=4, core_progress=0, mission=global_research_network
- Observed: pool=3 at start of RP's turn; should be 4

## Players (relevant)
| Name | Role | CPU | RAM | turn_order |
|------|------|-----|-----|-----------|
| Bot4 | misaligned_ai | 3 | 6 | 2 |
| RP   | misaligned_ai | 3 | 6 | 3 |

---

## Evidence: pool_size_before across all turns (from game_log metadata)

| Time (UTC) | Actor | Staged | pool_size_before | pull_count | Expected pool_before_staging |
|-----------|-------|--------|-----------------|-----------|------------------------------|
| 21:45:18  | Bot5  | 2      | 6               | 2          | 4+2=6 ✓ |
| 21:47:15  | Bot3  | 1      | 5               | 1          | 4+1=5 ✓ |
| 21:48:18  | Bot4  | 1      | 5               | 1          | 4+1=5 ✓ |
| 21:49:14  | RP    | 1      | 5               | 1          | 4+1=5 ✓ |
| 21:50:15  | Bot5  | 1      | 5               | 1          | 4+1=5 ✓ |
| 21:50:47  | Bot3  | 1      | 5               | 1          | 4+1=5 ✓ |
| 21:51:28  | Bot4  | 1      | 5               | 1          | 4+1=5 ✓ |
| **21:55:50** | **Bot4 (CF turn)** | **2** | **6** | **2** | **4+2=6 ✓** |
| **21:57:08** | **RP** | **2** | **5** | **2** | **4+2=6 ✗ — observed 3+2=5** |

Every single prior turn produced pool=4 before staging. After Bot4's CF chain, pool was **3**. This is the first and only deviation.

---

## Count trace: Bot4's CF turn (21:55:01–21:56:09)

| Event | Time | Operation | Pool count |
|-------|------|-----------|-----------|
| turn_start | 21:55:01 | — | 4 (from previous refill) |
| viruses_placed | 21:55:50.40 | end-play-phase v18: DELETE 4 survivors, INSERT shuffle(4+2=6) | **6** |
| virus_pull_initiated | 21:55:50.54 | pool_size_before=6 (confirmed by metadata) | 6 |
| virus_queue_start | 21:55:53.97 | pull-viruses: pulls 2 (pos 0,1), deletes them | **4** (pool_size_after=4, confirmed by metadata) |
| compute resolved | 21:55:57.00 | card at queue pos 0 — no pool change | 4 |
| cascading_failure resolved | 21:55:59.62 | CF reads pool `.limit(2)` (positions 2,3), inserts 2 cascade rows, DELETE by ID | **2** (cascade_count=2 confirmed in metadata) |
| data cascade resolved | 21:56:02.80 | cascade from CF, pos 4 — no pool change | 2 |
| compute cascade resolved | 21:56:05.61 | cascade from CF, pos 5 — no pool change | 2 |
| [refillVirusPool] | 21:56:05–09 | queue empty → CAS wins → refillVirusPool(pool=2) → ??? | **should be 4, was 3** |
| turn_start RP | 21:56:09.20 | advanceTurnOrPhase sets RP's turn | pool=3 |
| viruses_placed RP | 21:57:07.93 | end-play-phase: DELETE 3 survivors, INSERT shuffle(3+2=5) | 5 |
| virus_pull_initiated RP | 21:57:08.06 | pool_size_before=5 (confirmed by metadata) | **5 = 3+2 → confirms pool was 3** |

---

## Queue data (Bot4's CF chain rows only)

| id | card_key | type | pos | resolved | cascaded_from | being_processed_at |
|----|----------|------|-----|----------|--------------|-------------------|
| ea971553 | compute | progress | 0 | true | null | 21:55:56.703 |
| 905b3f2b | cascading_failure | virus | 1 | true | null | 21:55:59.284 |
| d155f622 | data | progress | 4 | true | 905b3f2b | 21:56:02.518 |
| 3b667483 | compute | progress | 5 | true | 905b3f2b | 21:56:05.289 |

Timing gaps between resolutions: ~2.5s each. No sub-second clustering. **No concurrent double-fire in this chain.** Race 1 (concurrent resolve-next-virus duplicate card processing) is eliminated as a cause.

---

## Root cause: partial-fill guard missing in refillVirusPool

### The code (resolve-next-virus v18, deployed)

```typescript
async function refillVirusPool(admin: any, game_id: string) {
  const { count: poolCount } = await admin.from("virus_pool")
    .select("*", { count: "exact", head: true }).eq("game_id", game_id);
  const needed = 4 - (poolCount ?? 0);
  if (needed <= 0) return;

  let drawCards = await drawFromDeck(admin, game_id, needed);  // ← reads in_deck

  if (drawCards.length === 0) {                    // ← only guards zero-draw case
    await reshuffleDiscard(admin, game_id);
    drawCards = await drawFromDeck(admin, game_id, needed);
  }

  if (drawCards.length === 0) return;             // ← only early-exits on zero

  const { data: survivors } = await admin.from("virus_pool")
    .select("card_key, card_type").eq("game_id", game_id);

  const combined = [
    ...(survivors ?? []).map(...),
    ...drawCards.map(...),                         // ← uses whatever drawCards returned
  ];
  const shuffledCombined = shuffle(combined);

  await admin.from("virus_pool").delete().eq("game_id", game_id);
  await admin.from("virus_pool").insert(
    shuffledCombined.map((card, i) => ({ ... position: i }))
  );
  // pool length = combined.length = survivors.length + drawCards.length
```

### The bug

`drawFromDeck(game_id, needed)` is called with `needed=2`. It returns however many `in_deck` rows Supabase provides, up to `LIMIT needed`. The code guards `drawCards.length === 0` (reshuffle path) and `drawCards.length === 0` after reshuffle (early exit). It does **NOT** guard `0 < drawCards.length < needed`.

If `drawFromDeck` returns 1 card instead of 2, the code continues silently:
- `combined = survivors(2) + drawCards(1) = 3`
- INSERT 3 rows → **pool = 3**

This matches the observation exactly.

### Why did drawFromDeck return 1 instead of 2?

With 36 `in_deck` cards available (confirmed from current deck state, which is after additional draws post-refill), the deck was not near-exhausted. The partial-fill cannot be explained by deck availability.

**Two candidate mechanisms (neither can be ruled out from available evidence):**

**(a) Transient PostgREST partial response:** The Supabase JS client's `select(...)` with `.limit(2)` makes an HTTP request to PostgREST. Under edge-function cold start, ephemeral network conditions, or Deno's async I/O, PostgREST could return a partial result. This is uncommon but not impossible, and the code has no retry.

**(b) In-flight deck status race between refillVirusPool and drawCardsForPlayer:** `drawCardsForPlayer` is called in `advanceTurnOrPhase`, which runs after `refillVirusPool`. However, `deck_cards.update({ status: 'drawn' })` in `refillVirusPool` runs at the very END of that function, after the pool INSERT. If a concurrent `drawCardsForPlayer` call (from a different path — e.g., a delayed response from a prior invocation) ran between `drawFromDeck` and `deck_cards.update`, it could claim the same `in_deck` rows. This would result in those cards appearing in both a player's hand AND the pool (double-draw). On the next refillVirusPool call, those same cards could appear as `in_deck` again… this mechanism is speculative and requires further investigation.

The **structural bug** (missing partial-fill guard) is certain. The triggering mechanism is uncertain.

---

## Why all prior turns were unaffected

All prior turns in this game (7 turns, several with CF chains) produced pool=4 correctly. The difference in Bot4's CF turn:

- It is the **first turn of a new mission** (pool reset to 4 via System Overload refill in the previous mission)
- It generated **2 viruses** with **CF as the second card** (not the first, as in Bot3's CF chain at 21:47 which worked correctly)
- Between the CF chain's last resolution and the refill, more async state had accumulated (prior resolutions: compute at 21:55:57, then CF chain 3 more steps)

None of these structural differences obviously explain the drawFromDeck partial return. The failure appears non-deterministic — possibly triggered by transient timing in this particular invocation.

---

## Eliminated candidates

| Hypothesis | Verdict | Evidence |
|-----------|---------|---------|
| Race 1 (concurrent double-fire in CF chain) | **ELIMINATED** | Queue timings 2.5s apart; no sub-second clusters; being_processed CAS would catch |
| Partial fill from deck exhaustion | **ELIMINATED** | in_deck=36 (current, post-multiple-draws); needed=2 |
| CF deleted wrong number of pool cards | **ELIMINATED** | cascade_count=2 in metadata; exactly 2 cascade queue rows exist; pool_size_after=4 confirmed at pull step |
| pull-viruses wrong delete count | **ELIMINATED** | pool_size_after=4 confirmed in metadata by pull-viruses itself |
| end-play-phase reshuffle miscounted | **ELIMINATED** | pool_size_before=6 confirmed; 4 survivors + 2 staged = 6 |
| Double-fire of refillVirusPool | **ELIMINATED** | empty-queue CAS (virus_resolution→between_turns) prevents two callers both reaching refillVirusPool |

---

## Deck state at time of investigation

| Status | Count |
|--------|-------|
| in_deck | 36 |
| drawn | 18 |
| discarded | 6 |
| **Total** | **60** ✓ |

Deck is healthy — no card loss.

---

## Affected code: fix area

**File:** `supabase/functions/resolve-next-virus/index.ts`  
**Function:** `refillVirusPool`

The fix must ensure `combined.length` always equals `survivors.length + needed` (i.e., pool reaches exactly 4). Specifically:

1. After the first `drawFromDeck`, if `drawCards.length < needed`, do NOT immediately fall through to the reshuffle-and-retry path (which only triggers on zero). Instead, handle the partial case: attempt a supplemental draw for the remaining deficit.

2. After the INSERT, optionally assert `shuffledCombined.length === (poolSurvivors + needed)` and log/throw if not, so partial-fill failures are surfaced rather than silently accepted.

**Current guard (broken for partial fills):**
```typescript
if (drawCards.length === 0) {
  await reshuffleDiscard(...);
  drawCards = await drawFromDeck(admin, game_id, needed);
}
if (drawCards.length === 0) return;
// ← no guard for 0 < drawCards.length < needed
```

**Fix direction:**
```typescript
if (drawCards.length < needed) {
  if (drawCards.length === 0) {
    await reshuffleDiscard(...);
    drawCards = await drawFromDeck(admin, game_id, needed);
  } else {
    // Partial draw: supplement with remaining from deck or after reshuffle
    const stillNeeded = needed - drawCards.length;
    const moreCards = await drawFromDeck(admin, game_id, stillNeeded);
    if (moreCards.length === 0) {
      await reshuffleDiscard(...);
      const afterReshuffle = await drawFromDeck(admin, game_id, stillNeeded);
      drawCards = [...drawCards, ...afterReshuffle];
    } else {
      drawCards = [...drawCards, ...moreCards];
    }
  }
}
if (drawCards.length === 0) return; // truly nothing to draw
```

Do NOT implement — diagnosis only.

---

## Relationship to prior diagnoses

This is distinct from all prior pool bugs:

- **DIAGNOSIS_2026-05-07** (pool stays at 2 after CF): caused by TOCTOU race in resolve-next-virus where concurrent call entered `!nextCard` branch while CF was still writing cascade cards. Fixed by per-card CAS (v17) and empty-queue CAS (v14). **Not a regression of this fix.**
- **SESSION_NOTES secondary partial-fill bug** (2026-05-07): described as "refillVirusPool only reshuffles discards if `drawCards.length === 0` — skips reshuffle when partial draw is possible. This is a separate bug triggered when deck is nearly exhausted." The current bug IS this partial-fill bug, but the triggering condition is not deck exhaustion — it is `drawFromDeck` returning fewer rows than requested for an unknown reason. The structural hole (no `0 < length < needed` guard) is the same.
- **Race 1** (double-CF application): closed by per-card CAS in v17. Not related.
- **Pool reshuffle fix** (v18): fixed FIFO position leak and `maxPos+1` append. The reshuffle code itself is not implicated here — the bug is upstream, in how many cards are drawn for refill.

**Summary: this is a new manifestation of the existing partial-fill structural gap, triggered by a mechanism not yet identified (transient PostgREST partial or in-flight deck race), under conditions (CF chain with 2 pulled viruses, CF at position 1) not previously observed.**

---

## Verification pass — 2026-06-02 (MCP prod queries)

### Check 1: in_deck count at refill time (~21:56:05)

**NOT RECONSTRUCTABLE.**

`deck_cards` has no timestamp column — schema is `(id, game_id, card_key, card_type, position, status)` only. There is no `updated_at`, `created_at`, or audit log on status transitions. The current `status` reflects only the present state; there is no way to query what it was at 21:56:05.

Lower bound only: in_deck at refill = current(36) + N (refillVirusPool draw) + M (drawCardsForPlayer for RP's turn). With N ≥ 1 and M ≥ 0, in_deck at refill ≥ 37 — clearly non-zero and sufficient to supply `needed=2`. The deck was not short. This remains consistent with candidate (a) (partial PostgREST response) and rules out the trivial deck-exhaustion case, but cannot pinpoint the mechanism.

### Check 2: double-claim — candidate (b) eliminated

Per-card-key integrity check across all live game locations:

| card_key | drawn (deck) | in hands | in pool | in queue (unresolved) | live total | verdict |
|---|---|---|---|---|---|---|
| cascading_failure | 1 | 1 | 0 | 0 | 1 | ok |
| compute | 3 | 3 | 0 | 0 | 3 | ok |
| cpu_drain | 1 | 1 | 0 | 0 | 1 | ok |
| data | 2 | 1 | 1 | 0 | 2 | ok |
| data_drift | 2 | 0 | 2 | 0 | 2 | ok |
| dependency_error | 2 | 2 | 0 | 0 | 2 | ok |
| pipeline_breakdown | 2 | 2 | 0 | 0 | 2 | ok |
| system_overload | 2 | 1 | 1 | 0 | 2 | ok |
| validation | 2 | 1 | 1 | 0 | 2 | ok |
| validation_failure | 1 | 1 | 0 | 0 | 1 | ok |

`live_total (hands + pool + unresolved_queue) ≤ drawn` for every card_key. Grand totals: hands=13, pool=5, queue_unresolved=0, live_total=18 = deck_cards.drawn=18 exactly. deck_cards total=60, no impossible states.

**Candidate (b) — concurrent drawCardsForPlayer claiming the same in_deck rows as drawFromDeck — is definitively eliminated.** No phantom cards exist. The deck is perfectly accounted for. The earlier hands/pool overlap result (validation, data, system_overload appearing in both) was card_key noise: the deck has multiple physical copies of each type, and different instances were in the hand vs pool.

### Updated conclusions

| Question | Answer |
|---|---|
| Trigger identified? | **No.** Mechanism by which drawFromDeck returned 1 instead of 2 is unknown. Deck was non-empty; no concurrency; no phantom cards. Transient PostgREST partial response remains the only live hypothesis. |
| Is the supplemental-draw fix sufficient? | **Yes.** No double-claim to defend against. The fix only needs to handle partial drawFromDeck results. |
| Any additional fix needed (double-claim mitigation, deck integrity guard)? | **No.** Deck integrity is clean. The structural fix (supplement partial draws before proceeding) is the complete fix. |
| Should the fix add observability? | **Yes** — recommended. Log a warning when `drawCards.length < needed` so the next occurrence can be captured with context (timestamp, counts, game_id). Currently the partial fill is completely silent. |
