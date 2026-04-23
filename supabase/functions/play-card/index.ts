// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MISSION_REQUIREMENTS: Record<string, { compute?: number; data?: number; validation?: number }> = {
  data_cleanup: { data: 4, compute: 3 },
  basic_model_training: { compute: 4, data: 2 },
  dataset_preparation: { data: 4, compute: 1 },
  cross_validation: { compute: 2, validation: 3 },
  distributed_training: { compute: 5 },
  balanced_compute_cluster: { compute: 4, data: 2 },
  dataset_integration: { compute: 4, data: 3 },
  multi_model_ensemble: { compute: 4, data: 3, validation: 2 },
  synchronized_training: { compute: 5, validation: 1 },
  genome_simulation: { compute: 5, data: 3, validation: 1 },
  global_research_network: { compute: 6, data: 4, validation: 1 },
  experimental_vaccine_model: { compute: 5, data: 3, validation: 2 },
};

// Active AI plays one card from hand to contribute to the active mission.
// Body: { game_id, card_id: string, override_player_id?: string }
// override_player_id is only honoured in non-production environments when the
// caller owns every player in the game (dev mode single-user testing).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, card_id, override_player_id } = await req.json();
    if (!game_id || !card_id) throw new Error("game_id and card_id required");

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

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");

    // Verify card is in player's hand
    const { data: handCard } = await admin
      .from("hands").select("*").eq("id", card_id).eq("player_id", callerPlayer.id).single();
    if (!handCard) throw new Error("Card not in your hand");
    if (handCard.card_type !== "progress") throw new Error("Only progress cards can contribute to a mission");

    // Get active mission
    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).single();
    if (!mission) throw new Error("No active mission");

    // Enforce CPU limit: count non-failed contributions by this player this round
    const { count: cardsPlayedThisTurn } = await admin
      .from("mission_contributions")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", mission.id)
      .eq("player_id", callerPlayer.id)
      .eq("round", mission.round)
      .eq("failed", false);

    if ((cardsPlayedThisTurn ?? 0) >= callerPlayer.cpu) {
      throw new Error(`CPU limit reached — you may play at most ${callerPlayer.cpu} cards this turn`);
    }

    // Update mission contribution counts
    const countUpdates: Record<string, number> = {};
    if (handCard.card_key === "compute") {
      countUpdates.compute_contributed = mission.compute_contributed + 1;
    } else if (handCard.card_key === "data") {
      countUpdates.data_contributed = mission.data_contributed + 1;
    } else if (handCard.card_key === "validation") {
      countUpdates.validation_contributed = mission.validation_contributed + 1;
    }
    await admin.from("active_mission").update(countUpdates).eq("id", mission.id);

    // Turn sequence = position in turn_order_ids (1-based)
    const turnSeq = ((game.turn_order_ids as string[]).indexOf(callerPlayer.id) + 1);
    await admin.from("mission_contributions").insert({
      mission_id: mission.id,
      player_id: callerPlayer.id,
      card_key: handCard.card_key,
      card_type: handCard.card_type,
      round: mission.round,
      turn_sequence: turnSeq,
      failed: false,
    });

    // Remove from hand; mark a deck_card as discarded (card consumed by mission)
    await admin.from("hands").delete().eq("id", card_id);
    const { data: deckCard } = await admin
      .from("deck_cards").select("id")
      .eq("game_id", game_id).eq("card_key", handCard.card_key).eq("status", "drawn")
      .limit(1).maybeSingle();
    if (deckCard) {
      await admin.from("deck_cards").update({ status: "discarded" }).eq("id", deckCard.id);
    }

    // Increment turn play count for virus generation calculation
    await admin.from("games")
      .update({ turn_play_count: game.turn_play_count + 1 })
      .eq("id", game_id);

    await admin.from("game_log").insert({
      game_id,
      event_type: "card_played",
      public_description: `${callerPlayer.display_name} contributed ${handCard.card_key.replace(/_/g, " ")}.`,
    });

    // Return updated mission state for client convenience
    const updatedMission = { ...mission, ...countUpdates };
    const reqs = MISSION_REQUIREMENTS[mission.mission_key] ?? {};
    const missionComplete =
      (updatedMission.compute_contributed ?? 0) >= (reqs.compute ?? 0) &&
      (updatedMission.data_contributed ?? 0) >= (reqs.data ?? 0) &&
      (updatedMission.validation_contributed ?? 0) >= (reqs.validation ?? 0);

    return new Response(JSON.stringify({ success: true, mission_complete: missionComplete }), {
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
  admin: ReturnType<typeof createClient>,
  game_id: string,
  userId: string,
  override_player_id?: string,
): Promise<any> {
  if (override_player_id && Deno.env.get("MESA_ENVIRONMENT") !== "production") {
    // Verify caller owns every player in this game — only true in dev mode games.
    const { count } = await admin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game_id)
      .neq("user_id", userId);
    if ((count ?? 1) !== 0) throw new Error("Dev override denied");

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
