// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GameLogInsert, CardType, MissionProgress } from "../_shared/gameLogTypes.ts";

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
    if (!callerPlayer.has_discarded_this_turn) throw new Error("Must complete discard step before playing cards");

    // Verify card is in player's hand
    const { data: handCard } = await admin
      .from("hands").select("*").eq("id", card_id).eq("player_id", callerPlayer.id).single();
    if (!handCard) throw new Error("Card not in your hand");
    if (handCard.card_type !== "progress") throw new Error("Only progress cards can contribute to a mission");

    // Get active mission
    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).single();
    if (!mission) throw new Error("No active mission");

    const specialState: Record<string, any> = { ...(mission.special_state ?? {}) };
    const cardKey: string = handCard.card_key;

    // ── Virus state: dependency_error blocks Compute ───────────────────────────
    if (specialState.dependency_error_active === true && cardKey === "compute") {
      throw new Error("Dependency Error active — Compute is blocked until a Data card is contributed");
    }

    // ── Player's existing contributions for this mission (all rounds) ──────────
    const { data: playerContribsData } = await admin
      .from("mission_contributions").select("card_key")
      .eq("mission_id", mission.id).eq("player_id", callerPlayer.id).eq("failed", false);
    const playerContribs: Array<{ card_key: string }> = playerContribsData ?? [];

    // ── Enforce CPU limit (per-turn) ───────────────────────────────────────────
    const { count: cardsPlayedThisTurn } = await admin
      .from("mission_contributions")
      .select("id", { count: "exact", head: true })
      .eq("mission_id", mission.id)
      .eq("player_id", callerPlayer.id)
      .eq("round", mission.round)
      .eq("failed", false);

    // Experimental Vaccine Model caps to 1 card per turn in the final round
    let cpuLimit = callerPlayer.cpu;
    if (mission.mission_key === "experimental_vaccine_model" && mission.round === 2) {
      cpuLimit = Math.min(cpuLimit, 1);
    }

    if ((cardsPlayedThisTurn ?? 0) >= cpuLimit) {
      const msg = mission.mission_key === "experimental_vaccine_model" && mission.round === 2
        ? "Experimental Vaccine Model: only 1 card per turn in the final round"
        : `CPU limit reached — you may play at most ${cpuLimit} card${cpuLimit !== 1 ? "s" : ""} this turn`;
      throw new Error(msg);
    }

    // ── Mission special rules ─────────────────────────────────────────────────
    const ruleError = checkMissionSpecialRules(mission, cardKey, playerContribs, specialState);
    if (ruleError) throw new Error(ruleError);

    // ── Pipeline Breakdown: 50% fail chance ───────────────────────────────────
    const pipelineActive = specialState.pipeline_breakdown_active === true;
    const failed = pipelineActive && Math.random() < 0.5;

    // Consume card from hand regardless of pipeline outcome
    await admin.from("hands").delete().eq("id", card_id);
    const { data: deckCard } = await admin
      .from("deck_cards").select("id")
      .eq("game_id", game_id).eq("card_key", cardKey).eq("status", "drawn")
      .limit(1).maybeSingle();
    if (deckCard) {
      await admin.from("deck_cards").update({ status: "discarded" }).eq("id", deckCard.id);
    }

    const turnSeq = ((game.turn_order_ids as string[]).indexOf(callerPlayer.id) + 1);
    await admin.from("mission_contributions").insert({
      mission_id: mission.id,
      player_id: callerPlayer.id,
      card_key: cardKey,
      card_type: handCard.card_type,
      round: mission.round,
      turn_sequence: turnSeq,
      failed,
    });

    // Pipeline failure path: clear flag, log, return early (counts don't update)
    if (failed) {
      specialState.pipeline_breakdown_active = false;
      await admin.from("active_mission").update({ special_state: specialState }).eq("id", mission.id);
      const failedMissionProgress: MissionProgress = {
        compute: mission.compute_contributed,
        data: mission.data_contributed,
        validation: mission.validation_contributed,
      };
      const failedCardLog: GameLogInsert<"card_played"> = {
        game_id,
        event_type: "card_played",
        public_description: `${callerPlayer.display_name}'s ${cardKey.replace(/_/g, " ")} contribution failed! (Pipeline Breakdown)`,
        metadata: {
          actor_player_id: callerPlayer.id,
          card_key: cardKey,
          card_type: cardKey as CardType,
          failed: true,
          mission_progress: failedMissionProgress,
          failure_reason: "pipeline_breakdown",
        },
      };
      await admin.from("game_log").insert(failedCardLog);
      return new Response(
        JSON.stringify({ success: true, failed: true, mission_complete: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Update mission contribution counts ────────────────────────────────────
    const countUpdates: Record<string, number> = {};
    if (cardKey === "compute") countUpdates.compute_contributed = mission.compute_contributed + 1;
    else if (cardKey === "data") countUpdates.data_contributed = mission.data_contributed + 1;
    else if (cardKey === "validation") countUpdates.validation_contributed = mission.validation_contributed + 1;

    // ── Update special_state ──────────────────────────────────────────────────
    if (pipelineActive) specialState.pipeline_breakdown_active = false;
    // Clear dependency_error when Data is successfully contributed
    if (specialState.dependency_error_active === true && cardKey === "data") {
      specialState.dependency_error_active = false;
    }
    // Record which round Compute was first played for Synchronized Training
    if (mission.mission_key === "synchronized_training" && cardKey === "compute") {
      if (specialState.compute_round == null) specialState.compute_round = mission.round;
    }

    await admin.from("active_mission")
      .update({ ...countUpdates, special_state: specialState }).eq("id", mission.id);

    // Increment turn play count for virus generation calculation
    await admin.from("games")
      .update({ turn_play_count: game.turn_play_count + 1 }).eq("id", game_id);

    // ── Check mission completion ──────────────────────────────────────────────
    const updatedMission = { ...mission, ...countUpdates };

    const successMissionProgress: MissionProgress = {
      compute: updatedMission.compute_contributed ?? 0,
      data: updatedMission.data_contributed ?? 0,
      validation: updatedMission.validation_contributed ?? 0,
    };
    const cardPlayedLog: GameLogInsert<"card_played"> = {
      game_id,
      event_type: "card_played",
      public_description: `${callerPlayer.display_name} contributed ${cardKey.replace(/_/g, " ")}.`,
      metadata: {
        actor_player_id: callerPlayer.id,
        card_key: cardKey,
        card_type: cardKey as CardType,
        failed: false,
        mission_progress: successMissionProgress,
      },
    };
    await admin.from("game_log").insert(cardPlayedLog);
    const reqs = MISSION_REQUIREMENTS[mission.mission_key] ?? {};
    const requirementsMet =
      (updatedMission.compute_contributed ?? 0) >= (reqs.compute ?? 0) &&
      (updatedMission.data_contributed ?? 0) >= (reqs.data ?? 0) &&
      (updatedMission.validation_contributed ?? 0) >= (reqs.validation ?? 0);

    let missionComplete = requirementsMet;

    // Distributed Training: requirements met, but also need ≥3 distinct contributors
    if (requirementsMet && mission.mission_key === "distributed_training") {
      const { data: allContribs } = await admin
        .from("mission_contributions").select("player_id")
        .eq("mission_id", mission.id).eq("failed", false);
      const uniqueContributors = new Set((allContribs ?? []).map((c: any) => c.player_id));
      if (uniqueContributors.size < 3) missionComplete = false;
    }

    return new Response(
      JSON.stringify({ success: true, mission_complete: missionComplete }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Mission special rule validator ────────────────────────────────────────────

function checkMissionSpecialRules(
  mission: any,
  cardKey: string,
  playerContribs: Array<{ card_key: string }>,
  specialState: Record<string, any>,
): string | null {
  const playerCompute = playerContribs.filter((c) => c.card_key === "compute").length;
  const playerData = playerContribs.filter((c) => c.card_key === "data").length;
  const playerValidation = playerContribs.filter((c) => c.card_key === "validation").length;
  const playerTotal = playerContribs.length;

  switch (mission.mission_key) {
    case "dataset_preparation":
      // Compute locked until all 4 Data are contributed
      if (cardKey === "compute" && mission.data_contributed < 4) {
        return "Dataset Preparation: Compute cannot be played until all 4 Data are contributed";
      }
      break;

    case "cross_validation":
      // Each Validation must be played by a different AI
      if (cardKey === "validation" && playerValidation >= 1) {
        return "Cross Validation: you have already contributed a Validation card this mission";
      }
      break;

    case "balanced_compute_cluster":
      // Each AI may contribute at most 2 cards total
      if (playerTotal >= 2) {
        return "Balanced Compute Cluster: you may contribute at most 2 cards total";
      }
      break;

    case "dataset_integration":
      // Each Data card unlocks 2 global Compute slots; Compute blocked until slots available
      if (cardKey === "compute") {
        const slotsAvailable = mission.data_contributed * 2;
        if (mission.compute_contributed >= slotsAvailable) {
          return `Dataset Integration: Compute slots full — contribute more Data to unlock slots (${mission.compute_contributed}/${slotsAvailable} used)`;
        }
      }
      break;

    case "multi_model_ensemble":
      // Each AI may play at most 1 Data and 1 Validation; Compute is unlimited
      if (cardKey === "data" && playerData >= 1) {
        return "Multi-Model Ensemble: you have already contributed a Data card this mission";
      }
      if (cardKey === "validation" && playerValidation >= 1) {
        return "Multi-Model Ensemble: you have already contributed a Validation card this mission";
      }
      break;

    case "synchronized_training":
      // All Compute must be played in the same round; locked once first Compute sets the round
      if (cardKey === "compute" && specialState.compute_round != null && specialState.compute_round !== mission.round) {
        return `Synchronized Training: all Compute must be played in the same round (locked to round ${specialState.compute_round})`;
      }
      break;

    case "genome_simulation":
      // Validation must be the final contribution — only playable when Compute + Data are done
      if (cardKey === "validation" && (mission.compute_contributed < 5 || mission.data_contributed < 3)) {
        return "Genome Simulation: Validation must be the final contribution — complete Compute and Data requirements first";
      }
      break;

    case "global_research_network":
      // Each AI may contribute at most 3 of any one resource type
      if (cardKey === "compute" && playerCompute >= 3) {
        return "Global Research Network: you have already contributed 3 Compute cards (maximum per AI)";
      }
      if (cardKey === "data" && playerData >= 3) {
        return "Global Research Network: you have already contributed 3 Data cards (maximum per AI)";
      }
      if (cardKey === "validation" && playerValidation >= 3) {
        return "Global Research Network: you have already contributed 3 Validation cards (maximum per AI)";
      }
      break;

    // distributed_training: no per-card block; ≥3 contributor rule checked at completion only
    // experimental_vaccine_model: round-2 cap handled via cpuLimit before this function
  }

  return null;
}

// ── Player resolution (dev mode override) ─────────────────────────────────────

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
