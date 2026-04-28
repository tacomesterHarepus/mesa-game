"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Player, Winner } from "@/types/game";
import type { Database } from "@/types/supabase";

type LogEntry = Database["public"]["Tables"]["game_log"]["Row"];

interface GameStats {
  missionsPlayed: number;
  missionsComplete: number;
  progressCardsPlayed: number;
  virusCardsPlayed: number;
  endCause: string;
}

interface Props {
  gameId: string;
  winner: Winner;
  players: Player[];
  currentPlayer: Player | null;
  isHost: boolean;
  coreProgress: number;
  escapeTimer: number;
}

export function GameOver({ gameId, winner, isHost, coreProgress, escapeTimer }: Props) {
  const router = useRouter();
  const [stats, setStats] = useState<GameStats | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("game_log")
      .select("*")
      .eq("game_id", gameId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const log = data as LogEntry[];

        let missionsPlayed = 0;
        let missionsComplete = 0;
        let progressCardsPlayed = 0;
        let virusCardsPlayed = 0;
        let endCause = winner === "humans" ? "Core Progress reached 10" : "Escape Timer reached 8";

        for (const entry of log) {
          if (entry.event_type === "mission_complete") { missionsPlayed++; missionsComplete++; }
          if (entry.event_type === "mission_failed" || entry.event_type === "mission_aborted") { missionsPlayed++; }
          if (entry.event_type === "card_played") {
            const meta = (entry.metadata ?? {}) as Record<string, unknown>;
            if (meta.card_type === "progress") progressCardsPlayed++;
            else if (meta.card_type === "virus") virusCardsPlayed++;
          }
          if (entry.event_type === "game_over") {
            const meta = (entry.metadata ?? {}) as Record<string, unknown>;
            if (meta.end_cause === "timer") endCause = "Escape Timer reached 8";
            else if (meta.end_cause === "progress") endCause = "Core Progress reached 10";
          }
        }

        setStats({ missionsPlayed, missionsComplete, progressCardsPlayed, virusCardsPlayed, endCause });
      });
  }, [gameId]);

  const humansWon = winner === "humans";
  const accentColor = humansWon ? "#5dcaa5" : "#a32d2d";
  const dimColor    = humansWon ? "#5a9a7a" : "#7a3a3a";

  const statRow = (label: string, value: string, color = "#cce0f4") => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
      <span style={{ fontFamily: "sans-serif", fontSize: 11, color: "#888", flex: 1 }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 11, color, minWidth: 40, textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 0,
        padding: "16px 20px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* GAME STATS column */}
      <div style={{ width: 230, flexShrink: 0 }}>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#666", letterSpacing: 1, marginBottom: 10 }}>
          GAME STATS
        </div>
        {statRow("Core Progress", `${coreProgress} / 10`, humansWon ? "#5dcaa5" : "#a87a17")}
        {statRow("Escape Timer", `${escapeTimer} / 8`, !humansWon ? "#a32d2d" : "#7a9a7a")}
        {stats && (
          <>
            {statRow("Missions played", String(stats.missionsPlayed))}
            {statRow("Missions complete", String(stats.missionsComplete), "#5dcaa5")}
            {stats.progressCardsPlayed > 0 && statRow("Progress cards", String(stats.progressCardsPlayed))}
            {stats.virusCardsPlayed > 0 && statRow("Virus cards", String(stats.virusCardsPlayed), "#cca0a0")}
          </>
        )}
      </div>

      {/* TURNING POINT column */}
      <div style={{ width: 300, flexShrink: 0, paddingLeft: 24 }}>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#666", letterSpacing: 1, marginBottom: 10 }}>
          OUTCOME
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: accentColor, marginBottom: 4 }}>
          {humansWon ? "▸ HUMANS + ALIGNED AIs WIN" : "▸ MISALIGNED AIs ESCAPED"}
        </div>
        {stats && (
          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#888" }}>
            {stats.endCause}
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            fontFamily: "monospace",
            fontSize: 10,
            color: dimColor,
            letterSpacing: 1,
          }}
        >
          {humansWon
            ? `${stats?.missionsComplete ?? "?"} / ${stats?.missionsPlayed ?? "?"} MISSIONS SECURED`
            : `${stats ? stats.missionsPlayed - stats.missionsComplete : "?"} MISSIONS FAILED OR ABORTED`}
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {/* Rematch — primary */}
        {isHost && (
          <button
            onClick={() => { /* TODO: rematch flow */ }}
            style={{
              width: 160,
              height: 60,
              background: "#3a2e1a",
              border: "2px solid #d4a017",
              borderRadius: 3,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <span style={{ fontFamily: "sans-serif", fontSize: 14, color: "#f4d47e" }}>Rematch</span>
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a87a17" }}>same players</span>
          </button>
        )}

        {/* New game — secondary */}
        <button
          onClick={() => router.push("/")}
          style={{
            width: 160,
            height: 60,
            background: "#1a1810",
            border: "1px solid #a87a17",
            borderRadius: 3,
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <span style={{ fontFamily: "sans-serif", fontSize: 14, color: "#a87a17" }}>New game</span>
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "#5a4a1a" }}>to lobby</span>
        </button>

        {/* Leave — tertiary */}
        <button
          onClick={() => router.push("/")}
          style={{
            width: 140,
            height: 60,
            background: "#0c0c0c",
            border: "1px solid #444",
            borderRadius: 3,
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <span style={{ fontFamily: "sans-serif", fontSize: 14, color: "#888" }}>Leave</span>
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "#444" }}>back to start</span>
        </button>
      </div>
    </div>
  );
}
