"use client";

import { useEffect, useRef, useState } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import type { Player } from "@/types/game";

interface QueueCard {
  id: string;
  card_key: string;
  card_type: string;
  position: number;
  cascaded_from: string | null;
}

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  overridePlayerId?: string;
  currentCard: QueueCard | null;
  remaining: number;
}

const VIRUS_DISPLAY_NAME: Record<string, string> = {
  cascading_failure:   "Cascading Failure",
  system_overload:     "System Overload",
  model_corruption:    "Model Corruption",
  data_drift:          "Data Drift",
  validation_failure:  "Validation Failure",
  pipeline_breakdown:  "Pipeline Breakdown",
  dependency_error:    "Dependency Error",
  process_crash:       "Process Crash",
  memory_leak:         "Memory Leak",
  resource_surge:      "Resource Surge",
  cpu_drain:           "CPU Drain",
  memory_allocation:   "Memory Allocation",
};

export function VirusResolution({ gameId, overridePlayerId, currentCard, remaining }: Props) {
  const [autoResolveError, setAutoResolveError] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  // CSS pacing bar — width 0→100 over 2s; reset per card via currentCard?.id dep
  const [barWidth, setBarWidth] = useState(0);
  const resolveInFlightRef = useRef(false);

  // Auto-resolve loop — fires 2s after each card appears (matching the pacing bar),
  // or 500ms after queue empties (to advance the turn).
  // currentCard?.id dep: undefined both at initial mount and genuine empty-queue —
  // the 500ms empty-queue timer cancels naturally when the first card arrives.
  useEffect(() => {
    setAutoResolveError(null);
    resolveInFlightRef.current = false;

    if (currentCard) {
      // Restart pacing bar for this card
      setBarWidth(0);
      const barTimer = setTimeout(() => setBarWidth(100), 50);

      const resolveTimer = setTimeout(async () => {
        if (resolveInFlightRef.current) return;
        resolveInFlightRef.current = true;
        const { data, error: fnError } = await invokeWithRetry("resolve-next-virus", {
          game_id: gameId,
          override_player_id: overridePlayerId,
        });
        if (fnError) {
          setAutoResolveError(fnError.message);
        } else if (data?.error) {
          setAutoResolveError(data.error);
        }
        // If data.paused === "secret_targeting", phase changes and component unmounts — no action needed
      }, 2000);

      return () => {
        clearTimeout(barTimer);
        clearTimeout(resolveTimer);
      };
    } else {
      // Empty queue — call resolve-next-virus to advance turn (short delay to debounce)
      const advanceTimer = setTimeout(async () => {
        if (resolveInFlightRef.current) return;
        resolveInFlightRef.current = true;
        const { data, error: fnError } = await invokeWithRetry("resolve-next-virus", {
          game_id: gameId,
          override_player_id: overridePlayerId,
        });
        if (fnError) {
          setAutoResolveError(fnError.message);
        } else if (data?.error) {
          setAutoResolveError(data.error);
        }
      }, 500);

      return () => clearTimeout(advanceTimer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCard?.id, gameId, overridePlayerId]);

  async function handleManualContinue() {
    setAutoResolveError(null);
    setManualLoading(true);
    const { data, error: fnError } = await invokeWithRetry("resolve-next-virus", {
      game_id: gameId,
      override_player_id: overridePlayerId,
    });
    if (fnError) setAutoResolveError(fnError.message);
    else if (data?.error) setAutoResolveError(data.error);
    setManualLoading(false);
  }

  const cardName = currentCard
    ? (VIRUS_DISPLAY_NAME[currentCard.card_key] ?? currentCard.card_key.replace(/_/g, " "))
    : null;
  const isCascaded = !!currentCard?.cascaded_from;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 32,
        padding: "16px 20px",
        fontFamily: "monospace",
        height: "100%",
      }}
    >
      {/* Left: resolving card info */}
      <div style={{ flex: "0 0 260px" }}>
        {currentCard ? (
          <>
            <div style={{ fontSize: 10, color: "#a32d2d", letterSpacing: 2, marginBottom: 4 }}>
              {isCascaded ? "↳ TRIGGERED — RESOLVING" : "// RESOLVING NOW"}
            </div>
            <div style={{ fontSize: 14, color: "#f4c4c4", marginBottom: 6 }}>{cardName}</div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 2 }}>
            {"// QUEUE EMPTY — ADVANCING"}
          </div>
        )}
      </div>

      {/* Center: pacing bar */}
      <div style={{ flex: 1 }}>
        {currentCard && (
          <div
            style={{
              height: 4,
              background: "#1a1a1a",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "#a32d2d",
                width: `${barWidth}%`,
                transition: "width 2s linear",
                borderRadius: 2,
              }}
            />
          </div>
        )}
      </div>

      {/* Right: queue count */}
      <div style={{ flex: "0 0 100px", textAlign: "right" }}>
        {remaining > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>QUEUE</div>
            <div style={{ fontSize: 22, color: "#a32d2d" }}>{remaining}</div>
          </>
        )}
      </div>

      {/* Error fallback — manual Continue button */}
      {autoResolveError && (
        <div style={{ position: "absolute", bottom: 12, left: 20, right: 20 }}>
          <div style={{ fontSize: 10, color: "#a32d2d", marginBottom: 6 }}>
            {"// AUTO-RESOLVE FAILED — " + autoResolveError}
          </div>
          <button
            onClick={handleManualContinue}
            disabled={manualLoading}
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: 1,
              padding: "4px 12px",
              border: "1px solid #a32d2d",
              color: "#f4c4c4",
              background: "#1a0a0a",
              cursor: manualLoading ? "not-allowed" : "pointer",
              opacity: manualLoading ? 0.5 : 1,
              borderRadius: 2,
            }}
          >
            {manualLoading ? "RETRYING…" : "CONTINUE"}
          </button>
        </div>
      )}
    </div>
  );
}
