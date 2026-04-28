"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MISSION_MAP } from "@/lib/game/missions";
import type { Database } from "@/types/supabase";

type LogEntry = Database["public"]["Tables"]["game_log"]["Row"];

interface MissionOutcome {
  key: string;
  name: string;
  outcome: "complete" | "failed" | "aborted";
  delta: number;
  deltaLabel: string;
}

export function MissionSummaryPanel({ gameId }: { gameId: string }) {
  const [missions, setMissions] = useState<MissionOutcome[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("game_log")
      .select("*")
      .eq("game_id", gameId)
      .in("event_type", ["mission_complete", "mission_failed", "mission_aborted"])
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const outcomes: MissionOutcome[] = (data as LogEntry[]).map((entry) => {
          const meta = (entry.metadata ?? {}) as Record<string, unknown>;
          const key = String(meta.mission_key ?? "");
          const name = MISSION_MAP[key]?.name ?? key.replace(/_/g, " ");
          if (entry.event_type === "mission_complete") {
            const reward = Number(meta.reward ?? 0);
            return { key, name, outcome: "complete" as const, delta: reward, deltaLabel: `+${reward} progress` };
          }
          const penalty = Number(meta.penalty ?? 0);
          return {
            key, name,
            outcome: entry.event_type === "mission_aborted" ? "aborted" as const : "failed" as const,
            delta: penalty,
            deltaLabel: `FAIL · +${penalty} timer`,
          };
        });
        setMissions(outcomes);
      });
  }, [gameId]);

  const successes = missions.filter((m) => m.outcome === "complete").length;
  const failures = missions.filter((m) => m.outcome !== "complete").length;

  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        top: 180,
        width: 348,
        height: 500,
        background: "#0c0c0c",
        border: "1px solid #222",
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 32,
          minHeight: 32,
          background: "#161616",
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#d4a017", letterSpacing: 2 }}>
          MISSIONS · {successes} OF {missions.length} COMPLETE
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {missions.map((m, i) => {
          const isComplete = m.outcome === "complete";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "7px 12px",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  background: isComplete ? "#1a3a2a" : "#3a1a1a",
                  border: `0.5px solid ${isComplete ? "#5dcaa5" : "#a32d2d"}`,
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 10, color: isComplete ? "#5dcaa5" : "#a32d2d", lineHeight: 1 }}>
                  {isComplete ? "✓" : "✕"}
                </span>
              </div>
              <span style={{ fontFamily: "sans-serif", fontSize: 12, color: isComplete ? "#cce4d4" : "#cca0a0", flex: 1 }}>
                {m.name}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: isComplete ? "#5dcaa5" : "#a32d2d", whiteSpace: "nowrap" }}>
                {m.deltaLabel}
              </span>
            </div>
          );
        })}
        {missions.length === 0 && (
          <div style={{ padding: "12px", fontFamily: "monospace", fontSize: 11, color: "#555" }}>
            No missions played.
          </div>
        )}
      </div>

      {missions.length > 0 && (
        <div style={{ borderTop: "0.5px solid #1a1a1a", padding: "8px 12px" }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#666" }}>
            SUCCESSES · {successes}{"  ·  "}FAILURES · {failures}
          </span>
        </div>
      )}
    </div>
  );
}
