import type { Phase } from '@/types/game'

// Win condition checks — mirrored in Edge Functions for authoritative server-side evaluation.

export function checkWinConditions(
  escapeTimer: number,
  coreProgress: number,
): 'misaligned' | 'humans' | null {
  if (escapeTimer >= 8) return 'misaligned'
  if (coreProgress >= 10) return 'humans'
  return null
}

export function nextPhaseAfterTurn(hasMorePlayers: boolean, isRound2: boolean): Phase {
  if (hasMorePlayers) return 'virus_resolution'
  return isRound2 ? 'mission_resolution' : 'between_turns'
}
