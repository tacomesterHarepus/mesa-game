# Design: Human Abort Vote (Round 2)

Status: **Step 1 — schema + diagnosis only. No code applied.** Review before step 2.

---

## Authoritative spec

- Any human may FLAG abort during Round 2, **except** during the last AI's turn of Round 2 (flag button hidden/disabled — mission resolves after that turn regardless).
- Flagging does nothing immediately. The current AI turn completes fully, including virus resolution.
- At the turn boundary **after** virus resolution, IF a flag is set AND the mission is still active, a 30-second abort vote opens (Abort / Continue) and the next AI turn is held back.
- Vote resolves when **all** humans have voted (immediately, no waiting out the timer) OR 30s elapses. Uncast votes = Continue.
- Abort happens if `votes_for_abort > humanCount / 2` (true majority — with 2 humans, both must vote abort; with 3 humans, 2 suffice).
- On continue / no-majority: the next AI turn proceeds normally.
- On abort: mission fails with the normal penalty (reuse existing `abort-mission` fail logic).

---

## 1. Schema design

### Proposed migration: `018_abort_vote.sql`

```sql
-- games table additions
alter table games
  add column if not exists abort_flag_pending boolean not null default false,
  add column if not exists abort_vote_deadline timestamptz,
  add column if not exists abort_flag_player_id uuid references players;

-- New abort_votes table for per-human votes during the abort_vote phase.
-- Mirrors the secret_target_votes pattern but scoped to game_id rather than
-- a per-resolution-queue-row ID, since abort votes are not tied to a queue item.
create table if not exists abort_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  voter_player_id uuid not null references players,
  vote text not null check (vote in ('abort', 'continue')),
  created_at timestamptz not null default now(),
  unique (game_id, voter_player_id)
);

create index on abort_votes (game_id);

alter table abort_votes enable row level security;

-- Abort votes are not secret — all players in the game can see them.
-- (Humans are cooperating; no hidden-alignment information involved.)
create policy "abort votes readable by players"
  on abort_votes for select
  using (is_player_in_game(game_id));

-- Only human players may insert votes.
create or replace function is_human_in_game(gid uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from players
    where game_id = gid and user_id = auth.uid() and role = 'human'
  );
$$;

create policy "humans can vote abort"
  on abort_votes for insert
  with check (is_human_in_game(game_id));
```

### Column inventory

| Column | Type | Purpose |
|--------|------|---------|
| `games.abort_flag_pending` | `boolean NOT NULL DEFAULT false` | Set true when any human flags; cleared when vote resolves or mission resolves naturally |
| `games.abort_vote_deadline` | `timestamptz` | Set to `now() + 30s` when `abort_vote` phase opens; null otherwise |
| `games.abort_flag_player_id` | `uuid REFERENCES players` | First human who flagged; for log/display only; cleared with the flag |

### Why not reuse `secret_target_votes`

`secret_target_votes` has `resolution_id uuid REFERENCES virus_resolution_queue` and `target_player_id` — both are meaningless for abort votes. The `unique(resolution_id, voter_player_id)` constraint naturally scopes votes to a queue row; abort votes have no equivalent anchor. Reusing the table would require either nulling out those NOT NULL FKs (schema violation) or repurposing them as abuse.

A dedicated `abort_votes` table with `unique(game_id, voter_player_id)` is clean. Consequence: old votes from a previous vote window (if a game somehow has two abort votes) share the same unique key as new ones and must be deleted with `DELETE FROM abort_votes WHERE game_id = ?` before opening a new window. This is a one-line DELETE — acceptable.

### New phase: `abort_vote`

Add `'abort_vote'` to the set of valid `games.phase` values. No schema constraint enforces this (phase is an unconstrained `text`), so no migration change needed beyond the column additions above. The phase state machine entry:

```
virus_resolution → [CAS: between_turns] → abort_vote  (flag set, mission active, round 2)
                                         → player_turn (normal path)

player_turn → [no viruses] → abort_vote  (same condition)
                           → player_turn (normal path)

abort_vote → player_turn      (vote resolved: continue / no majority)
           → resource_adjustment (vote resolved: abort — same as abort-mission path)
```

---

## 2. Turn-boundary injection points

