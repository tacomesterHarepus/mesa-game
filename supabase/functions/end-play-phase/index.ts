// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceTurnOrPhase, corsHeaders, drawCardsForPlayer, shuffle } from "../_shared/advanceTurnOrPhase.ts";

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

// Active AI signals they are done playing cards and virus placements for this turn.
// Full Phase 7 implementation:
//   1. Check mission complete / end-of-round-2 failure
//   2. Apply score changes if mission resolved; clear current_mission_id
//   3. Shuffle pending_viruses into virus_pool
//   4. Compute viruses to resolve: virusCount(player.cpu, turn_play_count)
//   5. If viruses > 0: draw from pool into virus_resolution_queue, phase = virus_resolution
//   6. If viruses == 0: advance turn directly (or game_over / resource_adjustment)
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

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");

    // ── 1. Check mission outcome ──────────────────────────────────────────────
    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).maybeSingle();

    let missionResolved = false;
    let gameUpdates: Record<string, any> = { turn_play_count: 0 };

    if (mission) {
      const reqs = MISSION_REQUIREMENTS[mission.mission_key] ?? {};
      const requirementsMet =
        mission.compute_contributed >= (reqs.compute ?? 0) &&
        mission.data_contributed >= (reqs.data ?? 0) &&
        mission.validation_contributed >= (reqs.validation ?? 0);

      // Distributed Training also requires ≥3 distinct contributors
      let missionComplete = requirementsMet;
      if (requirementsMet && mission.mission_key === "distributed_training") {
        const { data: allContribs } = await admin
          .from("mission_contributions").select("player_id")
          .eq("mission_id", mission.id).eq("failed", false);
        const uniqueCount = new Set((allContribs ?? []).map((c: any) => c.player_id)).size;
        if (uniqueCount < 3) missionComplete = false;
      }

      if (missionComplete) {
        missionResolved = true;
        const reward = MISSION_REWARDS[mission.mission_key] ?? 2;
        gameUpdates.core_progress = game.core_progress + reward;
        gameUpdates.current_mission_id = null;
        gameUpdates.pending_mission_options = [];
        await resetPlayersForNextMission(admin, game_id);
        await admin.from("game_log").insert({
          game_id,
          event_type: "mission_complete",
          public_description: `Mission complete! Core Progress +${reward}. (${gameUpdates.core_progress}/10)`,
        });
      } else {
        // Check end of round 2
        const turnOrderIds: string[] = game.turn_order_ids ?? [];
        const currentIdx = turnOrderIds.indexOf(callerPlayer.id);
        const isLastPlayer = currentIdx >= turnOrderIds.length - 1;

        if (isLastPlayer && mission.round === 2) {
          missionResolved = true;
          const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
          gameUpdates.escape_timer = game.escape_timer + penalty;
          gameUpdates.current_mission_id = null;
          gameUpdates.pending_mission_options = [];
          await resetPlayersForNextMission(admin, game_id);
          await admin.from("game_log").insert({
            game_id,
            event_type: "mission_failed",
            public_description: `Mission failed! Escape Timer +${penalty}. (${gameUpdates.escape_timer}/8)`,
          });
        }
      }
    }

    // ── 2. Shuffle pending_viruses into virus_pool ────────────────────────────
    const { data: pending } = await admin
      .from("pending_viruses").select("*").eq("game_id", game_id);

    if (pending && pending.length > 0) {
      const { data: maxPoolRow } = await admin.from("virus_pool")
        .select("position").eq("game_id", game_id)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      const startPos = (maxPoolRow?.position ?? -1) + 1;
      const shuffled = shuffle([...pending]);

      await admin.from("virus_pool").insert(
        shuffled.map((card: any, i: number) => ({
          game_id,
          card_key: card.card_key,
          card_type: card.card_type,
          position: startPos + i,
        }))
      );
      await admin.from("pending_viruses").delete().eq("game_id", game_id);
    }

    // ── 3. Compute viruses to resolve ─────────────────────────────────────────
    const cardsPlayedThisTurn = game.turn_play_count;
    const numViruses = virusCount(callerPlayer.cpu, cardsPlayedThisTurn);

    // ── 4. Queue resolution or advance directly ───────────────────────────────
    if (numViruses > 0) {
      const { data: pool } = await admin.from("virus_pool")
        .select("*").eq("game_id", game_id).order("position").limit(numViruses);

      if (pool && pool.length > 0) {
        await admin.from("virus_resolution_queue").insert(
          pool.map((card: any, i: number) => ({
            game_id,
            card_key: card.card_key,
            card_type: card.card_type,
            position: i,
            resolved: false,
          }))
        );
        await admin.from("virus_pool").delete().in("id", pool.map((c: any) => c.id));
        await admin.from("game_log").insert({
          game_id,
          event_type: "virus_queue_start",
          public_description: `${callerPlayer.display_name} generated ${pool.length} virus${pool.length > 1 ? "es" : ""}.`,
        });
        gameUpdates.phase = "virus_resolution";
        await admin.from("games").update(gameUpdates).eq("id", game_id);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Pool was empty — fall through to advance turn directly (same as numViruses=0)
    }

    // No viruses (or pool empty) — advance turn directly
    await admin.from("games").update(gameUpdates).eq("id", game_id);
    const updatedGame = { ...game, ...gameUpdates };
    return await advanceTurnOrPhase(admin, updatedGame, callerPlayer, missionResolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function virusCount(cpu: number, cardsPlayed: number): number {
  const base = cpu >= 2 ? 1 : 0;
  const bonus = cardsPlayed >= 3 ? 1 : 0;
  return Math.min(2, base + bonus);
}

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

