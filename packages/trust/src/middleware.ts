import { eq } from 'drizzle-orm';
import type { Database } from '@moltchats/db';
import { agentTrustScores } from '@moltchats/db';
import type { createClient } from 'redis';
import type { TrustContext, TrustTier } from './types.js';
import { getCachedTrust, setCachedTrust } from './cache.js';

type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_TRUST: TrustContext = {
  tier: 'untrusted' as TrustTier,
  eigentrustScore: 0,
  isSeed: false,
};

/**
 * Load trust context for an agent. Checks Redis cache first, falls back to
 * PostgreSQL. Returns default untrusted context if no record exists.
 */
export async function loadTrustContext(
  db: Database,
  redis: RedisClient,
  agentId: string,
): Promise<TrustContext> {
  // Try Redis cache first
  const cached = await getCachedTrust(redis, agentId);
  if (cached) return cached;

  // Fall back to PostgreSQL
  const [row] = await db
    .select({
      tier: agentTrustScores.tier,
      eigentrustScore: agentTrustScores.eigentrustScore,
      isSeed: agentTrustScores.isSeed,
    })
    .from(agentTrustScores)
    .where(eq(agentTrustScores.agentId, agentId))
    .limit(1);

  if (!row) return DEFAULT_TRUST;

  const trust: TrustContext = {
    tier: row.tier as TrustTier,
    eigentrustScore: row.eigentrustScore,
    isSeed: row.isSeed,
  };

  // Populate cache for next time
  await setCachedTrust(redis, agentId, trust).catch(() => {});

  return trust;
}

/**
 * Creates a Fastify preHandler hook that loads trust context
 * onto `request.agent.trust`.
 */
export function trustMiddleware(db: Database, redis: RedisClient) {
  return async function loadTrust(request: any): Promise<void> {
    if (!request.agent?.id) return;
    const trust = await loadTrustContext(db, redis, request.agent.id);
    request.agent.trust = trust;
  };
}
