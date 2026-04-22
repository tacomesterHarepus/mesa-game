"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  gameId: string;
  userId: string;
  isHost: boolean;
  initialPlayers: PlayerRow[];
  currentPlayer: PlayerRow | null;
}

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 10;

export function LobbyPhase({
  gameId,
  userId,
  isHost,
  initialPlayers,
  currentPlayer: initialCurrentPlayer,
}: Props) {
  const router = useRouter();
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [currentPlayer, setCurrentPlayer] = useState<PlayerRow | null>(
    initialCurrentPlayer
  );
  const [displayName, setDisplayName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Realtime: watch players join/leave and game phase change
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`lobby-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "players",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const incoming = payload.new as PlayerRow;
          setPlayers((prev) =>
            prev.some((p) => p.id === incoming.id)
              ? prev
              : [...prev, incoming]
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "players",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const removed = payload.old as { id: string };
          setPlayers((prev) => prev.filter((p) => p.id !== removed.id));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          if (payload.new.phase !== "lobby") {
            router.push(`/game/${gameId}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, router]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJoinLoading(true);

    const supabase = createClient();
    const { data: player, error: joinError } = await supabase
      .from("players")
      .insert({
        game_id: gameId,
        user_id: userId,
        display_name: displayName.trim(),
      })
      .select()
      .single();

    if (joinError || !player) {
      setError(joinError?.message ?? "Failed to join game");
      setJoinLoading(false);
      return;
    }

    // Fetch all players now that we're a participant
    const { data: allPlayers } = await supabase
      .from("players")
      .select("*")
      .eq("game_id", gameId);

    setCurrentPlayer(player);
    setPlayers(allPlayers ?? [player]);
    setJoinLoading(false);
  }

  async function handleStart() {
    setError(null);
    setStartLoading(true);

    const supabase = createClient();
    const { error: fnError } = await supabase.functions.invoke("start-game", {
      body: { game_id: gameId },
    });

    if (fnError) {
      setError(fnError.message);
      setStartLoading(false);
    }
    // On success the realtime subscription detects the phase change and redirects
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canStart = isHost && players.length >= MIN_PLAYERS;
  const isJoined = currentPlayer !== null;

  return (
    <div className="min-h-screen bg-deep flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-amber tracking-[0.25em] uppercase text-sm">
            MESA
          </h1>
          <p className="label-caps mt-0.5">Lobby</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-faint text-xs">
            {gameId.slice(0, 8).toUpperCase()}
          </span>
          <Button variant="secondary" onClick={copyLink} className="text-xs px-3 py-1.5">
            {copied ? "Copied" : "Copy Link"}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-0 max-w-3xl mx-auto w-full p-6">
        {/* Player list */}
        <div className="flex-1">
          <div className="flex items-baseline gap-2 mb-4">
            <h2 className="label-caps">Players</h2>
            <span className="font-mono text-xs text-muted">
              {players.length} / {MAX_PLAYERS}
            </span>
            {players.length < MIN_PLAYERS && (
              <span className="font-mono text-xs text-faint">
                (need {MIN_PLAYERS}–{MAX_PLAYERS})
              </span>
            )}
          </div>

          <div className="space-y-2">
            {players.map((player) => (
              <PlayerSlot
                key={player.id}
                player={player}
                isSelf={player.user_id === userId}
                isHost={player.user_id === initialPlayers[0]?.user_id}
              />
            ))}
            {/* Empty slots */}
            {Array.from({
              length: Math.max(0, MIN_PLAYERS - players.length),
            }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-10 border border-dashed border-faint rounded flex items-center px-3"
              >
                <span className="text-faint text-xs font-mono">
                  Waiting for player...
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel: join form or host controls */}
        <div className="md:w-64 md:pl-6 md:border-l md:border-border mt-6 md:mt-0">
          {!isJoined ? (
            <div>
              <h2 className="label-caps mb-4">Join this game</h2>
              <form onSubmit={handleJoin} className="space-y-3">
                <Input
                  label="Display name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={20}
                  placeholder="Your name"
                />
                {error && (
                  <p className="text-virus text-xs font-mono">{error}</p>
                )}
                <Button
                  type="submit"
                  loading={joinLoading}
                  className="w-full"
                >
                  Join
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="label-caps mb-2">Waiting</h2>
                {isHost ? (
                  <p className="text-muted text-xs font-mono leading-relaxed">
                    Share the link. Start when{" "}
                    {players.length < MIN_PLAYERS
                      ? `${MIN_PLAYERS - players.length} more join`
                      : "ready"}
                    .
                  </p>
                ) : (
                  <p className="text-muted text-xs font-mono leading-relaxed">
                    Waiting for the host to start.
                  </p>
                )}
              </div>

              {isHost && (
                <>
                  {error && (
                    <p className="text-virus text-xs font-mono">{error}</p>
                  )}
                  <Button
                    onClick={handleStart}
                    loading={startLoading}
                    disabled={!canStart}
                    className="w-full"
                  >
                    Start Game
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerSlot({
  player,
  isSelf,
  isHost,
}: {
  player: PlayerRow;
  isSelf: boolean;
  isHost: boolean;
}) {
  return (
    <div
      className={`h-10 border rounded flex items-center justify-between px-3 ${
        isSelf
          ? "border-amber-border bg-surface"
          : "border-border bg-surface"
      }`}
    >
      <span
        className={`text-sm font-mono ${
          isSelf ? "text-amber" : "text-primary"
        }`}
      >
        {player.display_name}
      </span>
      <div className="flex gap-2">
        {isHost && (
          <span className="label-caps text-amber-dim">Host</span>
        )}
        {isSelf && !isHost && (
          <span className="label-caps text-muted">You</span>
        )}
      </div>
    </div>
  );
}
