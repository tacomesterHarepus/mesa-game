// deno-lint-ignore-file no-explicit-any

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
): Promise<Response> {
  const game_id = game.id;

  if ((game.escape_timer ?? 0) >= 8) {
    await admin.from("games").update({ phase: "game_over", winner: "misaligned" }).eq("id", game_id);
    await admin.from("game_log").insert({ game_id, event_type: "game_over", public_description: "Escape Timer reached 8! Misaligned AIs win!" });
    return new Response(JSON.stringify({ success: true, game_over: true, winner: "misaligned" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if ((game.core_progress ?? 0) >= 10) {
    await admin.from("games").update({ phase: "game_over", winner: "humans" }).eq("id", game_id);
    await admin.from("game_log").insert({ game_id, event_type: "game_over", public_description: "Core Progress reached 10! Humans win!" });
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
      .select("id, turn_order")
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
    await admin.from("games").update({
      phase: "resource_adjustment",
      pending_mission_options: shuffle(allMissions).slice(0, 3),
      turn_order_ids: rotated,
    }).eq("id", game_id);
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
      await admin.from("game_log").insert({
        game_id, event_type: "turn_skipped",
        public_description: `${nextPlayer.display_name}'s turn was skipped.`,
      });
      nextIdx++;
      continue;
    }

    await admin.from("players").update({ has_discarded_this_turn: false }).eq("id", nextPlayerId);
    await drawCardsForPlayer(admin, game_id, nextPlayer);
    await admin.from("games").update({ current_turn_player_id: nextPlayerId, phase: "player_turn" }).eq("id", game_id);
    await admin.from("game_log").insert({
      game_id, event_type: "turn_start",
      public_description: `${nextPlayer.display_name}'s turn.`,
    });
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
        await admin.from("game_log").insert({
          game_id, event_type: "turn_skipped",
          public_description: `${fp.display_name}'s turn was skipped.`,
        });
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
    await admin.from("game_log").insert({
      game_id, event_type: "round_start",
      public_description: "Round 2 begins.",
    });
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Round 2 last player — mission should have resolved above
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
