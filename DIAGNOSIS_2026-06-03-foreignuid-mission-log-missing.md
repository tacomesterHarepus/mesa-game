# DIAGNOSIS: Foreign-UID browser — mission panel NONE + game_log frozen

**Date:** 2026-06-04  
**Symptom:** A real independently-joined player (foreign `user_id`, not a Fill Lobby bot, no dev mode) does a hard refresh during an active game and sees: (1) mission panel shows NONE, (2) game_log frozen at "Game started". Host/dev window is unaffected.  
**Regression window:** Before 2026-06-02 everything worked; broke in the 06-02/06-03 work.

---

## (a) Server-render path for foreign-uid player

`app/game/[gameId]/page.tsx` uses `createClient()` from `lib/supabase/server.ts` — the SSR client that reads the user's cookie-based JWT. For a foreign-uid anonymous-auth player this JWT is valid and their `user_id` is in `players` with the correct `game_id`.

```
page.tsx (server render):
  supabase.from("games").select("*").single()          → initialGame (current_mission_id may be null)
  supabase.from("players").select("*")                 → initialPlayers
  supabase.from("active_mission").eq("id", missionId)  → initialMission  ← only if current_mission_id ≠ null
  supabase.from("game_log").order("created_at").limit(100) → initialLog
```

**Key finding in advanceTurnOrPhase.ts (lines 151–160):** On successful mission completion, `current_mission_id` is explicitly set to **`null`**:

```typescript
const missionCloseUpdates = {
  core_progress: newProgress,
  current_mission_id: null,   // ← cleared on success
  ...
};
```

The same null-clear happens in `applyMissionAbort` (line 399).  
`current_mission_id` stays `null` from mission-complete until `select-mission` runs and inserts a new `active_mission` row.

**Conclusion for (a):** If the foreign-uid player hard-refreshes *during any phase between missions* (`resource_adjustment`, `mission_selection`, `card_reveal`, `resource_allocation`) — which is the common case mid-game — the server render receives `current_mission_id = null`, skips the `active_mission` fetch, and sets `initialMission = null`. This is correct server-side behaviour; the bug is that nothing reliably recovers it on the client.

---

## (b) Recovery paths after SUBSCRIBED — mission vs game_log vs working fields

After the Realtime channel reports `SUBSCRIBED`, the reconnect-refresh runs (`GameBoard.tsx` lines 241–316):

```typescript
const genAtStart = subEventGenRef.current;
// ... async fetches (games, players, mission, log, hand) ...
if (subEventGenRef.current === genAtStart) {   // ← gen guard
  setGame(stable fields only — NOT current_mission_id);
  setPlayers(...);
  if (m !== undefined) setMission(m);          // ← inside gen guard
  setHand(...);
}
// game_log applied unconditionally — outside gen guard
if (recentLog && recentLog.length > 0) {
  setLog(prev => dedup-append(prev, recentLog));
}
```

**Fields that DO update correctly for foreign-uid:**

| Field | Source | Why it's correct |
|-------|--------|-----------------|
| `core_progress` | `initialGame` (server render) + games UPDATE Realtime | Accurate at render time; live updates via Realtime games UPDATE spread-all |
| `virus_pool_count` | Same | `setGame((prev) => ({ ...prev, ...newGame }))` spreads all fields |
| Player roster | `initialPlayers` (server render) + players UPDATE Realtime | Same spread-all handler |

**Fields that DO NOT recover:**

| Field | Why it fails |
|-------|-------------|
| `current_mission_id` in game state | Not in the stable-field apply list (commit 1b0a32d omitted it). Recovered only by Realtime games UPDATE spread — works IF the mission starts after the dead zone |
| `mission` (active_mission row) | `setMission(m)` is **inside the gen guard** — blocked when any event fires during async fetches |
| `game_log` new entries | Applied unconditionally in reconnect-refresh ✓, but only for entries at SUBSCRIBED time. If player joined early (only "Game started" existed), subsequent entries must arrive via Realtime INSERT |

**The active_mission UPDATE handler compounds the problem:**

```typescript
// GameBoard.tsx line ~182
setMission((prev) =>
  prev ? { ...prev, ...(payload.new as Partial<ActiveMission>) } : prev
);
```

When `prev = null`, the ternary short-circuits and returns `null`. Every `active_mission UPDATE` event (contribution counts changing during play) is a **silent no-op**. The only events that can set mission from `null` are `active_mission INSERT` and the reconnect-refresh `setMission(m)`.

---

## (c) RLS policies — no blocking of foreign-uid reads

Migration 001 (`is_player_in_game`):
```sql
select exists (
  select 1 from players where game_id = gid and user_id = auth.uid()
);
```

A real foreign-uid player who joined via invite link has their own row in `players` with `user_id = their_uid`. `is_player_in_game` returns **TRUE**. All relevant policies (`active mission readable`, `game log readable`) use this function and pass correctly.

