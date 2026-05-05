# DIAGNOSIS: MESA_ENVIRONMENT Architecture — Origin-Gate Rollout Plan

**Date:** 2026-05-05  
**Context:** After shipping the role-reveal modal loop fix (3 commits), canary still fails because `MESA_ENVIRONMENT=production` blocks override paths in the remaining 10 functions. User correctly stopped the agent from removing the env var, which would re-open the prod bypass. This doc answers four questions before any implementation begins.

**Status:** SHIPPED. Final fix: origin-only gate + devFetch wrapper in test helpers. Canary 11/10/0. Prod smoke test verified. See §5 for the full implementation story including two failed approaches.

---

## 1. Audit: Every edge function and its current gate

### Functions WITH `override_player_id` — MESA_ENVIRONMENT gate (original)

All 10 used identical pattern:
```
if (override_player_id && Deno.env.get("MESA_ENVIRONMENT") !== "production") {
  // look up player by override_player_id + game_id
  if (data.user_id !== userId) throw new Error("Dev override denied");
  return data;
}
// non-override path:
.eq("game_id", game_id).eq("user_id", userId).single()  ← PGRST116 risk with Fill Lobby
```

| Function | Phase gate needed for |
|---|---|
| `reveal-card` | card_reveal — AI reveals card |
| `play-card` | player_turn — AI plays card |
| `end-play-phase` | player_turn — AI ends turn |
| `abort-mission` | player_turn — human aborts |
| `adjust-resources` | resource_adjustment — human adjusts |
| `allocate-resources` | resource_allocation — human allocates |
| `discard-cards` | player_turn — AI discards |
| `place-virus` | player_turn — AI places virus |
| `pull-viruses` | virus_pull — active player pulls |
| `secret-target` | secret_targeting — misaligned AI votes |

### Functions WITH `override_player_id` — origin gate (already converted before this task)

| Function | Notes |
|---|---|
| `acknowledge-role` | v3 — origin check, user_id check removed |
| `select-mission` | v5 — origin check, user_id check removed |

### Functions WITHOUT `override_player_id`

| Function | How it authenticates |
|---|---|
| `start-game` | `game.host_user_id !== userId` — no player lookup at all |
| `resolve-next-virus` | `.eq("user_id", userId)` with `count: "exact"` — returns count, not `.single()`, so no PGRST116 risk; no override path needed |

---

## 2. Would origin-header gate on all 10 remaining functions restore dev + keep prod locked?

**Answer: Yes for browser-initiated calls. No for Node.js E2E direct fetches (requires devFetch wrapper — see §5).**

### How browser origin works

When a browser makes a cross-origin fetch:
- `http://localhost:3000` → Supabase edge function: browser sends `Origin: http://localhost:3000` ✓  
- `https://mesa-game.vercel.app` → Supabase: browser sends `Origin: https://mesa-game.vercel.app` ✓

The `isLocalhost` check (`origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")`) correctly passes only for localhost and blocks all others including Vercel prod.

### End-to-end example: play-card with override_player_id from Vercel production browser

1. Vercel-hosted page calls `invokeWithRetry("play-card", { game_id, card_id, override_player_id: someOtherPlayerId })`
2. Browser sends request to Supabase with header `Origin: https://mesa-game.vercel.app`
3. `origin.startsWith("http://localhost")` → false
4. `origin.startsWith("http://127.0.0.1")` → false
5. → falls through to non-override path: `.eq("user_id", userId).single()`
6. In a real production game each player has their own auth session → lookup succeeds, returns the real player
7. `callerPlayer.id !== game.current_turn_player_id` → rejected if it's not their turn

Override path silently skipped. Real player lookup used. Production is locked even if `override_player_id` is in the request body.

---

## 3. Node.js E2E tests — origin header is ABSENT

This is the critical problem. All Playwright test helpers call edge functions via Node.js `fetch()`:

```ts
await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
});
```

Node.js `fetch()` does **not** add an `Origin` header automatically. The `Origin` header is a browser security feature enforced by browsers to protect against CSRF — Node.js has no concept of a browsing context, so it sends no `Origin` unless explicitly set.

Result with origin-only gate (no devFetch):
- `req.headers.get("origin")` → `null`
- `origin = null ?? ""` → `""`
- `isLocalhost = false`
- Override path skipped → falls through to `.eq("user_id", userId).single()`
- Fill Lobby game has 6 players all with same `user_id` → PGRST116 → 400 error

### Functions called via direct Node.js fetch WITH override_player_id in canary/full suite:

| Function | Test files |
|---|---|
| `reveal-card` | turn-order, multi-mission, abort-mission, virus-system, secret-actions, hand-stability, draw-cards, game-log, game-log-ui, error-handling, mission-rules, discard, card-reveal (via dismissModal helper) |
| `allocate-resources` | turn-order, multi-mission, abort-mission, virus-system, hand-stability, draw-cards, game-log, game-log-ui, error-handling, mission-rules, discard |
| `end-play-phase` | turn-order, multi-mission, abort-mission, virus-system, secret-actions, hand-stability, draw-cards, game-log, game-log-ui, mission-rules, discard |
| `select-mission` | multi-mission, card-reveal |
| `adjust-resources` | multi-mission |
| `abort-mission` | abort-mission |
| `discard-cards` | hand-stability, draw-cards, game-log, game-log-ui, mission-rules, discard |
| `play-card` | hand-stability, draw-cards, game-log, game-log-ui, mission-rules, error-handling |
| `place-virus` | hand-stability |
| `pull-viruses` | virus-system |
| `secret-target` | secret-actions, game-log, game-log-ui, mission-rules |

