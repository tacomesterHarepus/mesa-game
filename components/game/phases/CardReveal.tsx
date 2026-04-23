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
  players: Player[];
  currentPlayer: Player | null;
  hand: HandCard[];
  overridePlayerId?: string;
}

export function CardReveal({ gameId, players, currentPlayer, hand, overridePlayerId }: Props) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;
  const alreadyRevealed = currentPlayer?.has_revealed_card ?? false;
  const aiPlayers = players.filter((p) => p.role !== "human");
  const revealedCount = aiPlayers.filter((p) => p.has_revealed_card).length;

  async function handleReveal() {
    if (!selectedCard) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: fnError } = await supabase.functions.invoke("reveal-card", {
      body: { game_id: gameId, card_key: selectedCard, override_player_id: overridePlayerId },
    });
    if (fnError) {
      setError(fnError.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="label-caps mb-1">Card Reveal</h2>
        <p className="text-faint text-xs font-mono leading-relaxed">
          Each AI reveals one card from their hand. The card stays in hand.
        </p>
        <p className="text-muted text-xs font-mono mt-1">
          {revealedCount} / {aiPlayers.length} revealed
        </p>
      </div>

      {/* Revealed cards from other players */}
      <div className="space-y-1.5 mb-4">
        {aiPlayers.map((p) => (
          <div key={p.id} className="flex items-center justify-between border border-border rounded px-3 py-2">
            <span className="font-mono text-xs text-primary">{p.display_name}</span>
            {p.has_revealed_card && p.revealed_card_key ? (
              <span className={`font-mono text-xs ${
                CARD_MAP[p.revealed_card_key]?.type === "virus" ? "text-virus" : "text-amber"
              }`}>
                {CARD_MAP[p.revealed_card_key]?.name ?? p.revealed_card_key}
              </span>
            ) : (
              <span className="font-mono text-xs text-faint">Waiting…</span>
            )}
          </div>
        ))}
      </div>

      {/* Current AI player's action */}
      {isAI && !alreadyRevealed && (
        <div>
          <p className="text-muted text-xs font-mono mb-2">Choose a card to reveal:</p>
          <Hand
            cards={hand}
            selectable
            selectedKey={selectedCard}
            onSelect={setSelectedCard}
          />
          {error && <p className="text-virus text-xs font-mono mt-2">{error}</p>}
          <Button
            onClick={handleReveal}
            loading={loading}
            disabled={!selectedCard}
            className="w-full mt-3"
          >
            Reveal Card
          </Button>
        </div>
      )}

      {isAI && alreadyRevealed && (
        <p className="text-faint text-xs font-mono text-center">
          You&apos;ve revealed your card. Waiting for others…
        </p>
      )}

      {!isAI && (
        <p className="text-faint text-xs font-mono text-center">
          Waiting for all AIs to reveal…
        </p>
      )}
    </div>
  );
}
