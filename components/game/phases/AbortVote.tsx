"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import type { Player } from "@/types/game";

interface VoteRow {
  voter_player_id: string;
  vote: "abort" | "continue";
}

interface Props {
  gameId: string;
  currentPlayer: Player | null;
  players: Player[];
  overridePlayerId?: string;
  abortVoteDeadline: string | null;
}

export function AbortVote({ gameId, currentPlayer, players, overridePlayerId, abortVoteDeadline }: Props) {
  const isHuman = currentPlayer?.role === "human";
  const humanPlayers = players.filter((p) => p.role === "human");

  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadlineTriggeredRef = useRef(false);

  const hasVoted = currentPlayer
    ? votes.some((v) => v.voter_player_id === currentPlayer.id)
    : false;

  // Countdown from abort_vote_deadline
  useEffect(() => {
    if (!abortVoteDeadline) return;
    const deadline = new Date(abortVoteDeadline).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !deadlineTriggeredRef.current) {
        deadlineTriggeredRef.current = true;
        handleForceResolve();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abortVoteDeadline]);

  // Realtime subscription + initial fetch — full openness, all players see votes.
  useEffect(() => {
    const supabase = createClient();

    const fetchVotes = async () => {
      await supabase.auth.getSession();
      const { data } = await supabase
        .from("abort_votes")
        .select("voter_player_id,vote")
        .eq("game_id", gameId);
      if (data) setVotes(data as VoteRow[]);
    };
    fetchVotes();

    const channel = supabase
      .channel(`abort-votes-${gameId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "abort_votes", filter: `game_id=eq.${gameId}` },
        () => { fetchVotes(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "abort_votes", filter: `game_id=eq.${gameId}` },
        () => { fetchVotes(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  async function handleVote(vote: "abort" | "continue") {
    setError(null);
    setLoading(true);
    const { data, error: fnError } = await invokeWithRetry("submit-abort-vote", {
      game_id: gameId,
      vote,
      override_player_id: overridePlayerId,
    });
    if (fnError) setError(fnError.message);
    else if (data?.error) setError(data.error);
    setLoading(false);
  }

  async function handleForceResolve() {
    await invokeWithRetry("submit-abort-vote", {
      game_id: gameId,
      force_resolve: true,
      override_player_id: overridePlayerId,
    });
  }

  const timerColor = secondsLeft <= 10 ? "#a32d2d" : "#555";
  const abortCount = votes.filter((v) => v.vote === "abort").length;
  const continueCount = votes.filter((v) => v.vote === "continue").length;

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
      {/* Left: timer + tally */}
      <div style={{ flex: "0 0 180px" }}>
        <div style={{ fontSize: 9, color: "#a32d2d", letterSpacing: 2, marginBottom: 4 }}>
          {"// ABORT VOTE"}
        </div>
        <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 2 }}>TIMER</div>
        <div
          style={{
            fontSize: 18,
            color: timerColor,
            fontWeight: "bold",
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
          {String(secondsLeft % 60).padStart(2, "0")}
        </div>
        <div style={{ fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 6 }}>TALLY</div>
        <div style={{ fontSize: 11, color: "#a32d2d", marginBottom: 3 }}>
          ABORT: {abortCount}
        </div>
        <div style={{ fontSize: 11, color: "#5dcaa5" }}>CONTINUE: {continueCount}</div>
      </div>

      {/* Right: vote panel or observer message */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Human vote rows — visible to all */}
        <div>
          <div style={{ fontSize: 8, color: "#888", letterSpacing: 2, marginBottom: 6 }}>
            HUMAN VOTES
          </div>
          {humanPlayers.map((p) => {
            const playerVote = votes.find((v) => v.voter_player_id === p.id);
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
                <span style={{ fontSize: 10, color: isSelf ? "#ddd" : "#888" }}>
                  {p.display_name}
                  {isSelf ? " (you)" : ""}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: 1,
                    color: playerVote
                      ? playerVote.vote === "abort"
                        ? "#a32d2d"
                        : "#5dcaa5"
                      : "#444",
                  }}
                >
                  {playerVote ? playerVote.vote.toUpperCase() : "PENDING"}
                </span>
              </div>
            );
          })}
        </div>

        {error && (
          <div style={{ fontSize: 9, color: "#a32d2d" }}>{error}</div>
        )}

        {isHuman && !hasVoted ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleVote("abort")}
              disabled={loading}
              style={{
                padding: "7px 16px",
                background: "#1a0808",
                border: "1px solid #a32d2d",
                borderRadius: 2,
                fontFamily: "monospace",
                fontSize: 10,
                color: "#a32d2d",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
                letterSpacing: 1,
              }}
            >
              {loading ? "…" : "VOTE ABORT"}
            </button>
            <button
              onClick={() => handleVote("continue")}
              disabled={loading}
              style={{
                padding: "7px 16px",
                background: "#0a1208",
                border: "1px solid #5dcaa5",
                borderRadius: 2,
                fontFamily: "monospace",
                fontSize: 10,
                color: "#5dcaa5",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
                letterSpacing: 1,
              }}
            >
              {loading ? "…" : "VOTE CONTINUE"}
            </button>
          </div>
        ) : isHuman && hasVoted ? (
          <div style={{ fontSize: 9, color: "#5dcaa5", letterSpacing: 1 }}>
            {"✓ VOTE SUBMITTED"}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>
            {"// WAITING FOR HUMANS TO VOTE…"}
          </div>
        )}
      </div>
    </div>
  );
}
