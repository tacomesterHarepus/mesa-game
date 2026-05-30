// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert } from "../_shared/gameLogTypes.ts";

// Human flags abort intent during an AI's turn in round 2.
// Sets abort_flag_pending = true on the game; does not interrupt the current turn.
// The vote window opens at the next turn boundary (end-play-phase or resolve-next-virus).
// Body: { game_id, override_player_id?: string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, override_player_id } = await req.json();
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
    if (game.phase !== "player_turn") throw new Error("Not in player_turn phase");
    if ((game.current_round ?? 1) !== 2) throw new Error("Abort flag only valid in round 2");
    if (!game.current_mission_id) throw new Error("No active mission");

    const callerPlayer = await resolvePlayer(req, admin, game_id, userId, override_player_id);
    if (callerPlayer.role !== "human") throw new Error("Only humans can flag abort");

    // Block flagging on the last turn of round 2 — mission resolves naturally after that turn.
    const turnOrderIds: string[] = game.turn_order_ids ?? [];
    const isLastTurnOfRound2 = turnOrderIds[turnOrderIds.length - 1] === game.current_turn_player_id;
    if (isLastTurnOfRound2) throw new Error("Cannot flag abort on last turn of round 2");

    // Idempotent: if already flagged, return success without duplicate log.
    if (game.abort_flag_pending) {
      return new Response(JSON.stringify({ success: true, already_flagged: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("games").update({
      abort_flag_pending: true,
      abort_flag_player_id: callerPlayer.id,
    }).eq("id", game_id);

    // Fetch mission key for the log (flag stores the key, not the UUID).
    const { data: mission } = await admin
      .from("active_mission").select("mission_key").eq("id", game.current_mission_id).maybeSingle();

    const flagLog: GameLogInsert<"abort_flagged"> = {
      game_id,
      event_type: "abort_flagged",
      public_description: `${callerPlayer.display_name} flagged for abort — vote will open after this turn.`,
      metadata: { flagging_player_id: callerPlayer.id, mission_key: mission?.mission_key ?? "" },
    };
    await admin.from("game_log").insert(flagLog);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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
