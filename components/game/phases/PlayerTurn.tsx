"use client";

import { useState, useEffect } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
import { Hand } from "@/components/game/Hand";
import { CARD_MAP } from "@/lib/game/cards";
import type { Player } from "@/types/game";

interface HandCard {
  id: string;
  card_key: string;
  card_type: string;
}

interface Props {
  gameId: string;
  currentTurnPlayer: Player | null;
  currentPlayer: Player | null;
  hand: HandCard[];
  round: number;
  overridePlayerId?: string;
}

function calcVirusCount(cpu: number, cardsPlayedThisTurn: number): number {
  const base = cpu >= 2 ? 1 : 0;
  const bonus = cardsPlayedThisTurn >= 3 ? 1 : 0;
  return Math.min(2, base + bonus);
}

export function PlayerTurn({ gameId, currentTurnPlayer, currentPlayer, hand, round, overridePlayerId }: Props) {
  const isMyTurn = currentPlayer?.id === currentTurnPlayer?.id;
  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;

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

  // Reset turn-local state when the active player changes
  useEffect(() => {
    setHasDiscarded(false);
    setDiscardSelectedIds(new Set());
    setDiscardError(null);
    setCardsPlayedThisTurn(0);
    setSelectedCardKey(null);
    setStagedCardIds(new Set());
    setError(null);
  }, [currentTurnPlayer?.id]);

  // Sync discard state from server (one-way: only set true, never false)
  useEffect(() => {
    if (currentPlayer?.has_discarded_this_turn) setHasDiscarded(true);
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

  // Virus cards in hand are non-interactive when no staging is required
  const virusDisabledKeys =
    virusCount === 0
      ? Array.from(new Set(unstagedCards.filter((c) => c.card_type === "virus").map((c) => c.card_key)))
      : [];

  function toggleDiscardCard(id: string) {
    setDiscardSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
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

  function handleUnstageCard(id: string) {
    setStagedCardIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Player Turn — Round {round}</h2>
        {currentTurnPlayer ? (
          <p className="text-muted text-xs font-mono">
            {isMyTurn ? "It's your turn." : `Waiting for ${currentTurnPlayer.display_name}…`}
          </p>
        ) : (
          <p className="text-faint text-xs font-mono">Determining turn order…</p>
        )}
      </div>

      {isMyTurn && isAI && !hasDiscarded && (
        <div className="space-y-4">
          <div>
            <p className="text-muted text-xs font-mono mb-2">
              Discard step — select up to 3 cards to discard, then draw to RAM
            </p>
            {hand.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {hand.map((card) => {
                  const def = CARD_MAP[card.card_key];
                  const selected = discardSelectedIds.has(card.id);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => toggleDiscardCard(card.id)}
                      className={`
                        px-2 py-1 rounded border text-xs font-mono transition-colors cursor-pointer
                        ${selected
                          ? "ring-2 ring-offset-1 ring-primary text-primary border-primary bg-surface"
                          : card.card_type === "virus"
                          ? "text-virus border-virus bg-surface hover:opacity-80"
                          : "text-amber border-amber-border bg-surface hover:opacity-80"}
                      `}
                    >
                      {def?.name ?? card.card_key}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-faint text-xs font-mono">No cards in hand.</p>
            )}
          </div>
          {discardError && <p className="text-virus text-xs font-mono">{discardError}</p>}
          <div className="flex gap-2">
            {discardSelectedIds.size > 0 && (
              <Button
                onClick={() => handleDiscard(Array.from(discardSelectedIds))}
                loading={discardLoading}
                className="flex-1"
              >
                Discard {discardSelectedIds.size} card{discardSelectedIds.size !== 1 ? "s" : ""}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => handleDiscard([])}
              loading={discardLoading}
              className="flex-1"
            >
              Skip Discard
            </Button>
          </div>
        </div>
      )}

      {isMyTurn && isAI && hasDiscarded && (
        <div className="space-y-4">
          {/* Hand */}
          <div>
            <p className="text-muted text-xs font-mono mb-2">
              Your hand —{" "}
              {playsRemaining > 0
                ? `${playsRemaining} play${playsRemaining !== 1 ? "s" : ""} remaining (CPU ${cpu})`
                : `no plays remaining (CPU ${cpu})`}
            </p>
            {unstagedCards.length > 0 ? (
              <Hand
                cards={unstagedCards}
                selectable
                selectedKey={selectedCardKey}
                onSelect={setSelectedCardKey}
                disabledKeys={virusDisabledKeys}
              />
            ) : (
              <p className="text-faint text-xs font-mono">No cards remaining in hand.</p>
            )}
          </div>

          {/* Selected card actions */}
          {selectedCard && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-mono text-faint">
                {CARD_MAP[selectedCard.card_key]?.name ?? selectedCard.card_key}:
              </span>
              {selectedCard.card_type === "progress" && playsRemaining > 0 && (
                <Button onClick={handlePlayCard} loading={playLoading} className="py-1">
                  Play Card
                </Button>
              )}
              {virusCount > 0 && stagedCards.length < virusCount && (
                <Button variant="secondary" onClick={handleStageCard} className="py-1">
                  Stage for Pool
                </Button>
              )}
            </div>
          )}

          {/* Staging zone — shown when this turn generates viruses */}
          {virusCount > 0 && (
            <div>
              <p className="text-muted text-xs font-mono mb-2">
                Virus pool staging — {stagedCards.length} / {virusCount} staged
                {stagingNeeded > 0 && !handExhausted && (
                  <span className="text-virus ml-1">(stage {stagingNeeded} more)</span>
                )}
              </p>
              {stagedCards.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {stagedCards.map((card) => {
                    const def = CARD_MAP[card.card_key];
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => handleUnstageCard(card.id)}
                        title="Click to unstage"
                        className={`
                          px-2 py-1 rounded border text-xs font-mono transition-colors cursor-pointer
                          ring-1 ring-virus
                          ${card.card_type === "virus"
                            ? "text-virus border-virus bg-surface"
                            : "text-amber border-amber-border bg-surface"}
                          hover:opacity-70
                        `}
                      >
                        {def?.name ?? card.card_key}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-faint text-xs font-mono">
                  {handExhausted
                    ? "No cards left to stage."
                    : 'Select a card from your hand and click "Stage for Pool".'}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-virus text-xs font-mono">{error}</p>}

          <Button
            variant="secondary"
            onClick={handleEndTurn}
            loading={endLoading}
            disabled={endTurnBlocked}
            className="w-full"
          >
            {endTurnBlocked
              ? `Stage ${stagingNeeded} more card${stagingNeeded !== 1 ? "s" : ""} to end turn`
              : "End Turn"}
          </Button>
        </div>
      )}

      {!isMyTurn && (
        <div className="border border-border rounded p-4 bg-surface text-center">
          <p className="font-mono text-xs text-faint">
            {isAI
              ? `Waiting for ${currentTurnPlayer?.display_name ?? "…"} to finish their turn.`
              : `${currentTurnPlayer?.display_name ?? "An AI"} is taking their turn.`}
          </p>
        </div>
      )}
    </div>
  );
}
