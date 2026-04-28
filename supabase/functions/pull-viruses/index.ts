// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert } from "../_shared/gameLogTypes.ts";

// Active AI pulls pending_pull_count cards from the virus pool into the resolution queue.
// Called immediately after end-play-phase transitions to virus_pull phase.
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
    if (game.phase !== "virus_pull") throw new Error("Not in virus_pull phase");
    const pullCount: number = game.pending_pull_count ?? 0;
    if (pullCount === 0) throw new Error("No cards to pull");

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");

    // ── Pull top pullCount cards from pool into resolution queue ─────────────
    const { data: pool } = await admin.from("virus_pool")
      .select("*").eq("game_id", game_id).order("position").limit(pullCount);

    if (!pool || pool.length === 0) throw new Error("Virus pool is empty");

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

    const { count: poolSizeAfter } = await admin.from("virus_pool")
      .select("id", { count: "exact", head: true }).eq("game_id", game_id);

    const queueStartLog: GameLogInsert<"virus_queue_start"> = {
      game_id,
      event_type: "virus_queue_start",
      public_description: `${callerPlayer.display_name} pulled ${pool.length} virus${pool.length > 1 ? "es" : ""} from the pool.`,
      metadata: { actor_player_id: callerPlayer.id, virus_count: pool.length, pool_size_after: poolSizeAfter ?? 0 },
    };
    await admin.from("game_log").insert(queueStartLog);

    await admin.from("games").update({
      phase: "virus_resolution",
      pending_pull_count: 0,
    }).eq("id", game_id);

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
