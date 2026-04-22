// Mission special-rule validators — mirrored in Edge Functions for server-side enforcement.

import type { MissionDefinition } from './missions'

export interface ContributionState {
  compute: number
  data: number
  validation: number
  contributors: Record<string, number>       // player_id → total cards
  validationContributors: string[]            // player_id list (for cross_validation)
  computeRound: 1 | 2                        // for synchronized_training
  datasetIntegrationComputeSlots: number     // for dataset_integration
  finalRoundPlays: Record<string, number>    // player_id → cards this round (for experimental_vaccine_model)
}

export function canPlayCard(
  mission: MissionDefinition,
  state: ContributionState,
  playerId: string,
  cardKey: string,
  currentRound: number,
): { allowed: boolean; reason?: string } {
  switch (mission.key) {
    case 'dataset_preparation':
      if (cardKey === 'compute' && state.data < (mission.requirements.data ?? 0)) {
        return { allowed: false, reason: 'Data requirement must be met before Compute can be played.' }
      }
      break

    case 'cross_validation':
      if (cardKey === 'validation' && state.validationContributors.includes(playerId)) {
        return { allowed: false, reason: 'You have already contributed a Validation card.' }
      }
      break

    case 'distributed_training':
      // No per-play restriction; checked at mission end.
      break

    case 'balanced_compute_cluster': {
      const played = state.contributors[playerId] ?? 0
      if (played >= 2) {
        return { allowed: false, reason: 'You may contribute at most 2 cards in this mission.' }
      }
      break
    }

    case 'dataset_integration':
      if (cardKey === 'compute') {
        const used = state.compute
        if (used >= state.datasetIntegrationComputeSlots) {
          return { allowed: false, reason: 'No Compute slots available — play Data cards to unlock more.' }
        }
      }
      break

    case 'multi_model_ensemble':
      if (cardKey === 'data') {
        const dataPlayed = state.validationContributors.filter(id => id === playerId).length
        if (dataPlayed >= 1) {
          return { allowed: false, reason: 'You may only play 1 Data card in this mission.' }
        }
      }
      if (cardKey === 'validation') {
        if (state.validationContributors.includes(playerId)) {
          return { allowed: false, reason: 'You may only play 1 Validation card in this mission.' }
        }
      }
      break

    case 'synchronized_training':
      if (cardKey === 'compute' && currentRound !== state.computeRound) {
        return { allowed: false, reason: 'All Compute must be played in the same round.' }
      }
      break

    case 'genome_simulation':
      if (cardKey === 'validation') {
        const req = mission.requirements
        const computeMet = state.compute >= (req.compute ?? 0)
        const dataMet = state.data >= (req.data ?? 0)
        if (!computeMet || !dataMet) {
          return { allowed: false, reason: 'Validation must be the final contribution.' }
        }
      }
      break

    case 'global_research_network': {
      const counts: Record<string, number> = {
        compute: state.compute,
        data: state.data,
        validation: state.validation,
      }
      if ((counts[cardKey] ?? 0) >= 3) {
        return { allowed: false, reason: `No AI may contribute more than 3 ${cardKey} cards.` }
      }
      break
    }

    case 'experimental_vaccine_model':
      if (currentRound === 2) {
        const playsThisRound = state.finalRoundPlays[playerId] ?? 0
        if (playsThisRound >= 1) {
          return { allowed: false, reason: 'Each AI may play only 1 card per turn in the final round.' }
        }
      }
      break
  }

  return { allowed: true }
}
