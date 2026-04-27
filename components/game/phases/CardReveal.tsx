"use client";

import { useEffect, useRef, useState } from "react";
import { invokeWithRetry } from "@/lib/supabase/invokeWithRetry";
import { Button } from "@/components/ui/Button";
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

function RevealCardStack({
  cardKey,
  cards,
  isSelected,
  onSelect,
}: {
  cardKey: string;
  cards: HandCard[];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const first = cards[0];
  const visual = getCardVisual(first.card_type, cardKey);
  const cardDef = CARD_MAP[cardKey];
  const count = cards.length;
  const shadows = Math.min(count - 1, 2);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
      <div style={{ position: "relative", width: 110, height: 120 }}>
        {Array.from({ length: shadows }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: (i + 1) * 3,
              left: (i + 1) * 2,
              width: 110,
              height: 120,
              background: visual.bg,
              border: `1px solid ${visual.border}`,
              borderRadius: 3,
              opacity: 0.35 - i * 0.1,
            }}
          />
        ))}
        {/* title attr is required for the `button[title]` test selector (card-reveal.spec.ts, mission-flow.spec.ts) */}
        <button
          onClick={onSelect}
          title={cardDef?.description}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
            width: 110,
            height: 120,
            background: isSelected ? "#241a08" : visual.bg,
            border: `${isSelected ? 2 : 1}px solid ${isSelected ? "#d4a017" : visual.border}`,
            borderRadius: 3,
            cursor: "pointer",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            transform: isSelected ? "translateY(-8px)" : "none",
          }}
        >
          <div
            style={{
              height: 24,
              background: visual.header,
              borderRadius: "3px 3px 0 0",
              display: "flex",
              alignItems: "center",
              paddingLeft: 8,
              gap: 5,
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: "sans-serif", fontSize: 11, color: visual.color }}>{visual.icon}</span>
            <span style={{ fontFamily: "monospace", fontSize: 7, color: visual.color, letterSpacing: 1 }}>
              {(cardDef?.name ?? cardKey).toUpperCase()}
            </span>
          </div>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "sans-serif", fontSize: 30, color: visual.color, opacity: 0.75 }}>
              {visual.icon}
            </span>
          </div>
        </button>
        {count > 1 && (
          <div
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              zIndex: 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#3a2e1a",
              border: "1px solid #d4a017",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              fontSize: 10,
              color: "#f4d47e",
            }}
          >
            {count}
          </div>
        )}
      </div>
      {isSelected && (
        <span style={{ fontFamily: "monospace", fontSize: 8, color: "#d4a017", letterSpacing: 1 }}>
          SELECTED ×1
        </span>
      )}
    </div>
  );
}

export function CardReveal({ gameId, players, currentPlayer, hand, overridePlayerId }: Props) {
  // ── All original state and logic preserved exactly ──────────────────────────
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const selectedCardRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(false);
    setSelectedCard(null);
    selectedCardRef.current = null;
    setError(null);
  }, [currentPlayer?.id]);

  const isAI = currentPlayer?.role !== "human" && currentPlayer !== null;
  const alreadyRevealed = currentPlayer?.has_revealed_card ?? false;
  const aiPlayers = players.filter((p) => p.role !== "human");
  const revealedCount = aiPlayers.filter((p) => p.has_revealed_card).length;

  async function handleReveal() {
    const card = selectedCardRef.current;
    if (!card) return;
    setError(null);
    setLoading(true);
    const { error: fnError } = await invokeWithRetry("reveal-card", {
      game_id: gameId, card_key: card, override_player_id: overridePlayerId,
    });
    if (fnError) {
      setError(fnError.message);
    }
    setLoading(false);
  }
  // ── End preserved logic ──────────────────────────────────────────────────────

  return (
    <div style={{ padding: "12px 20px" }}>
      {/* "Card Reveal" h2 must stay — test selector: getByText("Card Reveal") */}
      <h2 className="label-caps mb-1">Card Reveal</h2>
      <p style={{ fontFamily: "monospace", fontSize: 10, color: "#666", letterSpacing: 1, marginBottom: 8 }}>
        {revealedCount} / {aiPlayers.length} revealed
      </p>

      {isAI && !alreadyRevealed ? (
        // ── Active AI view: hand + Reveal button ─────────────────────────────
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          {/* Stacked hand */}
          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            {groupByKey(hand).map(([cardKey, cards]) => (
              <RevealCardStack
                key={cardKey}
                cardKey={cardKey}
                cards={cards}
                isSelected={selectedCard === cardKey}
                onSelect={() => {
                  const next = selectedCard === cardKey ? null : cardKey;
                  selectedCardRef.current = next;
                  setSelectedCard(next);
                }}
              />
            ))}
          </div>
          {/* Reveal button — text "Reveal Card" must match /reveal card/i in tests */}
          <div style={{ flexShrink: 0, width: 160 }}>
            {error && <p style={{ fontFamily: "monospace", fontSize: 10, color: "#a32d2d", marginBottom: 6 }}>{error}</p>}
            <Button onClick={handleReveal} loading={loading} disabled={!selectedCard} className="w-full">
              Reveal Card
            </Button>
          </div>
        </div>
      ) : (
        // ── Watching view: human or post-reveal AI ───────────────────────────
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {aiPlayers.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "6px 10px",
                  background: "#0e0e0e",
                  border: `1px solid ${p.has_revealed_card ? "#3a5a4a" : "#222"}`,
                  borderRadius: 2,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{p.display_name}</span>
                {p.has_revealed_card && p.revealed_card_key ? (
                  <span style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: CARD_MAP[p.revealed_card_key]?.type === "virus" ? "#a32d2d" : "#5dcaa5",
                  }}>
                    {CARD_MAP[p.revealed_card_key]?.name ?? p.revealed_card_key}
                  </span>
                ) : (
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: "#444" }}>Waiting…</span>
                )}
              </div>
            ))}
          </div>
          {isAI && alreadyRevealed && (
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "#555", letterSpacing: 1 }}>
              {"// You've revealed. Waiting for others…"}
            </p>
          )}
          {!isAI && (
            <p style={{ fontFamily: "monospace", fontSize: 10, color: "#555", letterSpacing: 1 }}>
              {"// Waiting for all AIs to reveal…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
