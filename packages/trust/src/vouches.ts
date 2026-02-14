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
