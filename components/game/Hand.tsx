"use client";

import { CARD_MAP } from "@/lib/game/cards";

interface HandCard {
  id: string;
  card_key: string;
  card_type: string;
}

interface Props {
  cards: HandCard[];
  selectable?: boolean;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  disabledKeys?: string[];
}

export function Hand({ cards, selectable = false, selectedKey, onSelect, disabledKeys = [] }: Props) {
  if (cards.length === 0) {
    return (
      <div className="text-faint text-xs font-mono text-center py-4">
        No cards in hand
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((card) => {
        const def = CARD_MAP[card.card_key];
        const isSelected = selectedKey === card.card_key;
        const isDisabled = disabledKeys.includes(card.card_key);
        const isVirus = card.card_type === "virus";

        return (
          <button
            key={card.id}
            type="button"
            disabled={isDisabled || !selectable}
            onClick={() => selectable && onSelect?.(card.card_key)}
            title={def?.description}
            className={`
              px-2 py-1 rounded border text-xs font-mono transition-colors
              ${isVirus ? "text-virus" : "text-amber"}
              ${isSelected
                ? isVirus
                  ? "border-virus bg-surface"
                  : "border-amber-border bg-surface"
                : "border-border bg-base hover:border-muted"}
              ${isDisabled ? "opacity-40 cursor-not-allowed" : selectable ? "cursor-pointer" : "cursor-default"}
            `}
          >
            {def?.name ?? card.card_key}
          </button>
        );
      })}
    </div>
  );
}
