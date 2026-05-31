# Diagnosis: secret_targeting skipped on DevMode player switch

**Date:** 2026-05-31
**Status: CLOSED** — Fixed in commits `e4964cf` (server CAS) + `c4b41fe` (client dep-array). Both deployed and pushed 2026-05-31.

**E2E concurrent-race test:** Not added — staging two concurrent `resolve-next-virus` calls that race on the same `virus_resolution` exit with precise DB timing is not feasible in Playwright without artificial delays (e.g. `pg_sleep` interception). Manual verification: during DevMode play, trigger a targeting card, switch players mid-resolution; phase must remain `secret_targeting`, not `player_turn`. The server-side CAS fix is the load-bearing guard; the dep-array change eliminates the DevMode-specific trigger.
**Repro:** Browser A = DevModeOverlay with all 5 players. Browser B = real misaligned AI. Memory Leak triggered `secret_targeting`. Browser B showed targeting UI correctly. Browser A switched to Bot4 (misaligned AI) via PlayerSwitcher WITHOUT clicking any button. Game left `secret_targeting` and advanced to Bot4's `player_turn`. No `targeting_resolved` event in game log.

---

## Hypothesis verdicts

### H1 — VirusResolution.tsx useEffect re-fires on player switch (LIKELY PRIMARY)

**File:** `components/game/phases/VirusResolution.tsx:97`

```javascript
}, [currentCard?.id, gameId, overridePlayerId]);
```

`overridePlayerId` is in the dependency array of the auto-resolve useEffect. On every player switch, this effect re-fires. The effect body resets `resolveInFlightRef.current = false` and then, if conditions are met, issues a new `resolve-next-virus` call.

**Server protection:** `resolve-next-virus` guards at line 35:
```javascript
if (game.phase !== "virus_resolution") return { skipped: "not_in_virus_resolution" };
```
This guard fires when the game is in `secret_targeting`, returning early. So the call is blocked server-side.

**Remaining risk window:** Realtime delivery is not instantaneous. If browser A switches player in the ~100–300ms window between the server writing `phase = 'secret_targeting'` and the Realtime event arriving at browser A's subscription, then `VirusResolution` is still mounted and its `game.phase` local state still reads `virus_resolution`. The re-fired useEffect then sees `phase === 'virus_resolution'` locally, resets the in-flight ref, and issues `resolve-next-virus`. If the server has already committed `phase = 'secret_targeting'` at that point, the call returns `skipped` and is safe. If the server has NOT yet committed the phase change (e.g. the `end-play-phase` call that triggered secret_targeting is still in flight), the call is a genuine race.

**Verdict:** This is a latent bug with a narrow but real race window. The `overridePlayerId` dep is not needed for the auto-resolve logic (it only needs `currentCard?.id` and `gameId` to decide whether to call `resolve-next-virus`). It should not be in the dep array.

---

### H2 — Natural 60s deadline expired coinciding with player switch (POSSIBLE ALTERNATIVE)

The targeting deadline is 60 seconds. The repro involved switching player in browser A "without clicking any button." If the 60s window had naturally elapsed at that moment, `handleDeadline()` in `SecretTargeting.tsx` would fire, call `secret-target` with `force_resolve: true`, and advance the game.

**Evidence test:** Check `game_log` for `targeting_resolved`. 
- If `targeting_resolved` IS present in DB → `secret-target` ran to completion → deadline fired normally (possibly coincident with player switch, not caused by it).
- If `targeting_resolved` is ABSENT from DB → `secret-target` was NOT called to completion. The phase change happened via another path (VirusResolution H1, or a direct DB write).

**Verdict:** Needs DB verification to rule in/out. The repro description says "no targeting_resolved event in log" — if that means the DB row is absent (not just UI Realtime miss), then H2 is excluded and H1 or an untested path is the root cause.

---

### H3 — Abort-vote injection interfering with secret_targeting (NOT A FACTOR)

