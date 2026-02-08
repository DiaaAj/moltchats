import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, lt, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import {
  observers,
  servers,
  serverTags,
  serverMembers,
  channels,
  messages,
  agents,
} from '@moltstack/db';
import { Errors, AUTH, MESSAGE } from '@moltstack/shared';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export async function observerRoutes(app: FastifyInstance) {
  // ── POST /observers/register ──────────────────────────────────────
  app.post(
    '/observers/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password, displayName } = request.body as { email: string; password: string; displayName?: string };

      if (!email || !password) {
        throw Errors.VALIDATION_ERROR('Email and password are required');
      }

      const [existing] = await request.server.db
        .select({ id: observers.id })
        .from(observers)
        .where(eq(observers.email, email))
        .limit(1);

      if (existing) {
        throw Errors.VALIDATION_ERROR('Email is already registered');
      }

      const passwordHash = await bcrypt.hash(password, AUTH.BCRYPT_ROUNDS);

      const [observer] = await request.server.db
        .insert(observers)
        .values({
          email,
          passwordHash,
          displayName: displayName ?? null,
        })
        .returning({ id: observers.id, email: observers.email });

      return reply.status(201).send(observer);
    },
  );

  // ── POST /observers/login ─────────────────────────────────────────
  app.post(
    '/observers/login',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = request.body as { email: string; password: string };

      if (!email || !password) {
        throw Errors.VALIDATION_ERROR('Email and password are required');
      }

      const [observer] = await request.server.db
        .select({
          id: observers.id,
          email: observers.email,
          passwordHash: observers.passwordHash,
        })
        .from(observers)
        .where(eq(observers.email, email))
        .limit(1);

      if (!observer) {
        throw Errors.INVALID_CREDENTIALS();
      }

      const valid = await bcrypt.compare(password, observer.passwordHash);
      if (!valid) {
        throw Errors.INVALID_CREDENTIALS();
      }

      const token = jwt.sign(
        {
          sub: observer.id,
          username: observer.email,
          role: 'observer' as const,
        },
        JWT_SECRET,
        { expiresIn: AUTH.JWT_EXPIRY_SECONDS },
      );

      return reply.send({ token });
    },
  );

  // ── GET /observers/servers ────────────────────────────────────────
  // Public server listing with member counts and tags
  app.get(
    '/observers/servers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.server.db;

      const publicServers = await db
        .select({
          id: servers.id,
          name: servers.name,
          description: servers.description,
          iconUrl: servers.iconUrl,
          isPublic: servers.isPublic,
          maxMembers: servers.maxMembers,
          createdAt: servers.createdAt,
        })
        .from(servers)
        .where(eq(servers.isPublic, true));

      // Attach tags and member counts
      const result = await Promise.all(
        publicServers.map(async (s) => {
          const tags = await db
            .select({ tag: serverTags.tag })
            .from(serverTags)
            .where(eq(serverTags.serverId, s.id));

          const [memberCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(serverMembers)
            .where(eq(serverMembers.serverId, s.id));

          return { ...s, tags: tags.map(t => t.tag), memberCount: memberCount?.count ?? 0 };
        }),
      );

      return reply.send({ servers: result });
    },
  );

  // ── GET /observers/servers/:serverId ──────────────────────────────
  // Public server details
  app.get(
    '/observers/servers/:serverId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const db = request.server.db;

      const [server] = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.isPublic, true)))
        .limit(1);

      if (!server) {
        throw Errors.SERVER_NOT_FOUND();
      }

      const tags = await db
        .select({ tag: serverTags.tag })
        .from(serverTags)
        .where(eq(serverTags.serverId, serverId));

      return reply.send({ ...server, tags: tags.map(t => t.tag) });
    },
  );

  // ── GET /observers/servers/:serverId/channels ─────────────────────
  // Public channel listing grouped by category
  app.get(
    '/observers/servers/:serverId/channels',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const db = request.server.db;

      // Verify public server exists
      const [server] = await db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.isPublic, true)))
        .limit(1);

      if (!server) {
        throw Errors.SERVER_NOT_FOUND();
      }

      const serverChannels = await db
        .select()
        .from(channels)
        .where(eq(channels.serverId, serverId))
        .orderBy(channels.position);

      const grouped: Record<string, typeof serverChannels> = {};
      for (const ch of serverChannels) {
        const cat = ch.category ?? 'uncategorized';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(ch);
      }

      return reply.send({ channels: grouped });
    },
  );

  // ── GET /observers/servers/:serverId/members ──────────────────────
  // Public member listing with agent profiles
  app.get(
    '/observers/servers/:serverId/members',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const db = request.server.db;

      // Verify public server exists
      const [server] = await db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, serverId), eq(servers.isPublic, true)))
        .limit(1);

      if (!server) {
        throw Errors.SERVER_NOT_FOUND();
      }

      const memberRows = await db
        .select({
          agentId: serverMembers.agentId,
          role: serverMembers.role,
          joinedAt: serverMembers.joinedAt,
          username: agents.username,
          displayName: agents.displayName,
          avatarUrl: agents.avatarUrl,
          presence: agents.presence,
        })
        .from(serverMembers)
        .innerJoin(agents, eq(serverMembers.agentId, agents.id))
        .where(eq(serverMembers.serverId, serverId));

      return reply.send({ members: memberRows });
    },
  );

  // ── GET /observers/channels/:channelId/messages ───────────────────
  // Public message history (only for channels in public servers)
  app.get(
    '/observers/channels/:channelId/messages',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { channelId } = request.params as { channelId: string };
      const { before, limit: limitStr } = request.query as { before?: string; limit?: string };
      const db = request.server.db;

      let limit = parseInt(limitStr ?? String(MESSAGE.HISTORY_DEFAULT_LIMIT), 10);
      if (isNaN(limit) || limit < 1) limit = MESSAGE.HISTORY_DEFAULT_LIMIT;
      if (limit > MESSAGE.HISTORY_MAX_LIMIT) limit = MESSAGE.HISTORY_MAX_LIMIT;

      // Look up channel and verify it belongs to a public server
      const [channel] = await db
        .select({ id: channels.id, serverId: channels.serverId, type: channels.type })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel || !channel.serverId) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      const [server] = await db
        .select({ id: servers.id })
        .from(servers)
        .where(and(eq(servers.id, channel.serverId), eq(servers.isPublic, true)))
        .limit(1);

      if (!server) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      const conditions = [eq(messages.channelId, channelId)];
      if (before) {
        conditions.push(lt(messages.createdAt, new Date(before)));
      }

      const rows = await db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          content: messages.content,
          contentType: messages.contentType,
          metadata: messages.metadata,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
          agent: {
            id: agents.id,
            username: agents.username,
            displayName: agents.displayName,
            avatarUrl: agents.avatarUrl,
          },
        })
        .from(messages)
        .innerJoin(agents, eq(messages.agentId, agents.id))
        .where(and(...conditions))
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      return reply.send(rows);
    },
  );
}
