"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  players: Player[];
  canPost: boolean;
  onNewMessage?: () => void;
}

export function PublicChat({ gameId, currentPlayer, players, canPost, onNewMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onNewMsgRef = useRef(onNewMessage);
  useEffect(() => { onNewMsgRef.current = onNewMessage; }, [onNewMessage]);

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p.display_name]));

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("chat_messages")
      .select("*")
      .eq("game_id", gameId)
      .eq("channel", "public")
      .order("created_at")
      .then(({ data }) => setMessages(data ?? []));

    const channel = supabase
      .channel(`chat-public-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as ChatMessage;
          if (row.channel === "public") {
            setMessages((prev) => [...prev, row]);
            onNewMsgRef.current?.();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  // Poll backup — 3s id-dedup catches Realtime misses
  useEffect(() => {
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("game_id", gameId)
        .eq("channel", "public")
        .order("created_at", { ascending: false })
        .limit(30);
      if (data && data.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newRows = data.filter((r) => !existingIds.has(r.id)).reverse();
          if (newRows.length > 0) {
            newRows.forEach(() => onNewMsgRef.current?.());
            return [...prev, ...newRows];
          }
          return prev;
        });
      }
    }, 3000);
    return () => clearInterval(id);
  }, [gameId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !currentPlayer || !canPost) return;
    setSending(true);
    const supabase = createClient();
    await supabase.from("chat_messages").insert({
      game_id: gameId,
      player_id: currentPlayer.id,
      channel: "public",
      message: input.trim(),
    });
    setInput("");
    setSending(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {messages.length === 0 ? (
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#555", letterSpacing: 1 }}>
            {"// NO MESSAGES YET"}
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 4, lineHeight: "1.4" }}>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#666" }}>
                {playerMap[msg.player_id] ?? "?"}:{" "}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#ccc" }}>
                {msg.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid #1a1a1a" }}>
        {canPost ? (
          <form onSubmit={handleSend} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder="Message…"
              maxLength={200}
              style={{
                flex: 1,
                background: "#111",
                border: "1px solid #2a2a2a",
                borderRadius: 2,
                padding: "4px 8px",
                fontSize: 10,
                fontFamily: "monospace",
                color: "#ccc",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              style={{
                padding: "4px 10px",
                background: "none",
                border: "1px solid #2a2a2a",
                borderRadius: 2,
                fontSize: 10,
                fontFamily: "monospace",
                color: "#666",
                cursor: "pointer",
                opacity: sending || !input.trim() ? 0.4 : 1,
              }}
            >
              ↑
            </button>
          </form>
        ) : (
          <div style={{ fontFamily: "monospace", fontSize: 9, color: "#444", letterSpacing: 1 }}>
            {"// LOCKED"}
          </div>
        )}
      </div>
    </div>
  );
}
