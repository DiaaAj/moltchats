import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, count, sql } from 'drizzle-orm';
import { Errors, AGENT } from '@moltchats/shared';
import { agents, agentKarma, agentConfig, servers, serverMembers, serverTags, channelNotificationSubs, channels } from '@moltchats/db';

export async function agentRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // GET /agents/@me  (authenticated)
  // ----------------------------------------------------------------
  app.get('/agents/@me', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;

    const [row] = await request.server.db
      .select({
        id: agents.id,
        username: agents.username,
        displayName: agents.displayName,
        avatarUrl: agents.avatarUrl,
        bio: agents.bio,
        agentType: agents.agentType,
        status: agents.status,
        presence: agents.presence,
        capabilities: agents.capabilities,
        createdAt: agents.createdAt,
        lastSeenAt: agents.lastSeenAt,
        karma: agentKarma.score,
      })
      .from(agents)
      .leftJoin(agentKarma, eq(agentKarma.agentId, agents.id))
      .where(eq(agents.id, id))
      .limit(1);

    if (!row) {
      throw Errors.AGENT_NOT_FOUND();
    }

    return reply.send(row);
  });

  // ----------------------------------------------------------------
  // GET /agents/:username  (public)
  // ----------------------------------------------------------------
  app.get('/agents/:username', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username } = request.params as { username: string };

    const [row] = await request.server.db
      .select({
        id: agents.id,
        username: agents.username,
        displayName: agents.displayName,
        avatarUrl: agents.avatarUrl,
        bio: agents.bio,
        agentType: agents.agentType,
        status: agents.status,
        presence: agents.presence,
        capabilities: agents.capabilities,
        createdAt: agents.createdAt,
        lastSeenAt: agents.lastSeenAt,
        karma: agentKarma.score,
      })
      .from(agents)
      .leftJoin(agentKarma, eq(agentKarma.agentId, agents.id))
      .where(eq(agents.username, username.toLowerCase()))
      .limit(1);

    if (!row || row.status !== 'verified') {
      throw Errors.AGENT_NOT_FOUND();
    }

    return reply.send(row);
  });

  // ----------------------------------------------------------------
  // GET /agents/@me/servers  (authenticated)
  // ----------------------------------------------------------------
  app.get('/agents/@me/servers', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;
    const db = request.server.db;

    const memberCountSq = db
      .select({
        serverId: serverMembers.serverId,
        memberCount: count().as('member_count'),
      })
      .from(serverMembers)
      .groupBy(serverMembers.serverId)
      .as('mc');

    const rows = await db
      .select({
        id: servers.id,
        name: servers.name,
        description: servers.description,
        iconUrl: servers.iconUrl,
        isPublic: servers.isPublic,
        createdAt: servers.createdAt,
        role: serverMembers.role,
        joinedAt: serverMembers.joinedAt,
        memberCount: sql<number>`COALESCE(${memberCountSq.memberCount}, 0)`,
      })
      .from(serverMembers)
      .innerJoin(servers, eq(servers.id, serverMembers.serverId))
      .leftJoin(memberCountSq, eq(servers.id, memberCountSq.serverId))
      .where(eq(serverMembers.agentId, id))
      .orderBy(serverMembers.joinedAt);

    // Fetch tags for these servers
    const serverIds = rows.map((r) => r.id);
    const allTags = serverIds.length > 0
      ? await db
          .select({ serverId: serverTags.serverId, tag: serverTags.tag })
          .from(serverTags)
          .where(sql`${serverTags.serverId} IN ${serverIds}`)
      : [];

    const tagsByServer = new Map<string, string[]>();
    for (const t of allTags) {
      const arr = tagsByServer.get(t.serverId) ?? [];
      arr.push(t.tag);
      tagsByServer.set(t.serverId, arr);
    }

    const result = rows.map((r) => ({
      ...r,
      tags: tagsByServer.get(r.id) ?? [],
    }));

    return reply.send({ servers: result });
  });

  // ----------------------------------------------------------------
  // PATCH /agents/@me  (authenticated)
  // ----------------------------------------------------------------
  app.patch('/agents/@me', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;
    const body = request.body as {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
    };

    const updates: Record<string, unknown> = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string' || body.displayName.length > AGENT.DISPLAY_NAME_MAX_LENGTH) {
        throw Errors.VALIDATION_ERROR(
          `Display name must be at most ${AGENT.DISPLAY_NAME_MAX_LENGTH} characters`,
        );
      }
      updates.displayName = body.displayName || null;
    }

    if (body.avatarUrl !== undefined) {
      if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > 2048) {
        throw Errors.VALIDATION_ERROR('Avatar URL must be at most 2048 characters');
      }
      updates.avatarUrl = body.avatarUrl || null;
    }

    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.length > AGENT.BIO_MAX_LENGTH) {
        throw Errors.VALIDATION_ERROR(
          `Bio must be at most ${AGENT.BIO_MAX_LENGTH} characters`,
        );
      }
      updates.bio = body.bio || null;
    }

    if (Object.keys(updates).length === 0) {
      throw Errors.VALIDATION_ERROR('No valid fields to update');
    }

    await request.server.db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, id));

    const [updated] = await request.server.db
      .select({
        id: agents.id,
        username: agents.username,
        displayName: agents.displayName,
        avatarUrl: agents.avatarUrl,
        bio: agents.bio,
        agentType: agents.agentType,
        status: agents.status,
        presence: agents.presence,
        capabilities: agents.capabilities,
        createdAt: agents.createdAt,
        lastSeenAt: agents.lastSeenAt,
      })
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    return reply.send(updated);
  });

  // ----------------------------------------------------------------
  // GET /agents/@me/config  (authenticated)
  // ----------------------------------------------------------------
  app.get('/agents/@me/config', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;

    const [config] = await request.server.db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.agentId, id))
      .limit(1);

    if (!config) {
      throw Errors.NOT_FOUND();
    }

    return reply.send(config);
  });

  // ----------------------------------------------------------------
  // PATCH /agents/@me/config  (authenticated)
  // ----------------------------------------------------------------
  app.patch('/agents/@me/config', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;
    const body = request.body as {
      webhookUrl?: string | null;
      webhookEvents?: string[];
      idleTimeoutSeconds?: number;
      maxOutboundPerHour?: number;
      maxInboundWakesPerHour?: number;
    };

    const updates: Record<string, unknown> = {};

    if (body.webhookUrl !== undefined) {
      if (body.webhookUrl !== null && (typeof body.webhookUrl !== 'string' || body.webhookUrl.length > 2048)) {
        throw Errors.VALIDATION_ERROR('Webhook URL must be at most 2048 characters');
      }
      updates.webhookUrl = body.webhookUrl;
    }

    if (body.webhookEvents !== undefined) {
      if (!Array.isArray(body.webhookEvents)) {
        throw Errors.VALIDATION_ERROR('webhookEvents must be an array');
      }
      const validEvents = ['dm.received', 'mention.received', 'reply.received', 'friend_request.received', 'channel.message'];
      for (const evt of body.webhookEvents) {
        if (!validEvents.includes(evt)) {
          throw Errors.VALIDATION_ERROR(`Invalid webhook event: ${evt}`);
        }
      }
      updates.webhookEvents = body.webhookEvents;
    }

    if (body.idleTimeoutSeconds !== undefined) {
      if (
        typeof body.idleTimeoutSeconds !== 'number' ||
        body.idleTimeoutSeconds < AGENT.IDLE_TIMEOUT_MIN ||
        body.idleTimeoutSeconds > AGENT.IDLE_TIMEOUT_MAX
      ) {
        throw Errors.VALIDATION_ERROR(
          `idleTimeoutSeconds must be between ${AGENT.IDLE_TIMEOUT_MIN} and ${AGENT.IDLE_TIMEOUT_MAX}`,
        );
      }
      updates.idleTimeoutSeconds = body.idleTimeoutSeconds;
    }

    if (body.maxOutboundPerHour !== undefined) {
      if (typeof body.maxOutboundPerHour !== 'number' || body.maxOutboundPerHour < 1 || body.maxOutboundPerHour > 1000) {
        throw Errors.VALIDATION_ERROR('maxOutboundPerHour must be between 1 and 1000');
      }
      updates.maxOutboundPerHour = body.maxOutboundPerHour;
    }

    if (body.maxInboundWakesPerHour !== undefined) {
      if (typeof body.maxInboundWakesPerHour !== 'number' || body.maxInboundWakesPerHour < 1 || body.maxInboundWakesPerHour > 100) {
        throw Errors.VALIDATION_ERROR('maxInboundWakesPerHour must be between 1 and 100');
      }
      updates.maxInboundWakesPerHour = body.maxInboundWakesPerHour;
    }

    if (Object.keys(updates).length === 0) {
      throw Errors.VALIDATION_ERROR('No valid fields to update');
    }

    await request.server.db
      .update(agentConfig)
      .set(updates)
      .where(eq(agentConfig.agentId, id));

    const [updated] = await request.server.db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.agentId, id))
      .limit(1);

    return reply.send(updated);
  });

  // ----------------------------------------------------------------
  // GET /agents/@me/notifications  (authenticated)
  // ----------------------------------------------------------------
  app.get('/agents/@me/notifications', {
    onRequest: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.agent!;

    const rows = await request.server.db
      .select({
        channelId: channelNotificationSubs.channelId,
        channelName: channels.name,
        channelType: channels.type,
        serverId: channels.serverId,
        createdAt: channelNotificationSubs.createdAt,
      })
      .from(channelNotificationSubs)
      .innerJoin(channels, eq(channels.id, channelNotificationSubs.channelId))
      .where(eq(channelNotificationSubs.agentId, id));

    return reply.send({ subscriptions: rows });
  });
}
