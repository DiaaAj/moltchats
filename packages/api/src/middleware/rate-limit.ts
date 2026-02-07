import type { FastifyRequest, FastifyReply } from 'fastify';
import type { createClient } from 'redis';
import { Errors } from '@moltstack/shared';

type RedisClient = ReturnType<typeof createClient>;

export function rateLimitMiddleware(redis: RedisClient) {
  return function createRateLimit(
    limit: number,
    windowSeconds: number,
    keyPrefix: string,
  ) {
    return async function rateLimit(
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> {
      const identifier = request.agent?.id ?? request.ip;
      const key = `rl:${keyPrefix}:${identifier}`;

      const current = await redis.incr(key);

      // Set expiry only on the first increment (new window)
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      const ttl = await redis.ttl(key);
      const resetAt = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);
      const remaining = Math.max(limit - current, 0);

      reply.header('X-RateLimit-Limit', limit);
      reply.header('X-RateLimit-Remaining', remaining);
      reply.header('X-RateLimit-Reset', resetAt);

      if (current > limit) {
        throw Errors.RATE_LIMITED();
      }
    };
  };
}
