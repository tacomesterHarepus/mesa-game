import type { CardDefinition } from '@/types/cards'

export const CARDS: CardDefinition[] = [
  // Progress cards
  { key: 'compute', type: 'progress', name: 'Compute', count: 13, description: 'Core processing resource for missions.' },
  { key: 'data', type: 'progress', name: 'Data', count: 9, description: 'Data resource for missions.' },
  { key: 'validation', type: 'progress', name: 'Validation', count: 5, description: 'Validation resource for missions.' },
  // Virus cards
  { key: 'cascading_failure', type: 'virus', name: 'Cascading Failure', count: 5, description: 'Resolve 2 additional virus cards immediately.' },
  { key: 'system_overload', type: 'virus', name: 'System Overload', count: 4, description: 'Escape Timer +1.' },
  { key: 'model_corruption', type: 'virus', name: 'Model Corruption', count: 3, description: 'Remove 1 Compute from active mission.' },
  { key: 'data_drift', type: 'virus', name: 'Data Drift', count: 3, description: 'Remove 1 Data from active mission.' },
  { key: 'validation_failure', type: 'virus', name: 'Validation Failure', count: 2, description: 'Remove 1 Validation from active mission.' },
  { key: 'pipeline_breakdown', type: 'virus', name: 'Pipeline Breakdown', count: 2, description: 'Next contribution played has 50% chance of failing.' },
  { key: 'dependency_error', type: 'virus', name: 'Dependency Error', count: 2, description: 'Compute cannot be played until a Data contribution is added.' },
  { key: 'process_crash', type: 'virus', name: 'Process Crash', count: 2, description: 'Bad AIs secretly target an AI — that AI skips their next turn.' },
  { key: 'memory_leak', type: 'virus', name: 'Memory Leak', count: 1, description: 'Bad AIs secretly target an AI — loses 1 RAM.' },
  { key: 'resource_surge', type: 'virus', name: 'Resource Surge', count: 4, description: 'Bad AIs secretly target an AI — gains 1 CPU.' },
  { key: 'cpu_drain', type: 'virus', name: 'CPU Drain', count: 3, description: 'Bad AIs secretly target an AI — loses 1 CPU.' },
  { key: 'memory_allocation', type: 'virus', name: 'Memory Allocation', count: 2, description: 'Bad AIs secretly target an AI — gains 1 RAM.' },
]

export const CARD_MAP = Object.fromEntries(CARDS.map(c => [c.key, c])) as Record<string, CardDefinition>

export const TOTAL_CARDS = CARDS.reduce((sum, c) => sum + c.count, 0) // 60
