import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GameBoard } from "@/components/game/GameBoard";
import type { Game } from "@/types/game";
import type { Database } from "@/types/supabase";

export default async function GamePage({
  params,
}: {
  params: { gameId: string };
}) {
  const supabase = createClient();
  const { gameId } = params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: game } = await supabase.from("games").select("*").eq("id", gameId).single();
  if (!game) redirect("/");
  if (game.phase === "lobby") redirect(`/game/${gameId}/lobby`);

  const { data: players } = await supabase.from("players").select("*").eq("game_id", gameId);
  const allPlayers = players ?? [];

  let currentPlayer = null;
  let hand: Database["public"]["Tables"]["hands"]["Row"][] = [];

  if (user) {
    currentPlayer = allPlayers.find((p) => p.user_id === user.id) ?? null;

    if (currentPlayer && currentPlayer.role !== "human") {
      const { data: handCards } = await supabase
        .from("hands")
        .select("*")
        .eq("player_id", currentPlayer.id);
      hand = handCards ?? [];
    }
  }

  let mission = null;
  if (game.current_mission_id) {
    const { data: activeMission } = await supabase
      .from("active_mission")
      .select("*")
      .eq("id", game.current_mission_id)
      .single();
    mission = activeMission;
  }

  const { data: logEntries } = await supabase
    .from("game_log")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at")
    .limit(100);

  return (
    <GameBoard
      initialGame={game as unknown as Game}
      initialPlayers={allPlayers}
      currentPlayer={currentPlayer}
      initialHand={hand}
      initialMission={mission}
      initialLog={logEntries ?? []}
      userId={user?.id ?? null}
    />
  );
}
