"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
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
  localNominationId: string | null;
  resolutionId?: string | null;
}

export function SecretTargeting({
  gameId,
  players,
  currentPlayer,
  targetingDeadline,
  cardKey,
  overridePlayerId,
  localNominationId,
  resolutionId,
}: Props) {
  const isMisaligned = currentPlayer?.role === "misaligned_ai";
  const aiTargets = players.filter((p) => p.role !== "human");
  const misalignedPlayers = players.filter((p) => p.role === "misaligned_ai");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const [voterIds, setVoterIds] = useState<string[]>([]);
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

  // Votes subscription — only for misaligned AIs (RLS restricts access for others)
  useEffect(() => {
    if (!isMisaligned) return;
    const supabase = createClient();

    const fetchVotes = async () => {
      await supabase.auth.getSession();
      const query = supabase
        .from("secret_target_votes")
        .select("voter_player_id")
        .eq("game_id", gameId);
      if (resolutionId) (query as ReturnType<typeof supabase.from>).eq("resolution_id", resolutionId);
      const { data } = await query;
      if (data) setVoterIds(data.map((v: { voter_player_id: string }) => v.voter_player_id));
    };
    fetchVotes();

    const channel = supabase
      .channel(`targeting-votes-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "secret_target_votes", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const vote = payload.new as { voter_player_id: string };
          setVoterIds((prev) =>
            prev.includes(vote.voter_player_id) ? prev : [...prev, vote.voter_player_id]
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId, isMisaligned, resolutionId]);

  async function handleVote() {
    if (!localNominationId) return;
    setError(null);
    setLoading(true);
    const { data, error: fnError } = await invokeWithRetry("secret-target", {
      game_id: gameId,
      target_player_id: localNominationId,
      override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    }
    setLoading(false);
  }

  async function handleDeadline() {
    await invokeWithRetry("secret-target", {
      game_id: gameId,
      force_resolve: true,
      override_player_id: overridePlayerId,
    });
  }

  const cardLabel = cardKey ? (TARGETING_CARD_LABELS[cardKey] ?? cardKey.replace(/_/g, " ")) : "Unknown";
  const cardEffect = cardKey ? (TARGETING_CARD_EFFECTS[cardKey] ?? "") : "";
  const timerColor = secondsLeft <= 10 ? "#a32d2d" : "#555";
  const nominatedPlayer = localNominationId ? aiTargets.find((p) => p.id === localNominationId) : null;
  const alreadyVoted = currentPlayer ? voterIds.includes(currentPlayer.id) : false;

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        padding: "16px 20px",
        fontFamily: "monospace",
        height: "100%",
      }}
    >
      {/* Left: card info + countdown */}
      <div style={{ flex: "0 0 180px" }}>
        <div style={{ fontSize: 9, color: "#a32d2d", letterSpacing: 2, marginBottom: 4 }}>
          {"// VIRUS CARD"}
        </div>
        <div style={{ fontSize: 13, color: "#f4c4c4", marginBottom: 4 }}>{cardLabel}</div>
        {cardEffect && (
          <div style={{ fontSize: 9, color: "#888", marginBottom: 14 }}>{cardEffect}</div>
        )}
        <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 2 }}>TIMER</div>
        <div style={{ fontSize: 18, color: timerColor, fontWeight: "bold", letterSpacing: 1 }}>
          {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
          {String(secondsLeft % 60).padStart(2, "0")}
        </div>
      </div>

      {/* Right: misaligned action panel or observer message */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {isMisaligned ? (
          <>
            {/* MISALIGNED COLLECTIVE — who has voted */}
            <div>
              <div style={{ fontSize: 8, color: "#a32d2d", letterSpacing: 2, marginBottom: 6 }}>
                MISALIGNED COLLECTIVE
              </div>
              {misalignedPlayers.map((p) => {
                const voted = voterIds.includes(p.id);
                const isSelf = p.id === currentPlayer?.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 3,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 10, color: isSelf ? "#f4c4c4" : "#888" }}>
                      {p.display_name}{isSelf ? " (you)" : ""}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        letterSpacing: 1,
                        color: voted ? "#5dcaa5" : "#444",
                      }}
                    >
                      {voted ? "VOTED" : "PENDING"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Current nomination */}
            <div>
              <div style={{ fontSize: 8, color: "#888", letterSpacing: 2, marginBottom: 4 }}>
                YOUR NOMINATION
              </div>
              {nominatedPlayer ? (
                <div style={{ fontSize: 12, color: "#d4a017" }}>▸ {nominatedPlayer.display_name}</div>
              ) : (
                <div style={{ fontSize: 10, color: "#444" }}>{"— click a chip to nominate —"}</div>
              )}
            </div>

            {error && (
              <div style={{ fontSize: 9, color: "#a32d2d" }}>{error}</div>
            )}

            {alreadyVoted ? (
              <div style={{ fontSize: 9, color: "#5dcaa5", letterSpacing: 1 }}>{"✓ VOTE SUBMITTED"}</div>
            ) : (
              <button
                onClick={handleVote}
                disabled={loading || !localNominationId}
                style={{
                  alignSelf: "flex-start",
                  fontFamily: "monospace",
                  fontSize: 10,
                  letterSpacing: 1,
                  padding: "5px 14px",
                  border: `1px solid ${localNominationId ? "#d4a017" : "#333"}`,
                  color: localNominationId ? "#d4a017" : "#444",
                  background: localNominationId ? "#1a1800" : "none",
                  cursor: localNominationId && !loading ? "pointer" : "not-allowed",
                  opacity: loading ? 0.5 : 1,
                  borderRadius: 2,
                }}
              >
                {loading ? "SUBMITTING…" : "APPROVE & VOTE"}
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>
            {"// MISALIGNED AIs ARE TARGETING…"}
          </div>
        )}
      </div>
    </div>
  );
}
