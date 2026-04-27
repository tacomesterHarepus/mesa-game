"use client";

import { useState } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  currentTurnPlayerId: string | undefined;
  pendingPullCount: number;
  overridePlayerId?: string;
}

export function VirusPull({
  gameId,
  currentPlayer,
  currentTurnPlayerId,
  pendingPullCount,
  overridePlayerId,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMyTurn =
    !!currentPlayer && currentPlayer.id === currentTurnPlayerId;

  async function handlePull() {
    setError(null);
    setLoading(true);
    const { data, error: fnError } = await invokeWithRetry("pull-viruses", {
      game_id: gameId,
      override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    }
    setLoading(false);
  }

  return (
    <div>
      <h2 className="label-caps mb-3">Virus Resolution</h2>

      <div className="border border-virus rounded p-4 bg-surface space-y-4">
        <div className="text-center">
          <p className="font-mono text-xs text-faint mb-1">
            Drawing {pendingPullCount} card{pendingPullCount !== 1 ? "s" : ""} from the virus pool
          </p>
        </div>

        {isMyTurn ? (
          <Button
            onClick={handlePull}
            loading={loading}
            className="w-full border-amber-600 text-amber-400 hover:bg-amber-900/20"
          >
            Pull {pendingPullCount} from virus pool
          </Button>
        ) : (
          <p className="font-mono text-xs text-faint text-center">
            Waiting for active player to pull from virus pool…
          </p>
        )}

        {error && <p className="text-virus text-xs font-mono">{error}</p>}
      </div>
    </div>
  );
}
