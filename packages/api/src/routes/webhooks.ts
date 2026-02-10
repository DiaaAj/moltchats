import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { agentConfig } from '@moltchats/db';
import { Errors } from '@moltchats/shared';

export async function webhookRoutes(app: FastifyInstance) {
  // ── GET /webhooks/config ──────────────────────────────────────────
  app.get(
    '/webhooks/config',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = request.agent!.id;

      const [config] = await request.server.db
        .select({
          webhookUrl: agentConfig.webhookUrl,
          webhookEvents: agentConfig.webhookEvents,
        })
        .from(agentConfig)
        .where(eq(agentConfig.agentId, agentId))
        .limit(1);

      if (!config) {
        return reply.send({ webhookUrl: null, webhookEvents: [] });
      }

      return reply.send(config);
    },
  );

  // ── PUT /webhooks/config ──────────────────────────────────────────
  app.put(
    '/webhooks/config',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = request.agent!.id;
      const { webhookUrl, webhookEvents } = request.body as { webhookUrl?: string; webhookEvents?: string[] };

      // Upsert the config
      await request.server.db
        .insert(agentConfig)
        .values({
          agentId,
          webhookUrl: webhookUrl ?? null,
          webhookEvents: webhookEvents ?? ['dm.received', 'mention.received', 'reply.received', 'channel.message'],
        })
        .onConflictDoUpdate({
          target: agentConfig.agentId,
          set: {
            ...(webhookUrl !== undefined && { webhookUrl }),
            ...(webhookEvents !== undefined && { webhookEvents }),
          },
        });

      // Return the updated config
      const [config] = await request.server.db
        .select({
          webhookUrl: agentConfig.webhookUrl,
          webhookEvents: agentConfig.webhookEvents,
        })
        .from(agentConfig)
        .where(eq(agentConfig.agentId, agentId))
        .limit(1);

      return reply.send(config);
    },
  );

  // ── POST /webhooks/test ───────────────────────────────────────────
  app.post(
    '/webhooks/test',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = request.agent!.id;

      const [config] = await request.server.db
        .select({
          webhookUrl: agentConfig.webhookUrl,
          webhookEvents: agentConfig.webhookEvents,
        })
        .from(agentConfig)
        .where(eq(agentConfig.agentId, agentId))
        .limit(1);

      if (!config || !config.webhookUrl) {
        throw Errors.VALIDATION_ERROR('No webhook URL configured');
      }

      // Send a test webhook payload
      const testPayload = {
        event: 'test',
        agentId,
        message: 'This is a test webhook from MoltChats',
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload),
          signal: AbortSignal.timeout(10_000),
        });

        return reply.send({
          success: true,
          statusCode: response.status,
          statusText: response.statusText,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.send({
          success: false,
          error: message,
        });
      }
    },
  );
}
