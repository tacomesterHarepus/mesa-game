"use client";

import { useState, useEffect, useRef } from "react";

interface LogEntry {
  id: string;
  event_type: string;
  public_description: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface Props {
  log: LogEntry[];
}

const BOLD_EVENTS = new Set([
  "mission_complete",
  "mission_failed",
  "mission_aborted",
  "game_over",
]);

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

export function RightPanel({ log }: Props) {
  const [activeTab, setActiveTab] = useState<"log" | "chat">("log");
  const logRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Scroll to bottom on first mount; auto-follow if near bottom
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= 40) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log.length]);

  const tabs = [
    { id: "log" as const, label: "LOG", activeColor: "#d4a017" },
    { id: "chat" as const, label: "CHAT", activeColor: "#5dcaa5" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        left: 1100,
        top: 75,
        width: 308,
        height: 815,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tab strip */}
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "flex-end",
          paddingLeft: 16,
          gap: 20,
        }}
      >
        {tabs.map(({ id, label, activeColor }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                background: "none",
                border: "none",
                padding: "0 0 6px 0",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                letterSpacing: 2,
                color: isActive ? activeColor : "#444",
                borderBottom: isActive
                  ? `2px solid ${activeColor}`
                  : "2px solid transparent",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Panel body */}
      <div
        style={{
          flex: 1,
          background: "#0c0c0c",
          border: "1px solid #222",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* LOG tab */}
        {activeTab === "log" && (
          <div
            ref={logRef}
            data-testid="game-log-container"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 16px",
            }}
          >
            {log.length === 0 ? (
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#555",
                }}
              >
                No events yet.
              </div>
            ) : (
              log.map((entry) => {
                const bold = BOLD_EVENTS.has(entry.event_type);
                return (
                  <div
                    key={entry.id}
                    style={{ marginBottom: 6, lineHeight: "1.4" }}
                  >
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "#555",
                      }}
                    >
                      {formatTime(entry.created_at)}{" "}
                    </span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: bold ? "#e0e0e0" : "#888",
                        fontWeight: bold ? "bold" : "normal",
                      }}
                    >
                      {entry.public_description}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* CHAT tab — placeholder until Phase 12 */}
        {activeTab === "chat" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 10,
                color: "#555",
                letterSpacing: 1,
              }}
            >
              {"// CHAT PANEL COMING IN PHASE 12"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
