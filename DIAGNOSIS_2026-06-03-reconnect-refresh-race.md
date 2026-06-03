# Diagnosis: Phase 2 LobbyPhase regression + Phase 3 card-reveal race

**Created:** 2026-06-03  
**Status:** Phase 2 regression confirmed; Phase 3 race mechanism documented.  
**Requires user review before any further autonomous implementation.**

---

## Step 1 Triage Results

| Test | Isolated result | Conclusion |
|------|----------------|------------|
| `abort-mission.spec.ts:175` | **FAILS** (37.7s, `waitForURL` timeout) | Real regression |
| `mission-flow.spec.ts:122` | **FAILS** (0ms, `waitForURL` timeout) | Real regression |
| `virus-system.spec.ts:404` | **PASSES** (37.8s) | Full-suite contention flake — not a regression |

---

## Regression A — LobbyPhase start-game navigation broken (Phase 2)

### Symptom

Both tests fail at `page.waitForURL` (30s timeout) after clicking "Start Game" from the lobby. Screenshot confirms: 6-player lobby renders, "Start Game" button in loading state (`...`), page never navigates. This means `invokeWithRetry("start-game")` returned success but the resulting `games UPDATE` Realtime event was either not received or not acted upon.

### Root cause

Supabase Realtime has a documented 1-3s window after the `SUBSCRIBED` status fires during which the replication listener is not yet fully ready. Events (e.g., `games UPDATE` from `start-game`) that land during this window are **silently dropped** — they are never delivered to the client.

**Before Phase 2**: a 2s polling backup ran continuously. Even if the `games UPDATE` was dropped, the poll fired within 2s, fetched `games.phase`, found it was not `'lobby'`, and called `router.push(gameUrl)`. Navigation always happened.

**After Phase 2**: the 2s polling backup was removed. The reconnect-refresh fires **once** on SUBSCRIBED — at subscription setup time, before Start Game is ever clicked. It finds `phase='lobby'`, does not navigate. Later, when Start Game runs and changes the phase, the `games UPDATE` event fires. If this event lands in the Supabase replication-ready window (1-3s after the SUBSCRIBED that fired at component mount), it is dropped. No polling backup catches it. Navigation never happens.

Tests that fill a lobby and click Start Game immediately are especially vulnerable because the lobby subscription was established and `SUBSCRIBED` fired just seconds before Start Game is clicked — the replication listener may not be fully ready yet.

### Specific Phase 2 change that introduced the regression

In `components/game/phases/LobbyPhase.tsx`, the original poll useEffect was removed:
```js
// REMOVED in Phase 2:
const poll = async () => {
  const [{ data: p }, { data: s }, { data: g }] = await Promise.all([...]);
  if (p) setPlayers(p);
  if (s) setSpectators(s);
  if (g && g.phase !== "lobby") router.push(gameUrl); // ← this was the safety net
};
const id = setInterval(poll, 2000);
```

The reconnect-refresh added in Phase 2 only fires on SUBSCRIBED (once at mount, then again only on reconnect), not continuously. It cannot recover a dropped event on an otherwise-stable connection.

### Fix recommendation (for user to review)

**Option A — Targeted one-shot delayed check (preferred, minimal change):** After the SUBSCRIBED reconnect-refresh runs and finds `phase='lobby'`, schedule a single 3s delayed re-check of `games.phase`. This covers the Supabase replication-ready window without re-introducing continuous polling. Cancel it on component unmount.

```js
// Inside the 'SUBSCRIBED' callback, after applying state:
if (!gPhase || gPhase === "lobby") {
  const timer = setTimeout(async () => {
    if (cancelled) return;
    const { data: g2 } = await supabase.from("games").select("phase").eq("id", gameId).single();
    if (!cancelled && g2 && g2.phase !== "lobby") router.push(gameUrl);
  }, 3000);
  // store timer ref for cleanup if needed
}
```

**Option B — Restore the 2s poll for phase-change only:** Restore a poll (2s interval) that ONLY checks `games.phase` and navigates if not 'lobby'. Stop it when the component unmounts. This re-introduces minimal polling but is reliable and well-understood.

This fix must go into LobbyPhase.tsx as a SEPARATE commit from any Phase 3 or Phase 4 work. It is technically a Phase 2 bugfix.

---

## Regression B — GameBoard reconnect-refresh race (Phase 3, card-reveal:201)

### Symptom

