// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Humans pick one of the 3 pending mission options.
// Body: { game_id, mission_key }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, mission_key } = await req.json();
    if (!game_id || !mission_key) throw new Error("game_id and mission_key required");

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
    if (game.phase !== "mission_selection") throw new Error("Not in mission_selection phase");

    // Verify caller is a human in this game
    const { data: callerPlayer } = await admin
      .from("players")
      .select("*")
      .eq("game_id", game_id)
      .eq("user_id", userId)
      .single();
    if (!callerPlayer || callerPlayer.role !== "human") throw new Error("Only humans may select missions");

    // Validate mission_key is one of the 3 options
    if (!game.pending_mission_options.includes(mission_key)) {
      throw new Error("mission_key not in pending options");
    }

    // Create the active_mission record
    const { data: mission, error: missionErr } = await admin.from("active_mission").insert({
      game_id,
      mission_key,
      compute_contributed: 0,
      data_contributed: 0,
      validation_contributed: 0,
      round: 1,
      special_state: {},
    }).select().single();
    if (missionErr || !mission) throw new Error("Failed to create active mission");

    // Reset all AI players' has_revealed_card and revealed_card_key
    const { data: aiPlayers } = await admin
      .from("players")
      .select("id")
      .eq("game_id", game_id)
      .neq("role", "human");

    if (aiPlayers && aiPlayers.length > 0) {
      await admin.from("players").update({
        has_revealed_card: false,
        revealed_card_key: null,
      }).eq("game_id", game_id).neq("role", "human");
    }

    await admin.from("games").update({
      phase: "card_reveal",
      current_mission_id: mission.id,
      pending_mission_options: [],
    }).eq("id", game_id);

    await admin.from("game_log").insert({
      game_id,
      event_type: "mission_selected",
      public_description: `Mission selected: ${mission_key.replace(/_/g, " ")}.`,
    });

    return new Response(JSON.stringify({ success: true, mission_id: mission.id }), {
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
