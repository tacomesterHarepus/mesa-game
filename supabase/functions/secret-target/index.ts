// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GameLogInsert, TargetingEffect } from "../_shared/gameLogTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Secret targeting: misaligned AI submits a vote, OR any player forces deadline resolution.
//
// Vote mode:   { game_id, target_player_id: string, override_player_id? }
//   — caller must be a misaligned_ai. Records vote in secret_target_votes.
//   — auto-tallies if all misaligned AIs have voted.
//
// Deadline mode: { game_id, force_resolve: true, override_player_id? }
//   — caller must be a player in the game. Tallies whatever votes exist (or picks random target).
//   — only accepted when targeting_deadline has passed or all misaligned AIs have voted.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, target_player_id, force_resolve, override_player_id } = await req.json();
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
    if (game.phase !== "secret_targeting") throw new Error("Not in secret_targeting phase");

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    const resolutionId: string = game.current_targeting_resolution_id;
    const cardKey: string = game.current_targeting_card_key;
    if (!resolutionId || !cardKey) throw new Error("No targeting resolution active");

    // ── Vote mode ──────────────────────────────────────────────────────────────
    if (target_player_id && !force_resolve) {
      if (callerPlayer.role !== "misaligned_ai") throw new Error("Only misaligned AIs may vote");

      // Validate target: must be an AI in the same game
      const { data: targetPlayer } = await admin
        .from("players").select("*").eq("id", target_player_id).eq("game_id", game_id).maybeSingle();
      if (!targetPlayer) throw new Error("Target player not found in game");
      if (targetPlayer.role === "human") throw new Error("Cannot target a human player");

      // Upsert vote (unique constraint on resolution_id + voter_player_id)
      await admin.from("secret_target_votes").upsert({
        game_id,
        resolution_id: resolutionId,
        voter_player_id: callerPlayer.id,
        target_player_id,
      }, { onConflict: "resolution_id,voter_player_id" });
    } else if (force_resolve) {
      // Deadline trigger: verify the caller is a player and deadline has passed (or all voted)
      const { count: playerInGame } = await admin
        .from("players").select("id", { count: "exact", head: true })
        .eq("game_id", game_id).eq("user_id", userId);
      if (!override_player_id && (playerInGame ?? 0) === 0) throw new Error("Not a player in this game");
    } else {
      throw new Error("target_player_id or force_resolve is required");
    }

    // ── Check whether to tally now ─────────────────────────────────────────────
    const { count: misalignedCount } = await admin
      .from("players").select("id", { count: "exact", head: true })
      .eq("game_id", game_id).eq("role", "misaligned_ai");

    const { count: voteCount } = await admin
      .from("secret_target_votes").select("id", { count: "exact", head: true })
      .eq("resolution_id", resolutionId);

    const deadlinePassed = game.targeting_deadline
      ? new Date(game.targeting_deadline) <= new Date()
      : false;
    const allVoted = (voteCount ?? 0) >= (misalignedCount ?? 1);

    if (!allVoted && !deadlinePassed && !force_resolve) {
      return new Response(JSON.stringify({ success: true, voted: true, waiting: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Tally votes ────────────────────────────────────────────────────────────
    const { data: votes } = await admin
      .from("secret_target_votes").select("target_player_id")
      .eq("resolution_id", resolutionId);

    let winnerId: string | null = null;

    if (votes && votes.length > 0) {
      // Count votes per target
      const tally: Record<string, number> = {};
      for (const v of votes) tally[v.target_player_id] = (tally[v.target_player_id] ?? 0) + 1;

      const maxVotes = Math.max(...Object.values(tally));
      const candidates = Object.keys(tally).filter((id) => tally[id] === maxVotes);
      // Random tiebreak
      winnerId = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // No votes cast — pick a random AI
      const { data: aiPlayers } = await admin
        .from("players").select("id")
        .eq("game_id", game_id).neq("role", "human");
      if (aiPlayers && aiPlayers.length > 0) {
        winnerId = aiPlayers[Math.floor(Math.random() * aiPlayers.length)].id;
      }
    }

    // ── Apply effect ───────────────────────────────────────────────────────────
    let effectLog = "Secret targeting resolved.";
    if (winnerId) {
      const { data: target } = await admin.from("players").select("*").eq("id", winnerId).single();
      if (target) {
        effectLog = await applyTargetingEffect(admin, cardKey, target, game_id);
      }
    }

    // ── Clear targeting state and resume virus_resolution ─────────────────────
    await admin.from("games").update({
      phase: "virus_resolution",
      targeting_deadline: null,
      current_targeting_resolution_id: null,
      current_targeting_card_key: null,
    }).eq("id", game_id);

    const targetingLog: GameLogInsert<"targeting_resolved"> = {
      game_id,
      event_type: "targeting_resolved",
      public_description: effectLog,
      metadata: {
        card_key: cardKey,
        target_player_id: winnerId ?? "",
        effect: cardKey as TargetingEffect,
      },
    };
    await admin.from("game_log").insert(targetingLog);

    return new Response(JSON.stringify({ success: true, resolved: true }), {
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

// ── Effect application ────────────────────────────────────────────────────────

async function applyTargetingEffect(
  admin: any,
  cardKey: string,
  target: any,
  game_id: string
): Promise<string> {
  const name = target.display_name as string;

  switch (cardKey) {
    case "process_crash": {
      await admin.from("players").update({ skip_next_turn: true }).eq("id", target.id);
      return `${name} was targeted by Process Crash — their next turn is skipped.`;
    }
    case "memory_leak": {
      const newRam = Math.max(3, (target.ram as number) - 1);
      await admin.from("players").update({ ram: newRam }).eq("id", target.id);
      return `${name} was targeted by Memory Leak — RAM reduced to ${newRam}.`;
    }
    case "resource_surge": {
      const newCpu = Math.min(4, (target.cpu as number) + 1);
      await admin.from("players").update({ cpu: newCpu }).eq("id", target.id);
      return `${name} was targeted by Resource Surge — CPU increased to ${newCpu}.`;
    }
    case "cpu_drain": {
      const newCpu = Math.max(1, (target.cpu as number) - 1);
      await admin.from("players").update({ cpu: newCpu }).eq("id", target.id);
      return `${name} was targeted by CPU Drain — CPU reduced to ${newCpu}.`;
    }
    case "memory_allocation": {
      const newRam = Math.min(7, (target.ram as number) + 1);
      await admin.from("players").update({ ram: newRam }).eq("id", target.id);
      return `${name} was targeted by Memory Allocation — RAM increased to ${newRam}.`;
    }
    default:
      return `${name} was targeted (unknown effect: ${cardKey}).`;
  }
}

// ── Player resolution (dev mode override) ─────────────────────────────────────

async function resolvePlayer(
  admin: any,
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
