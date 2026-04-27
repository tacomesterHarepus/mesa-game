"use client";

import { useState } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
import { MISSION_MAP } from "@/lib/game/missions";
import type { Player } from "@/types/game";

interface Props {
  mode: "adjustment" | "allocation";
  gameId: string;
  aiPlayers: Player[];
  currentPlayer: Player | null;
  overridePlayerId?: string;
  missionKey?: string;
  pendingCpu: Record<string, number>;
  pendingRam: Record<string, number>;
}

export function ResourcePhase({
  mode,
  gameId,
  aiPlayers,
  currentPlayer,
  overridePlayerId,
  missionKey,
  pendingCpu,
  pendingRam,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHuman = currentPlayer?.role === "human";

  const def = mode === "allocation" ? (MISSION_MAP[missionKey ?? ""] ?? null) : null;
  const cpuPool = def?.allocation.cpu ?? 0;
  const ramPool = def?.allocation.ram ?? 0;
  const totalPendingCpu = Object.values(pendingCpu).reduce((a, b) => a + b, 0);
  const totalPendingRam = Object.values(pendingRam).reduce((a, b) => a + b, 0);

  async function handleConfirm() {
    setError(null);
    setLoading(true);

    if (mode === "adjustment") {
      const adjustments = aiPlayers
        .filter((p) => (pendingCpu[p.id] ?? 0) !== 0 || (pendingRam[p.id] ?? 0) !== 0)
        .map((p) => ({
          player_id: p.id,
          cpu: p.cpu - (pendingCpu[p.id] ?? 0),
          ram: p.ram - (pendingRam[p.id] ?? 0),
        }));
      const { error: fnError } = await invokeWithRetry("adjust-resources", {
        game_id: gameId,
        adjustments,
        confirm_ready: true,
        override_player_id: overridePlayerId,
      });
      if (fnError) {
        setError(fnError.message);
        setLoading(false);
      }
    } else {
      const allocations = aiPlayers.map((p) => ({
        player_id: p.id,
        cpu_delta: pendingCpu[p.id] ?? 0,
        ram_delta: pendingRam[p.id] ?? 0,
      }));
      const { error: fnError } = await invokeWithRetry("allocate-resources", {
        game_id: gameId,
        allocations,
        override_player_id: overridePlayerId,
      });
      if (fnError) {
        setError(fnError.message);
        setLoading(false);
      }
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">
          {mode === "adjustment" ? "Resource Adjustment" : "Resource Allocation"}
        </h2>
        <p className="text-faint text-xs font-mono leading-relaxed">
          {mode === "adjustment"
            ? isHuman
              ? "Reduce AI CPU or RAM before the mission using chip controls. Confirm when ready."
              : "Humans are adjusting resources. AI chat is locked."
            : isHuman
            ? "Distribute the mission pool using the chip controls."
            : "Humans are allocating resources. AI chat unlocks when done."}
        </p>
        {isHuman && mode === "allocation" && def && (
          <div className="flex gap-4 mt-2 text-xs font-mono">
            <span className={totalPendingCpu > cpuPool ? "text-virus" : "text-muted"}>
              CPU pool: {totalPendingCpu} / {cpuPool}
            </span>
            <span className={totalPendingRam > ramPool ? "text-virus" : "text-muted"}>
              RAM pool: {totalPendingRam} / {ramPool}
            </span>
          </div>
        )}
      </div>

      {isHuman && (
        <div className="mt-4">
          {error && <p className="text-virus text-xs font-mono mb-2">{error}</p>}
          <Button onClick={handleConfirm} loading={loading} className="w-full">
            {mode === "adjustment" ? "Confirm & Select Mission" : "Start Mission"}
          </Button>
        </div>
      )}

      {!isHuman && (
        <p className="mt-4 text-faint text-xs font-mono text-center">
          {mode === "adjustment"
            ? "Waiting for the host to proceed…"
            : "Waiting for resource allocation…"}
        </p>
      )}
    </div>
  );
}
