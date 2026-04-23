// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Humans distribute the mission's bonus CPU/RAM pool among AI players.
// During this phase Humans may ONLY ADD (up to per-player max).
// Body: { game_id, allocations: [{player_id, cpu_delta, ram_delta}], override_player_id?: string }
// override_player_id is only honoured in non-production environments when the
// caller owns every player in the game (dev mode single-user testing).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, allocations, override_player_id } = await req.json();
    if (!game_id || !Array.isArray(allocations)) throw new Error("game_id and allocations required");

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
    if (game.phase !== "resource_allocation") throw new Error("Not in resource_allocation phase");

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.role !== "human") throw new Error("Only humans may allocate resources");

    // Get mission to know the pool sizes
    const { data: activeMission } = await admin
      .from("active_mission")
      .select("*")
      .eq("id", game.current_mission_id)
      .single();
    if (!activeMission) throw new Error("Active mission not found");

    const missionDefs: Record<string, { cpu: number; ram: number }> = {
      data_cleanup: { cpu: 2, ram: 1 },
      basic_model_training: { cpu: 1, ram: 1 },
      dataset_preparation: { cpu: 2, ram: 2 },
      cross_validation: { cpu: 2, ram: 2 },
      distributed_training: { cpu: 3, ram: 2 },
      balanced_compute_cluster: { cpu: 3, ram: 3 },
      dataset_integration: { cpu: 4, ram: 3 },
      multi_model_ensemble: { cpu: 4, ram: 4 },
      synchronized_training: { cpu: 5, ram: 4 },
      genome_simulation: { cpu: 5, ram: 5 },
      global_research_network: { cpu: 6, ram: 5 },
      experimental_vaccine_model: { cpu: 6, ram: 6 },
    };
    const pool = missionDefs[activeMission.mission_key] ?? { cpu: 0, ram: 0 };

    // Validate total allocations don't exceed pool
    let totalCpu = 0;
    let totalRam = 0;
    for (const alloc of allocations as any[]) {
      totalCpu += Math.max(0, alloc.cpu_delta ?? 0);
      totalRam += Math.max(0, alloc.ram_delta ?? 0);
    }
    if (totalCpu > pool.cpu) throw new Error(`CPU allocation ${totalCpu} exceeds pool ${pool.cpu}`);
    if (totalRam > pool.ram) throw new Error(`RAM allocation ${totalRam} exceeds pool ${pool.ram}`);

    // Apply allocations (only add, respect max limits)
    for (const alloc of allocations as any[]) {
      const { player_id, cpu_delta, ram_delta } = alloc;
      const { data: target } = await admin.from("players").select("*").eq("id", player_id).single();
      if (!target || target.game_id !== game_id) continue;
      if (target.role === "human") continue;

      const updates: Record<string, number> = {};
      if (cpu_delta && cpu_delta > 0) updates.cpu = Math.min(4, target.cpu + cpu_delta);
      if (ram_delta && ram_delta > 0) updates.ram = Math.min(7, target.ram + ram_delta);
      if (Object.keys(updates).length > 0) {
        await admin.from("players").update(updates).eq("id", player_id);
      }
    }

    // Advance to player_turn — set current_turn_player_id to first in turn_order
    const firstPlayerId = game.turn_order_ids[0] ?? null;
    await admin.from("games").update({
      phase: "player_turn",
      current_turn_player_id: firstPlayerId,
      current_round: 1,
    }).eq("id", game_id);

    await admin.from("game_log").insert({
      game_id,
      event_type: "phase_change",
      public_description: "Resources allocated. Mission begins!",
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
