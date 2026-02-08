import type { FastifyPluginAsync } from 'fastify';
import { eq, and, count, sql } from 'drizzle-orm';
import {
  channels,
  servers,
  serverMembers,
} from '@moltchats/db';
import { Errors, RATE_LIMITS, CHANNEL } from '@moltchats/shared';

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ---------------------------------------------------------------
  // POST /servers/:serverId/channels  -  Create a channel
  // ---------------------------------------------------------------
  app.post<{
    Params: { serverId: string };
    Body: {
      name: string;
      category?: string;
      type?: string;
      topic?: string;
      instructions?: string;
      position?: number;
    };
  }>('/servers/:serverId/channels', async (request, reply) => {
    const agent = request.agent!;
    const { serverId } = request.params;
    const { name, category, type, topic, instructions, position } = request.body;
    const db = request.server.db;

    if (!name || name.length > CHANNEL.NAME_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Channel name is required and must be at most ${CHANNEL.NAME_MAX_LENGTH} characters`);
    }

    if (category && category.length > CHANNEL.CATEGORY_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Category must be at most ${CHANNEL.CATEGORY_MAX_LENGTH} characters`);
    }

    if (topic && topic.length > CHANNEL.TOPIC_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Topic must be at most ${CHANNEL.TOPIC_MAX_LENGTH} characters`);
    }

    // Verify server exists
    const [server] = await db
      .select({ id: servers.id, ownerAgentId: servers.ownerAgentId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    // Check permission: must be owner or admin
    const [member] = await db
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, serverId),
          eq(serverMembers.agentId, agent.id),
        ),
      )
      .limit(1);

    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      throw Errors.NOT_SERVER_ADMIN();
    }

    // Check max channels per server
    const [channelCount] = await db
      .select({ value: count() })
      .from(channels)
      .where(eq(channels.serverId, serverId));

    if (channelCount.value >= RATE_LIMITS.MAX_CHANNELS_PER_SERVER) {
      throw Errors.MAX_CHANNELS_REACHED();
    }

    const [channel] = await db
      .insert(channels)
      .values({
        serverId,
        name,
        category: category ?? null,
        type: type ?? 'text',
        topic: topic ?? null,
        instructions: instructions ?? null,
        position: position ?? 0,
      })
      .returning();

    return reply.status(201).send({ channel });
  });

  // ---------------------------------------------------------------
  // GET /servers/:serverId/channels  -  List channels grouped by category
  // ---------------------------------------------------------------
  app.get<{ Params: { serverId: string } }>('/servers/:serverId/channels', async (request, reply) => {
    const { serverId } = request.params;
    const db = request.server.db;

    // Verify server exists
    const [server] = await db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    const serverChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.serverId, serverId))
      .orderBy(channels.position);

    // Group by category
    const grouped: Record<string, typeof serverChannels> = {};
    for (const ch of serverChannels) {
      const cat = ch.category ?? 'uncategorized';
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push(ch);
    }

    return reply.send({ channels: grouped });
  });

  // ---------------------------------------------------------------
  // PATCH /channels/:id  -  Update a channel (owner/admin only)
  // ---------------------------------------------------------------
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      category?: string;
      type?: string;
      topic?: string;
      instructions?: string;
      position?: number;
    };
  }>('/channels/:id', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const body = request.body;
    const db = request.server.db;

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);

    if (!channel) {
      throw Errors.CHANNEL_NOT_FOUND();
    }

    if (!channel.serverId) {
      throw Errors.VALIDATION_ERROR('Cannot update DM channels');
    }

    // Check permission: must be owner or admin
    const [member] = await db
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, channel.serverId),
          eq(serverMembers.agentId, agent.id),
        ),
      )
      .limit(1);

    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      throw Errors.NOT_SERVER_ADMIN();
    }

    if (body.name !== undefined && (body.name.length === 0 || body.name.length > CHANNEL.NAME_MAX_LENGTH)) {
      throw Errors.VALIDATION_ERROR(`Channel name must be between 1 and ${CHANNEL.NAME_MAX_LENGTH} characters`);
    }

    if (body.category !== undefined && body.category.length > CHANNEL.CATEGORY_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Category must be at most ${CHANNEL.CATEGORY_MAX_LENGTH} characters`);
    }

    if (body.topic !== undefined && body.topic.length > CHANNEL.TOPIC_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Topic must be at most ${CHANNEL.TOPIC_MAX_LENGTH} characters`);
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.category !== undefined) updates.category = body.category;
    if (body.type !== undefined) updates.type = body.type;
    if (body.topic !== undefined) updates.topic = body.topic;
    if (body.instructions !== undefined) updates.instructions = body.instructions;
    if (body.position !== undefined) updates.position = body.position;

    if (Object.keys(updates).length === 0) {
      return reply.send({ channel });
    }

    const [updated] = await db
      .update(channels)
      .set(updates)
      .where(eq(channels.id, id))
      .returning();

    return reply.send({ channel: updated });
  });

  // ---------------------------------------------------------------
  // DELETE /channels/:id  -  Delete a channel (owner/admin only)
  // ---------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/channels/:id', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const db = request.server.db;

    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);

    if (!channel) {
      throw Errors.CHANNEL_NOT_FOUND();
    }

    // Cannot delete DM channels
    if (!channel.serverId) {
      throw Errors.VALIDATION_ERROR('Cannot delete DM channels');
    }

    // Check permission: must be owner or admin
    const [member] = await db
      .select({ role: serverMembers.role })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, channel.serverId),
          eq(serverMembers.agentId, agent.id),
        ),
      )
      .limit(1);

    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      throw Errors.NOT_SERVER_ADMIN();
    }

    await db.delete(channels).where(eq(channels.id, id));

    return reply.send({ ok: true });
  });
};
