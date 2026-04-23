"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { MISSION_MAP } from "@/lib/game/missions";
import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  pendingOptions: string[];
  currentPlayer: Player | null;
}

export function MissionSelection({ gameId, pendingOptions, currentPlayer }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHuman = currentPlayer?.role === "human";

  async function handleSelect() {
    if (!selected) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: fnError } = await supabase.functions.invoke("select-mission", {
      body: { game_id: gameId, mission_key: selected },
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

      <div className="space-y-2">
        {pendingOptions.map((key) => {
          const def = MISSION_MAP[key];
          if (!def) return null;
          const isSelected = selected === key;

          const reqs = [
            def.requirements.compute && `${def.requirements.compute} Compute`,
            def.requirements.data && `${def.requirements.data} Data`,
            def.requirements.validation && `${def.requirements.validation} Validation`,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <button
              key={key}
              type="button"
              disabled={!isHuman}
              onClick={() => isHuman && setSelected(key)}
              className={`w-full text-left border rounded p-3 transition-colors ${
                isSelected
                  ? "border-amber-border bg-surface"
                  : isHuman
                  ? "border-border bg-surface hover:border-muted cursor-pointer"
                  : "border-border bg-surface cursor-default"
              }`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="font-mono text-sm text-primary">{def.name}</span>
                <span className="font-mono text-xs text-amber">+{def.reward}</span>
              </div>
              <div className="text-xs font-mono text-faint">{reqs}</div>
              {def.specialRule && (
                <div className="text-xs font-mono text-muted mt-1 italic">{def.specialRule}</div>
              )}
            </button>
          );
        })}
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
