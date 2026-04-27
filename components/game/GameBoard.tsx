"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ResourcePhase } from "./phases/ResourcePhase";
import { MissionSelection } from "./phases/MissionSelection";
import { CardReveal } from "./phases/CardReveal";
import { PlayerTurn } from "./phases/PlayerTurn";
import { VirusPull } from "./phases/VirusPull";
import { VirusResolution } from "./phases/VirusResolution";
import { SecretTargeting } from "./phases/SecretTargeting";
import { GameOver } from "./phases/GameOver";
import { DevModeOverlay } from "./DevModeOverlay";
import { TopBar } from "./board/TopBar";
import { TrackerBars } from "./board/TrackerBars";
import { HumanTerminals } from "./board/HumanTerminals";
import { MissionPanel } from "./board/MissionPanel";
import { MissionCandidatesPanel } from "./board/MissionCandidatesPanel";
import { VirusPoolPanel } from "./board/VirusPoolPanel";
import { CentralBoard, type ResourceChipConfig, type RevealChipConfig } from "./board/CentralBoard";
import { ActionRegion } from "./board/ActionRegion";
import { RightPanel } from "./board/RightPanel";
import { MISSION_MAP } from "@/lib/game/missions";
import type { Game } from "@/types/game";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
type ActiveMission = Database["public"]["Tables"]["active_mission"]["Row"];
type LogEntry = Database["public"]["Tables"]["game_log"]["Row"];
type HandCard = Database["public"]["Tables"]["hands"]["Row"];

