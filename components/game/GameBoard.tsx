"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TrackerBar } from "./TrackerBar";
import { MissionBoard } from "./MissionBoard";
import { PlayerRoster } from "./PlayerRoster";
import { Hand } from "./Hand";
import { GameLog } from "./GameLog";
import { ResourceAdjustment } from "./phases/ResourceAdjustment";
import { MissionSelection } from "./phases/MissionSelection";
import { CardReveal } from "./phases/CardReveal";
import { ResourceAllocation } from "./phases/ResourceAllocation";
import { PlayerTurn } from "./phases/PlayerTurn";
import { VirusResolution } from "./phases/VirusResolution";
import { SecretTargeting } from "./phases/SecretTargeting";
import { GameOver } from "./phases/GameOver";
import { PublicChat } from "@/components/chat/PublicChat";
import { MisalignedPrivateChat } from "@/components/chat/MisalignedPrivateChat";
import type { Game } from "@/types/game";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
type ActiveMission = Database["public"]["Tables"]["active_mission"]["Row"];
type LogEntry = Database["public"]["Tables"]["game_log"]["Row"];
type HandCard = Database["public"]["Tables"]["hands"]["Row"];

interface Props {
  initialGame: Game;
  initialPlayers: PlayerRow[];
  currentPlayer: PlayerRow | null;
  initialHand: HandCard[];
  initialMission: ActiveMission | null;
  initialLog: LogEntry[];
  userId: string | null;
}

// Phases where AI chat is locked
const CHAT_LOCKED_PHASES = new Set([
  "resource_adjustment",
  "mission_selection",
  "card_reveal",
  "resource_allocation",
]);

