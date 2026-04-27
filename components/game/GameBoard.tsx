"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ResourceAdjustment } from "./phases/ResourceAdjustment";
import { MissionSelection } from "./phases/MissionSelection";
import { CardReveal } from "./phases/CardReveal";
import { ResourceAllocation } from "./phases/ResourceAllocation";
import { PlayerTurn } from "./phases/PlayerTurn";
import { VirusResolution } from "./phases/VirusResolution";
import { SecretTargeting } from "./phases/SecretTargeting";
import { GameOver } from "./phases/GameOver";
import { DevModeOverlay } from "./DevModeOverlay";
import { TopBar } from "./board/TopBar";
import { TrackerBars } from "./board/TrackerBars";
import { HumanTerminals } from "./board/HumanTerminals";
import { MissionPanel } from "./board/MissionPanel";
import { VirusPoolPanel } from "./board/VirusPoolPanel";
import { CentralBoard } from "./board/CentralBoard";
import { ActionRegion } from "./board/ActionRegion";
import { RightPanel } from "./board/RightPanel";
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
      // Fetch game first — need current_mission_id to query active_mission by ID.
      // active_mission is a history table (one row per completed mission); querying
      // by game_id with maybeSingle() returns PGRST116 (multiple rows) on mission 2+.
      const { data: g } = await supabase.from("games").select("*").eq("id", gameId).single();
      if (g) setGame((prev) => ({ ...prev, ...(g as unknown as Partial<Game>) }));

      const missionId = g?.current_mission_id ?? null;
      const [{ data: p }, { data: m }] = await Promise.all([
        supabase.from("players").select("*").eq("game_id", gameId),
        missionId
          ? supabase.from("active_mission").select("*").eq("id", missionId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (p && p.length > 0) setPlayers(p);
      // m is null when there is no active mission (lobby, resource_adjustment, etc.) — that is valid
      if (m !== undefined) setMission(m);

      // Hand poll backup: avoids invisible cards when Realtime INSERT/DELETE is dropped.
      // Sort by id ensures stable display order across polls (hands table has no position column).
      if (handPlayerId && handPlayerRole !== "human") {
        const { data: h } = await supabase
          .from("hands").select("*")
          .eq("player_id", handPlayerId).eq("game_id", gameId);
        if (h) {
          const sorted = [...h].sort((a, b) => a.id.localeCompare(b.id));
          if (process.env.NODE_ENV !== "production") {
            console.log(`[hand poll] ${new Date().toISOString()} player=${handPlayerId.slice(0, 8)} ids=${sorted.map((c) => c.id.slice(0, 8)).join(",")}`);
          }
          setHand(sorted);
        }
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
              const newCard = payload.new as HandCard;
              if (process.env.NODE_ENV !== "production") {
                console.log(`[hand insert] ${new Date().toISOString()} card=${newCard.id.slice(0, 8)}`);
              }
              setHand((prev) => [...prev, newCard].sort((a, b) => a.id.localeCompare(b.id)));
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
    const pid = activeDevPlayer.id;
    supabase
      .from("hands")
      .select("*")
      .eq("player_id", pid)
      .then(({ data }) => {
        if (data) {
          const sorted = [...data].sort((a, b) => a.id.localeCompare(b.id));
          if (process.env.NODE_ENV !== "production") {
            console.log(`[hand switch] ${new Date().toISOString()} player=${pid.slice(0, 8)} ids=${sorted.map((c) => c.id.slice(0, 8)).join(",")}`);
          }
          setHand(sorted);
        }
      });
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

  // Humans first (stable by id), then AIs ascending by turn_order (seat order).
  // Human turn_order is null; do not use it for sorting.
  const sortedPlayers = [...players].sort((a, b) => {
    const aHuman = a.role === "human";
    const bHuman = b.role === "human";
    if (aHuman !== bHuman) return aHuman ? -1 : 1;
    if (aHuman) return a.id.localeCompare(b.id);
    return (a.turn_order ?? 0) - (b.turn_order ?? 0);
  });

  const currentTurnPlayer = players.find((p) => p.id === game.current_turn_player_id) ?? null;
  const overridePlayerId = devMode ? (activeDevPlayer?.id ?? undefined) : undefined;

  // Derived player lists for board regions
  const humanPlayers = sortedPlayers.filter((p) => p.role === "human");
  const aiPlayers = sortedPlayers.filter((p) => p.role !== "human");

  function renderPhase() {
    switch (game.phase) {
      case "resource_adjustment":
        return (
          <ResourceAdjustment
            gameId={gameId}
            players={sortedPlayers}
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
            players={sortedPlayers}
            currentPlayer={effectiveCurrentPlayer}
            hand={hand}
            overridePlayerId={overridePlayerId}
          />
        );
      case "resource_allocation":
        return (
          <ResourceAllocation
            gameId={gameId}
            players={sortedPlayers}
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
            players={sortedPlayers}
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
            players={sortedPlayers}
            currentPlayer={effectiveCurrentPlayer}
            isHost={isHost}
          />
        );
      default:
        return (
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "#555",
              letterSpacing: 2,
              padding: "16px 20px",
            }}
          >
            {"// SCAFFOLDING — NO PHASE ACTIVE"}
          </div>
        );
    }
  }

  return (
    // Outer wrapper: page background, horizontal scroll for small viewports
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        overflowX: "auto",
        paddingTop: devMode ? 24 : 0,
      }}
    >
      {devMode && (
        <DevModeOverlay
          players={sortedPlayers}
          activePlayer={activeDevPlayer}
          onSwitch={setActiveDevPlayer}
        />
      )}

      {/* Fixed 1440×900 board — all child elements absolutely positioned */}
      <div
        style={{
          position: "relative",
          width: 1440,
          height: 900,
          background: "#0a0a0a",
          overflow: "hidden",
        }}
      >
        <TopBar phase={game.phase} />

        <TrackerBars
          coreProgress={game.core_progress}
          escapeTimer={game.escape_timer}
        />

        <HumanTerminals humanPlayers={humanPlayers} />

        <MissionPanel mission={mission} />

        <VirusPoolPanel />

        <CentralBoard
          aiPlayers={aiPlayers}
          coreProgress={game.core_progress}
          currentTurnPlayerId={game.current_turn_player_id ?? undefined}
          turnOrderIds={game.turn_order_ids ?? []}
        />

        <ActionRegion
          phase={game.phase}
          isActivePlayer={
            (game.phase === "player_turn" || game.phase === "between_turns") &&
            !!effectiveCurrentPlayer &&
            effectiveCurrentPlayer.id === game.current_turn_player_id
          }
          currentTurnPlayerName={currentTurnPlayer?.display_name ?? undefined}
        >
          {renderPhase()}
        </ActionRegion>

        <RightPanel log={log} />
      </div>
    </div>
  );
}