Migration 022 changed nothing for `active_mission` or `game_log` — only dropped the `virus_pool` SELECT policy and removed `virus_pool` from the Realtime publication.  
Migration 023 adds a `hands` policy for dev host — irrelevant to this bug.

**RLS is not the cause.**

---

## (d) Git log walk — which commit introduced the regression

### The regression: commit 1fba3b0 (Phase 3, 2026-06-03)

Before this commit, `GameBoard.tsx` had a **3-second `setInterval` poll** that fetched:

```typescript
// removed in 1fba3b0:
const { data: g } = await supabase.from("games").select("*")...
setGame((prev) => ({ ...prev, ...g }));             // ALL fields — including current_mission_id

const [{ data: p }, { data: m }, { data: contrib }] = await Promise.all([
  supabase.from("players")...,
  supabase.from("active_mission").eq("id", missionId).maybeSingle(),
  supabase.from("mission_contributions")...,
]);
setMission(m);                                       // unconditional, every 3s

const { data: recentLog } = await supabase.from("game_log")...;
setLog(dedup-append);                               // unconditional, every 3s
```

This poll ran for **every user** regardless of Realtime delivery. It provided a 3-second recovery window for both `active_mission` and `game_log`.

Phase 3 replaced this with the **one-shot SUBSCRIBED reconnect-refresh**. The reconnect-refresh is strictly weaker:
- Runs **once per reconnect** (not every 3s)
- `setMission(m)` is inside the **gen guard** (added in commit 1b0a32d) — skipped if any Realtime event fires during its async fetches

### The compounding: commit 1b0a32d (stable/volatile split, 2026-06-03)

This commit fixed the card-reveal:201 race by introducing the gen counter guard. The guard correctly protects volatile fields (phase, current_turn_player_id) from being overwritten by stale reconnect-refresh data. But it has an unintended consequence:

**On the very first SUBSCRIBED event for an active game** — where Realtime events are arriving continuously (turns advancing, viruses resolving) — a subscription event is near-certain to fire during the ~500ms–2s of async fetches. The gen counter increments → the gen guard fires → `setMission(m)` is **skipped**.

This is the first SUBSCRIBED ever for this browser session. There is no retry: the useEffect deps (`[gameId, currentPlayer, devMode, activeDevPlayer?.id]`) are all stable for the foreign-uid browser — the effect runs exactly **once** and never re-triggers.

**Why the host/dev browser is not affected:**

The host's useEffect re-runs every time `activeDevPlayer?.id` changes (switching between bots in the PlayerSwitcher). Each switch tears down the old channel and calls `setup()` again → new SUBSCRIBED → new reconnect-refresh attempt. The host gets **many chances**; the foreign-uid player gets **one**.

---

## Exact failure sequence for foreign-uid player (most probable path)

```
t=0    Hard refresh. Server render:
         game.current_mission_id = null (between missions, or game just started)
         initialMission = null
         initialLog = ["Game started"]        ← only entry at this moment

t=0.5  JS hydrates. setup() begins.
         await supabase.auth.getSession()
         channel = supabase.channel("game-XXXX")
           .on(games UPDATE)
           .on(players UPDATE)
           .on(active_mission UPDATE)   ← no-op when prev=null
           .on(active_mission INSERT)   ← correct handler, but depends on event delivery
           .on(game_log INSERT)         ← correct handler, but game is quiet at this moment
           ...
         channel.subscribe()

t=1    status === "SUBSCRIBED" fires.
         genAtStart = 0
         async fetches begin: games, players, mission, log, hand

t=1.2  During fetches: host selects a mission.
         → games UPDATE event fires (current_mission_id = Y, phase = card_reveal)
         → subEventGenRef.current = 1                    ← gen guard will fire
         → active_mission INSERT event fires shortly after
              → setMission(payload.new) called ✓  (handled before gen guard check)
           [OR: INSERT event lands inside Supabase's 1-3s post-SUBSCRIBED dead zone → DROPPED]

t=1.8  Promise.all completes.
         g.current_mission_id = null (fetched at t=1, before select-mission)
         missionId = null → m = null
         recentLog = ["Game started"] (same entry)

         subEventGenRef.current (1) !== genAtStart (0)
         → gen guard fires → setMission(null) SKIPPED

         If active_mission INSERT was delivered (t=1.2 path A):
           mission = correct mission row ✓ (set directly by INSERT handler, not reconnect-refresh)
         If INSERT was in the dead zone (t=1.2 path B):
           mission = null ← permanently stuck

t=1.8+ Mission is active. Players start taking turns.
         active_mission UPDATE events fire on each card played.
         setMission((prev) => prev ? {...} : prev)
         prev = null → NO-OP. Mission state never recovers.

t=1.8+ game_log INSERT events fire on each turn_start, card_played, etc.
         setLog((prev) => [...prev, payload.new])
         These arrive correctly... IF Realtime is working.
         But if the player joined BEFORE turn_start events were logged,
         only "Game started" was in initialLog, and subsequent events
         must come via Realtime INSERT (no polling fallback).
```