`card-reveal.spec.ts:201` was PASSING (15.5s) before Phase 3, now FAILS (15s assertion timeout on "Card Reveal" heading not visible). Both `card-reveal:132` and `card-reveal:201` now fail at the same assertion (`waitFor('heading Card Reveal')`) rather than card-reveal:132's previous failure mode (DevQueueInspector overlay intercept).

### Mechanism diagnosis (confirming all of a/b/c from task spec)

**Reading GameBoard.tsx as shipped in commit 1fba3b0:**

**(a) No ordering guard between setGame calls:**

The reconnect-refresh `setGame`:
```js
// Reconnect-refresh (lines ~242-244 in GameBoard.tsx):
if (g) {
  const gGame = g as unknown as Partial<Game>;
  setGame((prev) => ({ ...prev, ...gGame }));
```

The games UPDATE subscription handler `setGame`:
```js
// Subscription UPDATE handler (lines ~141-143):
const newGame = payload.new as Partial<Game>;
setGame((prev) => ({ ...prev, ...newGame }));
```

Both write the same game state fields (including `phase`). There is NO generation counter, no in-flight flag, no ordering guard. Either call can overwrite the other's result.

**(b) Genuinely async window — the awaits that create interleaving opportunity:**

Inside the `channel.subscribe(async (status) => {...})` callback:
```js
await supabase.auth.getSession();        // await 1: network call ~50-200ms
if (cancelled) return;
const { data: g } = await supabase.from("games")...single();  // await 2: ~50-200ms
if (cancelled) return;
const [{ data: p }, { data: m }, ... ] = await Promise.all([  // await 3: ~50-200ms
  ...three parallel queries...
]);
```

Each await is a genuine async suspension. Total window between SUBSCRIBED firing and setGame being called: **150-600ms typical, up to several seconds on slow Supabase cold starts.** A subscription event can and does arrive during this window.

**(c) Overwrite direction is possible — reconnect-refresh can carry stale phase:**

The reconnect-refresh fetches `games` at the MOMENT of `SUBSCRIBED`. In the failing test scenario:

1. GameBoard mounts, subscription `setup()` runs
2. SUBSCRIBED fires at ~T+200ms after `setup()`
3. Reconnect-refresh starts: `await getSession()` → `await games.select("*")` 
4. During these awaits, the `beforeAll` calls `select-mission` → server transitions `phase = 'card_reveal'`
5. `games UPDATE` fires → subscription handler: `setGame({...prev, phase: 'card_reveal'})`
6. Reconnect-refresh fetch completes → its `g` snapshot has `phase = 'mission_selection'` (captured at step 3)
7. `setGame((prev) => ({...prev, ...gGame}))` overwrites `phase = 'mission_selection'` — REGRESSION