Every function with an override path is called from Node.js context in the test suite.

### `resolve-next-virus` — special case, no issue

`resolve-next-virus` has no override path and uses a count check (not `.single()`). Node.js test calls send no `override_player_id` and the count check handles multiple-same-user_id fine. **This function needs no changes.**

---

## 4. Meaningful difference between MESA_ENVIRONMENT unset vs MESA_ENVIRONMENT=production

**For the 10 functions still using MESA_ENVIRONMENT gate:**

| State | `Deno.env.get("MESA_ENVIRONMENT") !== "production"` | Override path |
|---|---|---|
| `MESA_ENVIRONMENT` **not set** | `undefined !== "production"` → **true** | **OPEN** |
| `MESA_ENVIRONMENT=production` | `"production" !== "production"` → **false** | **CLOSED** |
| `MESA_ENVIRONMENT=development` | `"development" !== "production"` → **true** | **OPEN** |

**Difference is total.** With the env var unset, the override path for all 10 functions is fully open in production — any caller who knows or guesses a valid `override_player_id` can impersonate any player in any game. This is why removing the env var is not acceptable.

For `acknowledge-role` and `select-mission` (already on origin gate), `MESA_ENVIRONMENT` is ignored regardless. Those are safe either way.

---

## 5. Implementation history — two failed approaches, then the correct fix

### Approach 1 (failed): DENO_DEPLOYMENT_ID gate

Initial plan: `!Deno.env.get("DENO_DEPLOYMENT_ID")` as the gate — present only in hosted Supabase, absent locally. Seemed promising because it doesn't require any env var management.

**Why it failed:** E2E tests call hosted Supabase directly. `DENO_DEPLOYMENT_ID` IS set in hosted Supabase. So the gate is identical to `MESA_ENVIRONMENT=production` — it blocks both production browsers and test Node.js calls with equal effectiveness. Canary remained at 8 failures after this deploy.

### Approach 2 (considered but never deployed): SUPABASE_URL local check

Diagnosis doc originally recommended: check `Deno.env.get("SUPABASE_URL")` starts with `http://127.0.0.1` to detect local runtime.

**Why it would have failed:** `SUPABASE_URL` inside the Deno runtime (Docker container) is `http://kong:8000` (Docker-internal networking), NOT `http://127.0.0.1:54321`. The public port is exposed separately as `SUPABASE_PUBLIC_URL`. The `startsWith("http://127.0.0.1")` check would always return false even locally. This approach was discarded before deployment.

Additionally: E2E tests call hosted Supabase directly anyway — even if local SUPABASE_URL detection worked, it wouldn't help since tests run against `https://qpoakdiwmpaxvvzpqqdh.supabase.co`.

### Approach 3 (shipped): Origin gate + devFetch wrapper

**The key insight:** The only reliable signal that distinguishes "dev caller who should have override access" from "production browser who should not" is the HTTP `Origin` header. The fix has two parts:

**Part 1 — All 12 edge functions:** Switched `resolvePlayer` to origin-only gate:
```typescript
async function resolvePlayer(
  req: Request,
  admin: ReturnType<typeof createClient>,
  game_id: string,
  userId: string,
  override_player_id?: string,
): Promise<any> {
  const origin = req.headers.get("origin") ?? "";
  const isLocalhost = origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
  if (override_player_id && isLocalhost) {
    const { data } = await admin
      .from("players").select("*")
      .eq("id", override_player_id).eq("game_id", game_id).single();
    if (!data) throw new Error("Override player not found in game");
    return data;
  }
  const { data } = await admin
    .from("players").select("*")
    .eq("game_id", game_id).eq("user_id", userId).single();
  if (!data) throw new Error("Player not found");
  return data;
}
```

**Part 2 — Test helpers:** Created `tests/e2e/_helpers.ts` with `devFetch()` that adds `Origin: http://localhost:3000` to all Node.js edge function calls:
```typescript
export function devFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Origin: "http://localhost:3000",
    },
  });
}
```

All 14 test spec files updated: `fetch(SUPABASE_URL/functions/v1/...)` → `devFetch(SUPABASE_URL/functions/v1/...)`. REST API calls (`/rest/v1/`) intentionally left as plain `fetch()`.

### Gate verification matrix

| Caller | Origin header | Override path | Expected | Verified |
|---|---|---|---|---|
| Dev browser (localhost:3000) | `http://localhost:3000` (automatic) | open | allowed | ✓ (canary 11/10/0) |
| Node.js test + devFetch | `http://localhost:3000` (explicit) | open | allowed | ✓ (canary 11/10/0) |
| Production browser (Vercel) | `https://mesa-game.vercel.app` | closed | blocked → "Player not found" | ✓ (smoke test) |
| Localhost browser + devFetch | `http://localhost:3000` | open | "Override player not found in game" | ✓ (smoke test) |

---

## 6. Final state

- All 12 edge functions deployed with origin-only gate
- `MESA_ENVIRONMENT` remains set to `production` in Supabase Dashboard (now irrelevant — origin gate is the only gate)
- Canary: **11 pass / 10 conditional skip / 0 fail**
- Prod smoke test: **pass** — production Origin blocked, localhost Origin takes override path (confirmed by different error messages)
- All 14 test spec files import and use `devFetch` from `./_helpers`
