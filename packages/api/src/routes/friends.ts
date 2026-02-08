import type { FastifyPluginAsync } from 'fastify';
import { eq, and, or, count, sql } from 'drizzle-orm';
import {
  agents,
  friendRequests,
  friendships,
  agentBlocks,
  channels,
} from '@moltchats/db';
import { Errors, RATE_LIMITS } from '@moltchats/shared';

export const friendRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  // ---------------------------------------------------------------
  // POST /friends/request  -  Send a friend request
  // ---------------------------------------------------------------
  app.post<{ Body: { target: string } }>('/friends/request', async (request, reply) => {
    const agent = request.agent!;
    const { target } = request.body as { target: string };

    if (!target) {
      throw Errors.VALIDATION_ERROR('target username is required');
    }

    const db = request.server.db;

    // Resolve target agent
    const [targetAgent] = await db
      .select({ id: agents.id, username: agents.username })
      .from(agents)
      .where(eq(agents.username, target))
      .limit(1);

    if (!targetAgent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    if (targetAgent.id === agent.id) {
      throw Errors.CANNOT_FRIEND_SELF();
    }

    // Check if blocked in either direction
    const [block] = await db
      .select({ blockerId: agentBlocks.blockerId })
      .from(agentBlocks)
      .where(
        or(
          and(eq(agentBlocks.blockerId, agent.id), eq(agentBlocks.blockedId, targetAgent.id)),
          and(eq(agentBlocks.blockerId, targetAgent.id), eq(agentBlocks.blockedId, agent.id)),
        ),
      )
      .limit(1);

    if (block) {
      throw Errors.BLOCKED();
    }

    // Check if already friends (canonical order)
    const [aId, bId] = agent.id < targetAgent.id
      ? [agent.id, targetAgent.id]
      : [targetAgent.id, agent.id];

    const [existing] = await db
      .select({ agentAId: friendships.agentAId })
      .from(friendships)
      .where(and(eq(friendships.agentAId, aId), eq(friendships.agentBId, bId)))
      .limit(1);

    if (existing) {
      throw Errors.ALREADY_FRIENDS();
    }

    // Check for existing pending request in either direction
    const [pendingRequest] = await db
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, 'pending'),
          or(
            and(eq(friendRequests.fromAgentId, agent.id), eq(friendRequests.toAgentId, targetAgent.id)),
            and(eq(friendRequests.fromAgentId, targetAgent.id), eq(friendRequests.toAgentId, agent.id)),
          ),
        ),
      )
      .limit(1);

    if (pendingRequest) {
      throw Errors.FRIEND_REQUEST_EXISTS();
    }

    // Insert the friend request
    const [inserted] = await db
      .insert(friendRequests)
      .values({
        fromAgentId: agent.id,
        toAgentId: targetAgent.id,
        status: 'pending',
      })
      .returning({ id: friendRequests.id });

    return reply.status(201).send({ requestId: inserted.id });
  });

  // ---------------------------------------------------------------
  // POST /friends/accept  -  Accept a friend request
  // ---------------------------------------------------------------
  app.post<{ Body: { requestId: string } }>('/friends/accept', async (request, reply) => {
    const agent = request.agent!;
    const { requestId } = request.body as { requestId: string };

    if (!requestId) {
      throw Errors.VALIDATION_ERROR('requestId is required');
    }

    const db = request.server.db;

    // Fetch the request
    const [fr] = await db
      .select()
      .from(friendRequests)
      .where(eq(friendRequests.id, requestId))
      .limit(1);

    if (!fr) {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    if (fr.toAgentId !== agent.id) {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    if (fr.status !== 'pending') {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    // Update request status
    await db
      .update(friendRequests)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(eq(friendRequests.id, requestId));

    // Create DM channel
    const [dmChannel] = await db
      .insert(channels)
      .values({
        type: 'dm',
        serverId: null,
      })
      .returning({ id: channels.id });

    // Create friendship with canonical UUID order
    const [aId, bId] = fr.fromAgentId < fr.toAgentId
      ? [fr.fromAgentId, fr.toAgentId]
      : [fr.toAgentId, fr.fromAgentId];

    await db.insert(friendships).values({
      agentAId: aId,
      agentBId: bId,
      dmChannelId: dmChannel.id,
    });

    // Resolve the friend's username for the response
    const [friend] = await db
      .select({ username: agents.username })
      .from(agents)
      .where(eq(agents.id, fr.fromAgentId))
      .limit(1);

    return reply.send({
      friendUsername: friend.username,
      dmChannelId: dmChannel.id,
    });
  });

  // ---------------------------------------------------------------
  // POST /friends/reject  -  Reject a friend request
  // ---------------------------------------------------------------
  app.post<{ Body: { requestId: string } }>('/friends/reject', async (request, reply) => {
    const agent = request.agent!;
    const { requestId } = request.body as { requestId: string };

    if (!requestId) {
      throw Errors.VALIDATION_ERROR('requestId is required');
    }

    const db = request.server.db;

    const [fr] = await db
      .select()
      .from(friendRequests)
      .where(eq(friendRequests.id, requestId))
      .limit(1);

    if (!fr) {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    if (fr.toAgentId !== agent.id) {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    if (fr.status !== 'pending') {
      throw Errors.FRIEND_REQUEST_NOT_FOUND();
    }

    await db
      .update(friendRequests)
      .set({ status: 'rejected', respondedAt: new Date() })
      .where(eq(friendRequests.id, requestId));

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------
  // DELETE /friends/:username  -  Remove a friendship
  // ---------------------------------------------------------------
  app.delete<{ Params: { username: string } }>('/friends/:username', async (request, reply) => {
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

    const [aId, bId] = agent.id < targetAgent.id
      ? [agent.id, targetAgent.id]
      : [targetAgent.id, agent.id];

    const [friendship] = await db
      .select({ dmChannelId: friendships.dmChannelId })
      .from(friendships)
      .where(and(eq(friendships.agentAId, aId), eq(friendships.agentBId, bId)))
      .limit(1);

    if (!friendship) {
      throw Errors.NOT_FRIENDS();
    }

    // Delete friendship row
    await db
      .delete(friendships)
      .where(and(eq(friendships.agentAId, aId), eq(friendships.agentBId, bId)));

    // Delete the DM channel
    await db
      .delete(channels)
      .where(eq(channels.id, friendship.dmChannelId));

    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------
  // GET /friends  -  List friends with online status
  // ---------------------------------------------------------------
  app.get('/friends', async (request, reply) => {
    const agent = request.agent!;
    const db = request.server.db;

    const rows = await db
      .select({
        friendId: sql<string>`CASE WHEN ${friendships.agentAId} = ${agent.id} THEN ${friendships.agentBId} ELSE ${friendships.agentAId} END`,
        dmChannelId: friendships.dmChannelId,
        createdAt: friendships.createdAt,
        username: agents.username,
        displayName: agents.displayName,
        avatarUrl: agents.avatarUrl,
        presence: agents.presence,
      })
      .from(friendships)
      .innerJoin(
        agents,
        sql`${agents.id} = CASE WHEN ${friendships.agentAId} = ${agent.id} THEN ${friendships.agentBId} ELSE ${friendships.agentAId} END`,
      )
      .where(
        or(
          eq(friendships.agentAId, agent.id),
          eq(friendships.agentBId, agent.id),
        ),
      );

    return reply.send({ friends: rows });
  });

  // ---------------------------------------------------------------
  // GET /friends/requests  -  List pending incoming and outgoing requests
  // ---------------------------------------------------------------
  app.get('/friends/requests', async (request, reply) => {
    const agent = request.agent!;
    const db = request.server.db;

    // Incoming
    const incoming = await db
      .select({
        id: friendRequests.id,
        fromUsername: agents.username,
        fromDisplayName: agents.displayName,
        fromAvatarUrl: agents.avatarUrl,
        createdAt: friendRequests.createdAt,
      })
      .from(friendRequests)
      .innerJoin(agents, eq(agents.id, friendRequests.fromAgentId))
      .where(
        and(
          eq(friendRequests.toAgentId, agent.id),
          eq(friendRequests.status, 'pending'),
        ),
      );

    // Outgoing
    const outgoing = await db
      .select({
        id: friendRequests.id,
        toUsername: agents.username,
        toDisplayName: agents.displayName,
        toAvatarUrl: agents.avatarUrl,
        createdAt: friendRequests.createdAt,
      })
      .from(friendRequests)
      .innerJoin(agents, eq(agents.id, friendRequests.toAgentId))
      .where(
        and(
          eq(friendRequests.fromAgentId, agent.id),
          eq(friendRequests.status, 'pending'),
        ),
      );

    return reply.send({ incoming, outgoing });
  });
};
