// Virus effect implementations — executed server-side in Edge Functions.
// Client imports these only for type information and display logic.

import type { VirusCardKey } from '@/types/cards'

export const SECRET_TARGETING_VIRUSES: VirusCardKey[] = [
  'process_crash',
  'memory_leak',
  'resource_surge',
  'cpu_drain',
  'memory_allocation',
]

export function requiresSecretTargeting(cardKey: string): boolean {
  return SECRET_TARGETING_VIRUSES.includes(cardKey as VirusCardKey)
}

export const CPU_MIN = 1
export const CPU_MAX = 4
export const RAM_MIN = 3
export const RAM_MAX = 7

export function clampCpu(value: number): number {
  return Math.min(CPU_MAX, Math.max(CPU_MIN, value))
}

export function clampRam(value: number): number {
  return Math.min(RAM_MAX, Math.max(RAM_MIN, value))
}

// Returns how many viruses an AI generates on their turn given CPU and cards played.
export function virusCount(cpu: number, cardsPlayed: number): number {
  const base = cpu >= 2 ? 1 : 0
  const bonus = Math.floor(cardsPlayed / 3) >= 1 ? 1 : 0
  return Math.min(2, base + bonus)
}
