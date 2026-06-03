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
