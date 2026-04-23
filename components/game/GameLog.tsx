"use client";

import { useEffect, useRef } from "react";

interface LogEntry {
  id: string;
  event_type: string;
  public_description: string;
  created_at: string;
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
          <div key={entry.id} className="text-xs font-mono text-faint leading-relaxed">
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

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
