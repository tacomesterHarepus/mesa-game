"use client";

import type { Player } from "@/types/game";

interface HandCard {
  id: string;
  card_key: string;
  card_type: string;
}

interface Props {
  gameId: string;
  currentTurnPlayer: Player | null;
  currentPlayer: Player | null;
  hand: HandCard[];
  round: number;
}

export function PlayerTurn({ currentTurnPlayer, currentPlayer, round }: Props) {
  const isMyTurn = currentPlayer?.id === currentTurnPlayer?.id;

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Player Turn — Round {round}</h2>
        {currentTurnPlayer ? (
          <p className="text-muted text-xs font-mono">
            {isMyTurn ? "It's your turn." : `${currentTurnPlayer.display_name}'s turn.`}
          </p>
        ) : (
          <p className="text-faint text-xs font-mono">Determining turn order…</p>
        )}
      </div>

      <div className="border border-border rounded p-4 bg-surface text-center">
        <p className="font-mono text-xs text-faint">
          Player turn system coming in Phase 5.
        </p>
        <p className="font-mono text-xs text-faint mt-1">
          (Discard → Draw → Play cards + Place viruses)
        </p>
      </div>
    </div>
  );
}
