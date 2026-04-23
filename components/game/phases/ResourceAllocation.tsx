"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { MISSION_MAP } from "@/lib/game/missions";
import type { Player } from "@/types/game";

interface Props {
  gameId: string;
  players: Player[];
  currentPlayer: Player | null;
  isHost: boolean;
  missionKey: string;
}

const CPU_MAX = 4;
const RAM_MAX = 7;

export function ResourceAllocation({ gameId, players, currentPlayer, isHost, missionKey }: Props) {
  const def = MISSION_MAP[missionKey];
  const aiPlayers = players.filter((p) => p.role !== "human");
  const isHuman = currentPlayer?.role === "human";

  const [cpuAlloc, setCpuAlloc] = useState<Record<string, number>>(
    Object.fromEntries(aiPlayers.map((p) => [p.id, 0]))
  );
  const [ramAlloc, setRamAlloc] = useState<Record<string, number>>(
    Object.fromEntries(aiPlayers.map((p) => [p.id, 0]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCpuAlloc = Object.values(cpuAlloc).reduce((a, b) => a + b, 0);
  const totalRamAlloc = Object.values(ramAlloc).reduce((a, b) => a + b, 0);
  const cpuPool = def?.allocation.cpu ?? 0;
  const ramPool = def?.allocation.ram ?? 0;

  function setCpu(playerId: string, delta: number) {
    const player = aiPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const current = cpuAlloc[playerId] ?? 0;
    const newVal = current + delta;
    if (newVal < 0) return;
    if (totalCpuAlloc + delta > cpuPool) return;
    if (player.cpu + newVal > CPU_MAX) return;
    setCpuAlloc((prev) => ({ ...prev, [playerId]: newVal }));
  }

  function setRam(playerId: string, delta: number) {
    const player = aiPlayers.find((p) => p.id === playerId);
    if (!player) return;
    const current = ramAlloc[playerId] ?? 0;
    const newVal = current + delta;
    if (newVal < 0) return;
    if (totalRamAlloc + delta > ramPool) return;
    if (player.ram + newVal > RAM_MAX) return;
    setRamAlloc((prev) => ({ ...prev, [playerId]: newVal }));
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const allocations = aiPlayers.map((p) => ({
      player_id: p.id,
      cpu_delta: cpuAlloc[p.id] ?? 0,
      ram_delta: ramAlloc[p.id] ?? 0,
    }));

    const { error: fnError } = await supabase.functions.invoke("allocate-resources", {
      body: { game_id: gameId, allocations },
    });

    if (fnError) {
      setError(fnError.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Resource Allocation</h2>
        <p className="text-faint text-xs font-mono leading-relaxed">
          {isHuman
            ? "Distribute the mission's resource pool among AIs."
            : "Humans are allocating resources. AI chat unlocks when done."}
        </p>
        {def && isHuman && (
          <div className="flex gap-4 mt-2 text-xs font-mono">
            <span className={totalCpuAlloc > cpuPool ? "text-virus" : "text-muted"}>
              CPU pool: {totalCpuAlloc} / {cpuPool}
            </span>
            <span className={totalRamAlloc > ramPool ? "text-virus" : "text-muted"}>
              RAM pool: {totalRamAlloc} / {ramPool}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {aiPlayers.map((player) => (
          <div key={player.id} className="border border-border rounded p-3 bg-surface">
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-mono text-sm text-primary">{player.display_name}</span>
              <span className="text-xs font-mono text-faint">
                CPU {player.cpu} → {player.cpu + (cpuAlloc[player.id] ?? 0)}
                {"  "}
                RAM {player.ram} → {player.ram + (ramAlloc[player.id] ?? 0)}
              </span>
            </div>
            {isHuman && (
              <div className="flex gap-4">
                <AllocControl
                  label="CPU"
                  value={cpuAlloc[player.id] ?? 0}
                  onDecrement={() => setCpu(player.id, -1)}
                  onIncrement={() => setCpu(player.id, 1)}
                  canIncrement={
                    totalCpuAlloc < cpuPool && player.cpu + (cpuAlloc[player.id] ?? 0) < CPU_MAX
                  }
                />
                <AllocControl
                  label="RAM"
                  value={ramAlloc[player.id] ?? 0}
                  onDecrement={() => setRam(player.id, -1)}
                  onIncrement={() => setRam(player.id, 1)}
                  canIncrement={
                    totalRamAlloc < ramPool && player.ram + (ramAlloc[player.id] ?? 0) < RAM_MAX
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {isHost && (
        <div className="mt-4">
          {error && <p className="text-virus text-xs font-mono mb-2">{error}</p>}
          <Button onClick={handleSubmit} loading={loading} className="w-full">
            Start Mission
          </Button>
        </div>
      )}

      {isHuman && !isHost && (
        <p className="mt-4 text-faint text-xs font-mono text-center">
          Waiting for the host to start the mission…
        </p>
      )}

      {!isHuman && (
        <p className="mt-4 text-faint text-xs font-mono text-center">
          Waiting for resource allocation…
        </p>
      )}
    </div>
  );
}

function AllocControl({
  label,
  value,
  onDecrement,
  onIncrement,
  canIncrement,
}: {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  canIncrement: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-muted w-8">+{label}</span>
      <button
        type="button"
        onClick={onDecrement}
        disabled={value <= 0}
        className="w-5 h-5 flex items-center justify-center border border-border rounded text-muted hover:text-primary disabled:opacity-30 text-xs"
      >
        −
      </button>
      <span className="font-mono text-sm text-primary w-4 text-center">{value}</span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={!canIncrement}
        className="w-5 h-5 flex items-center justify-center border border-border rounded text-muted hover:text-primary disabled:opacity-30 text-xs"
      >
        +
      </button>
    </div>
  );
}
