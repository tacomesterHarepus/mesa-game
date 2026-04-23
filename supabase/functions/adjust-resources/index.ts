// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Humans adjust AI CPU/RAM during resource_adjustment phase.
// Any human may submit stat changes; only the host may confirm ready (advancing the phase).
// Body: { game_id, adjustments?: [{player_id, cpu?, ram?}], confirm_ready?: boolean }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, adjustments, confirm_ready } = await req.json();
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
    if (game.phase !== "resource_adjustment") throw new Error("Not in resource_adjustment phase");

    // Verify caller is a human player in this game
    const { data: callerPlayer } = await admin
      .from("players")
      .select("*")
      .eq("game_id", game_id)
      .eq("user_id", userId)
      .single();
    if (!callerPlayer || callerPlayer.role !== "human") throw new Error("Only humans may adjust resources");

    // Apply stat adjustments (Humans may only REDUCE during this phase, down to minimums)
    if (adjustments && Array.isArray(adjustments)) {
      for (const adj of adjustments as any[]) {
        const { player_id, cpu, ram } = adj;
        const { data: target } = await admin.from("players").select("*").eq("id", player_id).single();
        if (!target || target.game_id !== game_id) continue;
        if (target.role === "human") continue; // Cannot adjust humans

        const updates: Record<string, number> = {};
        if (cpu !== undefined) {
          const newCpu = Math.max(1, Math.min(4, cpu));
          if (newCpu <= target.cpu) updates.cpu = newCpu; // Only reduce
        }
        if (ram !== undefined) {
          const newRam = Math.max(3, Math.min(7, ram));
          if (newRam <= target.ram) updates.ram = newRam; // Only reduce
        }
        if (Object.keys(updates).length > 0) {
          await admin.from("players").update(updates).eq("id", player_id);
        }
      }
    }

    // Any human may advance the phase when ready
    if (confirm_ready) {

      // Draw 3 mission cards for selection
      const allMissions = [
        "data_cleanup", "basic_model_training", "dataset_preparation", "cross_validation",
        "distributed_training", "balanced_compute_cluster", "dataset_integration",
        "multi_model_ensemble", "synchronized_training", "genome_simulation",
        "global_research_network", "experimental_vaccine_model",
      ];
      const options = shuffle(allMissions).slice(0, 3);

      await admin.from("games").update({
        phase: "mission_selection",
        pending_mission_options: options,
      }).eq("id", game_id);

      await admin.from("game_log").insert({
        game_id,
        event_type: "phase_change",
        public_description: "Resource adjustment complete. Selecting mission.",
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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
