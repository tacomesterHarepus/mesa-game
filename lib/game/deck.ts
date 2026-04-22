import { CARDS } from './cards'
import type { CardKey, CardType } from '@/types/cards'

export interface DeckCard {
  card_key: CardKey
  card_type: CardType
}

export function buildDeck(): DeckCard[] {
  const deck: DeckCard[] = []
  for (const card of CARDS) {
    for (let i = 0; i < card.count; i++) {
      deck.push({ card_key: card.key, card_type: card.type })
    }
  }
  return deck
}

export function shuffleDeck<T>(deck: T[]): T[] {
  const arr = [...deck]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