const CPU_MIN = 1;
const CPU_MAX = 4;
const RAM_MIN = 3;
const RAM_MAX = 7;

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
  const [missionSelected, setMissionSelected] = useState<string | null>(null);
  const [resPendingCpu, setResPendingCpu] = useState<Record<string, number>>({});
  const [resPendingRam, setResPendingRam] = useState<Record<string, number>>({});

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

      // game_log poll backup: Realtime INSERT can be missed silently; poll catches stragglers.
      // Fetches the 50 most-recent rows and appends any not yet in state. gameId is referenced
      // only in the query (captured at useEffect setup); setLog uses a functional update so
      // prev is current at apply time, no stale-closure risk on game switch.
      // Assumes game_log is append-only — no edge function ever DELETEs from it.
      const { data: recentLog } = await supabase
        .from("game_log")
        .select("*")
        .eq("game_id", gameId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (recentLog && recentLog.length > 0) {
        setLog((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newRows = recentLog.filter((r) => !existingIds.has(r.id)).reverse();
          return newRows.length > 0 ? [...prev, ...newRows] : prev;
        });
      }

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

  // Reset phase-local state when leaving their respective phases
  useEffect(() => {
    if (game.phase !== "mission_selection") setMissionSelected(null);
  }, [game.phase]);

  useEffect(() => {
    const isResPhase = game.phase === "resource_adjustment" || game.phase === "resource_allocation";
    if (!isResPhase) {
      setResPendingCpu({});
      setResPendingRam({});
    }
  }, [game.phase]);

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

  // ── Resource phase chip config ────────────────────────────────────────────
  // Compute per-player ResourceChipConfig when in a resource phase.
  // State (resPendingCpu / resPendingRam) is lifted here so both CentralBoard
  // (visual) and ResourcePhase (Confirm payload) read from a single source.

  const isResPhase =
    game.phase === "resource_adjustment" || game.phase === "resource_allocation";
  const resMode = game.phase === "resource_allocation" ? "allocation" : "adjustment";
  const isViewerHuman = effectiveCurrentPlayer?.role === "human";

  // Pool sizes — only meaningful in allocation mode
  const missionDef =
    isResPhase && resMode === "allocation" && mission
      ? (MISSION_MAP[mission.mission_key] ?? null)
      : null;
  const cpuPool = missionDef?.allocation.cpu ?? 0;
  const ramPool = missionDef?.allocation.ram ?? 0;
  const totalResCpu = Object.values(resPendingCpu).reduce((a, b) => a + b, 0);
  const totalResRam = Object.values(resPendingRam).reduce((a, b) => a + b, 0);

  // Build per-player chip configs (rendered in CentralBoard)
  const resourceChips: Record<string, ResourceChipConfig> | undefined = isResPhase
    ? Object.fromEntries(
        aiPlayers.map((player) => {
          const pendCpu = resPendingCpu[player.id] ?? 0;
          const pendRam = resPendingRam[player.id] ?? 0;

          // Adjustment: [-] = remove more (delta +1), [+] = undo removal (delta -1)
          // Allocation: [+] = allocate more (delta +1), [-] = undo allocation (delta -1)
          const applyCpu = (delta: number) => {
            const next = pendCpu + delta;
            if (next < 0) return;
            if (resMode === "adjustment" && player.cpu - next < CPU_MIN) return;
            if (resMode === "allocation") {
              if (player.cpu + next > CPU_MAX) return;
              if (totalResCpu - pendCpu + next > cpuPool) return;
            }
            setResPendingCpu((prev) => ({ ...prev, [player.id]: next }));
          };
          const applyRam = (delta: number) => {
            const next = pendRam + delta;
            if (next < 0) return;
            if (resMode === "adjustment" && player.ram - next < RAM_MIN) return;
            if (resMode === "allocation") {
              if (player.ram + next > RAM_MAX) return;
              if (totalResRam - pendRam + next > ramPool) return;
            }
            setResPendingRam((prev) => ({ ...prev, [player.id]: next }));
          };

          const cfg: ResourceChipConfig = {
            mode: resMode,
            pendingCpu: pendCpu,
            pendingRam: pendRam,
            cpuMinus: isViewerHuman
              ? {
                  enabled:
                    resMode === "adjustment"
                      ? player.cpu - pendCpu > CPU_MIN
                      : pendCpu > 0,
                  onClick: () => applyCpu(resMode === "adjustment" ? +1 : -1),
                }
              : null,
            cpuPlus: isViewerHuman
              ? {
                  enabled:
                    resMode === "adjustment"
                      ? pendCpu > 0
                      : totalResCpu < cpuPool && player.cpu + pendCpu < CPU_MAX,
                  onClick: () => applyCpu(resMode === "adjustment" ? -1 : +1),
                }
              : null,
            ramMinus: isViewerHuman
              ? {
                  enabled:
                    resMode === "adjustment"
                      ? player.ram - pendRam > RAM_MIN
                      : pendRam > 0,
                  onClick: () => applyRam(resMode === "adjustment" ? +1 : -1),
                }
              : null,
            ramPlus: isViewerHuman
              ? {
                  enabled:
                    resMode === "adjustment"
                      ? pendRam > 0
                      : totalResRam < ramPool && player.ram + pendRam < RAM_MAX,
                  onClick: () => applyRam(resMode === "adjustment" ? -1 : +1),
                }
              : null,
          };
          return [player.id, cfg];
        })
      )
    : undefined;

  // ── Card reveal chip config ───────────────────────────────────────────────
  const isRevealPhase = game.phase === "card_reveal";
  const revealSlots: Record<string, RevealChipConfig> | undefined = isRevealPhase
    ? Object.fromEntries(
        aiPlayers.map((player) => [
          player.id,
          {
            hasRevealed: player.has_revealed_card,
            revealedCardKey: player.revealed_card_key,
            isOwnSlot: effectiveCurrentPlayer?.id === player.id,
            ownerName: player.display_name,
          },
        ])
      )
    : undefined;

  function renderPhase() {
    switch (game.phase) {
      case "resource_adjustment":
        return (
          <ResourcePhase
            mode="adjustment"
            gameId={gameId}
            aiPlayers={aiPlayers as unknown as import("@/types/game").Player[]}
            currentPlayer={effectiveCurrentPlayer as import("@/types/game").Player | null}
            overridePlayerId={overridePlayerId}
            pendingCpu={resPendingCpu}
            pendingRam={resPendingRam}
          />
        );
      case "mission_selection":
        return (
          <MissionSelection
            gameId={gameId}
            currentPlayer={effectiveCurrentPlayer}
            overridePlayerId={overridePlayerId}
            selected={missionSelected}
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
          <ResourcePhase
            mode="allocation"
            gameId={gameId}
            aiPlayers={aiPlayers as unknown as import("@/types/game").Player[]}
            currentPlayer={effectiveCurrentPlayer as import("@/types/game").Player | null}
            overridePlayerId={overridePlayerId}
            missionKey={mission?.mission_key ?? ""}
            pendingCpu={resPendingCpu}
            pendingRam={resPendingRam}
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
      case "virus_pull":
        return (
          <VirusPull
            gameId={gameId}
            currentPlayer={effectiveCurrentPlayer}
            currentTurnPlayerId={game.current_turn_player_id ?? undefined}
            pendingPullCount={game.pending_pull_count ?? 0}
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

        {game.phase === "mission_selection" ? (
          <MissionCandidatesPanel
            pendingOptions={game.pending_mission_options}
            selected={missionSelected}
            onSelect={setMissionSelected}
            isHuman={effectiveCurrentPlayer?.role === "human"}
          />
        ) : (
          <>
            <MissionPanel mission={mission} />
            <VirusPoolPanel />
          </>
        )}

        <CentralBoard
          aiPlayers={aiPlayers}
          coreProgress={game.core_progress}
          // Suppress active-chip styling during resource + reveal phases (no single "active" AI)
          currentTurnPlayerId={
            isResPhase || isRevealPhase ? undefined : (game.current_turn_player_id ?? undefined)
          }
          turnOrderIds={game.turn_order_ids ?? []}
          resourceChips={resourceChips}
          revealSlots={revealSlots}
        />

        <ActionRegion
          phase={game.phase}
          isActivePlayer={
            ((game.phase === "player_turn" || game.phase === "between_turns" || game.phase === "virus_pull") &&
              !!effectiveCurrentPlayer &&
              effectiveCurrentPlayer.id === game.current_turn_player_id) ||
            (game.phase === "mission_selection" &&
              effectiveCurrentPlayer?.role === "human") ||
            ((game.phase === "resource_adjustment" ||
              game.phase === "resource_allocation") &&
              effectiveCurrentPlayer?.role === "human") ||
            (game.phase === "card_reveal" &&
              !!effectiveCurrentPlayer &&
              effectiveCurrentPlayer.role !== "human" &&
              !effectiveCurrentPlayer.has_revealed_card)
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
