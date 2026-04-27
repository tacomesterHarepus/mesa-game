"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  players: PlayerRow[];
  activePlayer: PlayerRow | null;
  onSwitch: (player: PlayerRow) => void;
  gameId?: string;
  phase?: string;
  turnOrderIds?: string[] | null;
}

export function DevModeOverlay({
  players,
  activePlayer,
  onSwitch,
  gameId,
  phase,
  turnOrderIds,
}: Props) {
  const [revealing, setRevealing] = useState(false);

  async function handleRevealAll() {
    if (!gameId || !turnOrderIds) return;
    setRevealing(true);
    const supabase = createClient();

    for (const playerId of turnOrderIds) {
      const player = players.find((p) => p.id === playerId);
      if (!player || player.has_revealed_card) continue;

      const { data: hand } = await supabase
        .from("hands")
        .select("*")
        .eq("player_id", playerId)
        .eq("game_id", gameId);

      if (!hand || hand.length === 0) continue;

      const firstCard = [...hand].sort((a, b) => a.id.localeCompare(b.id))[0];
      await invokeWithRetry("reveal-card", {
        game_id: gameId,
        card_key: firstCard.card_key,
        override_player_id: playerId,
      });
    }

    setRevealing(false);
  }

  return (
    <>
      {/* Full-width banner */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber text-deep text-center text-xs font-mono font-bold tracking-widest uppercase py-1 pointer-events-none select-none">
        DEV MODE — single-user testing
      </div>

      {/* Player switcher panel */}
      <div className="fixed top-7 right-3 z-50 flex flex-col gap-1 items-end">
        <span className="text-faint text-xs font-mono tracking-widest uppercase mb-1">
          Active player
        </span>
        {players.map((p) => {
          const isActive = p.id === activePlayer?.id;
          return (
            <button
              key={p.id}
              data-player-id={p.id}
              onClick={() => onSwitch(p)}
              className={[
                "px-2 py-1 text-xs font-mono rounded border transition-colors",
                p.role === "misaligned_ai" ? "ring-1 ring-virus" : "",
                isActive
                  ? "border-amber text-amber bg-surface"
                  : "border-border text-muted bg-base hover:border-muted hover:text-primary",
              ].join(" ")}
            >
              {p.display_name}
              {p.role ? (
                <span className="ml-1 opacity-50">
                  {p.role === "human" ? "H" : p.role === "aligned_ai" ? "A" : "M"}
                </span>
              ) : null}
            </button>
          );
        })}

        {phase === "card_reveal" && (
          <button
            onClick={handleRevealAll}
            disabled={revealing}
            className="mt-2 px-2 py-1 text-xs font-mono rounded border border-border text-muted bg-base hover:border-muted hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {revealing ? "Revealing…" : "Reveal All"}
          </button>
        )}
      </div>
    </>
  );
}
