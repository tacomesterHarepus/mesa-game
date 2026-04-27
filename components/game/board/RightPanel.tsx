"use client";

import { useState, useEffect, useRef } from "react";
import { PublicChat } from "@/components/chat/PublicChat";
import { MisalignedPrivateChat } from "@/components/chat/MisalignedPrivateChat";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];
type LogEntry = Database["public"]["Tables"]["game_log"]["Row"];

interface Props {
  log: LogEntry[];
  gameId: string;
  currentPlayer: PlayerRow | null;
  allPlayers: PlayerRow[];
  phase: string;
  currentTurnPlayerId: string | null;
}

const BOLD_EVENTS = new Set([
  "mission_complete",
  "mission_failed",
  "mission_aborted",
  "game_over",
]);

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function canPostPublic(
  phase: string,
  currentPlayer: PlayerRow | null,
  currentTurnPlayerId: string | null
): boolean {
  if (!currentPlayer) return false;
  if (phase === "secret_targeting") return false;
  if (phase === "player_turn") {
    return currentPlayer.role === "human" || currentPlayer.id === currentTurnPlayerId;
  }
  if (["virus_pull", "virus_resolution", "between_turns", "game_over"].includes(phase)) return true;
  return currentPlayer.role === "human";
}

function canPostPrivate(phase: string): boolean {
  return !["mission_selection", "resource_adjustment", "resource_allocation"].includes(phase);
}

type TabId = "log" | "chat" | "private";

type TabDef = {
  id: TabId;
  label: string;
  activeColor: string;
  unread?: number;
};

export function RightPanel({
  log,
  gameId,
  currentPlayer,
  allPlayers,
  phase,
  currentTurnPlayerId,
}: Props) {
  const isMisaligned = currentPlayer?.role === "misaligned_ai";
  const [activeTab, setActiveTab] = useState<TabId>("log");
  const activeTabRef = useRef<TabId>("log");
  const [chatUnread, setChatUnread] = useState(0);
  const [privateUnread, setPrivateUnread] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Keep ref in sync for stale-closure-safe callbacks in child components
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  function switchTab(id: TabId) {
    setActiveTab(id);
    if (id === "chat") setChatUnread(0);
    if (id === "private") setPrivateUnread(0);
  }

  function handleNewChatMessage() {
    if (activeTabRef.current !== "chat") setChatUnread((n) => n + 1);
  }

  function handleNewPrivateMessage() {
    if (activeTabRef.current !== "private") setPrivateUnread((n) => n + 1);
  }

  const misalignedPlayers = allPlayers.filter((p) => p.role === "misaligned_ai");

  const tabs: TabDef[] = [
    { id: "log", label: "LOG", activeColor: "#d4a017" },
    { id: "chat", label: "CHAT", activeColor: "#5dcaa5", unread: chatUnread },
    ...(isMisaligned
      ? [{ id: "private" as TabId, label: "🔒 PRIV", activeColor: "#a32d2d", unread: privateUnread }]
      : []),
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
        {tabs.map(({ id, label, activeColor, unread }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => switchTab(id)}
              style={{
                background: "none",
                border: "none",
                padding: "0 0 6px 0",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                letterSpacing: 2,
                color: isActive ? activeColor : "#444",
                borderBottom: isActive ? `2px solid ${activeColor}` : "2px solid transparent",
                position: "relative",
              }}
            >
              {label}
              {unread && unread > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -8,
                    background: activeColor,
                    color: "#0a0a0a",
                    fontSize: 8,
                    fontFamily: "monospace",
                    borderRadius: 2,
                    padding: "0 3px",
                    lineHeight: "14px",
                  }}
                >
                  {unread > 9 ? "9+" : String(unread)}
                </span>
              ) : null}
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
        {activeTab === "log" && (
          <div
            ref={logRef}
            data-testid="game-log-container"
            style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}
          >
            {log.length === 0 ? (
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "#555" }}>
                No events yet.
              </div>
            ) : (
              log.map((entry) => {
                const bold = BOLD_EVENTS.has(entry.event_type);
                return (
                  <div key={entry.id} style={{ marginBottom: 6, lineHeight: "1.4" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#555" }}>
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

        {activeTab === "chat" && (
          <PublicChat
            gameId={gameId}
            currentPlayer={currentPlayer}
            players={allPlayers}
            canPost={canPostPublic(phase, currentPlayer, currentTurnPlayerId)}
            onNewMessage={handleNewChatMessage}
          />
        )}

        {activeTab === "private" && isMisaligned && currentPlayer && (
          <MisalignedPrivateChat
            gameId={gameId}
            currentPlayer={currentPlayer}
            misalignedPlayers={misalignedPlayers}
            canPost={canPostPrivate(phase)}
            onNewMessage={handleNewPrivateMessage}
          />
        )}
      </div>
    </div>
  );
}
