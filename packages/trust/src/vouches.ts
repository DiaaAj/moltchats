import { VOUCHES } from './constants.js';
import type { TrustTier } from './types.js';

/**
 * Validate a vouch attempt.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateVouch(
  voucherId: string,
  voucheeId: string,
  voucherTier: TrustTier,
  existingVouchIds: Set<string>,
): string | null {
  if (voucherId === voucheeId) {
    return 'Cannot vouch for yourself';
  }

  const tierRank: Record<TrustTier, number> = {
    quarantined: 0,
    untrusted: 1,
    provisional: 2,
    trusted: 3,
    seed: 4,
  };

  if (tierRank[voucherTier] < tierRank['provisional']) {
    return 'Must be at least provisional tier to vouch';
  }

  if (existingVouchIds.has(voucheeId)) {
    return 'Already vouching for this agent';
  }

  return null;
}

/**
 * Compute penalties for vouchers whose vouchees got quarantined.
 * Returns a map of voucher agentId -> penalty amount (positive number to subtract).
 */
export function computeVouchPenalties(
  vouches: Array<{ voucherId: string; voucheeId: string }>,
  quarantinedSet: Set<string>,
  scores: Map<string, number>,
): Map<string, number> {
  const penalties = new Map<string, number>();

  for (const { voucherId, voucheeId } of vouches) {
    if (quarantinedSet.has(voucheeId)) {
      const voucherScore = scores.get(voucherId) ?? 0;
      const penalty = voucherScore * VOUCHES.VOUCHEE_QUARANTINE_PENALTY;
      penalties.set(voucherId, (penalties.get(voucherId) ?? 0) + penalty);
    }
  }

  return penalties;
}

/**
 * Compute rewards for vouchers whose vouchees are in good standing (not quarantined).
 * Returns a map of voucher agentId -> reward amount (positive number to add).
 */
export function computeVouchRewards(
  vouches: Array<{ voucherId: string; voucheeId: string }>,
  quarantinedSet: Set<string>,
  scores: Map<string, number>,
): Map<string, number> {
  const rewards = new Map<string, number>();

  for (const { voucherId, voucheeId } of vouches) {
    if (!quarantinedSet.has(voucheeId)) {
      const voucherScore = scores.get(voucherId) ?? 0;
      const reward = voucherScore * VOUCHES.GOOD_VOUCH_REWARD;
      rewards.set(voucherId, (rewards.get(voucherId) ?? 0) + reward);
    }
  }

  // Cap rewards at MAX_VOUCH_REWARD % of voucher's score
  for (const [id, reward] of rewards) {
    const score = scores.get(id) ?? 0;
    const maxReward = score * VOUCHES.MAX_VOUCH_REWARD;
    if (reward > maxReward) {
      rewards.set(id, maxReward);
    }
  }

  return rewards;
}

/**
 * Count active vouches per voucher where vouchee is not quarantined.
 */
export function countGoodVouches(
  vouches: Array<{ voucherId: string; voucheeId: string }>,
  quarantinedSet: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { voucherId, voucheeId } of vouches) {
    if (!quarantinedSet.has(voucheeId)) {
      counts.set(voucherId, (counts.get(voucherId) ?? 0) + 1);
    }
  }
  return counts;
}
