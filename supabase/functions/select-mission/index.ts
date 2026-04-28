// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { drawCardsForPlayer } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert } from "../_shared/gameLogTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Humans pick one of the 3 pending mission options.
// Body: { game_id, mission_key, override_player_id?: string }
// override_player_id is only honoured in non-production environments when the
// caller owns every player in the game (dev mode single-user testing).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, mission_key, override_player_id } = await req.json();
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

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.role !== "human") throw new Error("Only humans may select missions");

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

    // Fetch all AI players (full row needed for drawCardsForPlayer's ram check)
    const { data: aiPlayers } = await admin
      .from("players")
      .select("*")
      .eq("game_id", game_id)
      .neq("role", "human");

    // Reset card-reveal flags
    if (aiPlayers && aiPlayers.length > 0) {
      await admin.from("players").update({
        has_revealed_card: false,
        revealed_card_key: null,
      }).eq("game_id", game_id).neq("role", "human");
    }

    // Refill all AI hands to RAM before card_reveal.
    // This is the right insertion point: resource_adjustment is complete (RAM may have
    // been reduced by humans, but that's now finalised), the mission is confirmed, and
    // every AI is about to need cards for their reveal choice. Refilling in
    // advanceTurnOrPhase's missionResolved branch would be too early (humans haven't
    // confirmed the new mission yet and RAM could still change in resource_adjustment).
    // drawCardsForPlayer is idempotent — safe for mission 1 where start-game already
    // dealt full hands.
    if (aiPlayers) {
      for (const ai of aiPlayers) {
        await drawCardsForPlayer(admin, game_id, ai);
      }
    }

    await admin.from("games").update({
      phase: "card_reveal",
      current_mission_id: mission.id,
      pending_mission_options: [],
    }).eq("id", game_id);

    const missionSelectedLog: GameLogInsert<"mission_selected"> = {
      game_id,
      event_type: "mission_selected",
      public_description: `Mission selected: ${mission_key.replace(/_/g, " ")}.`,
      metadata: {
        mission_key,
        mission_options: [mission_key, ...game.pending_mission_options.filter((k: string) => k !== mission_key)] as [string, string, string],
      },
    };
    await admin.from("game_log").insert(missionSelectedLog);

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
