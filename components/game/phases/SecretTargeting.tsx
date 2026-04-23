"use client";

import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  players?: Player[];
  currentPlayer: Player | null;
  targetingDeadline?: string | null;
}

export function SecretTargeting({ currentPlayer }: Props) {
  const isMisaligned = currentPlayer?.role === "misaligned_ai";

  return (
    <div>
      <h2 className="label-caps mb-3">Secret Targeting</h2>
      {isMisaligned ? (
        <div className="border border-virus rounded p-3 bg-surface">
          <p className="text-virus text-xs font-mono">
            Misaligned AIs: vote on a target in private chat.
          </p>
          <p className="text-faint text-xs font-mono mt-1">
            Secret targeting system coming in Phase 5.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded p-3 bg-surface">
          <p className="text-faint text-xs font-mono">
            Misaligned AIs are selecting a target…
          </p>
        </div>
      )}
    </div>
  );
}
