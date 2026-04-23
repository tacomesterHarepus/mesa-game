// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resolves one card from the virus_resolution_queue.
// Called by the host (or any human in dev mode) from the VirusResolution UI.
// Applies the card's effect, marks it resolved, checks win conditions.
// When the queue is empty: refills the pool to 4 and advances the turn.
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
    if (game.phase !== "virus_resolution") throw new Error("Not in virus_resolution phase");

    // Any player in the game may advance resolution (host-controlled in UI)
    const { count: playerCount } = await admin
      .from("players").select("id", { count: "exact", head: true })
      .eq("game_id", game_id).eq("user_id", userId);
    if (!override_player_id && (playerCount ?? 0) === 0) throw new Error("Not a player in this game");

    // Get next unresolved queue item (lowest position)
    const { data: nextCard } = await admin
      .from("virus_resolution_queue").select("*")
      .eq("game_id", game_id).eq("resolved", false)
      .order("position").limit(1).maybeSingle();

    if (!nextCard) {
      // Queue empty — refill pool and advance turn
      await refillVirusPool(admin, game_id);
      const { data: freshGame } = await admin.from("games").select("*").eq("id", game_id).single();
      const missionResolved = !freshGame.current_mission_id;
      const fakeCurrentPlayer = { id: game.current_turn_player_id };
      return await advanceTurnOrPhase(admin, freshGame, fakeCurrentPlayer, missionResolved);
    }

    // Mark resolved first to prevent double-resolution
    await admin.from("virus_resolution_queue")
      .update({ resolved: true }).eq("id", nextCard.id);

    // Apply the virus effect
    const pauseForTargeting = await applyVirusEffect(admin, game, nextCard);

    if (pauseForTargeting) {
      // Secret targeting phase takes over — virus resolution resumes after (Phase 8)
      return new Response(JSON.stringify({ success: true, paused: "secret_targeting" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-fetch game to pick up any timer/progress changes from the effect
    const { data: updatedGame } = await admin.from("games").select("*").eq("id", game_id).single();

    // Timer check: misaligned win is immediate, even mid-chain
    if ((updatedGame?.escape_timer ?? 0) >= 8) {
      await admin.from("games").update({ phase: "game_over", winner: "misaligned" }).eq("id", game_id);
      await admin.from("game_log").insert({
        game_id, event_type: "game_over",
        public_description: "Escape Timer reached 8! Misaligned AIs win!",
      });
      return new Response(JSON.stringify({ success: true, game_over: true, winner: "misaligned" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

// ── Virus effect application ──────────────────────────────────────────────────

async function applyVirusEffect(admin: any, game: any, card: any): Promise<boolean> {
  const game_id = game.id;

  switch (card.card_key) {
    case "cascading_failure": {
      // Add up to 2 more cards from the pool to the queue
      const { data: pool } = await admin.from("virus_pool").select("*")
        .eq("game_id", game_id).order("position").limit(2);

      if (pool && pool.length > 0) {
        const { data: queueMax } = await admin.from("virus_resolution_queue")
          .select("position").eq("game_id", game_id)
          .order("position", { ascending: false }).limit(1).maybeSingle();
        const startPos = (queueMax?.position ?? -1) + 1;

        await admin.from("virus_resolution_queue").insert(
          pool.map((c: any, i: number) => ({
            game_id, card_key: c.card_key, card_type: c.card_type,
            position: startPos + i, resolved: false, cascaded_from: card.id,
          }))
        );
        await admin.from("virus_pool").delete().in("id", pool.map((c: any) => c.id));
        await admin.from("game_log").insert({
          game_id, event_type: "virus_resolved",
          public_description: `Cascading Failure! ${pool.length} more virus${pool.length > 1 ? "es" : ""} triggered.`,
        });
      } else {
        await admin.from("game_log").insert({
          game_id, event_type: "virus_resolved",
          public_description: "Cascading Failure! Pool was empty — chain stops here.",
        });
      }
      return false;
    }

    case "system_overload": {
      await admin.from("games")
        .update({ escape_timer: game.escape_timer + 1 }).eq("id", game_id);
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "System Overload! Escape Timer +1.",
      });
      return false;
    }

    case "model_corruption": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          compute_contributed: Math.max(0, mission.compute_contributed - 1),
        }).eq("id", mission.id);
      }
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "Model Corruption! −1 Compute from mission.",
      });
      return false;
    }

    case "data_drift": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          data_contributed: Math.max(0, mission.data_contributed - 1),
        }).eq("id", mission.id);
      }
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "Data Drift! −1 Data from mission.",
      });
      return false;
    }

    case "validation_failure": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          validation_contributed: Math.max(0, mission.validation_contributed - 1),
        }).eq("id", mission.id);
      }
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "Validation Failure! −1 Validation from mission.",
      });
      return false;
    }

    case "pipeline_breakdown": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        const specialState = { ...(mission.special_state ?? {}), pipeline_breakdown_active: true };
        await admin.from("active_mission").update({ special_state: specialState }).eq("id", mission.id);
      }
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "Pipeline Breakdown! Next contribution has 50% chance of failing.",
      });
      return false;
    }

    case "dependency_error": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        const specialState = { ...(mission.special_state ?? {}), dependency_error_active: true };
        await admin.from("active_mission").update({ special_state: specialState }).eq("id", mission.id);
      }
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: "Dependency Error! Compute locked until Data is contributed.",
      });
      return false;
    }

    // Secret-targeting effects: transition to secret_targeting, pause virus chain.
    // Phase 8 (secret-target edge function) will apply the effect and return to virus_resolution.
    case "process_crash":
    case "memory_leak":
    case "resource_surge":
    case "cpu_drain":
    case "memory_allocation": {
      const deadline = new Date(Date.now() + 60_000).toISOString();
      await admin.from("games").update({
        phase: "secret_targeting",
        targeting_deadline: deadline,
      }).eq("id", game_id);
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: `${cardDisplayName(card.card_key)}! Misaligned AIs are selecting a target…`,
      });
      return true; // pause
    }

    default: {
      await admin.from("game_log").insert({
        game_id, event_type: "virus_resolved",
        public_description: `Virus resolved: ${card.card_key.replace(/_/g, " ")}.`,
      });
      return false;
    }
  }
}