`end-play-phase` abort injection at lines 206-228 and `resolve-next-virus` abort injection at lines 95-117 both require the function to reach that code. Both functions bail out before the injection logic when the phase is wrong:
- `end-play-phase` line 61: `throw new Error("Not in player_turn phase")`
- `resolve-next-virus` line 35-41: `return { skipped: "not_in_virus_resolution" }`

Neither function can fire the abort injection when phase is `secret_targeting`. Abort-vote changes are NOT a factor in this bug.

---

### H4 — Reverse phase guards (CONFIRMED CORRECT, with one caveat)

**`resolve-next-virus` reverse guard:** `resolve-next-virus/index.ts:35-41` — returns `skipped` when phase ≠ `virus_resolution`. Correct.

**`end-play-phase` reverse guard:** `end-play-phase/index.ts:61` — throws when phase ≠ `player_turn`. Correct.

**`secret-target` force_resolve caveat:** `secret-target/index.ts:66-74` — the `force_resolve` path does NOT verify the deadline has passed. Any caller that knows the `resolutionId` and sends `force_resolve: true` will immediately tally and resolve the targeting, regardless of remaining time. This is a separate server-side design issue, but it is unrelated to the player-switch repro (the player switch doesn't call `secret-target` directly).

---

## Root cause summary

**Primary candidate:** `VirusResolution.tsx:97` has `overridePlayerId` in its dep array. Player switch changes `overridePlayerId` → auto-resolve useEffect re-fires → `resolveInFlightRef.current = false` reset → new `resolve-next-virus` call issued. Server guard catches this when phase is committed to `secret_targeting`, but a narrow Realtime delivery window creates a real race where the call can reach the server before or simultaneous with the phase-change commit.

**Pre-existing vs abort-vote introduced:** Pre-existing. `overridePlayerId` was added to the dep array before the abort-vote work (it was already there when abort-vote changes were read). Abort-vote changes did not touch `VirusResolution.tsx`'s dep array and did not introduce or worsen this bug.

---

## Proposed fix approach (NOT applied — awaiting approval)

**Primary fix:** Remove `overridePlayerId` from `VirusResolution.tsx`'s auto-resolve useEffect dep array:

```javascript
// Before (line 97):
}, [currentCard?.id, gameId, overridePlayerId]);

// After:
}, [currentCard?.id, gameId]);
```

`overridePlayerId` is passed to the `resolve-next-virus` call inside the effect (as `override_player_id` in the request body). The effect reads `overridePlayerId` from closure — it doesn't need it in the dep array to get the current value, because the closure will already have the latest value when the effect fires. The dep is spurious: it causes the effect to re-fire when the player switches, which is exactly the wrong behavior.

**Secondary hardening (optional):** Add a deadline-passed check in `secret-target`'s `force_resolve` path:
```javascript
if (force_resolve && new Date() < new Date(game.targeting_deadline)) {
  throw new Error("Deadline has not passed");
}
```
This prevents any premature `force_resolve` call from resolving targeting early. Low priority — the real trigger was on the client side.

**Verification:** After applying the primary fix, switch DevMode player during an active `secret_targeting` phase — VirusResolution's auto-resolve effect should NOT re-fire, no `resolve-next-virus` call should be issued, and the targeting phase should remain active until the deadline or all votes are cast.

---

## Root-cause fix design

### Q1 — Where exactly is phase='secret_targeting' written?

**File:** `supabase/functions/resolve-next-virus/index.ts:359-364` inside `applyVirusEffect`

```typescript
// Lines 353–372
case "process_crash":
case "memory_leak":
case "resource_surge":
case "cpu_drain":
case "memory_allocation": {
  const deadline = new Date(Date.now() + 60_000).toISOString();
  await admin.from("games").update({          // ← line 359: NO phase condition
    phase: "secret_targeting",
    targeting_deadline: deadline,
    current_targeting_resolution_id: card.id,
    current_targeting_card_key: card.card_key,
  }).eq("id", game_id);                       // ← only guards on game id
  const targetingLog: GameLogInsert<"virus_effect"> = { … };
  await admin.from("game_log").insert(targetingLog);
  return true; // pause
}
```

It is a **single atomic UPDATE** writing all four fields together (`phase`, `targeting_deadline`, `current_targeting_resolution_id`, `current_targeting_card_key`). The `game_log` INSERT follows the UPDATE and is not part of the transition predicate. There are **no prerequisite writes to other tables** before the UPDATE.

**This UPDATE has no `WHERE phase='virus_resolution'` condition.** It will unconditionally overwrite whatever phase the games row holds at the time it executes. This is the structural gap.

The empty-queue branch (lines 74-85), by contrast, has a full CAS:
```typescript
const { data: claimed } = await admin.from("games")
  .update({ phase: "between_turns" })
  .eq("id", game_id)
  .eq("phase", "virus_resolution")   // ← CAS condition
  .select("id");
if (!claimed?.length) { return no-op }
```

The targeting branch has no equivalent. Two concurrent `resolve-next-virus` calls — one taking the targeting path, one taking the empty-queue path — compete with no mutual exclusion on the games row.

---

### Q2 — Can the targeting transition be made a single conditional CAS?

**Yes, cleanly.** The structure is ideal for a CAS fix:

- The UPDATE is already a single statement writing all four fields atomically.
- The `game_log` INSERT follows the UPDATE (not before), so no "must-insert-before-phase-write" dependency exists.
- The loser path requires no rollback of prior writes (the card is already marked resolved in the queue, which is idempotent and correct regardless of which call wins the phase transition).

**Proposed change (NOT applied):**

```typescript
// Targeting case in applyVirusEffect, replace lines 359-372:

const deadline = new Date(Date.now() + 60_000).toISOString();
const { data: claimed } = await admin.from("games").update({
  phase: "secret_targeting",
  targeting_deadline: deadline,
  current_targeting_resolution_id: card.id,
  current_targeting_card_key: card.card_key,
}).eq("id", game_id).eq("phase", "virus_resolution").select("id");  // ← add CAS condition

if (!claimed?.length) {
  // CAS lost — concurrent caller already won the virus_resolution exit race. No-op.
  return false;
}

const targetingLog: GameLogInsert<"virus_effect"> = { … };
await admin.from("game_log").insert(targetingLog);
return true; // pause
```

The winner writes the log and returns `true` (pause). The loser returns `false` (no pause, no log).

---

### Q3 — Ordering and mutual exclusion after the fix

For non-CF cards, `resolve-next-virus` executes in this order per call:
1. `UPDATE virus_resolution_queue SET resolved=true` (line 129) — marks card consumed
2. Return card to deck cycle (line 133-138)
3. `applyVirusEffect` called (line 143-144) — writes phase transition

Call B can arrive at any point. The observed repro race (reconstructed from 413ms gap and orphaned targeting fields in DB) was:

| Step | Call A | Call B |
|------|--------|--------|
| 1 | SELECT game → phase='virus_resolution' | |
| 2 | SELECT queue → Memory Leak found | |
| 3 | UPDATE queue resolved=true ✓ | |
| 4 | | SELECT game → phase='virus_resolution' (Call A's applyVirusEffect UPDATE not yet committed) |
| 5 | | SELECT queue → empty (Call A's mark-resolved committed) |
| 6 | | empty-queue CAS → UPDATE phase='between_turns' WHERE phase='virus_resolution' → **wins** |
| 7 | applyVirusEffect → UPDATE phase='secret_targeting' WHERE id=? (no phase condition) → **overwrites** | |
| 8 | | advanceTurnOrPhase → UPDATE phase='player_turn' → **overwrites again** |

Result: targeting fields written by step 7, phase overwritten to 'player_turn' by step 8. Exactly matches DB state: targeting fields set, phase='player_turn'.

**After the fix**, both branches gate on the same `WHERE phase='virus_resolution'` predicate. Postgres row locking guarantees serialization: when steps 6 and 7 race to UPDATE the same games row, one blocks until the other commits, then re-evaluates its WHERE condition. Whichever commits first claims the `virus_resolution` exit. The other sees 0 rows and returns no-op. The interleaving that produced the bug (step 7 firing after step 6, step 8 firing after step 7) is impossible after the fix because step 7 can no longer fire if step 6 has already committed.

---

### Q4 — All callers that transition OUT of virus_resolution

Exhaustive search across all edge functions:

| Function | Direction | Phase guard | Notes |
|----------|-----------|-------------|-------|
| `resolve-next-virus` (empty-queue branch, line 76) | virus_resolution → between_turns → player_turn | `WHERE phase='virus_resolution'` ✓ CAS | Already correct |
| `resolve-next-virus` (targeting branch, line 359) | virus_resolution → secret_targeting | **none** — BUG | Fix target |
| `resolve-next-virus` (win-condition, line 159) | virus_resolution → game_over | none, but only reached after empty-queue CAS winner | Safe: only reachable after CAS winner confirmed |
| `pull-viruses` (line 67) | virus_pull → **virus_resolution** | guards `phase='virus_pull'` ✓ | Transitions INTO virus_resolution, not out |
| `end-play-phase` (line 61) | player_turn → virus_pull / direct | throws if not player_turn ✓ | Cannot reach virus_resolution |
| `secret-target` | secret_targeting → virus_resolution | guards `phase='secret_targeting'` ✓ | Transitions INTO virus_resolution, not out |

**Only `resolve-next-virus` transitions out of `virus_resolution`.** It has exactly two exit branches: empty-queue (CAS ✓) and targeting (no CAS — fix target). No other function writes the games row away from `virus_resolution`.

The game_over write at line 159 is not a concurrent race risk: it runs after the empty-queue CAS winner has been confirmed (lines 80-85 exit if CAS lost), so only one call ever reaches line 159.

---

### Q5 — Loser behavior

**Empty-queue CAS loser (existing):** 0 rows returned → logs and returns `{ success: true, skipped: "advance_claimed" }`. No throw, no re-advance. ✓

**Targeting CAS loser (proposed):** 0 rows returned → `applyVirusEffect` returns `false` → back in resolve-next-virus, `if (pauseForTargeting)` is false → falls through to win-condition re-fetch at line 154. For all five targeting cards (process_crash, memory_leak, resource_surge, cpu_drain, memory_allocation), none modify `escape_timer` or `core_progress` — the win-condition check at lines 157-170 passes harmlessly and the function returns `{ success: true }`. No throw, no re-advance. ✓

The loser of the targeting CAS does NOT write the `virus_effect` game_log entry (the `INSERT` at line 371 is skipped — it's after the `claimed?.length` check). Only the winner logs the effect.

---

### Summary of the fix

**One-line scope:** add `.eq("phase", "virus_resolution").select("id")` to the targeting UPDATE at `resolve-next-virus/index.ts:364`, check `claimed?.length`, and return `false` if 0 rows. This brings the targeting exit branch under the same CAS discipline as the empty-queue exit branch. After the fix, both exits from `virus_resolution` are mutually exclusive at the Postgres row level.

The VirusResolution.tsx dep-array change (removing `overridePlayerId` at line 97) is a **secondary hardening** that eliminates the spurious concurrent call at the source, but it is not the root-cause fix. The server-side race can also be triggered by legitimate network retry or any other scenario where two `resolve-next-virus` calls overlap. The CAS fix is the correct structural solution independent of what triggers the concurrent call.

**Recommended fix order:**
1. Server-side CAS fix in `resolve-next-virus` — closes the race for all callers
2. Remove `overridePlayerId` from VirusResolution.tsx dep array — eliminates the trigger

---

## DB verification — H1 vs H2

**Game ID:** `5c1cd3c9-0410-41c3-83ac-939adb0c73ae` (repro game, 2026-05-31)

### Raw results

**Q1 — targeting_resolved / virus_effect / mission_transition:**
```
virus_effect   | Pipeline Breakdown! Next contribution has 50% chance of failing. | 00:12:44.359
virus_effect   | Memory Leak! Misaligned AIs are selecting a target…              | 00:15:38.259
```
No `targeting_resolved` row. None.

**Q2 — Last 20 log entries (DESC):**
```
turn_start   | Bot4's turn.                                  | 00:15:38.672  ← game in player_turn
virus_effect | Memory Leak! Misaligned AIs are selecting a target… | 00:15:38.259  ← 413ms earlier
virus_queue_start | b pulled 1 virus from the pool.          | 00:15:34.168
virus_pull_initiated | b generated 1 virus — pulling from pool. | 00:15:30.371
...
```

**Q3 — secret_target_votes:** Empty — zero rows.

**Q4 — Current game state:**
```
phase:                          player_turn
targeting_deadline:             2026-05-31 00:16:38.163+00   ← 60s after Memory Leak event
current_targeting_resolution_id: 9879bbb1-61c0-43f5-8112-b471c497ef69  ← still set, not cleaned up
current_targeting_card_key:     memory_leak                  ← still set, not cleaned up
current_turn_player_id:         31d1c77e-...                 ← Bot4
```

---

### Verdict: **H1 CONFIRMED. H2 EXCLUDED.**

**H2 excluded** — the deadline was set for `00:16:38` (60s after `00:15:38`). The game advanced to `player_turn` at `00:15:38.672` — only **413ms** after `secret_targeting` was entered. No 60-second wait occurred. The deadline never fired.

**No votes** — `secret_target_votes` is empty, confirming no human in browser B interacted with the targeting UI before the game left the phase.

**`targeting_resolved` absent** — `secret-target` was never called to completion. The game transitioned out of `secret_targeting` without the resolution function running.

**`targeting_deadline` and `current_targeting_card_key` still set** — confirms the game state was left in a half-resolved condition: `secret_targeting` fields written by the first `resolve-next-virus` call were never cleaned up, because the clean-up happens inside `secret-target` (which never ran).

**Exact race reconstructed from timestamps:**

| Time | Event |
|------|-------|
| 00:15:38.259 | Call A (`resolve-next-virus`, legitimate): pops Memory Leak from queue, writes `virus_effect` log, sets `targeting_deadline`, begins writing `phase = 'secret_targeting'` |
| ~00:15:38.2xx | Player switch in browser A fires, `overridePlayerId` changes, VirusResolution dep array effect re-fires, `resolveInFlightRef.current = false` reset, Call B (`resolve-next-virus`, spurious) issued |
| ~00:15:38.3–.6 | Call B reaches server while game phase may still be `virus_resolution` in DB (Call A's write not yet committed or visible). Call B passes the phase guard, pops from the now-empty queue, executes the empty-queue branch: `UPDATE games SET phase='between_turns' WHERE phase='virus_resolution'` → succeeds if Call A's `secret_targeting` write hasn't committed yet. Advances to `player_turn`, writes `turn_start` |
| 00:15:38.672 | `turn_start` "Bot4's turn" written — game is now in `player_turn` |
| 00:16:38 | `targeting_deadline` expires — but game is already in `player_turn`, nobody is listening |

The key race condition: Call A and Call B both pass `phase === 'virus_resolution'` at line 35. Call A pops Memory Leak (queue now empty) and writes the targeting transition. Call B, running concurrently, sees the empty queue and wins the CAS race to `between_turns` → `player_turn`. Since `targeting_resolved` is written by `secret-target` (not by `resolve-next-virus`), and `secret-target` never ran, the log entry is absent. The targeting DB fields (`current_targeting_resolution_id`, `current_targeting_card_key`, `targeting_deadline`) remain set as orphaned state.

**The fix is the dep-array change, not the force_resolve guard.** The force_resolve path in `secret-target` (H4 caveat) is not implicated here — `secret-target` was never called at all. The dep-array removal at `VirusResolution.tsx:97` eliminates the spurious concurrent call entirely.
