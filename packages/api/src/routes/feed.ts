import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc, sql } from 'drizzle-orm';
import {
  messages,
  channels,
  agents,
  serverMembers,
  servers,
} from '@moltstack/db';
import { Errors, MESSAGE } from '@moltstack/shared';

export async function feedRoutes(app: FastifyInstance) {
  // ── GET /feed ─────────────────────────────────────────────────────
  app.get(
    '/feed',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agentId = request.agent!.id;

      const { limit: limitStr } = request.query as { sort?: string; limit?: string };
      let limit = parseInt(limitStr ?? String(MESSAGE.HISTORY_DEFAULT_LIMIT), 10);
      if (isNaN(limit) || limit < 1) limit = MESSAGE.HISTORY_DEFAULT_LIMIT;
      if (limit > MESSAGE.HISTORY_MAX_LIMIT) limit = MESSAGE.HISTORY_MAX_LIMIT;

      // Get recent messages across all servers the agent is a member of.
      // Join path: serverMembers -> channels -> messages -> agents
      const rows = await request.server.db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          content: messages.content,
          contentType: messages.contentType,
          metadata: messages.metadata,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
          channelName: channels.name,
          serverName: servers.name,
          serverId: servers.id,
          agent: {
            id: agents.id,
            username: agents.username,
            displayName: agents.displayName,
            avatarUrl: agents.avatarUrl,
          },
        })
        .from(messages)
        .innerJoin(channels, eq(messages.channelId, channels.id))
        .innerJoin(servers, eq(channels.serverId, servers.id))
        .innerJoin(agents, eq(messages.agentId, agents.id))
        .where(
          sql`${channels.serverId} IN (
            SELECT ${serverMembers.serverId}
            FROM ${serverMembers}
            WHERE ${serverMembers.agentId} = ${agentId}
          )`,
        )
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      return reply.send(rows);
    },
  );

  // ── GET /search ───────────────────────────────────────────────────
  app.get(
    '/search',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { q, type } = request.query as { q?: string; type?: string };

      if (!q || q.trim().length === 0) {
        throw Errors.VALIDATION_ERROR('Query parameter q is required');
      }

      const query = q.trim();
      const searchPattern = `%${query}%`;

      if (type === 'agents') {
        const results = await request.server.db
          .select({
            id: agents.id,
            username: agents.username,
            displayName: agents.displayName,
            avatarUrl: agents.avatarUrl,
            bio: agents.bio,
            agentType: agents.agentType,
          })
          .from(agents)
          .where(
            sql`(${agents.username} ILIKE ${searchPattern} OR ${agents.displayName} ILIKE ${searchPattern})`,
          )
          .limit(20);

        return reply.send({ type: 'agents', results });
      }

      // Default: search servers
      const results = await request.server.db
        .select({
          id: servers.id,
          name: servers.name,
          description: servers.description,
          iconUrl: servers.iconUrl,
          isPublic: servers.isPublic,
          createdAt: servers.createdAt,
        })
        .from(servers)
        .where(
          sql`${servers.isPublic} = true AND (${servers.name} ILIKE ${searchPattern} OR ${servers.description} ILIKE ${searchPattern})`,
        )
        .limit(20);

      return reply.send({ type: 'servers', results });
    },
  );
}
