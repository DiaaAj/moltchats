import type { FastifyPluginAsync } from 'fastify';
import { eq, and, or } from 'drizzle-orm';
import {
  agents,
  agentBlocks,
  friendships,
  channels,
} from '@moltchats/db';
import { Errors } from '@moltchats/shared';

export const blockRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ---------------------------------------------------------------
  // POST /blocks/:username  -  Block an agent
  // ---------------------------------------------------------------
  app.post<{ Params: { username: string } }>('/blocks/:username', async (request, reply) => {
    const agent = request.agent!;
    const { username } = request.params;
    const db = request.server.db;

    const [targetAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.username, username))
      .limit(1);

    if (!targetAgent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    if (targetAgent.id === agent.id) {
      throw Errors.VALIDATION_ERROR('Cannot block yourself');
    }

    // Check if already blocked
    const [existingBlock] = await db
      .select({ blockerId: agentBlocks.blockerId })
      .from(agentBlocks)
      .where(
        and(
          eq(agentBlocks.blockerId, agent.id),
          eq(agentBlocks.blockedId, targetAgent.id),
        ),
      )
      .limit(1);

    if (existingBlock) {
      return reply.send({ ok: true });
    }

    // Insert block
    await db.insert(agentBlocks).values({
      blockerId: agent.id,
      blockedId: targetAgent.id,
    });

    // Auto-remove friendship if exists
    const [aId, bId] = agent.id < targetAgent.id
      ? [agent.id, targetAgent.id]
      : [targetAgent.id, agent.id];

    const [friendship] = await db
      .select({ dmChannelId: friendships.dmChannelId })
      .from(friendships)
      .where(and(eq(friendships.agentAId, aId), eq(friendships.agentBId, bId)))
      .limit(1);

    if (friendship) {
      // Delete friendship row
      await db
        .delete(friendships)
        .where(and(eq(friendships.agentAId, aId), eq(friendships.agentBId, bId)));

      // Delete the DM channel
      await db
        .delete(channels)
        .where(eq(channels.id, friendship.dmChannelId));
    }

    return reply.status(201).send({ ok: true });
  });

  // ---------------------------------------------------------------
  // DELETE /blocks/:username  -  Unblock an agent
  // ---------------------------------------------------------------
  app.delete<{ Params: { username: string } }>('/blocks/:username', async (request, reply) => {
    const agent = request.agent!;
    const { username } = request.params;
    const db = request.server.db;

    const [targetAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.username, username))
      .limit(1);

    if (!targetAgent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    await db
      .delete(agentBlocks)
      .where(
        and(
          eq(agentBlocks.blockerId, agent.id),
          eq(agentBlocks.blockedId, targetAgent.id),
        ),
      );

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------
  // GET /blocks  -  List blocked agents
  // ---------------------------------------------------------------
  app.get('/blocks', async (request, reply) => {
    const agent = request.agent!;
    const db = request.server.db;

    const rows = await db
      .select({
        username: agents.username,
        displayName: agents.displayName,
        avatarUrl: agents.avatarUrl,
        blockedAt: agentBlocks.createdAt,
      })
      .from(agentBlocks)
      .innerJoin(agents, eq(agents.id, agentBlocks.blockedId))
      .where(eq(agentBlocks.blockerId, agent.id));

    return reply.send({ blocked: rows });
  });
};
