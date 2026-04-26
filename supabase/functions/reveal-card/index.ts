// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GameLogInsert, CardType } from "../_shared/gameLogTypes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AI player reveals one card from their hand (kept in hand; just a public record).
// When all AIs have revealed, advances to resource_allocation.
// Body: { game_id, card_key, override_player_id?: string }
// override_player_id is only honoured in non-production environments when the
// caller owns every player in the game (dev mode single-user testing).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, card_key, override_player_id } = await req.json();
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

    const callerPlayer = await resolvePlayer(admin, game_id, userId, override_player_id);
    if (callerPlayer.role === "human") throw new Error("Only AI players may reveal cards");
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

    const metadataCardType: CardType = handCard.card_type === "progress" ? card_key as CardType : "virus";
    const cardRevealedLog: GameLogInsert<"card_revealed"> = {
      game_id,
      event_type: "card_revealed",
      public_description: `${callerPlayer.display_name} revealed: ${card_key.replace(/_/g, " ")}.`,
      metadata: { actor_player_id: callerPlayer.id, card_key, card_type: metadataCardType },
    };
    await admin.from("game_log").insert(cardRevealedLog);

    // Check if all AIs have revealed
    const { data: aiPlayers } = await admin
      .from("players")
      .select("has_revealed_card")
      .eq("game_id", game_id)
      .neq("role", "human");

    const allRevealed = aiPlayers?.every((p: any) => p.has_revealed_card) ?? false;

    if (allRevealed) {
      await admin.from("games").update({ phase: "resource_allocation" }).eq("id", game_id);

      const revealDoneLog: GameLogInsert<"reveal_done"> = {
        game_id,
        event_type: "reveal_done",
        public_description: "All AIs revealed cards. Allocating resources.",
        metadata: {},
      };
      await admin.from("game_log").insert(revealDoneLog);
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