function cardDisplayName(key: string): string {
  const names: Record<string, string> = {
    process_crash: "Process Crash",
    memory_leak: "Memory Leak",
    resource_surge: "Resource Surge",
    cpu_drain: "CPU Drain",
    memory_allocation: "Memory Allocation",
  };
  return names[key] ?? key.replace(/_/g, " ");
}

// ── Pool refill ───────────────────────────────────────────────────────────────

async function refillVirusPool(admin: any, game_id: string) {
  const { count: poolCount } = await admin.from("virus_pool")
    .select("*", { count: "exact", head: true }).eq("game_id", game_id);
  const needed = 4 - (poolCount ?? 0);
  if (needed <= 0) return;

  let drawCards = await drawFromDeck(admin, game_id, needed);

  if (drawCards.length === 0) {
    // Draw pile empty — reshuffle discards
    await reshuffleDiscard(admin, game_id);
    drawCards = await drawFromDeck(admin, game_id, needed);
  }

  if (drawCards.length === 0) return;

  const { data: maxPoolRow } = await admin.from("virus_pool")
    .select("position").eq("game_id", game_id)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  const startPos = (maxPoolRow?.position ?? -1) + 1;

  await admin.from("virus_pool").insert(
    drawCards.map((card: any, i: number) => ({
      game_id, card_key: card.card_key, card_type: card.card_type,
      position: startPos + i,
    }))
  );
  await admin.from("deck_cards").update({ status: "drawn" })
    .in("id", drawCards.map((c: any) => c.id));
}

async function drawFromDeck(admin: any, game_id: string, count: number): Promise<any[]> {
  const { data } = await admin.from("deck_cards").select("*")
    .eq("game_id", game_id).eq("status", "in_deck")
    .order("position").limit(count);
  return data ?? [];
}

async function reshuffleDiscard(admin: any, game_id: string) {
  const { data: discarded } = await admin.from("deck_cards").select("id")
    .eq("game_id", game_id).eq("status", "discarded");
  if (!discarded || discarded.length === 0) return;

  const shuffledIds: string[] = shuffle(discarded.map((c: any) => c.id));
  await Promise.all(
    shuffledIds.map((id, pos) =>
      admin.from("deck_cards").update({ status: "in_deck", position: pos }).eq("id", id)
    )
  );
}

// ── Turn advancement (duplicated from end-play-phase for independent deployment) ──

async function advanceTurnOrPhase(admin: any, game: any, currentPlayer: any, missionResolved: boolean): Promise<Response> {
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
    const allMissions = [
      "data_cleanup", "basic_model_training", "dataset_preparation", "cross_validation",
      "distributed_training", "balanced_compute_cluster", "dataset_integration",
      "multi_model_ensemble", "synchronized_training", "genome_simulation",
      "global_research_network", "experimental_vaccine_model",
    ];
    await admin.from("games").update({
      phase: "resource_adjustment",
      pending_mission_options: shuffle(allMissions).slice(0, 3),
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

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
