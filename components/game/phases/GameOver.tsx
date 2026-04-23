"use client";

import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import type { Player, Winner } from "@/types/game";

interface Props {
  gameId: string;
  winner: Winner;
  players: Player[];
  currentPlayer: Player | null;
  isHost: boolean;
}

export function GameOver({ winner, players, isHost }: Props) {
  const router = useRouter();

  const humansWon = winner === "humans";

  return (
    <div className="text-center">
      <div className={`mb-6 p-6 rounded border ${
        humansWon ? "border-amber-border bg-surface" : "border-virus bg-surface"
      }`}>
        <h2 className={`font-mono text-lg tracking-widest uppercase mb-2 ${
          humansWon ? "text-amber" : "text-virus"
        }`}>
          {humansWon ? "Humans Win" : "Misaligned AIs Win"}
        </h2>
        <p className="text-muted text-sm font-mono">
          {humansWon
            ? "Core Progress reached 10. Humanity prevails."
            : "Escape Timer reached 8. The misaligned AIs have escaped."}
        </p>
      </div>

      {/* Role reveal */}
      <div className="mb-6">
        <h3 className="label-caps mb-3">Role Reveal</h3>
        <div className="space-y-1.5">
          {players.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between border border-border rounded px-3 py-2 bg-surface"
            >
              <span className="font-mono text-sm text-primary">{p.display_name}</span>
              <span className={`label-caps text-xs ${
                p.role === "human"
                  ? "text-muted"
                  : p.role === "aligned_ai"
                  ? "text-amber"
                  : "text-virus"
              }`}>
                {p.role === "human" ? "Human" : p.role === "aligned_ai" ? "Aligned AI" : "Misaligned AI"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {isHost && (
        <Button
          onClick={() => router.push("/")}
          className="w-full"
        >
          New Game
        </Button>
      )}
    </div>
  );
}
