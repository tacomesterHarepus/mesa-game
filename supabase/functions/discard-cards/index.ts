// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, drawCardsForPlayer } from "../_shared/advanceTurnOrPhase.ts";

// Active AI discards 0–3 cards from hand before playing (DISCARD → DRAW step).
// Each discarded card is removed from hands and its deck_cards row is marked 'discarded'.
// drawCardsForPlayer then refills the hand to RAM.
// Body: { game_id, card_ids: string[], override_player_id?: string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, card_ids, override_player_id } = await req.json();
    if (!game_id || !Array.isArray(card_ids)) throw new Error("game_id and card_ids required");
    if (card_ids.length > 3) throw new Error("Cannot discard more than 3 cards");

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
    if (callerPlayer.has_discarded_this_turn) throw new Error("Already discarded this turn");

    // Validate and discard each card
    for (const cardId of card_ids) {
      // Verify card is in caller's hand
      const { data: handCard } = await admin
        .from("hands").select("*").eq("id", cardId).eq("player_id", callerPlayer.id).single();
      if (!handCard) throw new Error(`Card ${cardId} not in your hand`);

      // Find one drawn deck_cards row for this card_key to mark discarded.
      // hands has no FK to deck_cards — matching by game_id + card_key + status='drawn'.
      // Identical pattern to play-card's discard step.
      const { data: deckCard } = await admin
        .from("deck_cards")
        .select("id")
        .eq("game_id", game_id)
        .eq("card_key", handCard.card_key)
        .eq("status", "drawn")
        .limit(1)
        .maybeSingle();

      if (deckCard) {
        await admin.from("deck_cards").update({ status: "discarded" }).eq("id", deckCard.id);
      }

      await admin.from("hands").delete().eq("id", cardId);
    }

    // Refill hand to RAM (DRAW step)
    await drawCardsForPlayer(admin, game_id, callerPlayer);

    // Mark discard step as complete for this turn
    await admin.from("players").update({ has_discarded_this_turn: true }).eq("id", callerPlayer.id);

    const n = card_ids.length;
    await admin.from("game_log").insert({
      game_id,
      event_type: "discard",
      public_description: n === 0
        ? `${callerPlayer.display_name} skipped discard.`
        : `${callerPlayer.display_name} discarded ${n} card${n !== 1 ? "s" : ""}.`,
    });

    return new Response(JSON.stringify({ success: true, cards_discarded: n }), {
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