There are **two distinct code paths** where `advanceTurnOrPhase` is called after a player turn ends. The abort vote check must be injected at both.

### Path A — via `resolve-next-virus` (virus path)

**File:** `supabase/functions/resolve-next-virus/index.ts`
**Lines:** 69–92

Current code (the CAS empty-queue branch):

```ts
// Lines 73–84: CAS guard
const { data: claimed } = await admin
  .from("games")
  .update({ phase: "between_turns" })
  .eq("id", game_id)
  .eq("phase", "virus_resolution")
  .select("id");
if (!claimed?.length) { /* loser — return no-op */ }

// Lines 86–92: CAS winner — advance
await refillVirusPool(admin, game_id);
const { data: freshGame } = await admin.from("games").select("*").eq("id", game_id).single();
const missionResolved = !freshGame.current_mission_id;
const fakeCurrentPlayer = { id: game.current_turn_player_id };
const pendingOutcome = (freshGame.pending_mission_outcome ?? null) as MissionOutcome | null;
return await advanceTurnOrPhase(admin, freshGame, fakeCurrentPlayer, missionResolved, pendingOutcome ?? undefined);
```

**Injection point:** Between line 87 (`await refillVirusPool(...)`) and line 92 (`return await advanceTurnOrPhase(...)`), after `freshGame` is re-fetched.

**Condition:** `!missionResolved && freshGame.current_round === 2 && freshGame.abort_flag_pending`

**Why this is safe:** The CAS guard (`UPDATE WHERE phase='virus_resolution'`) ensures exactly one concurrent caller wins and proceeds. `phase` is already `between_turns` when we reach this check — no second caller can claim the CAS again. `freshGame` is re-fetched AFTER the CAS wins, so `abort_flag_pending` reflects the true DB state at this moment. No race.

### Path B — via `end-play-phase` (no-virus path)

**File:** `supabase/functions/end-play-phase/index.ts`
**Lines:** 203–206

Current code:

```ts
// Line 204: apply game updates
await admin.from("games").update(gameUpdates).eq("id", game_id);
const updatedGame = { ...game, ...gameUpdates };
// Line 206: advance
return await advanceTurnOrPhase(admin, updatedGame, callerPlayer, missionResolved, missionOutcomeForTransition);
```

**Injection point:** Between line 204 (the `.update(gameUpdates)` commit) and line 206 (`return await advanceTurnOrPhase(...)`).

**Condition:** `!missionResolved && updatedGame.current_round === 2 && game.abort_flag_pending`

Note: `abort_flag_pending` is not in `gameUpdates`, so `updatedGame.abort_flag_pending` inherits from `game.abort_flag_pending`. The field can be read directly from `game` (fetched at line 67 of `end-play-phase`).

**Why there is no race here:** `end-play-phase` validates `callerPlayer.id === game.current_turn_player_id` (line 72). Only the active AI can call it. No concurrent callers can reach this path for the same turn. No CAS needed.

### What happens at the injection point

When the condition is met, instead of calling `advanceTurnOrPhase`, the function:
1. Deletes old abort_votes rows for this game_id (clear previous window).
2. Sets `games.phase = 'abort_vote'`, `abort_vote_deadline = now() + interval '30 seconds'`, `abort_flag_pending = false`, `abort_flag_player_id = null`.
3. Logs an `abort_vote_started` game_log event.
4. Returns `{ success: true }`.

The next AI turn is held back until the vote resolves.

### Mission-active vs mission-resolved at the boundary

Both paths compute `missionResolved` before reaching the injection point:

- **Path A:** `missionResolved = !freshGame.current_mission_id` (line 89 of resolve-next-virus). `current_mission_id` is nulled by `end-play-phase` when mission completes or fails (lines 104, 125), and stored in `pending_mission_outcome` for the virus path. If mission resolved, `freshGame.current_mission_id` is null → `missionResolved = true` → injection condition is false → normal `advanceTurnOrPhase` path, no vote.

- **Path B:** `missionResolved` is explicitly set in `end-play-phase` lines 99–135. If `missionComplete` is true OR if it's the last player of round 2 with unmet requirements, `missionResolved = true`. Injection condition requires `!missionResolved`, so the vote only opens during mid-round-2 turns where mission remains live.

