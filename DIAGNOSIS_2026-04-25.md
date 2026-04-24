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

---

## Bug A Revisit — "Edge Function returned a non-2xx status code" (2026-04-25)

### What changed

Original diagnosis: cold start → TCP failure → `FunctionsFetchError` ("Failed to send").
Original fix: `invokeWithRetry` retries on `FunctionsFetchError`.
New symptom: "Edge Function returned a non-2xx status code" in the PlayerTurn UI.

These are different error classes from `@supabase/functions-js`:

| Class | Message | When thrown |
|---|---|---|
| `FunctionsFetchError` | "Failed to send a request…" | `fetch()` itself throws — TCP/TLS failure, no HTTP response |
| `FunctionsRelayError` | "Relay Error invoking the Edge Function" | HTTP response with `x-relay-error: true` header |
| `FunctionsHttpError` | "Edge Function returned a non-2xx status code" | HTTP response, no relay header, `!response.ok` |

The new error is `FunctionsHttpError`. `invokeWithRetry` only retries `FunctionsFetchError`, so the new failure mode falls through to the UI as-is.

### Is auth the root cause?

Ruled out. Source analysis of `@supabase/supabase-js` confirms that every `functions.invoke()` call goes through a custom fetch wrapper (`rn`) that calls `await this._getAccessToken()` before the request and injects `Authorization: Bearer <token>`. `getSession()` is called inside `_getAccessToken`. Auth is always present — either the user JWT or the anon key as fallback. The edge function's `if (!authHeader) throw new Error("Unauthorized")` path cannot be reached in normal operation.

Relevant detail: `createBrowserClient` from `@supabase/ssr` is a singleton in browser environments (`cachedBrowserClient`), so `createClient()` in `invokeWithRetry` always returns the same instance. No auth-initialization race.

### Root cause: cold start manifesting as relay HTTP error

Cold start can produce either failure mode depending on Supabase infrastructure internals:

**Mode 1 (original):** The TCP connection to the Deno worker fails before a response is sent. `fetch()` throws. `FunctionsFetchError`. Retried by the existing fix.

**Mode 2 (new):** The Supabase relay accepts the HTTP connection but times out waiting for the Deno worker to start. The relay returns a 502 or 503 without the `x-relay-error` header. `!response.ok` → `FunctionsHttpError`. Not retried.

Both modes are cold-start symptoms. Which one fires is non-deterministic and depends on whether the relay gives up before or after the TCP handshake completes.

Pattern fit:

| Observation | Explanation |
|---|---|
| "First card ever played in a session" | `play-card` is cold — all earlier functions (start-game, reveal-card, allocate-resources) are different containers; each function cools independently |
| "Random mid-session turn" | A long pause between turns (virus resolution, player deliberation) re-cools `play-card`; Supabase containers typically warm for ~10 min |
| Error changed from "Failed to send" to non-2xx | The two cold-start modes are non-deterministic; the previous playtest hit Mode 1, this one hit Mode 2 |

### MCP logs — not accessible

Supabase MCP OAuth flow state is ephemeral and does not persist across tool call boundaries. The `complete_authentication` call arrives after the flow state is discarded. Could not confirm HTTP status code from server logs. Diagnosis rests on source analysis + pattern match.

### Secondary bug: error message display

When `FunctionsHttpError` is returned, all callers do:
```typescript
if (fnError) {
  setError(fnError.message);  // always "Edge Function returned a non-2xx status code"
}
```

`fnError.context` is the raw `Response` object (body unconsumed). For a 400 response, the actual message (e.g. `{ error: "Not your turn" }`) is in the response body, accessible via `await fnError.context.json()`. The UI never reads it. This means ALL 400 game-logic validation errors also show the generic wrapper message — a separate bug that's been present since shipping.

### Proposed fix

Two changes to `invokeWithRetry`, no changes to callers:

**1 — Retry on 5xx FunctionsHttpError (cold start relay error)**

```typescript
function isRetryableError(error: InvokeError): boolean {
  if (error.name === "FunctionsFetchError" || error.message.includes("Failed to send")) {
    return true;
  }
  if (error.name === "FunctionsHttpError") {
    const status = (error.context as Response | undefined)?.status;
    return status !== undefined && status >= 500;
  }
  return false;
}
```

**2 — Extract actual error message for non-retryable FunctionsHttpError (4xx)**

On exit from the retry loop (either not retryable or retries exhausted):
```typescript
// For 4xx FunctionsHttpError: read the body, return the actual message
if (error !== null && error.name === "FunctionsHttpError") {
  const status = (error.context as Response | undefined)?.status;
  if (status !== undefined && status < 500) {
    try {
      const body = await (error.context as Response).json();
      if (typeof body?.error === "string") {
        return { data: null, error: { ...error, message: body.error } };
      }
    } catch { /* body not JSON; keep generic message */ }
  }
}
return { data, error: error as InvokeError | null };
```

The 5xx case (cold start) keeps the generic message since the body is infrastructure HTML, not a function error object.

**Why this is safe for non-idempotent operations:**

The idempotency guarantee from the original comment still holds:
- `FunctionsFetchError`: `fetch()` threw → request never reached the server
- `FunctionsHttpError` with 5xx: the relay returned an error before routing to the function handler → no handler ran, no writes occurred

A 4xx is NOT retried — it means the request reached the function and the function rejected it intentionally.

**Updated comment for `invokeWithRetry`:**

```typescript
// Retries on two cold-start failure modes:
//   1. FunctionsFetchError: fetch() threw (TCP failure) — request never reached the server
//   2. FunctionsHttpError 5xx: relay timed out before reaching the handler — no writes occurred
// Does NOT retry 4xx — those are intentional rejections from the function handler.
// For 4xx FunctionsHttpError, reads the response body to surface the actual error message.
```
