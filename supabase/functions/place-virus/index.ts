// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI secretly places a card from their hand into the pending virus pool during player_turn.
// The card is removed from the hand and inserted into pending_viruses.
// Pending viruses are shuffled into the virus pool when the turn ends (end-play-phase).
// Body: { game_id, card_id: string, override_player_id?: string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, card_id, override_player_id } = await req.json();
    if (!game_id || !card_id) throw new Error("game_id and card_id required");

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
    if (game.phase !== "player_turn") throw new Error("Not in player_turn phase");

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.id !== game.current_turn_player_id) throw new Error("Not your turn");
    if (callerPlayer.role === "human") throw new Error("Humans cannot place virus cards");

    // Verify card is in player's hand
    const { data: handCard } = await admin
      .from("hands").select("*").eq("id", card_id).eq("player_id", callerPlayer.id).single();
    if (!handCard) throw new Error("Card not found in your hand");

    // Move card from hand to pending_viruses
    await Promise.all([
      admin.from("pending_viruses").insert({
        game_id,
        placed_by_player_id: callerPlayer.id,
        card_key: handCard.card_key,
        card_type: handCard.card_type,
      }),
      admin.from("hands").delete().eq("id", card_id),
    ]);

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
