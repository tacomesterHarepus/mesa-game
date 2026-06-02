// deno-lint-ignore-file no-explicit-any
import type { GameLogInsert, MissionOutcome } from "./gameLogTypes.ts";

export const MISSION_REQUIREMENTS: Record<string, { compute?: number; data?: number; validation?: number }> = {
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

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function drawCardsForPlayer(admin: any, game_id: string, player: any): Promise<void> {
  const { count: handSizeRaw } = await admin
    .from("hands")
    .select("id", { count: "exact", head: true })
    .eq("player_id", player.id);

  const handSize = handSizeRaw ?? 0;
  const cardsNeeded = (player.ram ?? 4) - handSize;
  if (cardsNeeded <= 0) return;

  const { data: deckCards } = await admin
    .from("deck_cards")
    .select("*")
    .eq("game_id", game_id)
    .eq("status", "in_deck")
    .order("position")
    .limit(cardsNeeded);

  let toDraw: any[] = deckCards ?? [];

  if (toDraw.length < cardsNeeded) {
    const { data: discarded } = await admin
      .from("deck_cards")
      .select("*")
      .eq("game_id", game_id)
      .eq("status", "discarded");

    if (discarded && discarded.length > 0) {
      const { data: maxPosRow } = await admin
        .from("deck_cards")
        .select("position")
        .eq("game_id", game_id)
        .eq("status", "in_deck")
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const startPos = (maxPosRow?.position ?? -1) + 1;
      const reshuffled = shuffle([...discarded]);

      await Promise.all(
        reshuffled.map((card: any, i: number) =>
          admin.from("deck_cards")
            .update({ status: "in_deck", position: startPos + i })
            .eq("id", card.id)
        )
      );

      const stillNeeded = cardsNeeded - toDraw.length;
      const { data: moreCards } = await admin
        .from("deck_cards")
        .select("*")
        .eq("game_id", game_id)
        .eq("status", "in_deck")
        .order("position")
        .limit(stillNeeded);

      toDraw = [...toDraw, ...(moreCards ?? [])];
    }
  }

  if (toDraw.length === 0) return;

  await admin.from("hands").insert(
    toDraw.map((card: any) => ({
      game_id,
      player_id: player.id,
      card_key: card.card_key,
      card_type: card.card_type,
    }))
  );

  await admin.from("deck_cards")
    .update({ status: "drawn" })
    .in("id", toDraw.map((c: any) => c.id));
}

export async function advanceTurnOrPhase(
  admin: any,
  game: any,
  currentPlayer: any,
  missionResolved: boolean,
  missionOutcome?: MissionOutcome,
): Promise<Response> {
  const game_id = game.id;

  if ((game.escape_timer ?? 0) >= 8) {
    await admin.from("games").update({ phase: "game_over", winner: "misaligned" }).eq("id", game_id);
    const gameOverLog: GameLogInsert<"game_over"> = {
      game_id,
      event_type: "game_over",
      public_description: "Escape Timer reached 8! Misaligned AIs win!",
      metadata: { winner: "misaligned", final_progress: game.core_progress ?? 0, final_timer: game.escape_timer ?? 0, end_cause: "timer" },
    };
    await admin.from("game_log").insert(gameOverLog);
    return new Response(JSON.stringify({ success: true, game_over: true, winner: "misaligned" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Re-check mission requirements if a reward was deferred by end-play-phase.
  // current_mission_id stays non-null through the completing turn's virus chain so that
  // contribution-removing viruses (model_corruption, data_drift, validation_failure) can
  // still decrement counts. We now verify requirements are still met before applying the reward.
  if ((game.pending_core_progress_delta ?? null) !== null && game.current_mission_id) {
    const { data: pendingMission } = await admin
      .from("active_mission").select("*").eq("id", game.current_mission_id).maybeSingle();

    if (pendingMission) {
      const reqs = MISSION_REQUIREMENTS[pendingMission.mission_key] ?? {};
      const stillMet =
        (pendingMission.compute_contributed ?? 0) >= (reqs.compute ?? 0) &&
        (pendingMission.data_contributed ?? 0) >= (reqs.data ?? 0) &&
        (pendingMission.validation_contributed ?? 0) >= (reqs.validation ?? 0);

      if (stillMet) {
        const reward: number = game.pending_core_progress_delta;
        const newProgress = (game.core_progress ?? 0) + reward;
        const missionCloseUpdates: Record<string, any> = {
          core_progress: newProgress,
          current_mission_id: null,
          pending_core_progress_delta: null,
          pending_mission_options: [],
          abort_flag_pending: false,
          abort_flag_player_id: null,
          abort_vote_deadline: null,
        };
        await admin.from("games").update(missionCloseUpdates).eq("id", game_id);
        await resetPlayersForNextMission(admin, game_id);
        const missionCompleteLog: GameLogInsert<"mission_complete"> = {
          game_id,
          event_type: "mission_complete",
          public_description: `Mission complete! Core Progress +${reward}. (${newProgress}/10)`,
          metadata: { mission_key: pendingMission.mission_key, reward, new_progress: newProgress },
        };
        await admin.from("game_log").insert(missionCompleteLog);
        // Update local snapshot so subsequent win check uses the applied value.
        game = { ...game, core_progress: newProgress, current_mission_id: null, pending_core_progress_delta: null };
      } else {
        // A virus removed a contribution — requirements no longer met. Reject the deferred
        // reward. Mission continues; remaining players in the round may still complete it,
        // or it fails at end of round 2 under existing logic.
        const missing: string[] = [];
        if ((pendingMission.compute_contributed ?? 0) < (reqs.compute ?? 0)) missing.push("compute");
        if ((pendingMission.data_contributed ?? 0) < (reqs.data ?? 0)) missing.push("data");
        if ((pendingMission.validation_contributed ?? 0) < (reqs.validation ?? 0)) missing.push("validation");
        await admin.from("games").update({
          pending_core_progress_delta: null,
          pending_mission_outcome: null,
        }).eq("id", game_id);
        const reqsUnmetLog: GameLogInsert<"mission_requirements_unmet"> = {
          game_id,
          event_type: "mission_requirements_unmet",
          public_description: "A virus removed a contribution — mission requirements no longer met. Mission continues.",
          metadata: { mission_key: pendingMission.mission_key, missing },
        };
        await admin.from("game_log").insert(reqsUnmetLog);
        game = { ...game, pending_core_progress_delta: null };
        missionResolved = false;
      }
    }
  }

  if ((game.core_progress ?? 0) >= 10) {
    await admin.from("games").update({ phase: "game_over", winner: "humans" }).eq("id", game_id);
    const gameOverLog: GameLogInsert<"game_over"> = {
      game_id,
      event_type: "game_over",
      public_description: "Core Progress reached 10! Humans win!",
      metadata: { winner: "humans", final_progress: game.core_progress ?? 0, final_timer: game.escape_timer ?? 0, end_cause: "progress" },
    };
    await admin.from("game_log").insert(gameOverLog);
    return new Response(JSON.stringify({ success: true, game_over: true, winner: "humans" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (missionResolved || !game.current_mission_id) {
    // Rotate turn order so currentPlayer goes first in the next mission.
    // Contract: currentPlayer must be the completing AI (success) or the last AI to act
    // in round 2 (mission failure). abort-mission (Phase 10) must pass the same contract.
    const { data: aiPlayers } = await admin
      .from("players")
      .select("id, turn_order, display_name")
      .eq("game_id", game_id)
      .neq("role", "human")
      .order("turn_order", { ascending: true });

    const seats: string[] = (aiPlayers ?? []).map((p: any) => p.id);
    const completingIdx = seats.indexOf(currentPlayer.id);
    const rotated = completingIdx >= 0
      ? [...seats.slice(completingIdx), ...seats.slice(0, completingIdx)]
      : seats;

    const allMissions = [
      "data_cleanup", "basic_model_training", "dataset_preparation", "cross_validation",
      "distributed_training", "balanced_compute_cluster", "dataset_integration",
      "multi_model_ensemble", "synchronized_training", "genome_simulation",
      "global_research_network", "experimental_vaccine_model",
    ];
    // Clear pending_mission_outcome atomically with the phase transition (Approach A).
    await admin.from("games").update({
      phase: "resource_adjustment",
      pending_mission_options: shuffle(allMissions).slice(0, 3),
      turn_order_ids: rotated,
      pending_mission_outcome: null,
    }).eq("id", game_id);

    if (missionOutcome !== undefined) {
      const transitionLog: GameLogInsert<"mission_transition"> = {
        game_id,
        event_type: "mission_transition",
        public_description: "Transitioning to next mission.",
        metadata: {
          next_first_player_id: rotated[0] ?? currentPlayer.id,
          completing_player_id: currentPlayer.id,
          mission_outcome: missionOutcome,
        },
      };
      await admin.from("game_log").insert(transitionLog);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: mission } = await admin
    .from("active_mission").select("*").eq("id", game.current_mission_id).maybeSingle();

  const turnOrderIds: string[] = game.turn_order_ids ?? [];
  const currentIdx = turnOrderIds.indexOf(currentPlayer.id);
  let nextIdx = currentIdx + 1;

  while (nextIdx < turnOrderIds.length) {
    const nextPlayerId = turnOrderIds[nextIdx];
    const { data: nextPlayer } = await admin.from("players").select("*").eq("id", nextPlayerId).single();
    if (!nextPlayer) { nextIdx++; continue; }

    if (nextPlayer.skip_next_turn) {
      await admin.from("players").update({ skip_next_turn: false }).eq("id", nextPlayerId);
      const turnSkippedLog: GameLogInsert<"turn_skipped"> = {
        game_id,
        event_type: "turn_skipped",
        public_description: `${nextPlayer.display_name}'s turn was skipped.`,
        metadata: { actor_player_id: nextPlayerId, reason: "process_crash" },
      };
      await admin.from("game_log").insert(turnSkippedLog);
      nextIdx++;
      continue;
    }

    await admin.from("players").update({ has_discarded_this_turn: false }).eq("id", nextPlayerId);
    await drawCardsForPlayer(admin, game_id, nextPlayer);
    await admin.from("games").update({ current_turn_player_id: nextPlayerId, phase: "player_turn" }).eq("id", game_id);
    const turnStartLog: GameLogInsert<"turn_start"> = {
      game_id,
      event_type: "turn_start",
      public_description: `${nextPlayer.display_name}'s turn.`,
      metadata: { actor_player_id: nextPlayerId, round: game.current_round ?? 1 },
    };
    await admin.from("game_log").insert(turnStartLog);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // End of round
  if (mission && mission.round === 1) {
    let firstIdx = 0;
    while (firstIdx < turnOrderIds.length) {
      const pid = turnOrderIds[firstIdx];
      const { data: fp } = await admin.from("players").select("*").eq("id", pid).single();
      if (fp && !fp.skip_next_turn) break;
      if (fp?.skip_next_turn) {
        await admin.from("players").update({ skip_next_turn: false }).eq("id", pid);
        const turnSkippedLog: GameLogInsert<"turn_skipped"> = {
          game_id,
          event_type: "turn_skipped",
          public_description: `${fp.display_name}'s turn was skipped.`,
          metadata: { actor_player_id: pid, reason: "process_crash" },
        };
        await admin.from("game_log").insert(turnSkippedLog);
      }
      firstIdx++;
    }
    const round2FirstPlayer = firstIdx < turnOrderIds.length ? turnOrderIds[firstIdx] : turnOrderIds[0];
    const { data: r2Player } = await admin.from("players").select("*").eq("id", round2FirstPlayer).single();
    if (r2Player) {
      await admin.from("players").update({ has_discarded_this_turn: false }).eq("id", round2FirstPlayer);
      await drawCardsForPlayer(admin, game_id, r2Player);
    }

    await admin.from("active_mission").update({ round: 2 }).eq("id", game.current_mission_id);
    await admin.from("games").update({
      current_turn_player_id: round2FirstPlayer,
      current_round: 2,
      phase: "player_turn",
    }).eq("id", game_id);

    const roundStartLog: GameLogInsert<"round_start"> = {
      game_id,
      event_type: "round_start",
      public_description: "Round 2 begins.",
      metadata: { round: 2, first_player_id: round2FirstPlayer },
    };
    await admin.from("game_log").insert(roundStartLog);

    if (r2Player) {
      const turnStartLog: GameLogInsert<"turn_start"> = {
        game_id,
        event_type: "turn_start",
        public_description: `${r2Player.display_name}'s turn — Round 2.`,
        metadata: { actor_player_id: round2FirstPlayer, round: 2 },
      };
      await admin.from("game_log").insert(turnStartLog);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Round 2 last player — mission should have resolved above
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const MISSION_FAIL_PENALTIES: Record<string, number> = {
  data_cleanup: 1, basic_model_training: 1,
  dataset_preparation: 1, cross_validation: 1, distributed_training: 1,
  balanced_compute_cluster: 2, dataset_integration: 2, multi_model_ensemble: 2,
  synchronized_training: 2, genome_simulation: 2,
  global_research_network: 3, experimental_vaccine_model: 3,
};

export async function resetPlayersForNextMission(admin: any, game_id: string): Promise<void> {
  await admin.from("players").update({
    has_revealed_card: false,
    revealed_card_key: null,
  }).eq("game_id", game_id).neq("role", "human");
}

export async function applyMissionAbort(
  admin: any,
  game: any,
  mission: any,
  abortedByPlayerId: string,
): Promise<Response> {
  const game_id = game.id;
  const penalty = MISSION_FAIL_PENALTIES[mission.mission_key] ?? 1;
  const newEscapeTimer = (game.escape_timer ?? 0) + penalty;

  await resetPlayersForNextMission(admin, game_id);

  const missionAbortedLog: GameLogInsert<"mission_aborted"> = {
    game_id,
    event_type: "mission_aborted",
    public_description: `Mission aborted by humans. Escape Timer +${penalty}. (${newEscapeTimer}/8)`,
    metadata: { mission_key: mission.mission_key, penalty, new_timer: newEscapeTimer, aborted_by_player_id: abortedByPlayerId },
  };
  await admin.from("game_log").insert(missionAbortedLog);

  const gameUpdates = {
    escape_timer: newEscapeTimer,
    current_mission_id: null,
    pending_mission_options: [],
    turn_play_count: 0,
    abort_flag_pending: false,
    abort_flag_player_id: null,
    abort_vote_deadline: null,
  };
  await admin.from("games").update(gameUpdates).eq("id", game_id);
  const updatedGame = { ...game, ...gameUpdates };
  return await advanceTurnOrPhase(admin, updatedGame, { id: game.current_turn_player_id }, true, "aborted");
}
