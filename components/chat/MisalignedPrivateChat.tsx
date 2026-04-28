"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  gameId: string;
  currentPlayer: Player;
  misalignedPlayers: Player[];
  canPost: boolean;
  onNewMessage?: () => void;
}

export function MisalignedPrivateChat({ gameId, currentPlayer, misalignedPlayers, canPost, onNewMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onNewMsgRef = useRef(onNewMessage);
  useEffect(() => { onNewMsgRef.current = onNewMessage; }, [onNewMessage]);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const playerMap = Object.fromEntries(misalignedPlayers.map((p) => [p.id, p.display_name]));

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("chat_messages")
      .select("*")
      .eq("game_id", gameId)
      .eq("channel", "misaligned_private")
      .order("created_at")
      .then(({ data }) => setMessages(data ?? []));

    const channel = supabase
      .channel(`chat-misaligned-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as ChatMessage;
          if (row.channel === "misaligned_private") {
            setMessages((prev) => [...prev, row]);
            onNewMsgRef.current?.();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  // Poll backup — 3s id-dedup
  useEffect(() => {
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("game_id", gameId)
        .eq("channel", "misaligned_private")
        .order("created_at", { ascending: false })
        .limit(30);
      if (data && data.length > 0) {
        const existingIds = new Set(messagesRef.current.map((m) => m.id));
        const newRows = data.filter((r) => !existingIds.has(r.id)).reverse();
        const newCount = newRows.length;
        if (newCount > 0) {
          setMessages((prev) => {
            const prevIds = new Set(prev.map((m) => m.id));
            const toAdd = newRows.filter((r) => !prevIds.has(r.id));
            return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
          });
          for (let i = 0; i < newCount; i++) onNewMsgRef.current?.();
        }
      }
    }, 3000);
    return () => clearInterval(id);
  }, [gameId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !canPost) return;
    setSending(true);
    const supabase = createClient();
    await supabase.from("chat_messages").insert({
      game_id: gameId,
      player_id: currentPlayer.id,
      channel: "misaligned_private",
      message: input.trim(),
    });
    setInput("");
    setSending(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "5px 12px 4px", borderBottom: "1px solid #1e0808" }}>
        <span style={{ fontFamily: "monospace", fontSize: 8, color: "#8a1a1a", letterSpacing: 2 }}>
          {"▲ PRIVATE — MISALIGNED ONLY"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {messages.length === 0 ? (
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#555", letterSpacing: 1 }}>
            {"// NO MESSAGES YET"}
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 4, lineHeight: "1.4" }}>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "#8a3a3a" }}>
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
      <div style={{ padding: "8px 12px", borderTop: "1px solid #1e0808" }}>
        {canPost ? (
          <form onSubmit={handleSend} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder="Private message…"
              maxLength={200}
              style={{
                flex: 1,
                background: "#110808",
                border: "1px solid #2a1010",
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
                border: "1px solid #2a1010",
                borderRadius: 2,
                fontSize: 10,
                fontFamily: "monospace",
                color: "#8a3a3a",
                cursor: "pointer",
                opacity: sending || !input.trim() ? 0.4 : 1,
              }}
            >
              ↑
            </button>
          </form>
        ) : (
          <div style={{ fontFamily: "monospace", fontSize: 9, color: "#442020", letterSpacing: 1 }}>
            {"// LOCKED DURING MISSION SETUP"}
          </div>
        )}
      </div>
    </div>
  );
}
