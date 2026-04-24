"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/anon";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
type SpectatorRow = Database["public"]["Tables"]["spectators"]["Row"];

interface Props {
  gameId: string;
  hostUserId: string;
  userId: string | null;
  isHost: boolean;
  initialPlayers: PlayerRow[];
  currentPlayer: PlayerRow | null;
  initialSpectators: SpectatorRow[];
  initialIsSpectating: boolean;
  devMode?: boolean;
}

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 10;

export function LobbyPhase({
  gameId,
  hostUserId,
  userId: initialUserId,
  isHost: initialIsHost,
  initialPlayers,
  currentPlayer: initialCurrentPlayer,
  initialSpectators,
  initialIsSpectating,
  devMode = false,
}: Props) {
  const router = useRouter();
  const gameUrl = devMode ? `/game/${gameId}?dev_mode=true` : `/game/${gameId}`;
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [spectators, setSpectators] = useState<SpectatorRow[]>(initialSpectators);
  const [currentPlayer, setCurrentPlayer] = useState<PlayerRow | null>(initialCurrentPlayer);
  const [isSpectating, setIsSpectating] = useState(initialIsSpectating);
  const [localUserId, setLocalUserId] = useState<string | null>(initialUserId);
  const [isHost, setIsHost] = useState(initialIsHost);

  const [displayName, setDisplayName] = useState("");
  const [joinMode, setJoinMode] = useState<"player" | "spectator" | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Polling fallback: re-fetch lobby state every 3s in case Realtime misses events.
  // Also checks game phase so all players navigate when the host starts the game,
  // even if their Realtime subscription was established before they had a session.
  useEffect(() => {
    const supabase = createClient();

    const poll = async () => {
      await supabase.auth.getSession();
      const [{ data: p }, { data: s }, { data: g }] = await Promise.all([
        supabase.from("players").select("*").eq("game_id", gameId),
        supabase.from("spectators").select("*").eq("game_id", gameId),
        supabase.from("games").select("phase").eq("id", gameId).single(),
      ]);
      if (p) setPlayers(p);
      if (s) setSpectators(s);
      if (g && g.phase !== "lobby") router.push(gameUrl);
    };

    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [gameId, router, gameUrl]);

  // Realtime: players, spectators, game phase change
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Await getSession() before subscribing so the JWT is loaded by the time
    // the channel JOIN message is sent — avoids anonymous-user RLS failures.
    const setup = async () => {
      await supabase.auth.getSession();
      if (cancelled) return;

      channel = supabase
        .channel(`lobby-${gameId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
          (payload) => {
            const row = payload.new as PlayerRow;
            setPlayers((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]));
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
          (payload) => {
            const removed = payload.old as { id: string };
            setPlayers((prev) => prev.filter((p) => p.id !== removed.id));
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "spectators", filter: `game_id=eq.${gameId}` },
          (payload) => {
            const row = payload.new as SpectatorRow;
            setSpectators((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]));
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "spectators", filter: `game_id=eq.${gameId}` },
          (payload) => {
            const removed = payload.old as { id: string };
            setSpectators((prev) => prev.filter((s) => s.id !== removed.id));
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
          (payload) => {
            if (payload.new.phase !== "lobby") router.push(gameUrl);
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [gameId, router, gameUrl]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJoinLoading(true);

    try {
      const uid = await ensureSession();
      setLocalUserId(uid);
      setIsHost(hostUserId === uid);

      const supabase = createClient();

      if (joinMode === "player") {
        // Generate ID client-side so we can build the row without a SELECT
        // (avoids read-replica lag on .select().single() after INSERT)
        const playerId = crypto.randomUUID();
        const { error: joinError } = await supabase
          .from("players")
          .insert({ id: playerId, game_id: gameId, user_id: uid, display_name: displayName.trim() });

        if (joinError) {
          setError(joinError.message);
          setJoinLoading(false);
          return;
        }

        const player: PlayerRow = {
          id: playerId,
          game_id: gameId,
          user_id: uid,
          display_name: displayName.trim(),
          role: null,
          cpu: 1,
          ram: 4,
          turn_order: null,
          skip_next_turn: false,
          has_revealed_card: false,
          revealed_card_key: null,
        };

        setCurrentPlayer(player);
        setPlayers((prev) => (prev.some((p) => p.id === player.id) ? prev : [...prev, player]));
      } else {
        const { error: specError } = await supabase.from("spectators").insert({
          game_id: gameId,
          user_id: uid,
          display_name: displayName.trim() || null,
        });

        if (specError) {
          setError(specError.message);
          setJoinLoading(false);
          return;
        }

        setIsSpectating(true);
        // Players list is already loaded from initial state + Realtime
      }

      setJoinLoading(false);
    } catch {
      setError("Failed to create session. Please try again.");
      setJoinLoading(false);
    }
  }

  async function handleStart() {
    setError(null);
    setStartLoading(true);
    const { data, error: fnError } = await invokeWithRetry("start-game", { game_id: gameId });
    if (fnError) {
      let message = fnError.message;
      try {
        const raw = await (fnError as unknown as { context?: Response }).context?.text();
        if (raw) {
          try { const j = JSON.parse(raw); if (j?.error) message = j.error; }
          catch { message = raw.slice(0, 300); }
        }
      } catch { /* give up */ }
      setError(message);
      setStartLoading(false);
    } else if (data?.error) {
      setError(data.error);
      setStartLoading(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isJoined = currentPlayer !== null;
  const canStart = isHost && players.length >= MIN_PLAYERS;
  const showJoinForm = !isJoined && !isSpectating;

  return (
    <div className="min-h-screen bg-deep flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-amber tracking-[0.25em] uppercase text-sm">MESA</h1>
          <p className="label-caps mt-0.5">Lobby</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-faint text-xs">{gameId.slice(0, 8).toUpperCase()}</span>
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
            {spectators.length > 0 && (
              <span className="font-mono text-xs text-faint ml-auto">
                {spectators.length} watching
              </span>
            )}
          </div>

          <div className="space-y-2">
            {players.map((player) => (
              <PlayerSlot
                key={player.id}
                player={player}
                isSelf={player.user_id === localUserId}
                isHost={player.user_id === hostUserId}
              />
            ))}
            {Array.from({ length: Math.max(0, MIN_PLAYERS - players.length) }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-10 border border-dashed border-faint rounded flex items-center px-3"
              >
                <span className="text-faint text-xs font-mono">Waiting for player…</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div className="md:w-64 md:pl-6 md:border-l md:border-border mt-6 md:mt-0">
          {showJoinForm ? (
            <JoinPanel
              joinMode={joinMode}
              setJoinMode={setJoinMode}
              displayName={displayName}
              setDisplayName={setDisplayName}
              loading={joinLoading}
              error={error}
              onSubmit={handleJoin}
            />
          ) : isSpectating ? (
            <SpectatorPanel spectatorCount={spectators.length} playerCount={players.length} />
          ) : (
            <PlayerPanel
              isHost={isHost}
              playerCount={players.length}
              canStart={canStart}
              loading={startLoading}
              error={error}
              onStart={handleStart}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function JoinPanel({
  joinMode,
  setJoinMode,
  displayName,
  setDisplayName,
  loading,
  error,
  onSubmit,
}: {
  joinMode: "player" | "spectator" | null;
  setJoinMode: (m: "player" | "spectator") => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  loading: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div>
      {!joinMode ? (
        <div className="space-y-3">
          <h2 className="label-caps mb-4">Join or Watch</h2>
          <Button className="w-full" onClick={() => setJoinMode("player")}>
            Play
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setJoinMode("spectator")}>
            Watch
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setJoinMode(joinMode === "player" ? "spectator" : "player")}
              className="text-faint text-xs font-mono hover:text-muted transition-colors"
            >
              ←
            </button>
            <h2 className="label-caps">
              {joinMode === "player" ? "Play" : "Watch"}
            </h2>
          </div>
          <Input
            label="Display name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required={joinMode === "player"}
            maxLength={20}
            placeholder={joinMode === "player" ? "Your name" : "Optional"}
          />
          {error && <p className="text-virus text-xs font-mono">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            {joinMode === "player" ? "Join" : "Watch"}
          </Button>
        </form>
      )}
    </div>
  );
}

function PlayerPanel({
  isHost,
  playerCount,
  canStart,
  loading,
  error,
  onStart,
}: {
  isHost: boolean;
  playerCount: number;
  canStart: boolean;
  loading: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="label-caps mb-2">Waiting</h2>
        {isHost ? (
          <p className="text-muted text-xs font-mono leading-relaxed">
            Share the link. Start when{" "}
            {playerCount < MIN_PLAYERS
              ? `${MIN_PLAYERS - playerCount} more join`
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
          {error && <p className="text-virus text-xs font-mono">{error}</p>}
          <Button onClick={onStart} loading={loading} disabled={!canStart} className="w-full">
            Start Game
          </Button>
        </>
      )}
    </div>
  );
}

function SpectatorPanel({
  spectatorCount,
  playerCount,
}: {
  spectatorCount: number;
  playerCount: number;
}) {
  return (
    <div>
      <h2 className="label-caps mb-2">Watching</h2>
      <p className="text-muted text-xs font-mono leading-relaxed">
        {playerCount} player{playerCount !== 1 ? "s" : ""} ·{" "}
        {spectatorCount} watching
      </p>
      <p className="text-faint text-xs font-mono mt-2 leading-relaxed">
        Game starts when the host is ready.
      </p>
    </div>
  );
}

// ── Player slot ───────────────────────────────────────────────────────────────

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
        isSelf ? "border-amber-border bg-surface" : "border-border bg-surface"
      }`}
    >
      <span className={`text-sm font-mono ${isSelf ? "text-amber" : "text-primary"}`}>
        {player.display_name}
      </span>
      <div className="flex gap-2">
        {isHost && <span className="label-caps text-amber-dim">Host</span>}
        {isSelf && !isHost && <span className="label-caps text-muted">You</span>}
      </div>
    </div>
  );
}
