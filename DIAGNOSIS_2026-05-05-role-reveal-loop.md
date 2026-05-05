# DIAGNOSIS: Role Reveal Modal Infinite Loop (Dev Mode)
**Date:** 2026-05-05
**Status:** Diagnosis only — no code changes

---

## Root Cause

**File:** `components/game/GameBoard.tsx:447-455`
**File:** `supabase/functions/acknowledge-role/index.ts` — `resolvePlayer`

`handleAcknowledge` silently discards `invokeWithRetry`'s return value:

```typescript
const handleAcknowledge = async () => {
  if (!effectiveCurrentPlayer) return;
  const pid = effectiveCurrentPlayer.id;
  setPlayers((prev) => prev.map((p) => (p.id === pid ? { ...p, role_revealed: true } : p)));
  await invokeWithRetry("acknowledge-role", {
    game_id: gameId,
    ...(devMode ? { override_player_id: pid } : {}),
  });
  // return value discarded — invokeWithRetry errors are silently ignored
};
```

The 3s poll (`GameBoard.tsx:114`) does a **full replace** of `players` state from the DB on every tick:
```typescript
if (p && p.length > 0) setPlayers(p);  // overwrites optimistic updates
```

When the edge function fails → DB is not updated → the next poll restores `role_revealed: false` → `showRoleReveal` flips back to true → modal reappears → infinite loop.

---

## When the Edge Function Fails in Dev Mode

`acknowledge-role` `resolvePlayer` contains a security check on the override path:

```typescript
if (override_player_id && Deno.env.get("MESA_ENVIRONMENT") !== "production") {
  const { data } = await admin.from("players").select("*")
    .eq("id", override_player_id).eq("game_id", game_id).single();
  if (!data) throw new Error("Override player not found in game");
  if (data.user_id !== userId) throw new Error("Dev override denied");  // ← FAILS HERE
  return data;
}
```

The check `data.user_id !== userId` compares:
- `data.user_id` = the switched-to player's Supabase `user_id` (set when they joined)
- `userId` = the JWT caller's `user_id` (the host's auth session)

In a **real multi-player dev game** (host + others who joined from separate browser sessions), each player has a different `user_id`. When the host switches to another player via DevModeOverlay and clicks Acknowledge:
- `override_player_id` = the other player's ID
- `data.user_id` = other player's `user_id` ≠ host's `user_id`
- Check throws `"Dev override denied"` → HTTP 400
- `invokeWithRetry` returns `{ data: null, error: { status: 400, message: "Dev override denied" } }`
- `handleAcknowledge` discards this
- DB not updated → loop begins

**Host's own player** never loops because `data.user_id === userId` always passes for the host's own player.

---

## Why Fill Lobby Does NOT Trigger the Loop

Fill Lobby creates all 6 players with the **same `user_id`** (the host's anonymous auth user). So `data.user_id === userId` for every player — the `resolvePlayer` check always passes — `acknowledge-role` succeeds for every player when switched to. No loop in Fill Lobby.

---

## Why the Prod Smoke Test Didn't Catch It

The prod smoke test (`tests/e2e/prod-smoke.spec.ts`) uses **6 separate browser contexts**, each with its own Supabase auth session and its own JWT. No `override_player_id` is passed (devMode is false in production). Each context acknowledges its own player using the non-override path (`.single()` on its own `user_id` — exactly 1 row per context). No user_id mismatch possible.

---

## Why E2E Tests Pass

The `dismissModal` helper:
```typescript
async function dismissModal(page) {
  const visible = await page.getByRole("button", { name: "Acknowledge" }).isVisible({ timeout: 3000 }).catch(() => false);
  if (visible) await page.getByRole("button", { name: "Acknowledge" }).click();
}
```

This clicks the button → optimistic update fires → modal hides. Tests proceed immediately without waiting 3+ seconds for the next poll. The loop doesn't manifest within the test execution window. Tests use Fill Lobby (all same `user_id`), so the edge function succeeds anyway.

---

## Contributing Factor: Modal Z-Index Design

`RoleRevealModal.tsx:99`:
```tsx
{/* z-index kept below DevModeOverlay (z-50=50) so the player switcher remains clickable */}
<div style={{ ..., zIndex: 40 }} />
```

The dim wash is intentionally z-40, below DevModeOverlay (z-50). The player switcher is **always clickable** even when a modal is showing. This is correct behavior (you need to be able to switch players to acknowledge each one), but it means you can switch players without acknowledging — leaving previous players with `role_revealed: false` in the DB.

---

## Full Loop Trace

```
[devMode game, real multi-user, host switches to P2]
1. setActiveDevPlayer(P2)
2. effectiveCurrentPlayer = syncedActiveDevPlayer → P2 (role_revealed: false from DB)
3. showRoleReveal = true → modal shows for P2
4. User clicks Acknowledge
5. setPlayers(optimistic: P2 role_revealed: true) → modal hides
6. invokeWithRetry("acknowledge-role", { override_player_id: P2_id })
7. Edge function: data.user_id(P2) !== userId(host) → throws "Dev override denied" → 400
8. invokeWithRetry returns { data: null, error: {...} }
9. handleAcknowledge discards return value — no error handling
10. DB: P2.role_revealed still false
11. 3s poll fires: setPlayers(serverData) → P2.role_revealed = false (from DB)
12. showRoleReveal = !false = true → modal reappears
→ goto 4 — infinite loop
```

---

## Proposed Fix Options

**Option A (most correct): Handle invokeWithRetry errors in handleAcknowledge**
```typescript
const { error } = await invokeWithRetry("acknowledge-role", { ... });
if (error) {
  // rollback optimistic update
  setPlayers((prev) => prev.map((p) => (p.id === pid ? { ...p, role_revealed: false } : p)));
  console.error("acknowledge-role failed:", error);
}
```
Prevents the loop and surfaces the error. Doesn't fix the underlying cause but breaks the cycle.

**Option B (fix the edge function): Relax the user_id check in dev override**

The `data.user_id !== userId` check in `resolvePlayer` is redundant defense-in-depth. The real security gate for production is `MESA_ENVIRONMENT !== "production"` — if that env var is set, the override path is never reachable. Removing the `user_id` check for the override path, or replacing it with just a log, fixes the root cause:

```typescript
if (override_player_id && Deno.env.get("MESA_ENVIRONMENT") !== "production") {
  const { data } = await admin.from("players").select("*")
    .eq("id", override_player_id).eq("game_id", game_id).single();
  if (!data) throw new Error("Override player not found in game");
  // user_id check removed — security already gated by MESA_ENVIRONMENT
  return data;
}
```

**Option C (belt + suspenders): Both A and B**
Fix both: surface errors in the client AND relax the redundant edge function check. This is the most robust approach and matches the security model already in place.

**Recommendation:** Option B alone is sufficient and is the minimal change. The `user_id !== userId` check in dev override adds no real security (a malicious user could call the edge function directly if they have the game_id and a valid JWT anyway — they just need to hit the Supabase functions URL). Option A is defensive programming against future edge function regressions. Both together (C) is the right call.

---

## Not Part of This Bug

- No React stale closure issue (`handleAcknowledge` is not memoized, recreated fresh each render)
- No issue with `syncedActiveDevPlayer` derivation — it correctly reflects latest `players` state
- No issue in Fill Lobby (all same user_id, override always succeeds)
- No issue in prod (override path never taken, MESA_ENVIRONMENT=production)
