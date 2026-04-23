// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI player reveals one card from their hand (kept in hand; just a public record).
// When all AIs have revealed, advances to resource_allocation.
// Body: { game_id, card_key }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, card_key } = await req.json();
    if (!game_id || !card_key) throw new Error("game_id and card_key required");

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
    if (game.phase !== "card_reveal") throw new Error("Not in card_reveal phase");

    // Verify caller is an AI player in this game
    const { data: callerPlayer } = await admin
      .from("players")
      .select("*")
      .eq("game_id", game_id)
      .eq("user_id", userId)
      .single();
    if (!callerPlayer || callerPlayer.role === "human") throw new Error("Only AI players may reveal cards");
    if (callerPlayer.has_revealed_card) throw new Error("Already revealed a card this phase");

    // Verify the card is in the player's hand (player may have duplicates, so limit 1)
    const { data: handCard } = await admin
      .from("hands")
      .select("*")
      .eq("player_id", callerPlayer.id)
      .eq("card_key", card_key)
      .limit(1)
      .maybeSingle();
    if (!handCard) throw new Error("Card not in hand");

    // Mark revealed (card stays in hand)
    await admin.from("players").update({
      has_revealed_card: true,
      revealed_card_key: card_key,
    }).eq("id", callerPlayer.id);

    await admin.from("game_log").insert({
      game_id,
      event_type: "card_revealed",
      public_description: `${callerPlayer.display_name} revealed: ${card_key.replace(/_/g, " ")}.`,
    });

    // Check if all AIs have revealed
    const { data: aiPlayers } = await admin
      .from("players")
      .select("has_revealed_card")
      .eq("game_id", game_id)
      .neq("role", "human");

    const allRevealed = aiPlayers?.every((p: any) => p.has_revealed_card) ?? false;

    if (allRevealed) {
      await admin.from("games").update({ phase: "resource_allocation" }).eq("id", game_id);

      await admin.from("game_log").insert({
        game_id,
        event_type: "phase_change",
        public_description: "All AIs revealed cards. Allocating resources.",
      });
    }

    return new Response(JSON.stringify({ success: true, all_revealed: allRevealed }), {
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
