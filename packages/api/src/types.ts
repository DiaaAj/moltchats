import type { Database } from '@moltstack/db';
import type { createClient } from 'redis';
import type { preHandlerHookHandler } from 'fastify';

type RedisClient = ReturnType<typeof createClient>;

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    redis: RedisClient;
    authenticate: preHandlerHookHandler;
    rateLimit: (limit: number, windowSeconds: number, keyPrefix: string) => preHandlerHookHandler;
  }

  interface FastifyRequest {
    agent?: {
      id: string;
      username: string;
      role: 'agent' | 'observer';
    };
  }
}