export function GameBoard({
  initialGame,
  initialPlayers,
  currentPlayer: initialCurrentPlayer,
  initialHand,
  initialMission,
  initialLog,
  userId,
}: Props) {
  const [game, setGame] = useState<Game>(initialGame);
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [currentPlayer] = useState<PlayerRow | null>(initialCurrentPlayer);
  const [hand, setHand] = useState<HandCard[]>(initialHand);
  const [mission, setMission] = useState<ActiveMission | null>(initialMission);
  const [log, setLog] = useState<LogEntry[]>(initialLog);

  const gameId = game.id;

  // Polling fallback: re-fetch game and players every 3s in case Realtime misses events.
  useEffect(() => {
    const supabase = createClient();

    const poll = async () => {
      await supabase.auth.getSession();
      const [{ data: g }, { data: p }] = await Promise.all([
        supabase.from("games").select("*").eq("id", gameId).single(),
        supabase.from("players").select("*").eq("game_id", gameId),
      ]);
      if (g) setGame((prev) => ({ ...prev, ...g }));
      if (p && p.length > 0) setPlayers(p);
    };

    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [gameId]);

  // Realtime subscriptions
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
        .channel(`game-${gameId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
          (payload) => {
            setGame((prev) => ({ ...prev, ...(payload.new as Partial<Game>) }));
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
          (payload) => {
            const updated = payload.new as PlayerRow;
            setPlayers((prev) =>
              prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "active_mission", filter: `game_id=eq.${gameId}` },
          (payload) => {
            setMission((prev) =>
              prev ? { ...prev, ...(payload.new as Partial<ActiveMission>) } : prev
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "active_mission", filter: `game_id=eq.${gameId}` },
          (payload) => {
            setMission(payload.new as ActiveMission);
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "game_log", filter: `game_id=eq.${gameId}` },
          (payload) => {
            setLog((prev) => [...prev, payload.new as LogEntry]);
          }
        );

      // Hand updates (only relevant if current player is an AI)
      if (currentPlayer && currentPlayer.role !== "human") {
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "hands",
              filter: `player_id=eq.${currentPlayer.id}`,
            },
            (payload) => {
              setHand((prev) => [...prev, payload.new as HandCard]);
            }
          )
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "hands",
              filter: `player_id=eq.${currentPlayer.id}`,
            },
            (payload) => {
              const removed = payload.old as { id: string };
              setHand((prev) => prev.filter((c) => c.id !== removed.id));
            }
          );
      }

      channel.subscribe();
    };

    setup();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [gameId, currentPlayer]);

  const isHost = game.host_user_id === userId;
  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;
  const isMisaligned = currentPlayer?.role === "misaligned_ai";
  const misalignedPlayers = players.filter((p) => p.role === "misaligned_ai");
  const chatEnabled = !CHAT_LOCKED_PHASES.has(game.phase);
  const currentTurnPlayer = players.find((p) => p.id === game.current_turn_player_id) ?? null;

  // Sync updated player data for currentPlayer (CPU/RAM changes from resource allocation)
  const syncedCurrentPlayer = currentPlayer
    ? players.find((p) => p.id === currentPlayer.id) ?? currentPlayer
    : null;

  function renderPhase() {
    switch (game.phase) {
      case "resource_adjustment":
        return (
          <ResourceAdjustment
            gameId={gameId}
            players={players}
            currentPlayer={syncedCurrentPlayer}
          />
        );
      case "mission_selection":
        return (
          <MissionSelection
            gameId={gameId}
            pendingOptions={game.pending_mission_options}
            currentPlayer={syncedCurrentPlayer}
          />
        );
      case "card_reveal":
        return (
          <CardReveal
            gameId={gameId}
            players={players}
            currentPlayer={syncedCurrentPlayer}
            hand={hand}
          />
        );
      case "resource_allocation":
        return (
          <ResourceAllocation
            gameId={gameId}
            players={players}
            currentPlayer={syncedCurrentPlayer}
            isHost={isHost}
            missionKey={mission?.mission_key ?? ""}
          />
        );
      case "player_turn":
      case "between_turns":
        return (
          <PlayerTurn
            gameId={gameId}
            currentTurnPlayer={currentTurnPlayer}
            currentPlayer={syncedCurrentPlayer}
            hand={hand}
            round={mission?.round ?? 1}
          />
        );
      case "virus_resolution":
        return <VirusResolution />;
      case "secret_targeting":
        return (
          <SecretTargeting
            gameId={gameId}
            players={players}
            currentPlayer={syncedCurrentPlayer}
            targetingDeadline={game.targeting_deadline}
          />
        );
      case "game_over":
        return (
          <GameOver
            gameId={gameId}
            winner={game.winner}
            players={players}
            currentPlayer={syncedCurrentPlayer}
            isHost={isHost}
          />
        );
      default:
        return (
          <div className="text-faint text-xs font-mono">
            Unknown phase: {game.phase}
          </div>
        );
    }
  }

  return (
    <div className="min-h-screen bg-deep flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center justify-between bg-base">
        <h1 className="font-mono text-amber tracking-[0.25em] uppercase text-sm">MESA</h1>
        <span className="font-mono text-faint text-xs">{gameId.slice(0, 8).toUpperCase()}</span>
      </div>

      {/* Tracker bar */}
      <TrackerBar coreProgress={game.core_progress} escapeTimer={game.escape_timer} />

      {/* Main layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left panel — phase UI */}
        <div className="flex-1 p-5 overflow-y-auto">
          {renderPhase()}

          {/* Mission board below phase controls (when active) */}
          {mission && game.phase !== "game_over" && (
            <div className="mt-6">
              <MissionBoard mission={mission} />
            </div>
          )}
        </div>

        {/* Right panel — roster, hand, log, chat */}
        <div className="md:w-64 border-t md:border-t-0 md:border-l border-border p-4 flex flex-col gap-4 overflow-y-auto">
          <PlayerRoster
            players={players}
            currentUserId={userId}
            currentTurnPlayerId={game.current_turn_player_id}
            phase={game.phase}
          />

          {isAI && hand.length > 0 && (
            <div>
              <h3 className="label-caps mb-2">Your Hand</h3>
              <Hand cards={hand} />
            </div>
          )}

          <GameLog entries={log} />

          {/* Misaligned private chat */}
          {isMisaligned && currentPlayer && (
            <MisalignedPrivateChat
              gameId={gameId}
              currentPlayer={currentPlayer}
              misalignedPlayers={misalignedPlayers}
            />
          )}

          {/* Public chat */}
          <PublicChat
            gameId={gameId}
            currentPlayer={currentPlayer}
            players={players}
            chatEnabled={chatEnabled}
          />
        </div>
      </div>
    </div>
  );
}