**Path A (active_mission INSERT delivered):** Mission shows correctly, but this depends on the INSERT not landing in the post-SUBSCRIBED dead zone. This path is non-deterministic — explains why the bug is intermittent in some test runs but reproducible when the game advances quickly after a refresh.

**Path B (active_mission INSERT dropped):** Mission = null permanently (UPDATE no-op when prev=null). This is the consistently reproduced case: the foreign-uid player refreshes, the game immediately advances, INSERT lands in the dead zone, and mission can NEVER recover in this session.

---

## Summary: what broke and why

| # | Root cause | Introduced by | Severity |
|---|-----------|--------------|----------|
| 1 | 3s poll removed — was the only reliable repeating recovery for active_mission and game_log | 1fba3b0 (Phase 3) | **Critical** |
| 2 | Gen guard blocks `setMission(m)` on initial SUBSCRIBED when events arrive during async fetches | 1b0a32d (stable/volatile split) | **Critical** |
| 3 | `active_mission UPDATE` handler is a no-op when `prev = null` — UPDATE events can never recover from a missed INSERT | Pre-existing | High |
| 4 | Foreign-uid useEffect runs once (stable deps); host/dev re-runs on `activeDevPlayer?.id` change — host gets retries, foreign-uid does not | Pre-existing design | High |
| 5 | `current_mission_id` is set to `null` after mission completion — so refreshing between missions gives `initialMission = null`, amplifying #2 and #3 | Pre-existing design | Medium |

---

## Fix options (for user approval — not implemented)

### Option A: Restore a targeted poll for mission + game_log (minimal, surgical)

Add back a repeating fetch — not the full 3s poll, just the two items that have no other recovery path:

```typescript
// Every 5s: fetch current_mission_id + active_mission + recent game_log
// Only active when phase is player_turn / virus_resolution / etc.
```

Restores the pre-Phase-3 fallback for exactly the two failing items. Low risk.

### Option B: Fix the active_mission UPDATE handler null-state no-op

Change:
```typescript
// current:
setMission((prev) => prev ? { ...prev, ...(payload.new as Partial<ActiveMission>) } : prev)

// fix:
setMission((prev) => prev
  ? { ...prev, ...(payload.new as Partial<ActiveMission>) }
  : (payload.new as ActiveMission)
);
```

When `prev = null`, a full active_mission UPDATE payload contains the complete row — safe to assign directly. This means UPDATE events can recover from a missed INSERT. Partially fixes #3.

**Limitation:** If active_mission UPDATEs also fail to deliver (same Realtime condition that dropped the INSERT), this doesn't help. Requires a parallel fix for the initial INSERT drop.

### Option C: Remove the gen guard from the mission apply in reconnect-refresh

The gen guard was added to protect volatile fields (phase, current_turn_player_id) from stale overwrites. But mission (`active_mission` row) is not volatile — it only changes on INSERT (new mission starts) and is safe to overwrite from a fresh DB fetch. Separate mission from the gen guard:

```typescript
if (subEventGenRef.current === genAtStart) {
  setGame(stable fields);
  setPlayers(...);
  // setMission removed from here
  setHand(...);
}
// Apply mission unconditionally (like game_log):
if (m !== undefined) setMission(m);
```

This restores the pre-1b0a32d mission recovery behaviour without re-introducing the phase/current_turn_player_id stale-overwrite problem. High confidence, low risk.

### Option D: Extend phase-keepalive to also recover current_mission_id + mission

Modify the 2s phase-keepalive to additionally fetch `current_mission_id`. If it changed (null → non-null), fetch and set the mission. Covers the "between missions" gap.

More invasive than Option C but also recovers the case where the games UPDATE carrying `current_mission_id` is dropped.

### Recommended fix: Options B + C together

- **Option C** removes mission from the gen guard — reconnect-refresh always applies the fetched mission on SUBSCRIBED, closing the primary path (#2)
- **Option B** fixes the UPDATE no-op — if an INSERT is still missed in the dead zone, the next UPDATE event will set the full mission row, closing path #3

Together these restore equivalent reliability to the old 3s poll for mission, without reintroducing the card-reveal:201 race (volatile fields remain protected by the gen guard). Game_log already applies unconditionally and is unaffected.

**Open question on game_log freeze:** Whether game_log INSERT Realtime events are actually failing to deliver (vs. the log simply being correct at render time and the tester not observing live updates) should be confirmed by the user testing whether existing log entries update live after the fix. If game_log INSERTs are genuinely dropping (not just a "quiet game at refresh time" artifact), Option A (targeted poll backup) would be needed for game_log too.
