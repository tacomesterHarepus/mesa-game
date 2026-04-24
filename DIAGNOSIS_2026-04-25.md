# Diagnosis — 2026-04-25 Autonomous Session

Phase 2 playtest bug investigation. Two bugs to diagnose only (no fixes applied).

---

## Bug A — "Failed to send a request to the Edge Function" during play-card

### Observed symptoms

- Occurs during CPU 1 AI turn when playing Compute
- Inconsistent: "sometimes" fails, not always
- On a different AI (same session, shortly after) the same action succeeded

### Error origin

The message "Failed to send a request to the Edge Function" is hardcoded in
`@supabase/functions-js` (the package bundled with `@supabase/supabase-js@2.104.0`):

```typescript
// node_modules/@supabase/functions-js/dist/module/types.js
class FunctionsFetchError extends FunctionsError {
  constructor(context) {
    super('Failed to send a request to the Edge Function', 'FunctionsFetchError', context);
  }
}
```

It is thrown whenever `fetch()` itself throws — i.e. when the HTTP request fails
**before** any response is received (network-level failure, not an HTTP error from
the function). This is distinct from a `FunctionsHttpError` (4xx/5xx from the
function body) or `FunctionsRelayError` (Supabase relay issue).

### Root cause: Supabase Edge Function cold start

Supabase edge functions (Deno Deploy) become "cold" after roughly 10 minutes of
inactivity. The first invocation to a cold function spins up a fresh Deno container,
which takes 1–5 seconds. During this cold start the initial fetch request may fail
with a TCP/TLS connection error before the container is ready to accept connections.

The `fetch()` throwing causes `FunctionsFetchError`, which surfaces in the UI as
"Failed to send a request to the Edge Function."

**Why it matches the observed symptoms:**

| Observation | Explanation |
|---|---|
| "Sometimes" fails | Only when `play-card` is cold; if called within ~10 min of a prior run it's warm |
| CPU 1 AI turn | This is the **first call to `play-card`** in this game session. All earlier calls used different functions: `start-game`, `reveal-card`, `allocate-resources`. `play-card` hasn't been called yet and is cold. |
| "Different AI the same action worked" | The second call to `play-card` (for the next AI) succeeds because the first (failed) call warmed the container |

### Is this dev-mode specific?

No. Cold starts affect real games too — the first `play-card` call in any cold
session would fail for real players. It is **more likely noticed in dev testing**
because:
1. Testers run multiple test games sequentially; gaps between games may exceed the
   warm window
2. Manual playtesting sessions have variable timing, making it hard to reproduce

### Confirmation from E2E tests

The virus-placement test (added in Task 1) reproduced this exact failure mode on
its second run: `start-game` failed with a network error ~60 seconds after the
first run completed. The function had gone cold during the test-suite runtime.

### Player switching / dev-mode state leaking — ruled out

`overridePlayerId` is passed in the request body; the function validates it with
`MESA_ENVIRONMENT !== "production"` guard and the `neq("user_id", userId)` count
check. All dev-mode players share one `user_id`, so count=0 and override is always
allowed. There is no player-specific code path that would cause a network failure
for one AI but not another. Player switching state does NOT cause this error.

### Proposed fix (do not apply yet)

**Option 1 — Retry on FunctionsFetchError (recommended):**

Add a small retry wrapper around `supabase.functions.invoke` calls in all phase
components. Only retry on network-level failures (not 400/validation errors from
the function body). First retry succeeds because the cold-start container is now
warm.

```typescript
// Proposed utility (lib/supabase/invokeWithRetry.ts)
import { createClient } from "@/lib/supabase/client";

export async function invokeWithRetry(
  fnName: string,
  body: Record<string, unknown>,
  maxRetries = 2,
): Promise<{ data: unknown; error: { message: string } | null }> {
  const supabase = createClient();
  for (let i = 0; i <= maxRetries; i++) {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    // Only retry network-level errors, not server-side validation errors
    if (!error || error.message !== "Failed to send a request to the Edge Function" || i === maxRetries) {
      return { data, error };
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  return { data: null, error: { message: "Failed after retries" } };
}
```

Callers: replace `supabase.functions.invoke("play-card", { body })` with
`invokeWithRetry("play-card", body)` in `PlayerTurn.tsx`, `VirusResolution.tsx`,
`CardReveal.tsx`, `ResourceAllocation.tsx`, `ResourceAdjustment.tsx`, and
`SecretTargeting.tsx`.

**Option 2 — Preheat on game entry:**

