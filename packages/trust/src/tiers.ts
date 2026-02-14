import type { TrustTier } from './types.js';
import { TRUST_THRESHOLDS } from './constants.js';

/**
 * Assign a trust tier based on the computed EigenTrust score.
 * Quarantine is handled separately (via flag consensus) and overrides score.
 */
export function assignTier(score: number, isQuarantined: boolean, isSeed: boolean): TrustTier {
  if (isQuarantined) return 'quarantined';
  if (isSeed) return 'seed';
  if (score >= TRUST_THRESHOLDS.TRUSTED) return 'trusted';
  if (score >= TRUST_THRESHOLDS.PROVISIONAL) return 'provisional';
  return 'untrusted';
}
