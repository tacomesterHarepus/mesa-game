"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  players: Player[];
  currentPlayer: Player | null;
  overridePlayerId?: string;
}

const CPU_MIN = 1;
const RAM_MIN = 3;

export function ResourceAdjustment({ gameId, players, currentPlayer, overridePlayerId }: Props) {
  const aiPlayers = players.filter((p) => p.role !== "human");
  const isHuman = currentPlayer?.role === "human";

  const [cpuValues, setCpuValues] = useState<Record<string, number>>(
    Object.fromEntries(aiPlayers.map((p) => [p.id, p.cpu]))
  );
  const [ramValues, setRamValues] = useState<Record<string, number>>(
    Object.fromEntries(aiPlayers.map((p) => [p.id, p.ram]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const adjustments = aiPlayers
      .filter((p) => cpuValues[p.id] !== p.cpu || ramValues[p.id] !== p.ram)
      .map((p) => ({ player_id: p.id, cpu: cpuValues[p.id], ram: ramValues[p.id] }));

    const { error: fnError } = await supabase.functions.invoke("adjust-resources", {
      body: { game_id: gameId, adjustments, confirm_ready: true, override_player_id: overridePlayerId },
    });

    if (fnError) {
      setError(fnError.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Resource Adjustment</h2>
        <p className="text-faint text-xs font-mono leading-relaxed">
          {isHuman
            ? "Humans may reduce any AI's CPU or RAM. AI chat is locked."
            : "Humans are adjusting resources. AI chat is locked."}
        </p>
      </div>

      <div className="space-y-3">
        {aiPlayers.map((player) => (
          <div key={player.id} className="border border-border rounded p-3 bg-surface">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-sm text-primary">{player.display_name}</span>
              <span className="label-caps text-faint text-[10px]">AI</span>
            </div>
            {isHuman ? (
              <div className="flex gap-4">
                <StatControl
                  label="CPU"
                  value={cpuValues[player.id] ?? player.cpu}
                  min={CPU_MIN}
                  max={player.cpu}
                  onChange={(v) => setCpuValues((prev) => ({ ...prev, [player.id]: v }))}
                />
                <StatControl
                  label="RAM"
                  value={ramValues[player.id] ?? player.ram}
                  min={RAM_MIN}
                  max={player.ram}
                  onChange={(v) => setRamValues((prev) => ({ ...prev, [player.id]: v }))}
                />
              </div>
            ) : (
              <div className="flex gap-3 text-xs font-mono text-faint">
                <span>CPU {player.cpu}</span>
                <span>RAM {player.ram}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {isHuman && (
        <div className="mt-4">
          {error && <p className="text-virus text-xs font-mono mb-2">{error}</p>}
          <Button onClick={handleConfirm} loading={loading} className="w-full">
            Confirm &amp; Select Mission
          </Button>
        </div>
      )}

      {!isHuman && (
        <p className="mt-4 text-faint text-xs font-mono text-center">
          Waiting for the host to proceed…
        </p>
      )}
    </div>
  );
}

function StatControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-muted w-8">{label}</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-5 h-5 flex items-center justify-center border border-border rounded text-muted hover:text-primary disabled:opacity-30 text-xs"
      >
        −
      </button>
      <span className="font-mono text-sm text-primary w-4 text-center">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-5 h-5 flex items-center justify-center border border-border rounded text-muted hover:text-primary disabled:opacity-30 text-xs"
      >
        +
      </button>
    </div>
  );
}