**Result:** the vote never opens after a mission completion or natural failure. The `abort_flag_pending` flag on `games` will also need to be explicitly cleared whenever mission resolves naturally — in `end-play-phase`'s `missionResolved = true` branch and in `advanceTurnOrPhase`'s `missionResolved` branch (the `resource_adjustment` transition block at line 155). Add `abort_flag_pending: false, abort_flag_player_id: null` to those update calls.

---

## 3. Penalty reuse from `abort-mission`

**File:** `supabase/functions/abort-mission/index.ts`

The penalty application is lines 51–73:

```ts
const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
const newEscapeTimer = game.escape_timer + penalty;

await resetPlayersForNextMission(admin, game_id);
// log mission_aborted with penalty
const gameUpdates = {
  escape_timer: newEscapeTimer,
  current_mission_id: null,
  pending_mission_options: [],
  turn_play_count: 0,
};
await admin.from("games").update(gameUpdates).eq("id", game_id);
const updatedGame = { ...game, ...gameUpdates };
return await advanceTurnOrPhase(admin, updatedGame, { id: game.current_turn_player_id }, true, "aborted");
```

`MISSION_FAIL_PENALTIES` is defined locally in `abort-mission/index.ts` (lines 6–12). The same map exists in `end-play-phase/index.ts` (lines 29–35) — currently duplicated.

**Reuse plan:** Move `MISSION_FAIL_PENALTIES` and the penalty-application block into `_shared/advanceTurnOrPhase.ts` as an exported helper:

```ts
// _shared/advanceTurnOrPhase.ts (proposed addition)
export const MISSION_FAIL_PENALTIES: Record<string, number> = { ... };

export async function applyMissionAbort(
  admin: any,
  game: any,
  mission: any,
): Promise<Response> {
  const game_id = game.id;
  const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
  const newEscapeTimer = game.escape_timer + penalty;
  await resetPlayersForNextMission(admin, game_id);
  // log mission_aborted
  const gameUpdates = { escape_timer: newEscapeTimer, current_mission_id: null, pending_mission_options: [], turn_play_count: 0, abort_flag_pending: false, abort_flag_player_id: null };
  await admin.from("games").update(gameUpdates).eq("id", game_id);
  const updatedGame = { ...game, ...gameUpdates };
  return await advanceTurnOrPhase(admin, updatedGame, { id: game.current_turn_player_id }, true, "aborted");
}
```

Then:
- `abort-mission/index.ts` calls `applyMissionAbort(admin, game, mission)` (replacing lines 51–73)
- New `resolve-abort-vote/index.ts` calls `applyMissionAbort(admin, game, mission)` on abort outcome

This eliminates the penalty duplication between `abort-mission` and `end-play-phase`, and gives the vote-resolution function a clean one-call abort path with no logic to duplicate.

Note: `resetPlayersForNextMission` currently lives locally in both `abort-mission/index.ts` and `end-play-phase/index.ts`. It should also be moved to `_shared` as part of this refactor — it's 5 lines and is already duplicated.

---

## 4. Last-turn-of-round-2 detection

### Server-side (end-play-phase, line 116–120)

```ts
const turnOrderIds: string[] = game.turn_order_ids ?? [];
const currentIdx = turnOrderIds.indexOf(callerPlayer.id);
const isLastPlayer = currentIdx >= turnOrderIds.length - 1;

if (isLastPlayer && mission.round === 2) { /* mission fails */ }
```

The "last player" is defined as `currentIdx >= turnOrderIds.length - 1`: the player at the final position in `turn_order_ids`. When this player ends their turn in round 2 without mission completion, the mission fails immediately — there is no subsequent turn boundary for an abort vote to open.

### Client-side (flag button suppression)

The flag button must be hidden when the active player is the last in turn order AND the round is 2:

```ts
const isLastTurnOfRound2 =
  game.current_round === 2 &&
  game.turn_order_ids[game.turn_order_ids.length - 1] === game.current_turn_player_id;
```

This is deterministic from `game.turn_order_ids`, `game.current_turn_player_id`, and `game.current_round` — all available from the game state subscription in `GameBoard.tsx`.

**Where to apply:** In `PlayerTurn.tsx`, the existing Abort section starts at line 553: `{isHuman && round === 2 && (...)`. The flag button (not the existing `ABORT MISSION` button — that entire button is being redesigned) should include `&& !isLastTurnOfRound2`.

