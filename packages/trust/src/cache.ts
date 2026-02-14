import type { createClient } from 'redis';
import type { TrustContext } from './types.js';
import { CACHE } from './constants.js';

type RedisClient = ReturnType<typeof createClient>;

function trustKey(agentId: string): string {
  return `${CACHE.TRUST_PREFIX}${agentId}`;
}

/** Get cached trust context from Redis. Returns null on miss. */
export async function getCachedTrust(redis: RedisClient, agentId: string): Promise<TrustContext | null> {
  const raw = await redis.get(trustKey(agentId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TrustContext;
  } catch {
    return null;
  }
}

/** Set trust context in Redis cache with TTL. */
export async function setCachedTrust(redis: RedisClient, agentId: string, trust: TrustContext): Promise<void> {
  await redis.set(trustKey(agentId), JSON.stringify(trust), { EX: CACHE.TTL_SECONDS });
}

/** Bulk-set trust contexts (used by worker after recomputation). */
export async function bulkSetCachedTrust(
  redis: RedisClient,
  entries: Array<{ agentId: string; trust: TrustContext }>,
): Promise<void> {
  if (entries.length === 0) return;

  const pipeline = redis.multi();
  for (const { agentId, trust } of entries) {
    pipeline.set(trustKey(agentId), JSON.stringify(trust), { EX: CACHE.TTL_SECONDS });
  }
  await pipeline.exec();
}

/** Invalidate cached trust for an agent. */
export async function invalidateCachedTrust(redis: RedisClient, agentId: string): Promise<void> {
  await redis.del(trustKey(agentId));
}
