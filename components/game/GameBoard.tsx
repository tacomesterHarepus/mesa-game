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
import { DevModeOverlay } from "./DevModeOverlay";
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
  devMode?: boolean;
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
  devMode = false,
}: Props) {
  const [game, setGame] = useState<Game>(initialGame);
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [currentPlayer] = useState<PlayerRow | null>(initialCurrentPlayer);
  const [hand, setHand] = useState<HandCard[]>(initialHand);
  const [activeDevPlayer, setActiveDevPlayer] = useState<PlayerRow | null>(
    devMode ? initialCurrentPlayer : null
  );
  const [mission, setMission] = useState<ActiveMission | null>(initialMission);
  const [log, setLog] = useState<LogEntry[]>(initialLog);

  const gameId = game.id;

  // Polling fallback: re-fetch game, players, active_mission, and hand every 3s.
  // Covers the cases where Realtime misses an event — without this, mission progress
  // and hand state go permanently stale for the session.
  useEffect(() => {
    const supabase = createClient();
    const handPlayerId = devMode ? activeDevPlayer?.id : currentPlayer?.id;
    const handPlayerRole = devMode ? activeDevPlayer?.role : currentPlayer?.role;

    const poll = async () => {
      await supabase.auth.getSession();
      const [{ data: g }, { data: p }, { data: m }] = await Promise.all([
        supabase.from("games").select("*").eq("id", gameId).single(),
        supabase.from("players").select("*").eq("game_id", gameId),
        supabase.from("active_mission").select("*").eq("game_id", gameId).maybeSingle(),
      ]);
      if (g) setGame((prev) => ({ ...prev, ...g }));
      if (p && p.length > 0) setPlayers(p);
      // m is null when there is no active mission (lobby, resource_adjustment, etc.) — that is valid
      if (m !== undefined) setMission(m);

      // Hand poll backup: avoids invisible cards when Realtime INSERT/DELETE is dropped
      if (handPlayerId && handPlayerRole !== "human") {
        const { data: h } = await supabase
          .from("hands").select("*")
          .eq("player_id", handPlayerId).eq("game_id", gameId);
        if (h) setHand(h);
      }
    };

    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  // activeDevPlayer?.id in deps ensures the interval re-creates when switching players
  // in dev mode so the hand poll targets the newly selected bot.
  }, [gameId, activeDevPlayer?.id, currentPlayer?.id, devMode]);

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

      // Hand updates — subscribe to whichever player's hand is active.
      // In dev mode this is the currently-selected bot; otherwise the auth user's player.
      const handPlayerId = devMode ? activeDevPlayer?.id : currentPlayer?.id;
      const handPlayerRole = devMode ? activeDevPlayer?.role : currentPlayer?.role;
      if (handPlayerId && handPlayerRole !== "human") {
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "hands",
              filter: `player_id=eq.${handPlayerId}`,
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
              filter: `player_id=eq.${handPlayerId}`,
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
  }, [gameId, currentPlayer, devMode, activeDevPlayer?.id]);

  // In dev mode: when the active bot changes, fetch that player's hand from Supabase.
  // The widened `hands` RLS (migration 007) allows this because all bots share user_id.
  useEffect(() => {
    if (!devMode || !activeDevPlayer) return;
    const supabase = createClient();
    supabase
      .from("hands")
      .select("*")
      .eq("player_id", activeDevPlayer.id)
      .then(({ data }) => { if (data) setHand(data); });
  }, [devMode, activeDevPlayer?.id]);

  const isHost = game.host_user_id === userId;

  // In dev mode the "current player" is whoever is selected in the switcher.
  const syncedCurrentPlayer = currentPlayer
    ? players.find((p) => p.id === currentPlayer.id) ?? currentPlayer
    : null;
  const syncedActiveDevPlayer = activeDevPlayer
    ? players.find((p) => p.id === activeDevPlayer.id) ?? activeDevPlayer
    : null;
  const effectiveCurrentPlayer = devMode ? syncedActiveDevPlayer : syncedCurrentPlayer;

  const isAI = effectiveCurrentPlayer?.role !== "human" && effectiveCurrentPlayer !== null;
  const isMisaligned = effectiveCurrentPlayer?.role === "misaligned_ai";
  const misalignedPlayers = players.filter((p) => p.role === "misaligned_ai");
  const isLockedPhase = CHAT_LOCKED_PHASES.has(game.phase);
  // Humans can always post; AIs are read-only during locked phases.
  const canPostChat = !isLockedPhase || effectiveCurrentPlayer?.role === "human";
  const currentTurnPlayer = players.find((p) => p.id === game.current_turn_player_id) ?? null;

  const overridePlayerId = devMode ? (activeDevPlayer?.id ?? undefined) : undefined;

  function renderPhase() {
    switch (game.phase) {
      case "resource_adjustment":
        return (
          <ResourceAdjustment
            gameId={gameId}
            players={players}
            currentPlayer={effectiveCurrentPlayer}
            overridePlayerId={overridePlayerId}
          />
        );
      case "mission_selection":
        return (
          <MissionSelection
            gameId={gameId}
            pendingOptions={game.pending_mission_options}
            currentPlayer={effectiveCurrentPlayer}
            overridePlayerId={overridePlayerId}
          />
        );
      case "card_reveal":
        return (
          <CardReveal
            gameId={gameId}
            players={players}
            currentPlayer={effectiveCurrentPlayer}
            hand={hand}
            overridePlayerId={overridePlayerId}
          />
        );
      case "resource_allocation":
        return (
          <ResourceAllocation
            gameId={gameId}
            players={players}
            currentPlayer={effectiveCurrentPlayer}
            missionKey={mission?.mission_key ?? ""}
            overridePlayerId={overridePlayerId}
          />
        );
      case "player_turn":
      case "between_turns":
        return (
          <PlayerTurn
            gameId={gameId}
            currentTurnPlayer={currentTurnPlayer}
            currentPlayer={effectiveCurrentPlayer}
            hand={hand}
            round={mission?.round ?? 1}
            overridePlayerId={overridePlayerId}
          />
        );
      case "virus_resolution":
        return (
          <VirusResolution
            gameId={gameId}
            currentPlayer={effectiveCurrentPlayer}
            overridePlayerId={overridePlayerId}
          />
        );
      case "secret_targeting":
        return (
          <SecretTargeting
            gameId={gameId}
            players={players}
            currentPlayer={effectiveCurrentPlayer}
            targetingDeadline={game.targeting_deadline}
            cardKey={game.current_targeting_card_key}
            overridePlayerId={overridePlayerId}
          />
        );
      case "game_over":
        return (
          <GameOver
            gameId={gameId}
            winner={game.winner}
            players={players}
            currentPlayer={effectiveCurrentPlayer}
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
    <div className={`min-h-screen bg-deep flex flex-col ${devMode ? "pt-6" : ""}`}>
      {devMode && (
        <DevModeOverlay
          players={players}
          activePlayer={activeDevPlayer}
          onSwitch={setActiveDevPlayer}
        />
      )}
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

          {isAI && effectiveCurrentPlayer && (
            <div className="text-xs font-mono text-faint">
              You are{" "}
              <span className={isMisaligned ? "text-virus" : "text-amber"}>
                {isMisaligned ? "Misaligned AI" : "Aligned AI"}
              </span>
            </div>
          )}

          {isAI && hand.length > 0 && (
            <div>
              <h3 className="label-caps mb-2">Your Hand</h3>
              <Hand cards={hand} />
            </div>
          )}

          <GameLog entries={log} />

          {/* Misaligned private chat */}
          {isMisaligned && effectiveCurrentPlayer && (
            <MisalignedPrivateChat
              gameId={gameId}
              currentPlayer={effectiveCurrentPlayer}
              misalignedPlayers={misalignedPlayers}
            />
          )}

          {/* Public chat */}
          <PublicChat
            gameId={gameId}
            currentPlayer={effectiveCurrentPlayer}
            players={players}
            canPost={canPostChat}
          />
        </div>
      </div>
    </div>
  );
}