**Skipped-player edge case:** `advanceTurnOrPhase` skips players with `skip_next_turn = true` (lines 188–204). If the last-indexed player is being skipped, `end-play-phase` would not trigger mission failure on the second-to-last player (their `isLastPlayer = false`). The second-to-last player's turn boundary would reach `advanceTurnOrPhase`, which would skip the last player and fall through to "Round 2 last player — mission should have resolved above" (line 277), returning `{ success: true }` without advancing to `resource_adjustment`. This is a pre-existing gap, not introduced by this mechanic. The abort vote design does not need to handle it specially — if the flag is set, the condition `!missionResolved && round === 2 && abort_flag_pending` is still checked. The abort vote would open normally if the second-to-last player triggers the turn boundary with the flag set.

---

## 5. New edge functions needed (step 2)

These are enumerated here for planning — NOT implemented yet:

| Function | Purpose |
|----------|---------|
| `flag-abort` | Human sets `abort_flag_pending = true` on games; validates: `phase = 'player_turn'`, `current_round = 2`, caller is human, caller's game has `!isLastTurnOfRound2` |
| `submit-abort-vote` | Human submits vote ('abort' or 'continue'); inserts into `abort_votes`; if all humans have voted OR `force_resolve: true`, resolves the vote (applies abort or advances turn) |

`submit-abort-vote` mirrors `secret-target/index.ts` in structure: vote submission + conditional auto-resolution when quorum reached. The timeout path (`force_resolve: true`) is called from the `AbortVote` client component when its local countdown hits 0, same as the `SecretTargeting` countdown pattern.

No `unflag-abort` function — the spec has no unflag mechanic. Once flagged, the vote opens at the next turn boundary.

---

## 6. Summary of files to modify in step 2

| File | Change |
|------|--------|
| `supabase/migrations/018_abort_vote.sql` | New migration (written above; NOT applied yet) |
| `supabase/functions/_shared/advanceTurnOrPhase.ts` | Export `MISSION_FAIL_PENALTIES`, `applyMissionAbort`, move `resetPlayersForNextMission` here |
| `supabase/functions/resolve-next-virus/index.ts` | Inject abort vote check at the CAS winner path (lines 87–92) |
| `supabase/functions/end-play-phase/index.ts` | Inject abort vote check before `advanceTurnOrPhase` (lines 204–206); clear flag on mission resolve |
| `supabase/functions/abort-mission/index.ts` | Refactor to call `applyMissionAbort` from `_shared` |
| `supabase/functions/flag-abort/index.ts` | New function |
| `supabase/functions/submit-abort-vote/index.ts` | New function |
| `components/game/phases/PlayerTurn.tsx` | Replace ABORT MISSION button with FLAG ABORT button; add `isLastTurnOfRound2` suppression |
| `components/game/phases/AbortVote.tsx` | New phase component (30s countdown, Abort/Continue buttons for humans, waiting message for AIs) |
| `components/game/GameBoard.tsx` | Add `abort_vote` case to `renderPhase()`; pass flag state to `PlayerTurn` |

---

## Open questions for review

1. **Who can unflag?** Spec says no unflag — confirm this is intentional.
2. **Vote display:** Should humans see each other's votes in real time (e.g. "1/2 voted abort"), or only the outcome? Recommend showing live counts (same as `secret_target_votes` are visible to misaligned players) to make the 30s feel active.
3. **Flag visible to AIs?** The AI players can see the game log — should the "flag raised" event be in the public log, or silent? Recommend silent (don't telegraph human consensus state to misaligned AIs watching the log).
4. **`abort_flag_pending` clearing:** The flag must be cleared on natural mission resolution. Currently planned in step 2 as additions to `end-play-phase` (missionResolved paths) and `advanceTurnOrPhase` (resource_adjustment transition). Confirm this covers all paths where `current_mission_id` goes null.
5. **Realtime:** The `AbortVote` phase component needs Realtime on `abort_votes` for live vote display. `GameBoard.tsx` already subscribes to `games` — the `abort_vote_deadline` and phase change will arrive via the existing game subscription. The votes table needs a new subscription.
