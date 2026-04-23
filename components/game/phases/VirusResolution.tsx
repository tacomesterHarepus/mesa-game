"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import type { Player } from "@/types/game";

interface QueueCard {
  id: string;
  card_key: string;
  card_type: string;
  position: number;
  resolved: boolean;
}

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  overridePlayerId?: string;
}

const VIRUS_LABELS: Record<string, string> = {
  cascading_failure: "Cascading Failure",
  system_overload: "System Overload",
  model_corruption: "Model Corruption",
  data_drift: "Data Drift",
  validation_failure: "Validation Failure",
  pipeline_breakdown: "Pipeline Breakdown",
  dependency_error: "Dependency Error",
  process_crash: "Process Crash",
  memory_leak: "Memory Leak",
  resource_surge: "Resource Surge",
  cpu_drain: "CPU Drain",
  memory_allocation: "Memory Allocation",
};

export function VirusResolution({ gameId, currentPlayer, overridePlayerId }: Props) {
  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const fetchQueue = async () => {
      const { data } = await supabase
        .from("virus_resolution_queue")
        .select("*")
        .eq("game_id", gameId)
        .eq("resolved", false)
        .order("position");
      setQueue(data ?? []);
    };

    fetchQueue();

    const channel = supabase
      .channel(`virus-queue-${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "virus_resolution_queue", filter: `game_id=eq.${gameId}` },
        () => { fetchQueue(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  async function handleResolve() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("resolve-next-virus", {
      body: { game_id: gameId, override_player_id: overridePlayerId },
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    }
    setLoading(false);
  }

  const nextCard = queue[0];
  const remaining = queue.length;

  return (
    <div>
      <h2 className="label-caps mb-3">Virus Resolution</h2>

      <div className="border border-virus rounded p-4 bg-surface space-y-4">
        {nextCard ? (
          <>
            <div className="text-center">
              <p className="font-mono text-xs text-faint mb-1">Next virus card:</p>
              <p className="font-mono text-sm text-virus font-bold">
                {VIRUS_LABELS[nextCard.card_key] ?? nextCard.card_key.replace(/_/g, " ")}
              </p>
              {remaining > 1 && (
                <p className="font-mono text-xs text-faint mt-1">
                  {remaining - 1} more card{remaining - 1 !== 1 ? "s" : ""} queued after this
                </p>
              )}
            </div>

            <Button
              onClick={handleResolve}
              loading={loading}
              className="w-full border-virus text-virus hover:bg-virus/10"
            >
              Resolve Virus
            </Button>
          </>
        ) : (
          <>
            <p className="font-mono text-xs text-faint text-center">
              Queue empty — advancing turn…
            </p>
            <Button
              onClick={handleResolve}
              loading={loading}
              className="w-full border-virus text-virus hover:bg-virus/10"
            >
              Continue
            </Button>
          </>
        )}

        {error && <p className="text-virus text-xs font-mono">{error}</p>}
      </div>

      <p className="font-mono text-xs text-faint mt-3 text-center">
        {currentPlayer?.role === "human"
          ? "You control virus resolution."
          : "Waiting for host to advance resolution…"}
      </p>
    </div>
  );
}
