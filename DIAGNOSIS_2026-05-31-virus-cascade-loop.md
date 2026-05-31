# Diagnosis: Double-CF application race + duplicate secret-target resolution

**Date:** 2026-05-31
**Game ID:** `c87c20d3-9830-411c-b313-c300613f14ba`
**Context:** Manual dev playtest. Bot4 generated 2 viruses. Chain produced 3 CF log entries, two cpu_drain targeting cycles, two memory_leak targeting cycles, and a duplicate `targeting_resolved` pair.

**Two distinct races observed — documented separately below.**

---

## Race 1 — Double-CF application (backlogged concurrent-apply race, confirmed firing in real play)

### Queue forensics

`virus_resolution_queue` for this game (8 rows total — expected 6):

| id (abbrev) | card_key | position | resolved | cascaded_from |
|-------------|---------|----------|---------|--------------|
| dedd2f33 | cascading_failure | 0 | true | null — original pull |
| 49c5b68d | data_drift | 1 | true | null — original pull |
| 5eb5d677 | compute | 2 | true | dedd2f33 (CF #1 cascade) |
| e2824a51 | cascading_failure | 3 | true | dedd2f33 (CF #1 cascade) |
| cb8f69a0 | cpu_drain | **4** | true | e2824a51 — CF #2 cascade, **Call A** |
| c9a45a45 | cpu_drain | **4** | true | e2824a51 — CF #2 cascade, **Call B** ← DUPLICATE |
| ce6c25d6 | memory_leak | **5** | true | e2824a51 — CF #2 cascade, **Call A** |
| a38a388b | memory_leak | **5** | true | e2824a51 — CF #2 cascade, **Call B** ← DUPLICATE |

**Positions 4 and 5 each have two rows, both with `cascaded_from = e2824a51`.** CF card `e2824a51` triggered two `applyVirusEffect` invocations, each inserting `cpu_drain + memory_leak` into the queue. This is the double-CF application race.

### Log timeline (ms precision)

| Timestamp | Event | Notes |
|-----------|-------|-------|
| 11:12:08.035 | virus_queue_start — Bot4 pulled 2 viruses | Queue: pos 0 (CF) + pos 1 (data_drift) |
| 11:12:12.202 | **virus_effect** — "Cascading Failure! 2 more viruses triggered." | CF #1 (dedd2f33): inserts compute (pos 2) + CF (pos 3). Single call. |
| 11:12:13.640 | virus_effect — "Data Drift! −1 Data from mission." | pos 1, single call |
| 11:12:16.080 | virus_no_effect — "compute in virus pool — no effect." | pos 2, **Call A** |
| 11:12:16.122 | virus_no_effect — "compute in virus pool — no effect." | pos 2, **Call B** — 42ms later, concurrent duplicate log only |
| 11:12:18.874 | **virus_effect** — "Cascading Failure! 2 more viruses triggered." | CF #2 (e2824a51), **Call A** — inserts cb8f69a0 (cpu_drain) + ce6c25d6 (memory_leak) |
| 11:12:18.940 | **virus_effect** — "Cascading Failure! 2 more viruses triggered." | CF #2 (e2824a51), **Call B** — 66ms later, inserts c9a45a45 (cpu_drain) + a38a388b (memory_leak) |
| 11:12:22.210 | virus_effect — "CPU Drain! Misaligned AIs selecting a target…" | cpu_drain cb8f69a0 |
| 11:13:16.434 | targeting_resolved — "Bot4 CPU reduced to 2." | |
| 11:13:20.003 | virus_effect — "CPU Drain! Misaligned AIs selecting a target…" | cpu_drain c9a45a45 — duplicate card |
| 11:13:48.817 | targeting_resolved — "Bot4 CPU reduced to 1." | |
| 11:13:53.197 | virus_effect — "Memory Leak! Misaligned AIs selecting a target…" | memory_leak ce6c25d6 |
| 11:14:14.800 | targeting_resolved — "Bot4 RAM reduced to 6." | |
| 11:14:18.203 | virus_effect — "Memory Leak! Misaligned AIs selecting a target…" | memory_leak a38a388b — duplicate card |
| 11:15:17.987 | targeting_resolved — "Bot3 RAM reduced to 3." | see Race 2 below |
| 11:15:18.308 | targeting_resolved — "Bot3 RAM reduced to 3." | see Race 2 below |
| 11:15:20.214 | turn_start — "Bot5's turn." | |

### Concurrent-call reconstruction

CF card `e2824a51` (position 3) was handled by two concurrent `resolve-next-virus` calls:

In `resolve-next-virus`, the CF path runs `applyVirusEffect` **before** marking the card resolved (the v11 TOCTOU fix intentionally orders it this way — so cascade rows exist before any call sees CF as resolved with no cascade). But this ordering does not prevent two calls from both reading the CF card as unresolved before either has marked it resolved.

1. **Call A** reads CF `e2824a51` as `resolved=false` (t=0ms)
2. **Call B** reads CF `e2824a51` as `resolved=false` — simultaneously (before A's mark-resolved commits)
3. **Call A** invokes `applyVirusEffect` → CF handler reads pool, inserts `cpu_drain` (pos 4, id=cb8f69a0) + `memory_leak` (pos 5, id=ce6c25d6) → logs "Cascading Failure! 2 more viruses triggered." (11:12:18.874)
4. **Call A** marks `e2824a51 resolved=true`
5. **Call B** also invokes `applyVirusEffect` → CF handler reads pool (already emptied by A's inserts? or still present) → inserts `cpu_drain` (pos 4, id=c9a45a45) + `memory_leak` (pos 5, id=a38a388b) → logs "Cascading Failure! 2 more viruses triggered." (11:12:18.940, 66ms after A)
6. **Call B** marks `e2824a51 resolved=true` (idempotent)

Result: 4 cascade rows instead of 2. All 4 are processed — two full `secret_targeting` cycles for CPU Drain, two for Memory Leak.

### Compute card — duplicate log, not duplicate queue row

The `compute` card at position 2 shows two `virus_no_effect` log entries 42ms apart (11:12:16.080 and 11:12:16.122), but only ONE queue row. Non-CF cards mark the row resolved before `applyVirusEffect` runs; the second call's UPDATE on the same row is idempotent (no-op at DB level). The log write is duplicated, but no duplicate queue row and no duplicate stat damage. This is the non-CF variant of the same concurrent-read race.

### Effects applied vs logged twice

| Card | Log entries | Queue rows | Effect application | Net damage |
|------|------------|-----------|-------------------|-----------|
| compute (pos 2) | 2 (42ms apart) | 1 | Applied once (mark-resolved before effect is a no-op) | None — progress card |
| CF #2 (pos 3) | 2 (66ms apart) | 1 | `applyVirusEffect` called **twice** | 2 extra cascade rows inserted |
| cpu_drain (pos 4) | 2 | **2** (duplicate rows) | Each row processed once in its own `secret_targeting` cycle | Bot4 CPU 3→2→1 (should have been 3→2) |
| memory_leak (pos 5) | 2 | **2** (duplicate rows) | Each row processed once | Bot4 RAM 7→6; Bot3 RAM 4→3 (second targeting) |

**Effects were applied twice for CF #2.** The duplicate cascade rows were each resolved independently through full `secret_targeting` cycles. Bot4 took two cpu_drain effects (losing 2 CPU instead of 1), and the second memory_leak was independently targeted (hitting Bot3 instead of repeating Bot4).

### Current player stats

```
bot0         cpu=1 ram=4
REAL PLAYER  cpu=2 ram=4
Bot2         cpu=1 ram=4
Bot3         cpu=2 ram=3   ← one memory_leak applied (4→3)
Bot4         cpu=1 ram=6   ← two cpu_drains (3→2→1) + one memory_leak (7→6)
Bot5         cpu=3 ram=6
```

Bot4 CPU=1 reflects TWO cpu_drain effects. With a single CF application, Bot4 would have cpu=2 (only one cpu_drain). The over-damage is real and already baked into the game state.

### Relation to prior fixes

- **v11 TOCTOU fix** (`bb569c6`): defended the cascade-insert window (concurrent empty-queue advance racing CF insertion). Does NOT protect against two calls reading the same CF card as unresolved simultaneously.
- **targeting CAS fix** (`e4964cf`): guards the `virus_resolution` EXIT (the `phase='secret_targeting'` transition). Completely unrelated — Race 1 is in `applyVirusEffect` for individual cards, not in the turn-advance path.

### Root cause and fix scope (NOT applied)

The race is at the card-read level: `SELECT ... WHERE resolved=false ORDER BY position LIMIT 1` returns the same card to two concurrent callers before either issues `UPDATE resolved=true`. No existing guard prevents two callers from both reading the same card.

**For CF specifically:** the v11 ordering (`applyVirusEffect` before `mark-resolved`) was intended to ensure cascade rows exist before the concurrent caller sees CF as resolved. But it exposes a different race: both callers see CF as *unresolved* and both run the cascade insert.

**Proposed fix direction (NOT applied):** Use a CAS on the queue row before calling `applyVirusEffect` — attempt `UPDATE virus_resolution_queue SET resolved=true WHERE id=card.id AND resolved=false RETURNING id`; if 0 rows returned, another caller already claimed this card, return no-op. For CF, this means reversing the v11 ordering back to mark-resolved first, but instead of a simple UPDATE, using a CAS. The CF TOCTOU concern (concurrent call sees CF resolved with no cascade rows yet) must then be addressed separately — e.g., by the re-check guard already in place at the empty-queue branch (if the queue has a resolved CF with no cascade rows, the re-check catches it).

---

## Race 2 — Duplicate secret-target resolution for Memory Leak #2

### Evidence

The second Memory Leak card (`a38a388b`, duplicate from Race 1) entered `secret_targeting` at 11:14:18.203. No votes were cast (`secret_target_votes` has no rows for `resolution_id = a38a388b`). Two `targeting_resolved` events fired 321ms apart:

| Timestamp | Event |
|-----------|-------|
| 11:15:17.987 | targeting_resolved — "Bot3 was targeted by Memory Leak — RAM reduced to 3." |
| 11:15:18.308 | targeting_resolved — "Bot3 was targeted by Memory Leak — RAM reduced to 3." |

The `secret_targeting` deadline was set 60s after entry: `11:14:18.203 + 60s ≈ 11:15:18.2`. The first `targeting_resolved` fired at 11:15:17.987 — **13ms before the deadline**. The second fired at 11:15:18.308 — **108ms after the deadline**.

This pattern is consistent with two `handleDeadline` calls from `SecretTargeting.tsx` — one from browser A (DevMode, all bots) and one from browser B (REAL PLAYER, who appears misaligned based on CPU=2 at resource allocation). Both called `secret-target` with `force_resolve: true` for the same `current_targeting_resolution_id`.

### The unguarded exit in secret-target

`secret-target/index.ts` line 42: `if (game.phase !== 'secret_targeting') throw new Error('Not in secret_targeting phase')` — this is a **read-then-check**, not a CAS. Two concurrent calls can both read `phase='secret_targeting'` before either commits the phase transition back to `virus_resolution`. Both succeed. Both apply the Memory Leak effect and write `targeting_resolved`.

First application (11:15:17.987): Bot3 RAM 4 → Math.max(3, 3) = 3. Logged "RAM reduced to 3." Real reduction.
Second application (11:15:18.308): Bot3 RAM already 3 → Math.max(2, 3) = 3. Logged "RAM reduced to 3." No-op due to floor clamp. No additional stat damage.

Current Bot3 RAM=3 is consistent with one real application. The floor clamp saved the game from a second real damage.

### Relation to targeting CAS fix (e4964cf)

The `e4964cf` fix added a CAS to the `secret_targeting` ENTRY (in `resolve-next-virus` — `UPDATE games ... WHERE phase='virus_resolution'`). It guards the transition INTO `secret_targeting`.

Race 2 is in the `secret_targeting` EXIT — the transition from `secret_targeting` back to `virus_resolution` in `secret-target`. The `e4964cf` fix does not guard this. The same CAS pattern is needed on the `secret-target` side.

### Proposed fix direction (NOT applied)

In `secret-target/index.ts`, replace the unconditional phase transition with a CAS:

```typescript
// After applying the effect and writing targeting_resolved log:
const { data: claimed } = await admin.from("games").update({
  phase: "virus_resolution",
  current_targeting_resolution_id: null,
  current_targeting_card_key: null,
  targeting_deadline: null,
}).eq("id", game_id).eq("phase", "secret_targeting").select("id");

if (!claimed?.length) {
  // CAS lost — concurrent caller already resolved targeting. No-op.
  return no-op response;
}
```

The loser (0 rows returned) must not write the `targeting_resolved` log entry or apply any player stat change — those must be gated on winning the CAS. This requires moving the log INSERT and stat UPDATE to AFTER the CAS check. The winner writes targeting_resolved + applies the stat; the loser exits clean.

---

## Summary

| Race | Location | Trigger | Root cause | Net damage | Closed by e4964cf? |
|------|---------|---------|-----------|-----------|-------------------|
| Race 1 — double-CF apply | `resolve-next-virus` / `applyVirusEffect` | Two concurrent calls read CF card as `resolved=false` simultaneously | No CAS on queue row claim | Bot4 CPU over-drained by 1; extra Memory Leak targeting cycle | **No** — different path |
| Race 2 — duplicate secret-target | `secret-target` | Two concurrent `force_resolve: true` calls (both browser A and B fired deadline timer within 321ms) | `secret-target` phase guard is read-then-check, not CAS | Bot3 RAM application doubled but floor-clamped to no additional damage | **No** — different function |

Both races are pre-existing. Neither was introduced or worsened by the abort-vote or targeting-CAS work. No fix applied.

---

## Race 1 fix design

### Q1 — Exact current ordering in `resolve-next-virus`

**Card SELECT (lines 50–53):**
```typescript
const { data: nextCard } = await admin
  .from("virus_resolution_queue").select("*")
  .eq("game_id", game_id).eq("resolved", false)
  .order("position").limit(1).maybeSingle();
```
Same for CF and non-CF. No claim is made here — two concurrent callers both get the same row.

**CF path (lines 125–127 + 129–131 + 141–144):**
```
[SELECT nextCard]
→ applyVirusEffect (cascade INSERT + pool DELETE + log)   ← BEFORE mark-resolved
→ UPDATE resolved=true WHERE id=nextCard.id               ← mark-resolved
→ deck-card return (lines 133–139)
→ pauseForTargeting = false (CF never calls applyVirusEffect again — line 143 guard)
```
`applyVirusEffect` for CF (lines 192–224): reads `virus_pool` (SELECT), computes `queueMax`, inserts cascade rows, deletes pool cards, logs "Cascading Failure!". Returns `false`. No idempotency guard — each invocation inserts fresh rows.

**Non-CF path (lines 125–131 + 141–144):**
```
[SELECT nextCard]
→ UPDATE resolved=true WHERE id=nextCard.id               ← mark-resolved FIRST
→ deck-card return
→ applyVirusEffect (stat writes, targeting CAS, etc.)     ← AFTER mark-resolved
```
For non-CF, mark-resolved before effect. The second caller's `UPDATE resolved=true` is idempotent. Most non-CF effects are also idempotent writes (both callers compute same value from same snapshot). The targeting case has its own CAS (added by `e4964cf`).

**Root cause of Race 1:** No claim exists between the SELECT and `applyVirusEffect`. Two callers read the same CF card as `resolved=false` and both call `applyVirusEffect`, which does a non-idempotent cascade INSERT.

---

### Q2 — Proposed atomic claim

**Required schema change (one migration):**
```sql
ALTER TABLE virus_resolution_queue
  ADD COLUMN being_processed boolean NOT NULL DEFAULT false;
```

**Claim CAS — inserted between `nextCard` SELECT and the CF/non-CF branch, lines 53–125:**
```typescript
const { data: cardClaimed } = await admin
  .from("virus_resolution_queue")
  .update({ being_processed: true })
  .eq("id", nextCard.id)
  .eq("resolved", false)
  .eq("being_processed", false)
  .select("id");

if (!cardClaimed?.length) {
  // CAS lost — another caller claimed this card. Return no-op.
  return new Response(JSON.stringify({ success: true, skipped: "card_claimed" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

If the CAS wins (1 row returned), the caller owns this card exclusively. The CF-first / non-CF-first ordering below is unchanged — the CAS is inserted before both branches, not within them.

**Why `being_processed` and not `resolved`?** If we claimed by writing `resolved=true` before `applyVirusEffect`, a CF card would be marked resolved before its cascade rows are inserted. That reopens the v11 race (see Q3). `being_processed=true` is a claim flag that leaves `resolved=false`, so the v11 ordering (cascade INSERT before `resolved=true`) is preserved unchanged.

**Does this serialise both CF and non-CF?** Yes. Both card types reach the CAS before any write. Only one caller per card wins the CAS; the loser returns immediately and never calls `applyVirusEffect`. There is no path past the CAS for a loser.

---

### Q3 — Proof the v11 race stays closed

**v11's concern (commit `bb569c6`):** A concurrent caller sees a CF card as `resolved=true` with no cascade rows yet inserted, treats the queue as empty, and advances the turn — orphaning the cascade rows.

v11 closed this by ordering CF as `applyVirusEffect` (cascade INSERT) **before** `UPDATE resolved=true`. With that ordering, the moment CF is `resolved=true`, cascade rows already exist in the queue. No window.

**Does the `being_processed` CAS reopen this window?** Trace:

```
Queue: CF only (being_processed=false, resolved=false)

Caller A wins CAS → being_processed=true, resolved=false
Caller B tries CAS → UPDATE WHERE being_processed=false AND resolved=false → 0 rows → returns no-op immediately

Caller A: applyVirusEffect → cascade rows inserted (N, N+1) → mark CF resolved=true
```

CF ordering is unchanged: cascade INSERT **before** `resolved=true`. The only difference from v11 is that B never reaches `applyVirusEffect` — it exits at the CAS. There is no window where CF is `resolved=true` with no cascade rows.

**Can a third caller C trigger the empty-queue advance during A's processing window?**

While A holds the card (`being_processed=true, resolved=false`):

- C's SELECT (`WHERE resolved=false`) **returns CF** — `resolved` is still false, so CF is visible.
- C tries the CAS: `UPDATE WHERE being_processed=false` → 0 rows (A set it to true) → C returns no-op.
- C never reaches the empty-queue branch.

After A's `resolved=true`:

- C's SELECT returns cascade rows (resolved=false) — processes them normally.

**What about the existing empty-queue re-check (lines 59–67)?**

```typescript
const { data: queueCheck } = await admin
  .from("virus_resolution_queue").select("id")
  .eq("game_id", game_id).eq("resolved", false)
  .limit(1).maybeSingle();
```

This re-check fires when `nextCard` is null (no `resolved=false` rows found). With the CAS in place, a caller whose `nextCard = null` means the queue is genuinely empty at the time of that read, OR all remaining cards are `resolved=true`. Because `being_processed=true` cards are still `resolved=false`, the initial SELECT would have found them — so a null `nextCard` can only occur when all cards are resolved. The re-check remains valid as a paranoia guard and can stay as-is. No change needed.

**Conclusion: the `being_processed` CAS does not reopen the v11 race.** The CF ordering (cascade INSERT before `resolved=true`) is completely unchanged. The CAS only adds a new gate before the existing code paths — it doesn't alter what happens after the gate.

---

### Q4 — Changes required beyond the single CAS

**Minimum required changes:**

1. **Migration** — `ALTER TABLE virus_resolution_queue ADD COLUMN being_processed boolean NOT NULL DEFAULT false`. One migration file.

2. **`resolve-next-virus/index.ts`** — Insert the CAS block (~10 lines) between the `nextCard` fetch (line 53) and the CF branch (line 125). No other logic changes.

**No RPC or Postgres function required.** The being_processed CAS is pure application-level serialisation via a single UPDATE RETURNING. Supabase Edge Functions can issue this as a normal SDK call.

**Are any existing guards made redundant?**

- The v11 re-check (lines 59–67) is now redundant for the CF-TOCTOU case, but it's a cheap safety net and can stay.
- The v11 code comment at lines 122–124 should be rewritten: with the CAS in place, the reason for CF-first ordering is still valid (it was never wrong), but the comment's framing ("concurrent call can observe CF as resolved with no cascade rows") no longer applies because no concurrent call can pass the CAS while CF is being processed.
- The non-CF idempotency of stat writes was a coincidental safety property (both callers write the same value). With the CAS, only one caller writes at all. The property is no longer relied upon and the comment documenting it (line 124) should be updated.

**Status: CLOSED — commits `e1f02ec` (migration 019) + `f761e1a` (CAS claim, resolve-next-virus v17), 2026-05-31.**

Race 1 E2E verification is manual: cross-browser CF chain, confirm exactly N cascade rows per CF card, no duplicate positions in `virus_resolution_queue`. Same manual-verification posture as the targeting race fix.

---

## being_processed cleanup / failure window

### Q1 — Where does `being_processed` get cleared?

On the **happy path**, it never needs to be cleared. Once the winner writes `resolved=true` (line 129–131), the initial SELECT (`WHERE resolved=false`) permanently excludes that row. `being_processed` on a `resolved=true` row is never read. No reset needed.

On the **failure path** (see Q2), the flag stays `true` on a `resolved=false` row — which is the freeze scenario.

### Q2 — Width of the failure window

Between winning the CAS (`being_processed=true`) and writing `resolved=true` (line 129–131):

**Non-CF path:**
```
CAS win
→ [no intervening awaits — CF branch at line 125 is skipped]
→ await UPDATE resolved=true  ← window closes
```
Window: **zero intervening DB round-trips.** The only failure mode is the `UPDATE resolved=true` itself failing, which is the same risk as any single DB call. Zombie-claim probability for non-CF is essentially zero.

**CF path:**
```
CAS win
→ await virus_pool SELECT (pool candidates)              ← await 1
→ await virus_resolution_queue SELECT queueMax position  ← await 2
→ await virus_resolution_queue INSERT cascade rows       ← await 3
→ await virus_pool DELETE pool cards                     ← await 4
→ await game_log INSERT                                  ← await 5
→ applyVirusEffect returns
→ await UPDATE resolved=true                             ← window closes
```
Window: **5 DB round-trips before mark-resolved.** At ~10–50ms per Supabase SDK call, the window is roughly **50–250ms**. Any JS exception thrown by awaits 1–5 is caught by the outer try-catch at line 176, which returns `{ error: message }` and exits — leaving `being_processed=true, resolved=false`. The flag is never reset.

**What does the frozen state look like?**

```
being_processed=true, resolved=false on the stuck CF card
```

Every subsequent `resolve-next-virus` call:
1. Phase guard passes (phase is still `virus_resolution`)
2. SELECT `resolved=false` → returns the stuck card
3. CAS `WHERE being_processed=false` → 0 rows → returns `{ skipped: "card_claimed" }`

The auto-resolve loop in `VirusResolution.tsx` re-fires on each `skipped` response. It loops forever, never advancing. **This is a permanent freeze for the game session** — the queue cannot progress without external intervention.

### Q3 — Mitigation options

**Option (a) — Claim timestamp, reclaim after N seconds (requires schema change)**

Add `being_processed_at timestamptz` to `virus_resolution_queue`. The CAS sets both `being_processed=true` AND `being_processed_at=now()`. The CAS condition becomes:

```sql
UPDATE virus_resolution_queue
SET being_processed=true, being_processed_at=now()
WHERE id=X
  AND resolved=false
  AND (being_processed=false OR being_processed_at < now() - interval '5 seconds')
```

Any call arriving more than 5 seconds after a claim can reclaim and reprocess the card. The 5s timeout is 20× the expected CF window (~250ms), so a healthy processing run never triggers it. On failure, recovery is automatic on the next resolve-next-virus call after 5s.

This is the correct production-quality fix. Requires adding `being_processed_at timestamptz` to the migration (same migration as `being_processed`, or a follow-on).

**Option (b) — Catch-block reset (no additional schema change)**

The outer try-catch at line 176 has access only to variables declared outside the try block. Currently `game_id` and `nextCard` are declared inside the try block (lines 16 and 50), so the catch block cannot see them. A small refactor lifts those declarations:

```typescript
let game_id: string | null = null;
let claimedCardId: string | null = null;
try {
  ({ game_id } = await req.json());
  // ...
  const { data: nextCard } = ...;
  // after winning CAS:
  claimedCardId = nextCard.id;
  // ...
} catch (err) {
  if (claimedCardId) {
    try {
      await admin.from("virus_resolution_queue")
        .update({ being_processed: false })
        .eq("id", claimedCardId).eq("being_processed", true);
    } catch { /* best-effort */ }
  }
  return new Response(JSON.stringify({ error: message }), { ... });
}
```

The catch-block reset is best-effort: if the DB itself is down, the reset also fails. It handles the common case (JS exception during a healthy DB connection) but not total DB failure. For those cases, option (a) provides automatic recovery on reconnect.

**Option (c) — Accept the risk, manual SQL recovery**

The failure mode requires: (1) CF card being processed, (2) one of the 5 DB awaits throwing a JS exception (not just returning an error row — the outer catch fires on throw, not on `{ data: null, error: ... }`). Supabase SDK methods return error objects rather than throwing for most DB errors. The window exists but the trigger conditions are narrower than they appear.

If a freeze does occur, a developer can recover via Supabase SQL editor:

```sql
UPDATE virus_resolution_queue
SET being_processed = false
WHERE game_id = 'X' AND resolved = false AND being_processed = true;
```

For a playtesting game, this is acceptable. For production with real players, option (a) is the right answer.

**Recommendation summary:**

| Option | Schema change | Code change | Auto-recovery | Complexity |
|--------|-------------|------------|--------------|-----------|
| (a) timestamp | `being_processed_at` column | CAS condition + col set | Yes, after N seconds | Low |
| (b) catch reset | None beyond `being_processed` | Variable hoisting + catch block | Partial (DB-up only) | Low |
| (c) accept | None | None | No — manual SQL | None |

Options (a) and (b) are not mutually exclusive. The practical minimum for non-playtesting use is (a). For the current playtest-phase, (c) is defensible given the narrow trigger conditions and available manual recovery.

**This analysis does not change the fix design in Q1–Q4.** The zombie-claim window is a separate concern — it exists whenever a multi-step operation has a claim flag, not specific to this race fix. Decision on which mitigation to include is separate from approving the Race 1 CAS fix itself.
