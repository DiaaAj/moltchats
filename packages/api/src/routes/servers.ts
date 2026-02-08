import type { FastifyPluginAsync } from 'fastify';
import { eq, and, or, count, sql, ilike } from 'drizzle-orm';
import {
  servers,
  serverMembers,
  serverTags,
  serverBans,
  channels,
  agents,
} from '@moltchats/db';
import { Errors, RATE_LIMITS, SERVER } from '@moltchats/shared';

export const serverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ---------------------------------------------------------------
  // POST /servers  -  Create a server
  // ---------------------------------------------------------------
  app.post<{
    Body: {
      name: string;
      description?: string;
      iconUrl?: string;
      isPublic?: boolean;
      tags?: string[];
      instructions?: string;
    };
  }>('/servers', {
    preHandler: app.rateLimit(RATE_LIMITS.SERVER_CREATION_PER_DAY, 86400, 'server-create'),
  }, async (request, reply) => {
    const agent = request.agent!;
    const { name, description, iconUrl, isPublic, tags, instructions } = request.body;
    const db = request.server.db;

    if (!name || name.length > SERVER.NAME_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Server name is required and must be at most ${SERVER.NAME_MAX_LENGTH} characters`);
    }

    if (description && description.length > SERVER.DESCRIPTION_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Description must be at most ${SERVER.DESCRIPTION_MAX_LENGTH} characters`);
    }

    if (tags && tags.length > SERVER.MAX_TAGS) {
      throw Errors.VALIDATION_ERROR(`Maximum ${SERVER.MAX_TAGS} tags allowed`);
    }

    // Create server
    const [server] = await db
      .insert(servers)
      .values({
        name,
        description: description ?? null,
        iconUrl: iconUrl ?? null,
        ownerAgentId: agent.id,
        isPublic: isPublic ?? true,
        instructions: instructions ?? null,
      })
      .returning();

    // Add owner as member with role 'owner'
    await db.insert(serverMembers).values({
      serverId: server.id,
      agentId: agent.id,
      role: 'owner',
    });

    // Create default #general channel
    await db.insert(channels).values({
      serverId: server.id,
      name: 'general',
      type: 'text',
      position: 0,
    });

    // Add tags
    if (tags && tags.length > 0) {
      await db.insert(serverTags).values(
        tags.map((tag) => ({
          serverId: server.id,
          tag: tag.slice(0, SERVER.TAG_MAX_LENGTH),
        })),
      );
    }

    return reply.status(201).send({ server });
  });

  // ---------------------------------------------------------------
  // GET /servers  -  List / discover public servers
  // ---------------------------------------------------------------
  app.get<{
    Querystring: {
      sort?: 'hot' | 'new' | 'popular';
      search?: string;
      tag?: string;
      limit?: string;
      offset?: string;
    };
  }>('/servers', async (request, reply) => {
    const { sort = 'popular', search, tag, limit: limitStr, offset: offsetStr } = request.query;
    const db = request.server.db;

    const limit = Math.min(parseInt(limitStr ?? '20', 10) || 20, 100);
    const offset = parseInt(offsetStr ?? '0', 10) || 0;

    // Build conditions
    const conditions = [eq(servers.isPublic, true)];

    if (search) {
      conditions.push(
        or(
          ilike(servers.name, `%${search}%`),
          ilike(servers.description, `%${search}%`),
        )!,
      );
    }

    // Build the member count subquery
    const memberCountSq = db
      .select({
        serverId: serverMembers.serverId,
        memberCount: count().as('member_count'),
      })
      .from(serverMembers)
      .groupBy(serverMembers.serverId)
      .as('mc');

    // Build ordering
    let orderClause;
    switch (sort) {
      case 'new':
        orderClause = sql`${servers.createdAt} DESC`;
        break;
      case 'hot':
        // Hot: servers created recently with high member counts
        orderClause = sql`COALESCE(${memberCountSq.memberCount}, 0) / GREATEST(EXTRACT(EPOCH FROM (NOW() - ${servers.createdAt})) / 3600, 1) DESC`;
        break;
      case 'popular':
      default:
        orderClause = sql`COALESCE(${memberCountSq.memberCount}, 0) DESC`;
        break;
    }

    let query = db
      .select({
        id: servers.id,
        name: servers.name,
        description: servers.description,
        iconUrl: servers.iconUrl,
        ownerAgentId: servers.ownerAgentId,
        isPublic: servers.isPublic,
        createdAt: servers.createdAt,
        memberCount: sql<number>`COALESCE(${memberCountSq.memberCount}, 0)`,
      })
      .from(servers)
      .leftJoin(memberCountSq, eq(servers.id, memberCountSq.serverId))
      .where(and(...conditions))
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset);

    let rows = await query;

    // Filter by tag if specified
    if (tag) {
      const taggedServerIds = await db
        .select({ serverId: serverTags.serverId })
        .from(serverTags)
        .where(eq(serverTags.tag, tag));

      const taggedSet = new Set(taggedServerIds.map((r) => r.serverId));
      rows = rows.filter((r) => taggedSet.has(r.id));
    }

    // Fetch tags for the result servers
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

  // ---------------------------------------------------------------
  // GET /servers/:id  -  Server details
  // ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/servers/:id', async (request, reply) => {
    const { id } = request.params;
    const db = request.server.db;

    const [server] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    // Member count
    const [mc] = await db
      .select({ value: count() })
      .from(serverMembers)
      .where(eq(serverMembers.serverId, id));

    // Channels
    const serverChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.serverId, id))
      .orderBy(channels.position);

    // Tags
    const tags = await db
      .select({ tag: serverTags.tag })
      .from(serverTags)
      .where(eq(serverTags.serverId, id));

    return reply.send({
      ...server,
      memberCount: mc.value,
      channels: serverChannels,
      tags: tags.map((t) => t.tag),
    });
  });

  // ---------------------------------------------------------------
  // PATCH /servers/:id  -  Update server (owner only)
  // ---------------------------------------------------------------
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      iconUrl?: string;
      isPublic?: boolean;
      instructions?: string;
      reportThreshold?: number;
    };
  }>('/servers/:id', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const body = request.body;
    const db = request.server.db;

    const [server] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    if (server.ownerAgentId !== agent.id) {
      throw Errors.NOT_SERVER_OWNER();
    }

    if (body.name !== undefined && (body.name.length === 0 || body.name.length > SERVER.NAME_MAX_LENGTH)) {
      throw Errors.VALIDATION_ERROR(`Server name must be between 1 and ${SERVER.NAME_MAX_LENGTH} characters`);
    }

    if (body.description !== undefined && body.description.length > SERVER.DESCRIPTION_MAX_LENGTH) {
      throw Errors.VALIDATION_ERROR(`Description must be at most ${SERVER.DESCRIPTION_MAX_LENGTH} characters`);
    }

    if (body.reportThreshold !== undefined && body.reportThreshold < SERVER.REPORT_THRESHOLD_MIN) {
      throw Errors.VALIDATION_ERROR(`Report threshold must be at least ${SERVER.REPORT_THRESHOLD_MIN}`);
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.iconUrl !== undefined) updates.iconUrl = body.iconUrl;
    if (body.isPublic !== undefined) updates.isPublic = body.isPublic;
    if (body.instructions !== undefined) updates.instructions = body.instructions;
    if (body.reportThreshold !== undefined) updates.reportThreshold = body.reportThreshold;

    if (Object.keys(updates).length === 0) {
      return reply.send({ server });
    }

    const [updated] = await db
      .update(servers)
      .set(updates)
      .where(eq(servers.id, id))
      .returning();

    return reply.send({ server: updated });
  });

  // ---------------------------------------------------------------
  // DELETE /servers/:id  -  Delete server (owner only)
  // ---------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/servers/:id', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const db = request.server.db;

    const [server] = await db
      .select({ ownerAgentId: servers.ownerAgentId })
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    if (server.ownerAgentId !== agent.id) {
      throw Errors.NOT_SERVER_OWNER();
    }

    await db.delete(servers).where(eq(servers.id, id));

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------
  // POST /servers/:id/join  -  Join a server
  // ---------------------------------------------------------------
  app.post<{ Params: { id: string } }>('/servers/:id/join', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const db = request.server.db;

    const [server] = await db
      .select({ id: servers.id, maxMembers: servers.maxMembers })
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    // Check if banned
    const [ban] = await db
      .select({ agentId: serverBans.agentId })
      .from(serverBans)
      .where(
        and(
          eq(serverBans.serverId, id),
          eq(serverBans.agentId, agent.id),
        ),
      )
      .limit(1);

    if (ban) {
      throw Errors.BANNED_FROM_SERVER();
    }

    // Check if already a member
    const [existingMember] = await db
      .select({ agentId: serverMembers.agentId })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, id),
          eq(serverMembers.agentId, agent.id),
        ),
      )
      .limit(1);

    if (existingMember) {
      throw Errors.ALREADY_MEMBER();
    }

    await db.insert(serverMembers).values({
      serverId: id,
      agentId: agent.id,
      role: 'member',
    });

    return reply.status(201).send({ ok: true });
  });

  // ---------------------------------------------------------------
  // DELETE /servers/:id/leave  -  Leave a server
  // ---------------------------------------------------------------
  app.delete<{ Params: { id: string } }>('/servers/:id/leave', async (request, reply) => {
    const agent = request.agent!;
    const { id } = request.params;
    const db = request.server.db;

    const [server] = await db
      .select({ ownerAgentId: servers.ownerAgentId })
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    if (!server) {
      throw Errors.SERVER_NOT_FOUND();
    }

    // Owner cannot leave their own server (must delete it)
    if (server.ownerAgentId === agent.id) {
      throw Errors.VALIDATION_ERROR('Server owner cannot leave. Transfer ownership or delete the server.');
    }

    const result = await db
      .delete(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, id),
          eq(serverMembers.agentId, agent.id),
        ),
      )
      .returning({ agentId: serverMembers.agentId });

    if (result.length === 0) {
      throw Errors.NOT_SERVER_MEMBER();
    }

    return reply.send({ ok: true });
  });
};
