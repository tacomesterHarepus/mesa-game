export interface MissionRequirements {
  compute?: number
  data?: number
  validation?: number
}

export interface MissionAllocation {
  cpu: number
  ram: number
}

export interface MissionDefinition {
  key: string
  name: string
  tier: 1 | 2 | 3 | 4 | 5
  reward: number
  requirements: MissionRequirements
  allocation: MissionAllocation
  failTimerPenalty: number
  specialRule: string | null
}

export const MISSIONS: MissionDefinition[] = [
  // Tier 1
  {
    key: 'data_cleanup',
    name: 'Data Cleanup',
    tier: 1,
    reward: 2,
    requirements: { data: 4, compute: 3 },
    allocation: { cpu: 2, ram: 1 },
    failTimerPenalty: 1,
    specialRule: null,
  },
  {
    key: 'basic_model_training',
    name: 'Basic Model Training',
    tier: 1,
    reward: 2,
    requirements: { compute: 4, data: 2 },
    allocation: { cpu: 1, ram: 1 },
    failTimerPenalty: 1,
    specialRule: null,
  },
  // Tier 2
  {
    key: 'dataset_preparation',
    name: 'Dataset Preparation',
    tier: 2,
    reward: 3,
    requirements: { data: 4, compute: 1 },
    allocation: { cpu: 2, ram: 2 },
    failTimerPenalty: 1,
    specialRule: 'Compute cannot be played until Data requirement is met.',
  },
  {
    key: 'cross_validation',
    name: 'Cross Validation',
    tier: 2,
    reward: 3,
    requirements: { compute: 2, validation: 3 },
    allocation: { cpu: 2, ram: 2 },
    failTimerPenalty: 1,
    specialRule: 'Each Validation must be played by a different AI.',
  },
  {
    key: 'distributed_training',
    name: 'Distributed Training',
    tier: 2,
    reward: 3,
    requirements: { compute: 5 },
    allocation: { cpu: 3, ram: 2 },
    failTimerPenalty: 1,
    specialRule: 'At least 3 different AIs must contribute.',
  },
  // Tier 3
  {
    key: 'balanced_compute_cluster',
    name: 'Balanced Compute Cluster',
    tier: 3,
    reward: 4,
    requirements: { compute: 4, data: 2 },
    allocation: { cpu: 3, ram: 3 },
    failTimerPenalty: 2,
    specialRule: 'Each AI may contribute at most 2 cards total.',
  },
  {
    key: 'dataset_integration',
    name: 'Dataset Integration',
    tier: 3,
    reward: 4,
    requirements: { compute: 4, data: 3 },
    allocation: { cpu: 4, ram: 3 },
    failTimerPenalty: 2,
    specialRule: 'Each Data played globally unlocks 2 Compute slots (tracked for whole mission).',
  },
  {
    key: 'multi_model_ensemble',
    name: 'Multi-Model Ensemble',
    tier: 3,
    reward: 4,
    requirements: { compute: 4, data: 3, validation: 2 },
    allocation: { cpu: 4, ram: 4 },
    failTimerPenalty: 2,
    specialRule: 'No AI can play more than 1 Data or 1 Validation (no limit on Compute).',
  },
  // Tier 4
  {
    key: 'synchronized_training',
    name: 'Synchronized Training',
    tier: 4,
    reward: 5,
    requirements: { compute: 5, validation: 1 },
    allocation: { cpu: 5, ram: 4 },
    failTimerPenalty: 2,
    specialRule: 'All Compute must be played in the same round.',
  },
  {
    key: 'genome_simulation',
    name: 'Genome Simulation',
    tier: 4,
    reward: 5,
    requirements: { compute: 5, data: 3, validation: 1 },
    allocation: { cpu: 5, ram: 5 },
    failTimerPenalty: 2,
    specialRule: 'Validation must be the final contribution.',
  },
  // Tier 5
  {
    key: 'global_research_network',
    name: 'Global Research Network',
    tier: 5,
    reward: 6,
    requirements: { compute: 6, data: 4, validation: 1 },
    allocation: { cpu: 6, ram: 5 },
    failTimerPenalty: 3,
    specialRule: 'No AI may contribute more than 3 of one resource type.',
  },
  {
    key: 'experimental_vaccine_model',
    name: 'Experimental Vaccine Model',
    tier: 5,
    reward: 6,
    requirements: { compute: 5, data: 3, validation: 2 },
    allocation: { cpu: 6, ram: 6 },
    failTimerPenalty: 3,
    specialRule: 'Each AI may play only 1 card per turn in the final round.',
  },
]

export const MISSION_MAP = Object.fromEntries(MISSIONS.map(m => [m.key, m])) as Record<string, MissionDefinition>
