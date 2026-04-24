"use client";

import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  players: PlayerRow[];
  activePlayer: PlayerRow | null;
  onSwitch: (player: PlayerRow) => void;
}

export function DevModeOverlay({ players, activePlayer, onSwitch }: Props) {
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
      </div>
    </>
  );
}
