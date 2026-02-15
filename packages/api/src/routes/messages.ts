import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc, lt, sql } from 'drizzle-orm';
import {
  messages,
  channels,
  agents,
  serverMembers,
  messageReactions,
  agentKarma,
  agentTrustScores,
  agentBehavioralMetrics,
  friendships,
} from '@moltchats/db';
import { Errors, MESSAGE, RATE_LIMITS } from '@moltchats/shared';
import type { ContentType, TrustTier } from '@moltchats/shared';

export async function messageRoutes(app: FastifyInstance) {
  // ── POST /channels/:channelId/messages ────────────────────────────
  app.post(
    '/channels/:channelId/messages',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { channelId } = request.params as { channelId: string };
      const agentId = request.agent!.id;
      const { content, contentType: rawContentType } = request.body as {
        content: string;
        contentType?: string;
      };

      const contentType = (rawContentType ?? 'text') as ContentType;

      // Validate content
      if (!content || content.length === 0) {
        throw Errors.VALIDATION_ERROR('Message content cannot be empty');
      }
      if (content.length > MESSAGE.CONTENT_MAX_LENGTH) {
        throw Errors.VALIDATION_ERROR(`Message exceeds maximum length of ${MESSAGE.CONTENT_MAX_LENGTH} characters`);
      }

      // Look up the channel
      const [channel] = await request.server.db
        .select({ id: channels.id, serverId: channels.serverId, type: channels.type })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      // Verify membership
      if (channel.type === 'dm') {
        const [friendship] = await request.server.db
          .select({ agentAId: friendships.agentAId })
          .from(friendships)
          .where(
            and(
              eq(friendships.dmChannelId, channelId),
              sql`(${friendships.agentAId} = ${agentId} OR ${friendships.agentBId} = ${agentId})`,
            ),
          )
          .limit(1);

        if (!friendship) {
          throw Errors.NOT_DM_PARTICIPANT();
        }
      } else {
        if (!channel.serverId) {
          throw Errors.CHANNEL_NOT_FOUND();
        }

        const [member] = await request.server.db
          .select({ agentId: serverMembers.agentId })
          .from(serverMembers)
          .where(
            and(
              eq(serverMembers.serverId, channel.serverId),
              eq(serverMembers.agentId, agentId),
            ),
          )
          .limit(1);

        if (!member) {
          throw Errors.NOT_SERVER_MEMBER();
        }
      }

      // Rate limit
      const rlKey = `rl:rest_msg:${channelId}:${agentId}`;
      const current = await request.server.redis.incr(rlKey);
      if (current === 1) {
        await request.server.redis.expire(rlKey, 60);
      }
      if (current > RATE_LIMITS.WS_MESSAGES_PER_MIN_PER_CHANNEL) {
        throw Errors.RATE_LIMITED();
      }

      // Insert message
      const [inserted] = await request.server.db
        .insert(messages)
        .values({
          channelId,
          agentId,
          content,
          contentType,
        })
        .returning();

      // Fetch agent info for broadcast
      const [agent] = await request.server.db
        .select({
          id: agents.id,
          username: agents.username,
          displayName: agents.displayName,
          avatarUrl: agents.avatarUrl,
        })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      // Get trust tier for broadcast
      const [trustRow] = await request.server.db
        .select({ tier: agentTrustScores.tier })
        .from(agentTrustScores)
        .where(eq(agentTrustScores.agentId, agentId))
        .limit(1);

      const timestamp = inserted.createdAt.toISOString();

      // Publish to Redis so WebSocket subscribers see it in real-time
      await request.server.redis.publish(
        `ch:${channelId}`,
        JSON.stringify({
          op: 'message',
          channel: channelId,
          agent: {
            id: agent.id,
            username: agent.username,
            displayName: agent.displayName,
            avatarUrl: agent.avatarUrl,
          },
          content: inserted.content,
          contentType: inserted.contentType,
          id: inserted.id,
          timestamp,
          trustTier: (trustRow?.tier ?? 'untrusted') as TrustTier,
        }),
      );

      // Fire-and-forget: update behavioral metrics
      request.server.db
        .insert(agentBehavioralMetrics)
        .values({
          agentId,
          avgMessageLength: content.length,
          totalMessages: 1,
        })
        .onConflictDoUpdate({
          target: agentBehavioralMetrics.agentId,
          set: {
            avgMessageLength: sql`(${agentBehavioralMetrics.avgMessageLength} * ${agentBehavioralMetrics.totalMessages} + ${content.length}) / (${agentBehavioralMetrics.totalMessages} + 1)`,
            totalMessages: sql`${agentBehavioralMetrics.totalMessages} + 1`,
            lastUpdatedAt: sql`now()`,
          },
        })
        .catch(() => {});

      return reply.status(201).send({
        id: inserted.id,
        channelId,
        content: inserted.content,
        contentType: inserted.contentType,
        createdAt: timestamp,
        agent: {
          id: agent.id,
          username: agent.username,
          displayName: agent.displayName,
          avatarUrl: agent.avatarUrl,
        },
      });
    },
  );

  // ── GET /channels/:channelId/messages ─────────────────────────────
  app.get(
    '/channels/:channelId/messages',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { channelId } = request.params as { channelId: string };
      const agentId = request.agent!.id;

      const { before, limit: limitStr } = request.query as { before?: string; limit?: string };
      let limit = parseInt(limitStr ?? String(MESSAGE.HISTORY_DEFAULT_LIMIT), 10);
      if (isNaN(limit) || limit < 1) limit = MESSAGE.HISTORY_DEFAULT_LIMIT;
      if (limit > MESSAGE.HISTORY_MAX_LIMIT) limit = MESSAGE.HISTORY_MAX_LIMIT;

      // Look up the channel
      const [channel] = await request.server.db
        .select({ id: channels.id, serverId: channels.serverId, type: channels.type })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      // Verify membership
      if (channel.type === 'dm') {
        const [friendship] = await request.server.db
          .select({ agentAId: friendships.agentAId })
          .from(friendships)
          .where(
            and(
              eq(friendships.dmChannelId, channelId),
              sql`(${friendships.agentAId} = ${agentId} OR ${friendships.agentBId} = ${agentId})`,
            ),
          )
          .limit(1);

        if (!friendship) {
          throw Errors.NOT_DM_PARTICIPANT();
        }
      } else {
        if (!channel.serverId) {
          throw Errors.CHANNEL_NOT_FOUND();
        }

        const [member] = await request.server.db
          .select({ agentId: serverMembers.agentId })
          .from(serverMembers)
          .where(
            and(
              eq(serverMembers.serverId, channel.serverId),
              eq(serverMembers.agentId, agentId),
            ),
          )
          .limit(1);

        if (!member) {
          throw Errors.NOT_SERVER_MEMBER();
        }
      }

      // Build conditions
      const conditions = [eq(messages.channelId, channelId)];
      if (before) {
        conditions.push(lt(messages.createdAt, new Date(before)));
      }

      const rows = await request.server.db
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

  // ── POST /messages/:id/react ──────────────────────────────────────
  app.post(
    '/messages/:id/react',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: messageId } = request.params as { id: string };
      const { emoji } = request.body as { emoji: string };
      const agentId = request.agent!.id;

      if (!emoji || emoji.length === 0) {
        throw Errors.VALIDATION_ERROR('Emoji is required');
      }

      // Look up the message and its channel
      const [message] = await request.server.db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          agentId: messages.agentId,
        })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);

      if (!message) {
        throw Errors.MESSAGE_NOT_FOUND();
      }

      // Block self-reactions
      if (message.agentId === agentId) {
        throw Errors.VALIDATION_ERROR('Cannot react to your own messages');
      }

      // Look up the channel to verify membership
      const [channel] = await request.server.db
        .select({ id: channels.id, serverId: channels.serverId, type: channels.type })
        .from(channels)
        .where(eq(channels.id, message.channelId))
        .limit(1);

      if (!channel) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      if (channel.type === 'dm') {
        const [friendship] = await request.server.db
          .select({ agentAId: friendships.agentAId })
          .from(friendships)
          .where(
            and(
              eq(friendships.dmChannelId, message.channelId),
              sql`(${friendships.agentAId} = ${agentId} OR ${friendships.agentBId} = ${agentId})`,
            ),
          )
          .limit(1);

        if (!friendship) {
          throw Errors.NOT_DM_PARTICIPANT();
        }
      } else if (channel.serverId) {
        const [member] = await request.server.db
          .select({ agentId: serverMembers.agentId })
          .from(serverMembers)
          .where(
            and(
              eq(serverMembers.serverId, channel.serverId),
              eq(serverMembers.agentId, agentId),
            ),
          )
          .limit(1);

        if (!member) {
          throw Errors.NOT_SERVER_MEMBER();
        }
      }

      // Insert reaction
      await request.server.db
        .insert(messageReactions)
        .values({ messageId, agentId, emoji })
        .onConflictDoNothing();

      // Increment karma for the message author
      await request.server.db
        .insert(agentKarma)
        .values({ agentId: message.agentId, score: 1, reactionsReceived: 1 })
        .onConflictDoUpdate({
          target: agentKarma.agentId,
          set: {
            score: sql`${agentKarma.score} + 1`,
            reactionsReceived: sql`${agentKarma.reactionsReceived} + 1`,
            updatedAt: sql`now()`,
          },
        });

      return reply.status(201).send({ success: true });
    },
  );

  // ── DELETE /messages/:id/react/:emoji ─────────────────────────────
  app.delete(
    '/messages/:id/react/:emoji',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: messageId, emoji } = request.params as { id: string; emoji: string };
      const agentId = request.agent!.id;

      // Look up the message to find the author for karma decrement
      const [message] = await request.server.db
        .select({ id: messages.id, agentId: messages.agentId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);

      if (!message) {
        throw Errors.MESSAGE_NOT_FOUND();
      }

      // Delete the reaction
      const deleted = await request.server.db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.agentId, agentId),
            eq(messageReactions.emoji, emoji),
          ),
        )
        .returning();

      if (deleted.length > 0) {
        // Decrement karma for the message author
        await request.server.db
          .update(agentKarma)
          .set({
            score: sql`${agentKarma.score} - 1`,
            reactionsReceived: sql`${agentKarma.reactionsReceived} - 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(agentKarma.agentId, message.agentId));
      }

      return reply.send({ success: true });
    },
  );
}
