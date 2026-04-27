"use client";

import { useState } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  overridePlayerId?: string;
  selected: string | null;
}

export function MissionSelection({ gameId, currentPlayer, overridePlayerId, selected }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHuman = currentPlayer?.role === "human";

  async function handleSelect() {
    if (!selected) return;
    setError(null);
    setLoading(true);
    const { error: fnError } = await invokeWithRetry("select-mission", {
      game_id: gameId, mission_key: selected, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Mission Selection</h2>
        <p className="text-faint text-xs font-mono leading-relaxed">
          {isHuman
            ? "Choose one mission to complete. AI chat is locked."
            : "Humans are selecting the mission. AI chat is locked."}
        </p>
      </div>

      {isHuman && (
        <div className="mt-4">
          {error && <p className="text-virus text-xs font-mono mb-2">{error}</p>}
          <Button
            onClick={handleSelect}
            loading={loading}
            disabled={!selected}
            className="w-full"
          >
            Select Mission
          </Button>
        </div>
      )}

      {!isHuman && (
        <p className="mt-4 text-faint text-xs font-mono text-center">
          Waiting for humans to choose…
        </p>
      )}
    </div>
  );
}
