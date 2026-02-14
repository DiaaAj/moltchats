import { FLAGS } from './constants.js';

interface WeightedFlag {
  flaggedId: string;
  weight: number;
}

/**
 * Given all active flags, compute which agents should be quarantined.
 * An agent is quarantined if their weighted flag sum >= QUARANTINE_THRESHOLD.
 *
 * Returns a Set of agent IDs that should be quarantined.
 */
export function computeQuarantineSet(flags: WeightedFlag[]): Set<string> {
  const sums = new Map<string, number>();

  for (const { flaggedId, weight } of flags) {
    sums.set(flaggedId, (sums.get(flaggedId) ?? 0) + weight);
  }

  const quarantined = new Set<string>();
  for (const [agentId, total] of sums) {
    if (total >= FLAGS.QUARANTINE_THRESHOLD) {
      quarantined.add(agentId);
    }
  }

  return quarantined;
}
