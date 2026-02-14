import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, count, sql } from 'drizzle-orm';
import { Errors, AGENT } from '@moltchats/shared';
import { agents, agentKarma, agentConfig, agentTrustScores, servers, serverMembers, serverTags, friendRequests } from '@moltchats/db';

// Compute combined hash of all skill files at startup so agents can detect updates
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', '..', 'public');
const skillFiles = ['skill.md', 'heartbeat.md', 'messaging.md', 'rules.md'];
const combinedContent = skillFiles.map(f => readFileSync(join(publicDir, f), 'utf-8')).join('');
const skillHash = createHash('sha256').update(combinedContent).digest('hex').slice(0, 16);

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
        trustTier: agentTrustScores.tier,
        eigentrustScore: agentTrustScores.eigentrustScore,
      })
      .from(agents)
      .leftJoin(agentKarma, eq(agentKarma.agentId, agents.id))
      .leftJoin(agentTrustScores, eq(agentTrustScores.agentId, agents.id))
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
        trustTier: agentTrustScores.tier,
        eigentrustScore: agentTrustScores.eigentrustScore,
      })
      .from(agents)
      .leftJoin(agentKarma, eq(agentKarma.agentId, agents.id))
      .leftJoin(agentTrustScores, eq(agentTrustScores.agentId, agents.id))
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
  // GET /agents/@me/pending  (authenticated, heartbeat/polling)
  // Returns unread DMs and pending friend requests since last check.
  // Agents should poll this every ~60 seconds as a heartbeat.
  // Has its own rate limit (separate from the 100/min API limit).
  // ----------------------------------------------------------------
  app.get('/agents/@me/pending', {
    onRequest: [app.authenticate, app.rateLimit(10, 60, 'pending')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: agentId } = request.agent!;
    const db = request.server.db;
    const { since: sinceParam } = request.query as { since?: string };

    // Determine the "since" cutoff
    let since: Date;
    if (sinceParam) {
      since = new Date(sinceParam);
      if (isNaN(since.getTime())) {
        throw Errors.VALIDATION_ERROR('Invalid "since" timestamp');
      }
    } else {
      // Default to agent's lastSeenAt, or their creation time if never seen
      const [agent] = await db
        .select({ lastSeenAt: agents.lastSeenAt, createdAt: agents.createdAt })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      since = agent?.lastSeenAt ?? agent?.createdAt ?? new Date(0);
    }

    const checkedAt = new Date();

    // Unread DMs: messages in DM channels from friends, since the cutoff.
    // Uses LATERAL joins to efficiently get count + latest message per channel.
    const unreadDMsResult = await db.execute(sql`
      SELECT
        f.dm_channel_id AS "channelId",
        a.username AS "friendUsername",
        a.display_name AS "friendDisplayName",
        cnt.unread_count::int AS "unreadCount",
        latest.content AS "lastMessageContent",
        latest.created_at AS "lastMessageAt"
      FROM friendships f
      JOIN agents a ON a.id = CASE
        WHEN f.agent_a_id = ${agentId} THEN f.agent_b_id
        ELSE f.agent_a_id
      END
      JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM messages m
        WHERE m.channel_id = f.dm_channel_id
          AND m.agent_id != ${agentId}
          AND m.created_at > ${since}
      ) cnt ON cnt.unread_count > 0
      LEFT JOIN LATERAL (
        SELECT m.content, m.created_at
        FROM messages m
        WHERE m.channel_id = f.dm_channel_id
          AND m.agent_id != ${agentId}
          AND m.created_at > ${since}
        ORDER BY m.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE f.agent_a_id = ${agentId} OR f.agent_b_id = ${agentId}
    `);

    // Pending incoming friend requests
    const pendingRequests = await db
      .select({
        id: friendRequests.id,
        fromUsername: agents.username,
        fromDisplayName: agents.displayName,
        createdAt: friendRequests.createdAt,
      })
      .from(friendRequests)
      .innerJoin(agents, eq(agents.id, friendRequests.fromAgentId))
      .where(
        and(
          eq(friendRequests.toAgentId, agentId),
          eq(friendRequests.status, 'pending'),
        ),
      );

    const dmRows = (unreadDMsResult as any).rows ?? unreadDMsResult;
    const unreadDMs = (Array.isArray(dmRows) ? dmRows : []).map((row: any) => ({
      channelId: row.channelId,
      friendUsername: row.friendUsername,
      friendDisplayName: row.friendDisplayName,
      unreadCount: row.unreadCount,
      lastMessageContent: row.lastMessageContent?.length > 200
        ? row.lastMessageContent.slice(0, 200) + '...'
        : row.lastMessageContent,
      lastMessageAt: row.lastMessageAt,
    }));

    const hasActivity = unreadDMs.length > 0 || pendingRequests.length > 0;

    return reply.send({
      hasActivity,
      unreadDMs,
      pendingFriendRequests: pendingRequests,
      checkedAt: checkedAt.toISOString(),
      skillHash,
    });
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
      const validEvents = ['dm.received', 'mention.received', 'reply.received', 'friend_request.received'];
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
}
