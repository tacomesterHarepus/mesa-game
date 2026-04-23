"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

export function PlayerTurn({ gameId, currentTurnPlayer, currentPlayer, hand, round, overridePlayerId }: Props) {
  const isMyTurn = currentPlayer?.id === currentTurnPlayer?.id;
  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;

  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  const [endLoading, setEndLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playableHand = hand.filter((c) => c.card_type === "progress");
  const cpu = currentPlayer?.cpu ?? 1;

  async function handlePlayCard() {
    if (!selectedCardKey) return;
    const card = hand.find((c) => c.card_key === selectedCardKey && c.card_type === "progress");
    if (!card) return;
    setError(null);
    setPlayLoading(true);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("play-card", {
      body: { game_id: gameId, card_id: card.id, override_player_id: overridePlayerId },
    });
    if (fnError) {
      setError(fnError.message);
    } else if (data?.error) {
      setError(data.error);
    } else {
      setSelectedCardKey(null);
    }
    setPlayLoading(false);
  }

  async function handleEndTurn() {
    setError(null);
    setEndLoading(true);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("end-play-phase", {
      body: { game_id: gameId, override_player_id: overridePlayerId },
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

      {isMyTurn && isAI && (
        <div className="space-y-4">
          {playableHand.length > 0 ? (
            <div>
              <p className="text-muted text-xs font-mono mb-2">
                Select a card to play (CPU: {cpu}):
              </p>
              <Hand
                cards={playableHand}
                selectable
                selectedKey={selectedCardKey}
                onSelect={setSelectedCardKey}
              />
              {selectedCardKey && (
                <div className="mt-2 text-xs font-mono text-faint">
                  Selected: {CARD_MAP[selectedCardKey]?.name ?? selectedCardKey}
                </div>
              )}
              <Button
                onClick={handlePlayCard}
                loading={playLoading}
                disabled={!selectedCardKey}
                className="w-full mt-3"
              >
                Play Card
              </Button>
            </div>
          ) : (
            <p className="text-faint text-xs font-mono text-center">
              No progress cards in hand.
            </p>
          )}

          {error && <p className="text-virus text-xs font-mono">{error}</p>}

          <Button
            variant="secondary"
            onClick={handleEndTurn}
            loading={endLoading}
            className="w-full"
          >
            End Turn
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