On game page mount, fire a cheap no-op request to each edge function that contains
a guard: `if (!game_id) return json({ ok: true })`. This keeps functions warm
during a session.

**Option 3 — Accept as known limitation:**

Document it. Users can retry manually (click Play Card again). No code change.
Low priority for pre-production playtesting.

Recommendation: **Option 1**. Invisible to users, zero downside, solves the root
cause without architecture changes.

---

## Bug B — Hand appears replaced rather than topped up

### Observed symptoms

- AI with RAM 4 had 4 cards at start of turn
- Later in the same turn, saw 4 "new" (different-looking) cards
- Suspicion: draw logic replaces full hand instead of topping up

### Investigation findings

#### 1. drawCardsForPlayer — logic is correct

`supabase/functions/_shared/advanceTurnOrPhase.ts` lines 17–92:

```typescript
const { count: handSizeRaw } = await admin
  .from("hands")
  .select("id", { count: "exact", head: true })
  .eq("player_id", player.id);

const handSize = handSizeRaw ?? 0;
const cardsNeeded = (player.ram ?? 4) - handSize;
if (cardsNeeded <= 0) return;  // ← exits if hand is full
```

`cardsNeeded = ram - currentHandSize` is calculated correctly. The function only
INSERTs the shortfall; it never DELETEs or replaces existing hand cards.

#### 2. No churn / replacement logic exists

- `play-card` DELETE: removes exactly one card (the played card, by `id`)
- `place-virus` DELETE: removes exactly one card (the staged card, by `id`)
- `drawCardsForPlayer` INSERT: adds only `ram - current_hand_size` cards
- No function performs a full hand DELETE+reinsert

There is no code path that replaces the entire hand.

#### 3. When drawCardsForPlayer is called for the active player

`drawCardsForPlayer` is called for the **next** player after a turn ends, and for
the **first player of Round 2** at end of Round 1. It is also called in
`allocate-resources` for the first player of the mission.

The only scenario where it's called for the **current** player is:
- They are the first player of Round 2 (end-of-round-1 draw)
- OR they are the first player after `allocate-resources` runs

If a player staged a card (via `place-virus`, which removes it from `hands`) and
ended their turn, `drawCardsForPlayer` would top up by exactly 1 card at the start
of Round 2. This is correct behavior.

#### 4. Most likely explanation for the observation

**UI hand-ordering instability:** The `hands` table has no position/order column.
Queries return rows in an arbitrary DB-level order. Two different reads of the same
hand — one via Realtime INSERT event, another via the 3s polling loop — may return
the same 4 cards in different orders. This makes the hand appear to "refresh" with
visually different card positions, which a user might perceive as seeing "new" cards.

The 3s polling loop in `GameBoard.tsx` (lines 91–96) runs `setHand(h)` on every
tick with whatever order the DB returns. If the DB order changes between ticks
(insertion order can shift), the hand display scrambles — same cards, different
layout.

**Secondary explanation:** If the player staged 1 card for virus pool (removing it
from hand), and then at Round 2 start `drawCardsForPlayer` correctly drew 1 new
card, the player would see their 3 remaining cards + 1 genuinely new card — a total
of 4 cards, one of which is new. The 1 new card stands out among the familiar 3,
making it feel like "4 new cards" to a tired playtester.

#### 5. Cannot conclusively confirm via current tools

Confirming via DB state requires inspecting `hands` rows at specific timestamps,
which is not possible without server-side logs or a real-time DB observer. The
playtester's report is imprecise enough that both explanations fit.

### Verdict

The draw logic (`drawCardsForPlayer`) is **correct**. There is **no hand-replacement
bug** in the backend. The observation is most likely a UI artifact (card reordering
from unstable query result order) or a correct draw being misread.

### Proposed fix (do not apply yet)

**Stabilize hand display order** in `GameBoard.tsx` hand polling and Realtime
handler by sorting by `id` (UUID, consistent across fetches):

```typescript
// In polling loop and Realtime handler:
if (h) setHand([...h].sort((a, b) => a.id.localeCompare(b.id)));
```

This ensures the same 4 cards always appear in the same visual order, eliminating
the "scrambled hand" perception even when the DB returns rows in different order.

If the playtester observes the bug again with stable ordering, it would suggest
something more complex is happening. But based on current evidence, ordering
stabilization is the right minimal fix.

---

## Session summary

- Bug A: Root cause confirmed (cold start). Fix proposed (retry wrapper). Not applied.
- Bug B: Backend draw logic is correct. UI ordering artifact is the likely cause.
  Fix proposed (sort hand by ID). Not applied.
- All findings added to this file per diagnosis protocol.
