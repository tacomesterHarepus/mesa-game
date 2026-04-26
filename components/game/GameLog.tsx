"use client";

import { useEffect, useRef } from "react";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div>
      <h3 className="label-caps mb-2">Log</h3>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`text-xs font-mono leading-relaxed ${isBoldEvent(entry.event_type) ? "text-foreground font-bold" : "text-faint"}`}
          >
            <span className="text-muted">{formatTime(entry.created_at)}</span>{" "}
            {entry.public_description}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-xs font-mono text-faint">No events yet.</div>
        )}
        <div ref={bottomRef} />
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

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