The "Card Reveal" heading disappears (or never appears if step 5's render is also missed) because the UI phase reverts. Playwright's 15s `waitFor` poll (every 100ms) may miss the brief card_reveal window if the revert happens within the same render cycle.

### Fix (as specified by task: generation counter approach)

Use a `useRef` counter incremented on every games subscription event received. The reconnect-refresh captures the counter value at fetch start and skips `setGame` (for game/players/mission — NOT log) if the counter has advanced, meaning a live subscription event arrived during the fetch and already has newer state.

Log IS applied unconditionally because game_log is append-only dedup — applying stale log entries is safe (the dedup skips already-present IDs).

---

## Implementation order (for user to approve)

1. **Phase 2 bugfix** — fix LobbyPhase start-game navigation (Option A or B above). Separate commit. Re-run abort-mission:175 and mission-flow:122 in isolation to confirm fix.
2. **Phase 3 fix** — add generation counter to GameBoard.tsx reconnect-refresh. Separate commit. Re-run card-reveal:201 in isolation.
3. **Full suite** — run with all three fixes in place. Gate to Phase 4.
4. **Phase 4** — only if gate passes.

---

## card-reveal:201 — at-mount stale-snapshot overwrite (distinct from interleaved race)

**Status:** Code-confirmed. Fix not implemented — requires user architecture decision.

### (a) The at-mount reconnect-refresh can apply a snapshot fetched before the first subscription event, with no event to bump the generation counter

`GameBoard.tsx` line 232–264 (the `channel.subscribe` async callback):

```js
channel.subscribe(async (status) => {
  if (status === "SUBSCRIBED" && !cancelled) {
    // ← LINE 236: genAtStart captured HERE, at the moment SUBSCRIBED fires
    const genAtStart = subEventGenRef.current;

    await supabase.auth.getSession();          // ← LINE 237: await 1 (~50–200ms)
    if (cancelled) return;
    const { data: g } = await supabase.from("games")...single();  // ← LINE 243: await 2 (~50–200ms)
    if (cancelled) return;
    const [{ data: p }, { data: m }, { data: recentLog }] = await Promise.all([...]); // ← LINE 246: await 3

    if (cancelled) return;
    if (subEventGenRef.current === genAtStart) {  // ← LINE 255: GUARD — only skips if counter advanced DURING lines 237–253
      if (g) { setGame((prev) => ({ ...prev, ...gGame })); ... }  // ← LINES 258–260
      if (p && p.length > 0) setPlayers(p);                        // ← LINE 263
      if (m !== undefined) setMission(m);                          // ← LINE 264
    }
  }
});
```

**Structural confirmation:** `genAtStart` is assigned at line 236, AFTER the SUBSCRIBED event fires. Supabase Realtime may buffer subscription events that arrived while the WebSocket JOIN handshake was in progress and deliver them at the SUBSCRIBED moment — before line 236. In that case, `subEventGenRef.current` is already incremented, and `genAtStart` captures the post-event value. If no NEW events fire during the three async awaits (lines 237–253), the guard at line 255 evaluates `N === N` and PASSES — applying the snapshot unconditionally, even if the snapshot is stale due to Postgres read-after-write lag on the `games.select("*")` query at line 243.

Separately: if SUBSCRIBED fires early (before any game state transition has occurred), the snapshot at line 243 is correct at fetch time but retroactively becomes stale once a subsequent state transition fires an event that is then dropped. In that case `genAtStart=0`, no events fire during the window (the transition event fires AFTER the reconnect-refresh completes or is dropped entirely), guard passes, snapshot applied — and the snapshot persists as the last-written state with no fallback to correct it.

**Both paths result in the at-mount snapshot being the sole authoritative write on the client**, with no mechanism to supersede it.

### (b) This snapshot overwrites authoritative game/players/mission state — overwrite trace

When the guard at line 255 passes (`subEventGenRef.current === genAtStart`), the following writes are unconditional:

- **`phase`** overwritten via `setGame` at line 258–260:
  ```js
  setGame((prev) => ({ ...prev, ...gGame }));
  ```
  `gGame` is the full `games` row spread from the snapshot. Every field — including `phase`, `core_progress`, `escape_timer`, `pending_mission_options`, `turn_order_ids`, `current_turn_player_id` — is overwritten.

- **`role_revealed` (and all player fields)** overwritten via `setPlayers` at line 263:
  ```js
  if (p && p.length > 0) setPlayers(p);
  ```
  `p` is the complete snapshot of all player rows. `role_revealed` (which is a column on `players`) is part of this overwrite. If the snapshot has `role_revealed=false` and a subscription event had previously set it to `true` (e.g., via an `acknowledge-role` UPDATE that arrived before the reconnect-refresh), the snapshot write at line 263 silently reverts it.

- **Mission state** overwritten via line 264:
  ```js
  if (m !== undefined) setMission(m);
  ```

**Specific card-reveal:201 failure:** The at-mount snapshot has `phase=mission_selection` (correct at T=mount). After the reconnect-refresh applies this, the test calls `select-mission`. The `games UPDATE` with `phase=card_reveal` either (a) fires but has already incremented `subEventGenRef.current` before `genAtStart` was captured (so guard passes on next reconnect, stale snapshot wins), or (b) is dropped in the Supabase 1–3s post-SUBSCRIBED dead zone with no polling fallback to recover it. Either way, the client's `phase` stays at `mission_selection`. The "Card Reveal" heading never renders. Test times out at 15s.

**Role Reveal Modal:** The modal (rendered at `GameBoard.tsx` line 885) is conditioned on `!effectiveCurrentPlayer.role_revealed && game.phase !== "lobby"`. The modal is an absolutely-positioned SVG overlay (z-index 40) — Playwright's `getByRole("heading")` + `waitFor({state: "visible"})` checks CSS visibility, not z-index occlusion, so the modal alone does NOT block Playwright from finding the "Card Reveal" heading. The failure is the heading not being rendered at all because `game.phase` remains `mission_selection`.

### (c) Generation-counter guard structurally cannot catch this

**Confirmed: the guard cannot protect against the at-mount overwrite.**

The guard at line 255 is:
```js
if (subEventGenRef.current === genAtStart) { /* apply */ }
```

The guard logic is: "if no subscription events arrived DURING this reconnect-refresh's async window, apply the snapshot." The async window is lines 237–253 (the three await points).

**Why it cannot protect:**

- Events that fire **before line 236** (before `genAtStart` is captured): these increment `subEventGenRef.current` before it's captured. `genAtStart` then equals the already-incremented value. No new events fire during lines 237–253 → guard evaluates `N === N` → PASSES → stale snapshot applied.

- Events that fire **after line 264** (after the snapshot is applied): too late to guard anything. If the event then fires and corrects the state, fine. If the event is dropped, the stale snapshot persists indefinitely because SUBSCRIBED will not fire again on a stable connection, and the polling fallback (Phase 1's 3s setInterval) was removed in Phase 3.

The guard was designed to handle the **interleaved race**: event fires BETWEEN `genAtStart` capture and the guard check (lines 236–255). That increments the counter to `M > genAtStart=N`, guard sees `M !== N`, skips the stale apply. This works correctly for that case.

The **at-mount case** escapes the guard because the event either fires before the window opens (pre-line-236) or after the window closes (post-line-264), or never fires at all (dropped). None of these paths produce a `subEventGenRef.current > genAtStart` condition at the guard check.

---

## Architecture decision required

This is the **third overwrite-or-missing-write race** from the reconnect-refresh acting as a second writer of subscription-owned state:

1. **LobbyPhase merge race (Phase 2, fixed):** reconnect-refresh overwrote correct phase after start-game.
2. **Interleaved-event race (Phase 3, generation counter in working tree):** subscription event fired during reconnect-refresh async window; reconnect-refresh overwrote it with stale fetch.
3. **At-mount stale-snapshot (this section, card-reveal:201):** reconnect-refresh fires before or concurrent with a game state transition; snapshot becomes stale and either overwrites correct state or is the sole writer when the follow-on event is dropped.

The root cause in all three cases is the same: **the reconnect-refresh and the subscription event handlers are independent writers of the same React state, with no protocol governing who is authoritative.**

### OPTION 1 — Add an at-mount-specific guard (another targeted patch)

**Mechanism:** On the very first SUBSCRIBED (initial mount), skip the reconnect-refresh's `setGame`/`setPlayers`/`setMission` apply entirely. Trust the SSR `initialGame`/`initialPlayers`/`initialMission` props for the first connection. Only apply the snapshot on subsequent SUBSCRIBED transitions (reconnects), where state may have genuinely diverged.

Implement via a `hasConnectedOnce = useRef(false)` flag: if `!hasConnectedOnce.current` → set it `true`, skip the apply, continue to log-only. On reconnects: apply as normal.

**Trade-off:**
- Pros: Minimal diff, solves the at-mount overwrite case completely.
- Cons: On the very first load, if SSR props are stale (e.g., slow CDN edge cache serving a cached page to a game already in mid-mission), the first SUBSCRIBED would not refresh game state. The subscription events would eventually correct it, but the first render could show stale SSR state until an event arrives. Also adds a third guard mechanic (alongside the generation counter and the existing `cancelled` flag) — increasing conceptual complexity.

### OPTION 2 — Redesign the writer: make the reconnect-refresh read-only / merge-safe

**Mechanism:** The reconnect-refresh should not be an unconditional writer. Instead, it should only apply fields that subscription events have NOT already delivered. Concretely:

- For `games`: only apply non-phase fields (e.g., `core_progress`, `escape_timer`, `turn_order_ids`) from the snapshot. Leave `phase` and `current_turn_player_id` to the subscription events. `phase` is the highest-risk field — if the reconnect-refresh applies a stale `phase`, the entire UI reverts.
- For `players`: only apply fields that are stable between events (e.g., `display_name`, `role`, `cpu`, `ram`, `turn_order`) and skip volatile fields (`role_revealed`, `has_revealed_card`, `skip_next_turn`) — these are subscription-owned.
- For `mission`: safe to apply fully (mission rows are append-only; the subscription delivers INSERTs, not UPDATEs).

Alternatively: define a `stableFields` whitelist per table that the reconnect-refresh is allowed to apply, and route volatile fields exclusively through subscription events. For reconnect recovery, the reconnect-refresh applies the stable fields; volatile fields come from events. If an event is dropped (volatile field not updated), the next reconnect's refresh can recover it — only one reconnect cycle of stale state rather than permanent stale.

**Trade-off:**
- Pros: Addresses the root cause architecturally. The reconnect-refresh becomes a structural complement to the subscription (recovers stable state), not a competitor (overwriting volatile state). No per-scenario guards needed.
- Cons: Requires determining which fields are "stable" vs "volatile" per table — a non-trivial audit. Risk of forgetting a field (volatile field left in stable list → overwrite regression; stable field removed from reconnect-refresh → loss of recovery for that field on reconnect). More invasive change than Option 1.
