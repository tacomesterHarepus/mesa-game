// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceTurnOrPhase, applyMissionAbort, corsHeaders } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert } from "../_shared/gameLogTypes.ts";

// Human submits an abort vote, or force-resolves the vote after the timeout.
// Body: { game_id, vote?: "abort" | "continue", force_resolve?: boolean, override_player_id?: string }
//
// Normal path: caller is human, vote is "abort" or "continue".
//   - Upserts their vote into abort_votes.
//   - If all humans have voted, auto-resolves immediately.
//   - Otherwise returns { success: true, waiting: true }.
//
// Force-resolve path: force_resolve=true (client fires when countdown hits 0).
//   - Tallies current votes (uncast = continue).
//   - CAS guard prevents double-resolution.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, vote, force_resolve, override_player_id } = await req.json();
    if (!game_id) throw new Error("game_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId: string = payload.sub;
    if (!userId) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: game } = await admin.from("games").select("*").eq("id", game_id).single();
    if (!game) throw new Error("Game not found");
    if (game.phase !== "abort_vote") throw new Error("Not in abort_vote phase");

    const callerPlayer = await resolvePlayer(req, admin, game_id, userId, override_player_id);

    const { count: humanCount } = await admin.from("players")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game_id).eq("role", "human");
    const totalHumans = humanCount ?? 0;

    // ── Vote submission (non-force path) ──────────────────────────────────────
    if (!force_resolve) {
      if (callerPlayer.role !== "human") throw new Error("Only humans can vote on abort");
      if (!vote || !["abort", "continue"].includes(vote)) throw new Error("vote must be 'abort' or 'continue'");

      await admin.from("abort_votes").upsert({
        game_id,
        voter_player_id: callerPlayer.id,
        vote,
      }, { onConflict: "game_id,voter_player_id" });

      // Auto-resolve if all humans have now voted.
      const { count: voteCount } = await admin.from("abort_votes")
        .select("id", { count: "exact", head: true })
        .eq("game_id", game_id);

      if ((voteCount ?? 0) >= totalHumans) {
        return await resolveVote(admin, game, totalHumans);
      }

      return new Response(JSON.stringify({ success: true, waiting: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Force-resolve path (timeout expired) ─────────────────────────────────
    return await resolveVote(admin, game, totalHumans);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function resolveVote(admin: any, game: any, totalHumans: number): Promise<Response> {
  const game_id = game.id;

  // Capture flag player ID before CAS clears it.
  const flagPlayerIdForLog = game.abort_flag_player_id ?? "";

  // CAS guard: only one concurrent caller (e.g. all-voted auto-resolve vs force_resolve)
  // wins the transition. The loser returns a no-op.
  const { data: claimed } = await admin
    .from("games")
    .update({ phase: "between_turns", abort_vote_deadline: null, abort_flag_player_id: null })
    .eq("id", game_id)
    .eq("phase", "abort_vote")
    .select("id");

  if (!claimed?.length) {
    return new Response(JSON.stringify({ success: true, skipped: "vote_already_resolved" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Tally votes (uncast votes count as "continue").
  const { data: votes } = await admin.from("abort_votes")
    .select("vote").eq("game_id", game_id);
  const votesForAbort = (votes ?? []).filter((v: any) => v.vote === "abort").length;
  const doAbort = votesForAbort > totalHumans / 2;

  const { data: freshGame } = await admin.from("games").select("*").eq("id", game_id).single();

  const voteResolvedLog: GameLogInsert<"abort_vote_resolved"> = {
    game_id,
    event_type: "abort_vote_resolved",
    public_description: doAbort
      ? `Abort vote passed (${votesForAbort}/${totalHumans}). Mission aborted.`
      : `Abort vote failed (${votesForAbort}/${totalHumans}). Mission continues.`,
    metadata: { outcome: doAbort ? "abort" : "continue", votes_for_abort: votesForAbort, total_humans: totalHumans },
  };
  await admin.from("game_log").insert(voteResolvedLog);

  if (doAbort) {
    const { data: mission } = await admin.from("active_mission").select("*")
      .eq("id", freshGame.current_mission_id).maybeSingle();
    if (!mission) throw new Error("Active mission not found");
    return await applyMissionAbort(admin, freshGame, mission, flagPlayerIdForLog);
  }

  // Continue path: advance to next AI turn.
  const fakeCurrentPlayer = { id: freshGame.current_turn_player_id };
  return await advanceTurnOrPhase(admin, freshGame, fakeCurrentPlayer, false, undefined);
}

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
