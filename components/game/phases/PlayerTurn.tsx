"use client";

import { useState, useEffect } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { CARD_MAP } from "@/lib/game/cards";
import type { Player } from "@/types/game";

interface HandCard {
  id: string;
  card_key: string;
  card_type: string;
}

interface ActiveMissionState {
  mission_key: string;
  compute_contributed: number;
  data_contributed: number;
}

interface Props {
  gameId: string;
  currentTurnPlayer: Player | null;
  currentPlayer: Player | null;
  hand: HandCard[];
  round: number;
  overridePlayerId?: string;
  activeMission?: ActiveMissionState | null;
}

const CARD_VISUAL: Record<string, { bg: string; border: string; header: string; icon: string; color: string }> = {
  compute:    { bg: "#0f1419", border: "#3a4a5a", header: "#1a2a3a", icon: "⚙", color: "#9cb4d4" },
  data:       { bg: "#0a1310", border: "#2a4a3a", header: "#1a3a2a", icon: "▣", color: "#5dcaa5" },
  validation: { bg: "#0f100a", border: "#3a4a20", header: "#1a2a10", icon: "◆", color: "#caa55d" },
  virus:      { bg: "#180c0c", border: "#5a3a3a", header: "#2a1010", icon: "⚠", color: "#a32d2d" },
};

function getCardVisual(cardType: string, cardKey: string) {
  if (cardType === "progress") return CARD_VISUAL[cardKey] ?? CARD_VISUAL.compute;
  return CARD_VISUAL.virus;
}

function groupByKey(cards: HandCard[]): [string, HandCard[]][] {
  const map = new Map<string, HandCard[]>();
  for (const card of cards) {
    const group = map.get(card.card_key) ?? [];
    group.push(card);
    map.set(card.card_key, group);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function calcVirusCount(cpu: number, cardsPlayedThisTurn: number): number {
  const base = cpu >= 2 ? 1 : 0;
  const bonus = cardsPlayedThisTurn >= 3 ? 1 : 0;
  return Math.min(2, base + bonus);
}

function ActionBtn({
  label,
  enabled,
  onClick,
  loading,
  title,
}: {
  label: string;
  enabled: boolean;
  onClick?: () => void;
  loading?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={enabled && !loading ? onClick : undefined}
      title={title}
      style={{
        width: "100%",
        padding: "9px 12px",
        background: enabled ? "#3a2e1a" : "#0c0c0c",
        border: `1px solid ${enabled ? "#d4a017" : "#222"}`,
        borderRadius: 2,
        fontFamily: "monospace",
        fontSize: 10,
        letterSpacing: 1,
        color: enabled ? "#f4d47e" : "#444",
        cursor: enabled && !loading ? "pointer" : "default",
        textAlign: "left" as const,
        opacity: loading ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {loading ? "..." : label}
    </button>
  );
}

function CardStackGroup({
  cardKey,
  cards,
  isSelected,
  tag,
  disabled,
  onClick,
}: {
  cardKey: string;
  cards: HandCard[];
  isSelected: boolean;
  tag?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const first = cards[0];
  const visual = getCardVisual(first.card_type, cardKey);
  const cardDef = CARD_MAP[cardKey];
  const count = cards.length;
  const shadows = Math.min(count - 1, 2);

  const typeLabel = first.card_type === "progress" ? "PROGRESS" : "VIRUS";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
      <div style={{ position: "relative", width: 120, height: 150 }}>
        {/* Shadow cards behind the main card */}
        {Array.from({ length: shadows }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: (i + 1) * 3,
              left: (i + 1) * 2,
              width: 120,
              height: 150,
              background: visual.bg,
              border: `1px solid ${visual.border}`,
              borderRadius: 3,
              opacity: 0.35 - i * 0.1,
            }}
          />
        ))}

        {/* Main card (button) */}
        <button
          onClick={!disabled ? onClick : undefined}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
            width: 120,
            height: 150,
            background: isSelected ? "#241a08" : visual.bg,
            border: `${isSelected ? 2 : 1}px solid ${isSelected ? "#d4a017" : disabled ? "#222" : visual.border}`,
            borderRadius: 3,
            cursor: disabled ? "default" : "pointer",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            transform: isSelected ? "translateY(-8px)" : "none",
            opacity: disabled ? 0.3 : 1,
          }}
        >
          {/* Header strip — type label only */}
          <div
            style={{
              height: 22,
              background: visual.header,
              borderRadius: "3px 3px 0 0",
              display: "flex",
              alignItems: "center",
              paddingLeft: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: "monospace", fontSize: 9, color: visual.color, letterSpacing: 1 }}>
              {typeLabel}
            </span>
          </div>
          {/* Card body — name + large icon */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingLeft: 8, paddingTop: 6 }}>
            <span style={{ fontFamily: "sans-serif", fontSize: 14, color: "#ddd", lineHeight: 1.2 }}>
              {cardDef?.name ?? cardKey}
            </span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: "sans-serif", fontSize: 28, color: visual.color, opacity: 0.8 }}>
                {visual.icon}
              </span>
            </div>
          </div>
        </button>

        {/* Count badge */}
        {count > 1 && (
          <div
            style={{
              position: "absolute",
              top: -7,
              right: -7,
              zIndex: 2,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#1a1810",
              border: "1.5px solid #d4a017",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              fontSize: 10,
              color: "#d4a017",
            }}
          >
            {count}
          </div>
        )}
      </div>

      {/* Tag below card */}
      {tag && (
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#d4a017", letterSpacing: 1 }}>
          {tag}
        </span>
      )}
    </div>
  );
}

