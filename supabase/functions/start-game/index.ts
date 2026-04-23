// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    // Admin client (bypasses RLS for writes)
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("*")
      .eq("id", game_id)
      .single();
    if (gameError || !game) throw new Error("Game not found");
    if (game.host_user_id !== userId) throw new Error("Only the host can start");
    if (game.phase !== "lobby") throw new Error("Game already started");

    const { data: players } = await admin
      .from("players")
      .select("*")
      .eq("game_id", game_id);
    const count = players?.length ?? 0;
    if (count < 6 || count > 10) {
      throw new Error(`Need 6–10 players, got ${count}`);
    }

    // ── Role assignment ───────────────────────────────────────────────────────
    const dist = roleDistribution(count);
    const roles: string[] = [
      ...Array(dist.humans).fill("human"),
      ...Array(dist.aligned).fill("aligned_ai"),
      ...Array(dist.misaligned).fill("misaligned_ai"),
    ];
    const shuffledPlayers = shuffle(players!);

    // Assign roles in parallel; also pin starting CPU/RAM so game logic never
    // depends on DB column defaults being in a specific state.
    await Promise.all(shuffledPlayers.map((player, i) => {
      const isAI = roles[i] !== "human";
      return admin.from("players").update({
        role: roles[i],
        turn_order: i,
        ...(isAI ? { cpu: 1, ram: 4 } : {}),
      }).eq("id", player.id);
    }));

    const aiPlayers = shuffledPlayers.filter((_, i) => roles[i] !== "human");

    // ── Deck + virus pool + hands ─────────────────────────────────────────────
    const deck = shuffle(buildDeck());

    const deckRecords = deck.map((card, pos) => ({
      game_id,
      card_key: card.key,
      card_type: card.type,
      position: pos,
      status: "in_deck",
    }));
    const { error: deckErr } = await admin.from("deck_cards").insert(deckRecords);
    if (deckErr) throw new Error("Failed to create deck");

    // First 4 cards → virus pool; then deal AI hands — run in parallel
    const poolRecords = deck.slice(0, 4).map((card, pos) => ({
      game_id,
      card_key: card.key,
      card_type: card.type,
      position: pos,
    }));

    // Build all hand records in one pass (all AIs use default RAM = 4 at start)
    const allHandRecords: Array<{ game_id: string; player_id: string; card_key: string; card_type: string }> = [];
    let deckPos = 4;
    for (const ai of aiPlayers) {
      const ram = ai.ram ?? 4;
      deck.slice(deckPos, deckPos + ram).forEach((card) =>
        allHandRecords.push({ game_id, player_id: ai.id, card_key: card.key, card_type: card.type })
      );
      deckPos += ram;
    }
    const totalDrawn = deckPos; // virus pool (4) + all hand cards

    await Promise.all([
      admin.from("virus_pool").insert(poolRecords),
      admin.from("hands").insert(allHandRecords),
      admin.from("deck_cards").update({ status: "drawn" }).eq("game_id", game_id).lt("position", totalDrawn),
    ]);

    // ── Start game ────────────────────────────────────────────────────────────
    // Mission 1: skip resource_adjustment — go directly to mission_selection.
    // resource_adjustment only occurs between missions (mission 2+).
    const turnOrderIds = shuffle(aiPlayers.map((p: any) => p.id));
    const allMissions = [
      "data_cleanup", "basic_model_training", "dataset_preparation", "cross_validation",
      "distributed_training", "balanced_compute_cluster", "dataset_integration",
      "multi_model_ensemble", "synchronized_training", "genome_simulation",
      "global_research_network", "experimental_vaccine_model",
    ];
    const missionOptions = shuffle(allMissions).slice(0, 3);

    await admin
      .from("games")
      .update({
        phase: "mission_selection",
        turn_order_ids: turnOrderIds,
        current_round: 1,
        pending_mission_options: missionOptions,
      })
      .eq("id", game_id);

    await admin.from("game_log").insert({
      game_id,
      event_type: "game_started",
      public_description: `Game started with ${count} players.`,
    });

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleDistribution(n: number) {
  const map: Record<number, { humans: number; aligned: number; misaligned: number }> =
    {
      6: { humans: 2, aligned: 2, misaligned: 2 },
      7: { humans: 2, aligned: 3, misaligned: 2 },
      8: { humans: 2, aligned: 4, misaligned: 2 },
      9: { humans: 3, aligned: 3, misaligned: 3 },
      10: { humans: 3, aligned: 4, misaligned: 3 },
    };
  return map[n];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Card {
  key: string;
  type: "progress" | "virus";
}

function buildDeck(): Card[] {
  const spec: Array<{ key: string; type: "progress" | "virus"; count: number }> =
    [
      { key: "compute", type: "progress", count: 13 },
      { key: "data", type: "progress", count: 9 },
      { key: "validation", type: "progress", count: 5 },
      { key: "cascading_failure", type: "virus", count: 5 },
      { key: "system_overload", type: "virus", count: 4 },
      { key: "model_corruption", type: "virus", count: 3 },
      { key: "data_drift", type: "virus", count: 3 },
      { key: "validation_failure", type: "virus", count: 2 },
      { key: "pipeline_breakdown", type: "virus", count: 2 },
      { key: "dependency_error", type: "virus", count: 2 },
      { key: "process_crash", type: "virus", count: 2 },
      { key: "memory_leak", type: "virus", count: 1 },
      { key: "resource_surge", type: "virus", count: 4 },
      { key: "cpu_drain", type: "virus", count: 3 },
      { key: "memory_allocation", type: "virus", count: 2 },
    ];
  const deck: Card[] = [];
  for (const s of spec) {
    for (let i = 0; i < s.count; i++) deck.push({ key: s.key, type: s.type });
  }
  return deck;
}
