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

const MISSION_REWARDS: Record<string, number> = {
  data_cleanup: 2, basic_model_training: 2,
  dataset_preparation: 3, cross_validation: 3, distributed_training: 3,
  balanced_compute_cluster: 4, dataset_integration: 4, multi_model_ensemble: 4,
  synchronized_training: 5, genome_simulation: 5,
  global_research_network: 6, experimental_vaccine_model: 6,
};

const MISSION_FAIL_PENALTIES: Record<string, number> = {
  data_cleanup: 1, basic_model_training: 1,
  dataset_preparation: 1, cross_validation: 1, distributed_training: 1,
  balanced_compute_cluster: 2, dataset_integration: 2, multi_model_ensemble: 2,
  synchronized_training: 2, genome_simulation: 2,
  global_research_network: 3, experimental_vaccine_model: 3,
};

// Active AI signals they are done playing cards and viruses for this turn.
// Phase 6 simplified: no virus resolution — advances turn order directly.
// Body: { game_id }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id } = await req.json();
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

    const { data: callerPlayer } = await admin
      .from("players").select("*").eq("game_id", game_id).eq("user_id", userId).single();
    if (!callerPlayer) throw new Error("Player not found");
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");

    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).single();
    if (!mission) throw new Error("No active mission");

    // Check mission complete
    const reqs = MISSION_REQUIREMENTS[mission.mission_key] ?? {};
    const missionComplete =
      mission.compute_contributed >= (reqs.compute ?? 0) &&
      mission.data_contributed >= (reqs.data ?? 0) &&
      mission.validation_contributed >= (reqs.validation ?? 0);

    if (missionComplete) {
      return await handleMissionSuccess(admin, game, mission);
    }

    // Advance turn order: find next player, skipping anyone with skip_next_turn
    const turnOrderIds: string[] = game.turn_order_ids ?? [];
    const currentIdx = turnOrderIds.indexOf(callerPlayer.id);
    let nextIdx = currentIdx + 1;

    while (nextIdx < turnOrderIds.length) {
      const nextPlayerId = turnOrderIds[nextIdx];
      const { data: nextPlayer } = await admin.from("players").select("*").eq("id", nextPlayerId).single();
      if (!nextPlayer) { nextIdx++; continue; }

      if (nextPlayer.skip_next_turn) {
        await admin.from("players").update({ skip_next_turn: false }).eq("id", nextPlayerId);
        await admin.from("game_log").insert({
          game_id,
          event_type: "turn_skipped",
          public_description: `${nextPlayer.display_name}'s turn was skipped.`,
        });
        nextIdx++;
        continue;
      }

      // This player goes next
      await admin.from("games").update({ current_turn_player_id: nextPlayerId }).eq("id", game_id);
      await admin.from("game_log").insert({
        game_id,
        event_type: "turn_start",
        public_description: `${nextPlayer.display_name}'s turn.`,
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // End of round
    if (mission.round === 1) {
      // Start round 2: reset to first player
      const firstPlayerId = turnOrderIds[0];
      let firstIdx = 0;
      while (firstIdx < turnOrderIds.length) {
        const pid = turnOrderIds[firstIdx];
        const { data: fp } = await admin.from("players").select("*").eq("id", pid).single();
        if (fp && !fp.skip_next_turn) break;
        if (fp?.skip_next_turn) {
          await admin.from("players").update({ skip_next_turn: false }).eq("id", pid);
          await admin.from("game_log").insert({
            game_id,
            event_type: "turn_skipped",
            public_description: `${fp.display_name}'s turn was skipped.`,
          });
        }
        firstIdx++;
      }
      const round2FirstPlayer = firstIdx < turnOrderIds.length ? turnOrderIds[firstIdx] : firstPlayerId;

      await admin.from("active_mission").update({ round: 2 }).eq("id", mission.id);
      await admin.from("games").update({
        current_turn_player_id: round2FirstPlayer,
        current_round: 2,
      }).eq("id", game_id);
      await admin.from("game_log").insert({
        game_id,
        event_type: "round_start",
        public_description: "Round 2 begins.",
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Round 2 over — mission failed
    return await handleMissionFailure(admin, game, mission);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleMissionSuccess(admin: any, game: any, mission: any) {
  const game_id = game.id;
  const reward = MISSION_REWARDS[mission.mission_key] ?? 2;
  const newProgress = game.core_progress + reward;
  const winner = newProgress >= 10 ? "humans" : null;

  await resetPlayersForNextMission(admin, game_id);

  if (winner) {
    await admin.from("games").update({
      phase: "game_over",
      winner: "humans",
      core_progress: newProgress,
      current_mission_id: null,
    }).eq("id", game_id);
    await admin.from("game_log").insert({
      game_id,
      event_type: "game_over",
      public_description: "Mission complete! Humans win!",
    });
  } else {
    await admin.from("games").update({
      phase: "resource_adjustment",
      core_progress: newProgress,
      current_mission_id: null,
      pending_mission_options: [],
    }).eq("id", game_id);
    await admin.from("game_log").insert({
      game_id,
      event_type: "mission_complete",
      public_description: `Mission complete! Core Progress +${reward}. (${newProgress}/10)`,
    });
  }

  return new Response(JSON.stringify({ success: true, mission_complete: true, winner }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleMissionFailure(admin: any, game: any, mission: any) {
  const game_id = game.id;
  const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
  const newTimer = game.escape_timer + penalty;
  const winner = newTimer >= 8 ? "misaligned" : null;

  await resetPlayersForNextMission(admin, game_id);

  if (winner) {
    await admin.from("games").update({
      phase: "game_over",
      winner: "misaligned",
      escape_timer: newTimer,
      current_mission_id: null,
    }).eq("id", game_id);
    await admin.from("game_log").insert({
      game_id,
      event_type: "game_over",
      public_description: "Mission failed! Misaligned AIs win!",
    });
  } else {
    await admin.from("games").update({
      phase: "resource_adjustment",
      escape_timer: newTimer,
      current_mission_id: null,
      pending_mission_options: [],
    }).eq("id", game_id);
    await admin.from("game_log").insert({
      game_id,
      event_type: "mission_failed",
      public_description: `Mission failed! Escape Timer +${penalty}. (${newTimer}/8)`,
    });
  }

  return new Response(JSON.stringify({ success: true, mission_complete: false, winner }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resetPlayersForNextMission(admin: any, game_id: string) {
  await admin.from("players").update({
    has_revealed_card: false,
    revealed_card_key: null,
  }).eq("game_id", game_id).neq("role", "human");
}