export function PlayerTurn({ gameId, currentTurnPlayer, currentPlayer, hand, round, overridePlayerId, activeMission }: Props) {
  const isMyTurn = currentPlayer?.id === currentTurnPlayer?.id;
  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;
  const isHuman = currentPlayer?.role === "human";

  const [hasDiscarded, setHasDiscarded] = useState(false);
  const [discardSelectedIds, setDiscardSelectedIds] = useState<Set<string>>(new Set());
  const [discardLoading, setDiscardLoading] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [stagedCardIds, setStagedCardIds] = useState<Set<string>>(new Set());
  const [cardsPlayedThisTurn, setCardsPlayedThisTurn] = useState(0);
  const [playLoading, setPlayLoading] = useState(false);
  const [endLoading, setEndLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [abortConfirming, setAbortConfirming] = useState(false);
  const [abortLoading, setAbortLoading] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);

  // Reset turn-local state when the active player changes
  useEffect(() => {
    setHasDiscarded(false);
    setDiscardSelectedIds(new Set());
    setDiscardError(null);
    setCardsPlayedThisTurn(0);
    setSelectedCardKey(null);
    setStagedCardIds(new Set());
    setError(null);
    setAbortConfirming(false);
    setAbortError(null);
  }, [currentTurnPlayer?.id]);

  // Sync discard state from server (bidirectional: true and false both reflected)
  useEffect(() => {
    setHasDiscarded(currentPlayer?.has_discarded_this_turn ?? false);
  }, [currentPlayer?.has_discarded_this_turn]);

  const cpu = currentPlayer?.cpu ?? 1;
  const virusCount = calcVirusCount(cpu, cardsPlayedThisTurn);

  const stagedCards = hand.filter((c) => stagedCardIds.has(c.id));
  const unstagedCards = hand.filter((c) => !stagedCardIds.has(c.id));
  const selectedCard = selectedCardKey
    ? unstagedCards.find((c) => c.card_key === selectedCardKey) ?? null
    : null;

  const playsRemaining = cpu - cardsPlayedThisTurn;
  const stagingNeeded = virusCount - stagedCards.length;
  const handExhausted = unstagedCards.length === 0;
  const endTurnBlocked = stagingNeeded > 0 && !handExhausted;

  const virusDisabledKeys =
    virusCount === 0
      ? Array.from(new Set(unstagedCards.filter((c) => c.card_type === "virus").map((c) => c.card_key)))
      : [];

  const computeBlocked =
    activeMission?.mission_key === "dataset_integration" &&
    (activeMission.compute_contributed ?? 0) >= (activeMission.data_contributed ?? 0) * 2;

  // Click-to-increment: each click adds one more card from the stack to discard selection,
  // wrapping back to 0 when at max (stack size or total-discard limit of 3).
  function toggleDiscardStack(cardKey: string) {
    const stackCards = hand.filter((c) => c.card_key === cardKey);
    setDiscardSelectedIds((prev) => {
      const selectedFromStack = stackCards.filter((c) => prev.has(c.id));
      const prevCount = selectedFromStack.length;
      const totalOthers = prev.size - prevCount;
      const maxCanSelect = Math.min(stackCards.length, 3 - totalOthers);

      const next = new Set(prev);
      // Remove all from this stack first
      selectedFromStack.forEach((c) => next.delete(c.id));

      if (prevCount < maxCanSelect) {
        // Increment: add one more card from this stack
        stackCards.slice(0, prevCount + 1).forEach((c) => next.add(c.id));
      }
      // else: already at max → wraps back to 0 (cleared above)
      return next;
    });
  }

  async function handleDiscard(cardIds: string[]) {
    setDiscardError(null);
    setDiscardLoading(true);
    const { data, error: fnError } = await invokeWithRetry("discard-cards", {
      game_id: gameId, card_ids: cardIds, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setDiscardError(fnError.message);
    } else if (data?.error) {
      setDiscardError(data.error);
    } else {
      setHasDiscarded(true);
      setDiscardSelectedIds(new Set());
    }
    setDiscardLoading(false);
  }

  async function handlePlayCard() {
    if (!selectedCard || selectedCard.card_type !== "progress" || playsRemaining <= 0) return;
    setError(null);
    setPlayLoading(true);
    const { data, error: fnError } = await invokeWithRetry("play-card", {
      game_id: gameId, card_id: selectedCard.id, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    } else {
      setSelectedCardKey(null);
      setCardsPlayedThisTurn((n) => n + 1);
    }
    setPlayLoading(false);
  }

  function handleStageCard() {
    if (!selectedCard || stagedCards.length >= virusCount) return;
    setStagedCardIds((prev) => new Set(Array.from(prev).concat(selectedCard.id)));
    setSelectedCardKey(null);
  }

  async function handleAbortMission() {
    setAbortError(null);
    setAbortLoading(true);
    const { data, error: fnError } = await invokeWithRetry("abort-mission", {
      game_id: gameId, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setAbortError(fnError.message);
    } else if (data?.error) {
      setAbortError(data.error);
    }
    setAbortLoading(false);
    setAbortConfirming(false);
  }

  async function handleEndTurn() {
    setError(null);
    setEndLoading(true);

    for (const card of stagedCards) {
      const { data, error: fnError } = await invokeWithRetry("place-virus", {
        game_id: gameId, card_id: card.id, override_player_id: overridePlayerId,
      });
      if (fnError) {
        setError(fnError.message);
        setEndLoading(false);
        return;
      }
      if (data?.error) {
        setError(data.error);
        setEndLoading(false);
        return;
      }
    }

    const { data, error: fnError } = await invokeWithRetry("end-play-phase", {
      game_id: gameId, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    }
    setEndLoading(false);
  }

  // Grouped card data for display
  const discardGroups = groupByKey(hand);
  const playGroups = groupByKey(unstagedCards);

  // Button enabled states
  const canPlayCard = hasDiscarded && !!selectedCard && selectedCard.card_type === "progress" && playsRemaining > 0;
  const canStage = hasDiscarded && !!selectedCard && virusCount > 0 && stagedCards.length < virusCount;
  const canEndTurn = hasDiscarded && !endTurnBlocked;
  const discardBtnLabel = !hasDiscarded
    ? discardSelectedIds.size > 0
      ? `DISCARD (${discardSelectedIds.size})`
      : "SKIP DISCARD"
    : "DISCARD DONE";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", padding: "8px 16px", gap: 16 }}>
      {isMyTurn && isAI ? (
        <>
          {/* Hand section + staging */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Phase label — contains "Player Turn" for test wait */}
            <p style={{ fontFamily: "monospace", fontSize: 9, color: "#555", letterSpacing: 2, margin: 0 }}>
              {`// Player Turn · Round ${round} · ${!hasDiscarded ? "DISCARD UP TO 3" : `${playsRemaining} PLAY${playsRemaining !== 1 ? "S" : ""} REMAINING`}`}
            </p>

            {/* h3 + card buttons — test locates buttons via h3 parent */}
            <div>
              <h3 style={{ fontFamily: "monospace", fontSize: 10, color: "#666", letterSpacing: 1, margin: "0 0 6px 0", fontWeight: "normal" }}>
                Your Hand
              </h3>
              <div style={{ display: "flex", gap: 24, overflowX: "auto", paddingBottom: 4 }}>
                {!hasDiscarded ? (
                  discardGroups.length > 0 ? (
                    discardGroups.map(([key, cards]) => {
                      const discardCount = cards.filter((c) => discardSelectedIds.has(c.id)).length;
                      return (
                        <CardStackGroup
                          key={key}
                          cardKey={key}
                          cards={cards}
                          isSelected={discardCount > 0}
                          tag={discardCount > 0 ? `DISCARD ×${discardCount}` : undefined}
                          disabled={false}
                          onClick={() => toggleDiscardStack(key)}
                        />
                      );
                    })
                  ) : (
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#555" }}>No cards in hand.</span>
                  )
                ) : (
                  playGroups.length > 0 ? (
                    playGroups.map(([key, cards]) => {
                      const isSelected = selectedCardKey === key;
                      const isDisabled = virusDisabledKeys.includes(key) || (computeBlocked && key === "compute");
                      return (
                        <CardStackGroup
                          key={key}
                          cardKey={key}
                          cards={cards}
                          isSelected={isSelected}
                          tag={isSelected ? "SELECTED ×1" : undefined}
                          disabled={isDisabled}
                          onClick={() => setSelectedCardKey(isSelected ? null : key)}
                        />
                      );
                    })
                  ) : (
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "#555" }}>No cards remaining.</span>
                  )
                )}
              </div>
            </div>

            {/* Dataset Integration compute-slot hint */}
            {hasDiscarded && computeBlocked && (
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "#666", letterSpacing: 1 }}>
                Play Data to unlock Compute slots.
              </span>
            )}

            {/* Errors */}
            {(error || discardError) && (
              <p style={{ fontFamily: "monospace", fontSize: 10, color: "#a32d2d", margin: 0 }}>
                {error ?? discardError}
              </p>
            )}
          </div>

          {/* 4-button action panel */}
          <div style={{ width: 196, display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingTop: 18 }}>
            <ActionBtn
              label="PLAY CARD"
              enabled={canPlayCard}
              onClick={handlePlayCard}
              loading={playLoading}
              title={canPlayCard ? undefined : !hasDiscarded ? "Discard first" : !selectedCard ? "Select a card" : selectedCard.card_type !== "progress" ? "Select a Progress card" : "No plays remaining"}
            />
            <ActionBtn
              label="STAGE FOR POOL"
              enabled={canStage}
              onClick={handleStageCard}
              title={canStage ? undefined : !hasDiscarded ? "Discard first" : virusCount === 0 ? "No viruses this turn" : stagedCards.length >= virusCount ? "Staging full" : "Select a card"}
            />
            {stagedCards.length > 0 && (
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a87a17", letterSpacing: 1 }}>
                {`staged ×${stagedCards.length}${stagingNeeded > 0 ? ` · ${stagingNeeded} more` : " · ready"}`}
              </span>
            )}
            <ActionBtn
              label={discardBtnLabel}
              enabled={!hasDiscarded}
              onClick={!hasDiscarded ? () => handleDiscard(Array.from(discardSelectedIds)) : undefined}
              loading={discardLoading}
            />
            <ActionBtn
              label={endTurnBlocked ? `STAGE ${stagingNeeded} MORE` : "END TURN"}
              enabled={canEndTurn}
              onClick={handleEndTurn}
              loading={endLoading}
            />
          </div>
        </>
      ) : !isMyTurn ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Status */}
          <p style={{ fontFamily: "monospace", fontSize: 10, color: "#555", letterSpacing: 1, margin: 0 }}>
            {`// Player Turn · Round ${round}`}
          </p>
          <div
            style={{
              padding: "10px 14px",
              background: "#0c0c0c",
              border: "1px solid #1a1a1a",
              borderRadius: 2,
            }}
          >
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "#555", margin: 0 }}>
              {isAI
                ? `Waiting for ${currentTurnPlayer?.display_name ?? "…"} to finish their turn.`
                : `${currentTurnPlayer?.display_name ?? "An AI"} is taking their turn.`}
            </p>
          </div>

          {/* Abort (human, round 2 only) */}
          {isHuman && round === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {!abortConfirming ? (
                <button
                  onClick={() => setAbortConfirming(true)}
                  style={{
                    padding: "9px 14px",
                    background: "#0c0c0c",
                    border: "1px solid #5a3a3a",
                    borderRadius: 2,
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: "#a32d2d",
                    cursor: "pointer",
                    letterSpacing: 1,
                    textAlign: "left" as const,
                  }}
                >
                  ABORT MISSION
                </button>
              ) : (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "#0c0c0c",
                    border: "1px solid #5a3a3a",
                    borderRadius: 2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <p style={{ fontFamily: "monospace", fontSize: 9, color: "#a32d2d", margin: 0 }}>
                    Abort mission? Normal fail penalty applies (Escape Timer increases).
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={handleAbortMission}
                      disabled={abortLoading}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        background: "#1a0808",
                        border: "1px solid #a32d2d",
                        borderRadius: 2,
                        fontFamily: "monospace",
                        fontSize: 10,
                        color: "#a32d2d",
                        cursor: abortLoading ? "default" : "pointer",
                        opacity: abortLoading ? 0.6 : 1,
                        letterSpacing: 1,
                      }}
                    >
                      {abortLoading ? "..." : "CONFIRM ABORT"}
                    </button>
                    <button
                      onClick={() => setAbortConfirming(false)}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        background: "#0c0c0c",
                        border: "1px solid #222",
                        borderRadius: 2,
                        fontFamily: "monospace",
                        fontSize: 10,
                        color: "#444",
                        cursor: "pointer",
                        letterSpacing: 1,
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
              {abortError && (
                <p style={{ fontFamily: "monospace", fontSize: 10, color: "#a32d2d", margin: 0 }}>
                  {abortError}
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
