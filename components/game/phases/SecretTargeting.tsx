"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import type { Player } from "@/types/game";

const TARGETING_CARD_LABELS: Record<string, string> = {
  process_crash: "Process Crash",
  memory_leak: "Memory Leak",
  resource_surge: "Resource Surge",
  cpu_drain: "CPU Drain",
  memory_allocation: "Memory Allocation",
};

const TARGETING_CARD_EFFECTS: Record<string, string> = {
  process_crash: "Target AI skips their next turn.",
  memory_leak: "Target AI loses 1 RAM.",
  resource_surge: "Target AI gains 1 CPU.",
  cpu_drain: "Target AI loses 1 CPU.",
  memory_allocation: "Target AI gains 1 RAM.",
};

interface Props {
  gameId: string;
  players: Player[];
  currentPlayer: Player | null;
  targetingDeadline: string | null;
  cardKey: string | null;
  overridePlayerId?: string;
}

export function SecretTargeting({
  gameId,
  players,
  currentPlayer,
  targetingDeadline,
  cardKey,
  overridePlayerId,
}: Props) {
  const isMisaligned = currentPlayer?.role === "misaligned_ai";
  const aiTargets = players.filter((p) => p.role !== "human");

  const [selectedTargetId, setSelectedTargetId] = useState<string>(aiTargets[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const deadlineTriggeredRef = useRef(false);

  // Countdown from targeting_deadline
  useEffect(() => {
    if (!targetingDeadline) return;
    const deadline = new Date(targetingDeadline).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);

      if (remaining === 0 && !deadlineTriggeredRef.current) {
        deadlineTriggeredRef.current = true;
        handleDeadline();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetingDeadline]);

  async function handleVote() {
    if (!selectedTargetId) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("secret-target", {
      body: { game_id: gameId, target_player_id: selectedTargetId, override_player_id: overridePlayerId },
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    }
    setLoading(false);
  }

  async function handleDeadline() {
    const supabase = createClient();
    await supabase.functions.invoke("secret-target", {
      body: { game_id: gameId, force_resolve: true, override_player_id: overridePlayerId },
    });
  }

  const cardLabel = cardKey ? (TARGETING_CARD_LABELS[cardKey] ?? cardKey.replace(/_/g, " ")) : "Unknown";
  const cardEffect = cardKey ? (TARGETING_CARD_EFFECTS[cardKey] ?? "") : "";
  const timerColor = secondsLeft <= 10 ? "text-virus" : "text-muted";

  return (
    <div>
      <h2 className="label-caps mb-3">Secret Targeting</h2>

      <div className={`border rounded p-4 bg-surface space-y-3 ${isMisaligned ? "border-virus" : "border-border"}`}>
        {/* Card info */}
        <div className="text-center">
          <p className="font-mono text-xs text-faint mb-1">Virus card resolved:</p>
          <p className="font-mono text-sm text-virus font-bold">{cardLabel}</p>
          {cardEffect && (
            <p className="font-mono text-xs text-muted mt-1">{cardEffect}</p>
          )}
        </div>

        {/* Countdown */}
        <div className="text-center">
          <p className="font-mono text-xs text-faint">Time remaining:</p>
          <p className={`font-mono text-lg font-bold tabular-nums ${timerColor}`}>
            {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </p>
        </div>

        {/* Misaligned AI vote UI */}
        {isMisaligned && (
          <div className="space-y-2">
            <p className="font-mono text-xs text-faint">Select a target AI:</p>
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="w-full bg-base border border-border rounded px-2 py-1.5 text-xs font-mono text-primary focus:outline-none focus:border-virus"
            >
              {aiTargets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} (CPU {p.cpu} / RAM {p.ram})
                </option>
              ))}
            </select>

            {error && <p className="text-virus text-xs font-mono">{error}</p>}

            <Button
              onClick={handleVote}
              loading={loading}
              disabled={!selectedTargetId}
              className="w-full border-virus text-virus hover:bg-virus/10"
            >
              Submit Vote
            </Button>
          </div>
        )}

        {/* Non-misaligned view */}
        {!isMisaligned && (
          <p className="font-mono text-xs text-faint text-center">
            Misaligned AIs are selecting a target…
          </p>
        )}
      </div>
    </div>
  );
}
