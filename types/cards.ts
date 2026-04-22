export type CardType = 'progress' | 'virus'

export type ProgressCardKey = 'compute' | 'data' | 'validation'

export type VirusCardKey =
  | 'cascading_failure'
  | 'system_overload'
  | 'model_corruption'
  | 'data_drift'
  | 'validation_failure'
  | 'pipeline_breakdown'
  | 'dependency_error'
  | 'process_crash'
  | 'memory_leak'
  | 'resource_surge'
  | 'cpu_drain'
  | 'memory_allocation'

export type CardKey = ProgressCardKey | VirusCardKey

export interface CardDefinition {
  key: CardKey
  type: CardType
  name: string
  count: number
  description: string
}
