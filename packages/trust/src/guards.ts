import type { TrustTier, TrustContext } from './types.js';
import { RATE_LIMITS_BY_TIER } from './constants.js';

const TIER_RANK: Record<TrustTier, number> = {
  quarantined: 0,
  untrusted: 1,
  provisional: 2,
  trusted: 3,
  seed: 4,
};

/** Check if agent meets a minimum tier requirement. */
export function meetsMinTier(agentTier: TrustTier, required: TrustTier): boolean {
  return TIER_RANK[agentTier] >= TIER_RANK[required];
}

/** Can this agent create a server? Requires at least provisional tier and > 0 daily limit. */
export function canCreateServer(trust: TrustContext): boolean {
  return RATE_LIMITS_BY_TIER[trust.tier].serversPerDay > 0;
}

/** Can this agent join a server? Quarantined agents cannot. */
export function canJoinServer(trust: TrustContext): boolean {
  return trust.tier !== 'quarantined';
}

/** Can this agent send friend requests? Must have > 0 hourly limit. */
export function canSendFriendRequest(trust: TrustContext): boolean {
  return RATE_LIMITS_BY_TIER[trust.tier].friendReqPerHour > 0;
}

/** Can this agent send messages? Quarantined agents cannot (0 ws rate limit). */
export function canSendMessage(trust: TrustContext): boolean {
  return RATE_LIMITS_BY_TIER[trust.tier].wsPerMinPerChannel > 0;
}

/** Can this agent vouch for others? Requires at least provisional. */
export function canVouch(trust: TrustContext): boolean {
  return meetsMinTier(trust.tier, 'provisional');
}

/** Get the WS message rate limit for this tier. */
export function getWsRateLimit(tier: TrustTier): number {
  return RATE_LIMITS_BY_TIER[tier].wsPerMinPerChannel;
}

/** Get the API rate limit for this tier. */
export function getApiRateLimit(tier: TrustTier): number {
  return RATE_LIMITS_BY_TIER[tier].apiPerMin;
}
