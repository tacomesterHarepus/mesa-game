// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceTurnOrPhase, corsHeaders } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert } from "../_shared/gameLogTypes.ts";

const MISSION_FAIL_PENALTIES: Record<string, number> = {
  data_cleanup: 1, basic_model_training: 1,
  dataset_preparation: 1, cross_validation: 1, distributed_training: 1,
  balanced_compute_cluster: 2, dataset_integration: 2, multi_model_ensemble: 2,
  synchronized_training: 2, genome_simulation: 2,
  global_research_network: 3, experimental_vaccine_model: 3,
};

// Human aborts the mission during round 2. Applies the normal fail penalty,
// then transitions to resource_adjustment (same path as end-of-round-2 failure).
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
    if (game.current_round !== 2) throw new Error("Abort only valid in round 2");
    if (!game.current_mission_id) throw new Error("No active mission");

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.role !== "human") throw new Error("Only humans can abort the mission");

    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).maybeSingle();
    if (!mission) throw new Error("Active mission record not found");

    const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
    const newEscapeTimer = game.escape_timer + penalty;

    await resetPlayersForNextMission(admin, game_id);
    const missionAbortedLog: GameLogInsert<"mission_aborted"> = {
      game_id,
      event_type: "mission_aborted",
      public_description: `Mission aborted by humans. Escape Timer +${penalty}. (${newEscapeTimer}/8)`,
      metadata: { mission_key: mission.mission_key, penalty, new_timer: newEscapeTimer, aborted_by_player_id: callerPlayer.id },
    };
    await admin.from("game_log").insert(missionAbortedLog);

    const gameUpdates = {
      escape_timer: newEscapeTimer,
      current_mission_id: null,
      pending_mission_options: [],
      turn_play_count: 0,
    };
    await admin.from("games").update(gameUpdates).eq("id", game_id);

    const updatedGame = { ...game, ...gameUpdates };
    const currentTurnPlayer = { id: game.current_turn_player_id };
    return await advanceTurnOrPhase(admin, updatedGame, currentTurnPlayer, true, "aborted");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function resetPlayersForNextMission(admin: any, game_id: string) {
  await admin.from("players").update({
    has_revealed_card: false,
    revealed_card_key: null,
  }).eq("game_id", game_id).neq("role", "human");
}

async function resolvePlayer(
  admin: ReturnType<typeof createClient>,
  game_id: string,
  userId: string,
  override_player_id?: string,
): Promise<any> {
  if (override_player_id && Deno.env.get("MESA_ENVIRONMENT") !== "production") {
    const { data } = await admin
      .from("players").select("*")
      .eq("id", override_player_id).eq("game_id", game_id).single();
    if (!data) throw new Error("Override player not found in game");
    if (data.user_id !== userId) throw new Error("Dev override denied");
    return data;
  }

  const { data } = await admin
    .from("players").select("*")
    .eq("game_id", game_id).eq("user_id", userId).single();
  if (!data) throw new Error("Player not found");
  return data;
}
