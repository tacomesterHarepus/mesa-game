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
  chatEnabled: boolean;
}

export function PublicChat({ gameId, currentPlayer, players, chatEnabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          if (row.channel === "public") {
            setMessages((prev) => [...prev, row]);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !currentPlayer || !chatEnabled) return;
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
    <div className="flex flex-col h-full">
      <h3 className="label-caps mb-2">Chat</h3>
      <div className="flex-1 overflow-y-auto space-y-1 mb-2 min-h-0 max-h-40 pr-1">
        {messages.map((msg) => (
          <div key={msg.id} className="text-xs font-mono">
            <span className="text-muted">{playerMap[msg.player_id] ?? "?"}: </span>
            <span className="text-primary">{msg.message}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-faint text-xs font-mono">No messages yet.</div>
        )}
        <div ref={bottomRef} />
      </div>
      {currentPlayer && (
        <form onSubmit={handleSend} className="flex gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!chatEnabled || sending}
            placeholder={chatEnabled ? "Message…" : "Chat locked"}
            maxLength={200}
            className="flex-1 bg-base border border-border rounded px-2 py-1 text-xs font-mono text-primary placeholder:text-faint focus:outline-none focus:border-muted disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!chatEnabled || sending || !input.trim()}
            className="px-2 py-1 bg-surface border border-border rounded text-xs font-mono text-muted hover:text-primary disabled:opacity-40"
          >
            ↑
          </button>
        </form>
      )}
    </div>
  );
}
