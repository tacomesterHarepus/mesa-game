"use client";

import { useEffect, useRef } from "react";
import { MISSION_MAP } from "@/lib/game/missions";

interface LogEntry {
  id: string;
  event_type: string;
  public_description: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface Props {
  entries: LogEntry[];
}

export function GameLog({ entries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!mountedRef.current) {
      // First render: scroll to bottom regardless of position
      mountedRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }

    // New entry arrived: only follow if user is within 40px of bottom
    const distFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distFromBottom <= 40) {
      container.scrollTop = container.scrollHeight;
    }
  }, [entries.length]);

  // Single pass: track which mission is active at each entry's position
  const missionKeyAtIndex: string[] = [];
  let currentMissionKey = "";
  for (const entry of entries) {
    if (entry.event_type === "mission_selected") {
      const mk = entry.metadata.mission_key;
      if (typeof mk === "string") currentMissionKey = mk;
    }
    missionKeyAtIndex.push(currentMissionKey);
  }

  return (
    <div>
      <h3 className="label-caps mb-2">Log</h3>
      <div ref={containerRef} data-testid="game-log-container" className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {entries.map((entry, idx) => {
          const total = getRunningTotal(entry, missionKeyAtIndex[idx]);
          return (
            <div
              key={entry.id}
              className={`text-xs font-mono leading-relaxed ${isBoldEvent(entry.event_type) ? "text-foreground font-bold" : "text-faint"}`}
            >
              <span className="text-muted">{formatTime(entry.created_at)}</span>{" "}
              {entry.public_description}
              {total !== null && (
                <span className="text-muted ml-1">{total}</span>
              )}
            </div>
          );
        })}
        {entries.length === 0 && (
          <div className="text-xs font-mono text-faint">No events yet.</div>
        )}
      </div>
    </div>
  );
}

const BOLD_EVENT_TYPES = new Set([
  "mission_complete",
  "mission_failed",
  "mission_aborted",
  "game_over",
]);

function isBoldEvent(eventType: string): boolean {
  return BOLD_EVENT_TYPES.has(eventType);
}

function getRunningTotal(entry: LogEntry, missionKey: string): string | null {
  if (entry.event_type !== "card_played") return null;
  const { metadata: meta } = entry;
  if (meta.failed === true) return null;
  const progress = meta.mission_progress;
  if (!progress || typeof progress !== "object") return null;
  const cardType = meta.card_type;
  if (typeof cardType !== "string") return null;
  const current = (progress as Record<string, unknown>)[cardType];
  if (typeof current !== "number") return null;
  const mission = missionKey ? MISSION_MAP[missionKey] : undefined;
  const required =
    mission?.requirements[cardType as "compute" | "data" | "validation"];
  if (typeof required !== "number") return null;
  return `(${current}/${required})`;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
