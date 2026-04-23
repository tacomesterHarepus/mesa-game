import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LobbyPhase } from "@/components/game/phases/LobbyPhase";

export default async function LobbyPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: { dev_mode?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Any anonymous or authenticated visitor can view a lobby-phase game.
  // The client handles anonymous sign-in before join/watch actions.

  const { data: game } = await supabase
    .from("games")
    .select("*")
    .eq("id", params.gameId)
    .single();

  if (!game) notFound();
  if (game.phase !== "lobby") redirect(`/game/${params.gameId}`);

  const userId = user?.id ?? null;

  // Returns [] when unauthenticated (RLS). Client fetches after signing in.
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .eq("game_id", params.gameId);

  // Returns [] when not a player or spectator (RLS).
  const { data: spectators } = await supabase
    .from("spectators")
    .select("*")
    .eq("game_id", params.gameId);

  const currentPlayer = userId
    ? (players?.find((p) => p.user_id === userId) ?? null)
    : null;

  const isSpectating = userId
    ? (spectators?.some((s) => s.user_id === userId) ?? false)
    : false;

  const devMode =
    process.env.NODE_ENV !== "production" && searchParams.dev_mode === "true";

  return (
    <LobbyPhase
      gameId={params.gameId}
      hostUserId={game.host_user_id}
      userId={userId}
      isHost={userId !== null && game.host_user_id === userId}
      initialPlayers={players ?? []}
      currentPlayer={currentPlayer}
      initialSpectators={spectators ?? []}
      initialIsSpectating={isSpectating}
      devMode={devMode}
    />
  );
}
