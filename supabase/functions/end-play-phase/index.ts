// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceTurnOrPhase, corsHeaders, drawCardsForPlayer, MISSION_FAIL_PENALTIES, resetPlayersForNextMission, shuffle } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert, MissionOutcome } from "../_shared/gameLogTypes.ts";

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

// Active AI signals they are done playing cards and virus placements for this turn.
// Full Phase 7 implementation:
//   1. CAS phase claim (player_turn → between_turns sentinel) — serialises concurrent calls
//   2. Check mission complete / end-of-round-2 failure
//   3. Apply score changes if mission resolved; clear current_mission_id
//   4. Shuffle pending_viruses into virus_pool — full reshuffle (DELETE all + INSERT shuffled 0..N-1)
//      so pool position never correlates with insertion order or staging AI identity
//   5. Compute viruses to resolve: virusCount(player.cpu, turn_play_count)
//   6. If viruses > 0: draw from pool into virus_resolution_queue, phase = virus_resolution
//   7. If viruses == 0: advance turn directly (or game_over / resource_adjustment)
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

    const callerPlayer = await resolvePlayer(req, admin, game_id, userId, override_player_id);
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");

    // ── 1. CAS phase claim ────────────────────────────────────────────────────
    // Atomically claim this invocation by transitioning player_turn → between_turns.
    // Any concurrent caller (e.g. double-tap) finds phase no longer 'player_turn' and exits.
    // The sentinel is overwritten on every path: virus_pull sets it to 'virus_pull';
    // the no-viruses path lets advanceTurnOrPhase write the real next phase; the
    // abort-vote path sets it to 'abort_vote'. No path leaves the game in 'between_turns'.
    const { data: claimed } = await admin.from("games")
      .update({ phase: "between_turns" })
      .eq("id", game_id).eq("phase", "player_turn")
      .select("id");
    if (!claimed?.length) {
      console.log("[end-play-phase] CAS lost — concurrent caller already claimed this turn");
      return new Response(JSON.stringify({ success: true, skipped: "already_advanced" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Check mission outcome ──────────────────────────────────────────────
    const { data: mission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).maybeSingle();

    let missionResolved = false;
    let missionOutcomeForTransition: MissionOutcome | undefined;
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
        missionOutcomeForTransition = "complete";
        const reward = MISSION_REWARDS[mission.mission_key] ?? 2;
        gameUpdates.core_progress = game.core_progress + reward;
        gameUpdates.current_mission_id = null;
        gameUpdates.pending_mission_options = [];
        gameUpdates.abort_flag_pending = false;
        gameUpdates.abort_flag_player_id = null;
        gameUpdates.abort_vote_deadline = null;
        await resetPlayersForNextMission(admin, game_id);
        const missionCompleteLog: GameLogInsert<"mission_complete"> = {
          game_id,
          event_type: "mission_complete",
          public_description: `Mission complete! Core Progress +${reward}. (${gameUpdates.core_progress}/10)`,
          metadata: { mission_key: mission.mission_key, reward, new_progress: gameUpdates.core_progress },
        };
        await admin.from("game_log").insert(missionCompleteLog);
      } else {
        // Check end of round 2
        const turnOrderIds: string[] = game.turn_order_ids ?? [];
        const currentIdx = turnOrderIds.indexOf(callerPlayer.id);
        const isLastPlayer = currentIdx >= turnOrderIds.length - 1;

        if (isLastPlayer && mission.round === 2) {
          missionResolved = true;
          missionOutcomeForTransition = "failed";
          const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
          gameUpdates.escape_timer = game.escape_timer + penalty;
          gameUpdates.current_mission_id = null;
          gameUpdates.pending_mission_options = [];
          gameUpdates.abort_flag_pending = false;
          gameUpdates.abort_flag_player_id = null;
          gameUpdates.abort_vote_deadline = null;
          await resetPlayersForNextMission(admin, game_id);
          const missionFailedLog: GameLogInsert<"mission_failed"> = {
            game_id,
            event_type: "mission_failed",
            public_description: `Mission failed! Escape Timer +${penalty}. (${gameUpdates.escape_timer}/8)`,
            metadata: { mission_key: mission.mission_key, penalty, new_timer: gameUpdates.escape_timer },
          };
          await admin.from("game_log").insert(missionFailedLog);
        }
      }
    }

    // ── 3. Shuffle pending_viruses into virus_pool ────────────────────────────
    // Full reshuffle: DELETE all pool rows + INSERT (survivors + pending) at random positions
    // 0..N-1 so position never encodes insertion order or staging AI identity.
    const { data: pending } = await admin
      .from("pending_viruses").select("*").eq("game_id", game_id);

    if (pending && pending.length > 0) {
      // Delete pending_viruses first — throw on error so stale rows cannot accumulate on retry
      const { error: deleteError } = await admin
        .from("pending_viruses").delete().eq("game_id", game_id);
      if (deleteError) throw deleteError;

      // Read current pool survivors
      const { data: existing } = await admin.from("virus_pool")
        .select("card_key, card_type").eq("game_id", game_id);

      // Combine survivors + new pending cards, shuffle, assign positions 0..N-1
      const combined = [
        ...(existing ?? []).map((c: any) => ({ card_key: c.card_key, card_type: c.card_type })),
        ...pending.map((c: any) => ({ card_key: c.card_key, card_type: c.card_type })),
      ];
      const shuffledCombined = shuffle(combined);

      // DELETE all existing pool rows, then INSERT combined set with fresh positions
      await admin.from("virus_pool").delete().eq("game_id", game_id);
      await admin.from("virus_pool").insert(
        shuffledCombined.map((card: any, i: number) => ({
          game_id,
          card_key: card.card_key,
          card_type: card.card_type,
          position: i,
        }))
      );
    }

    const virusesPlacedLog: GameLogInsert<"viruses_placed"> = {
      game_id,
      event_type: "viruses_placed",
      public_description: `${callerPlayer.display_name} shuffled ${pending?.length ?? 0} card${(pending?.length ?? 0) !== 1 ? "s" : ""} into the virus pool.`,
      metadata: { actor_player_id: callerPlayer.id, count: pending?.length ?? 0 },
    };
    await admin.from("game_log").insert(virusesPlacedLog);

    // ── 4. Compute viruses to resolve ─────────────────────────────────────────
    const cardsPlayedThisTurn = game.turn_play_count;
    const numViruses = virusCount(callerPlayer.cpu, cardsPlayedThisTurn);

    // ── 5. Fork to virus_pull or advance directly ────────────────────────────
    if (numViruses > 0) {
      const { count: poolSize } = await admin.from("virus_pool")
        .select("id", { count: "exact", head: true }).eq("game_id", game_id);

      if ((poolSize ?? 0) > 0) {
        const virusPullLog: GameLogInsert<"virus_pull_initiated"> = {
          game_id,
          event_type: "virus_pull_initiated",
          public_description: `${callerPlayer.display_name} generated ${numViruses} virus${numViruses > 1 ? "es" : ""} — pulling from pool.`,
          metadata: { actor_player_id: callerPlayer.id, virus_count: numViruses, pool_size_before: poolSize ?? 0 },
        };
        await admin.from("game_log").insert(virusPullLog);
        gameUpdates.phase = "virus_pull";
        gameUpdates.pending_pull_count = numViruses;
        if (missionOutcomeForTransition !== undefined) {
          gameUpdates.pending_mission_outcome = missionOutcomeForTransition;
        }
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

    // Abort vote check: flag set, mission still active, round 2 — open the vote window.
    if (!missionResolved && (updatedGame.current_round ?? 1) === 2 && game.abort_flag_pending) {
      await admin.from("abort_votes").delete().eq("game_id", game_id);
      const deadline = new Date(Date.now() + 30_000).toISOString();
      await admin.from("games").update({
        phase: "abort_vote",
        abort_vote_deadline: deadline,
        abort_flag_pending: false,
      }).eq("id", game_id);
      const voteStartedLog: GameLogInsert<"abort_vote_started"> = {
        game_id,
        event_type: "abort_vote_started",
        public_description: "Abort vote opened — humans have 30 seconds to vote.",
        metadata: {
          flagging_player_id: game.abort_flag_player_id ?? "",
          deadline,
          round: updatedGame.current_round ?? 2,
        },
      };
      await admin.from("game_log").insert(voteStartedLog);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return await advanceTurnOrPhase(admin, updatedGame, callerPlayer, missionResolved, missionOutcomeForTransition);
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
