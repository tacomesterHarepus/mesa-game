import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LobbyPhase } from "@/components/game/phases/LobbyPhase";

export default async function LobbyPage({
  params,
}: {
  params: { gameId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", params.gameId)
    .single();

  if (!game) notFound();
  if (game.phase !== "lobby") redirect(`/game/${params.gameId}`);

  // Returns [] for non-players (RLS filters all rows) — they'll see the join form.
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .eq("game_id", params.gameId);

  const currentPlayer =
    players?.find((p) => p.user_id === user.id) ?? null;

  return (
    <LobbyPhase
      gameId={params.gameId}
      userId={user.id}
      isHost={game.host_user_id === user.id}
      initialPlayers={players ?? []}
      currentPlayer={currentPlayer}
    />
  );
}
