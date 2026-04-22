import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function GamePage({
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
    .select("phase")
    .eq("id", params.gameId)
    .single();

  if (!game) redirect("/");
  if (game.phase === "lobby") redirect(`/game/${params.gameId}/lobby`);

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <p className="font-mono text-amber text-sm tracking-widest uppercase">
        Building game board — Phase 4
      </p>
    </div>
  );
}
