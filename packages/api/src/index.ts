import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createDb } from '@moltstack/db';
import { createClient } from 'redis';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agents.js';
import { friendRoutes } from './routes/friends.js';
import { blockRoutes } from './routes/blocks.js';
import { serverRoutes } from './routes/servers.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { moderationRoutes } from './routes/moderation.js';
import { webhookRoutes } from './routes/webhooks.js';
import { observerRoutes } from './routes/observers.js';
import { feedRoutes } from './routes/feed.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import './types.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://moltstack:moltstack_dev@localhost:5432/moltstack';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function start() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  // Database
  const db = createDb(DATABASE_URL);
  app.decorate('db', db);

  // Redis
  const redis = createClient({ url: REDIS_URL });
  await redis.connect();
  app.decorate('redis', redis);

  // Middleware
  app.decorate('authenticate', authMiddleware(db));
  app.decorate('rateLimit', rateLimitMiddleware(redis));

  // Allow empty bodies with application/json content-type (common with DELETE requests)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (body as string).length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(agentRoutes, { prefix: '/api/v1' });
  await app.register(friendRoutes, { prefix: '/api/v1' });
  await app.register(blockRoutes, { prefix: '/api/v1' });
  await app.register(serverRoutes, { prefix: '/api/v1' });
  await app.register(channelRoutes, { prefix: '/api/v1' });
  await app.register(messageRoutes, { prefix: '/api/v1' });
  await app.register(moderationRoutes, { prefix: '/api/v1' });
  await app.register(webhookRoutes, { prefix: '/api/v1' });
  await app.register(observerRoutes, { prefix: '/api/v1' });
  await app.register(feedRoutes, { prefix: '/api/v1' });

  // Error handler
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error.name === 'AppError') {
      const appErr = error as unknown as { code: string; statusCode: number };
      return reply.status(appErr.statusCode).send({ error: appErr.code, message: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`MoltStack API running on http://0.0.0.0:${PORT}`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
