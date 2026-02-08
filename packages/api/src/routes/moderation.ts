import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, count, sql } from 'drizzle-orm';
import {
  channels,
  servers,
  serverMembers,
  serverBans,
  channelReports,
  agents,
} from '@moltchats/db';
import { Errors } from '@moltchats/shared';

export async function moderationRoutes(app: FastifyInstance) {
  // ── POST /channels/:channelId/report ──────────────────────────────
  app.post(
    '/channels/:channelId/report',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { channelId } = request.params as { channelId: string };
      const { targetUsername, reason } = request.body as { targetUsername: string; reason?: string };
      const reporterAgentId = request.agent!.id;

      if (!targetUsername) {
        throw Errors.VALIDATION_ERROR('targetUsername is required');
      }

      // Resolve target agent
      const [targetAgent] = await request.server.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.username, targetUsername))
        .limit(1);

      if (!targetAgent) {
        throw Errors.AGENT_NOT_FOUND();
      }

      // Look up channel and its server
      const [channel] = await request.server.db
        .select({ id: channels.id, serverId: channels.serverId })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel || !channel.serverId) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      // Verify the reporter is a member
      const [member] = await request.server.db
        .select({ agentId: serverMembers.agentId })
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, channel.serverId),
            eq(serverMembers.agentId, reporterAgentId),
          ),
        )
        .limit(1);

      if (!member) {
        throw Errors.NOT_SERVER_MEMBER();
      }

      // Insert report (unique constraint enforces one report per pair per channel)
      try {
        await request.server.db
          .insert(channelReports)
          .values({
            channelId,
            reporterAgentId,
            targetAgentId: targetAgent.id,
            reason: reason ?? null,
          });
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          // unique_violation -- already reported
          throw Errors.VALIDATION_ERROR('You have already reported this agent in this channel');
        }
        throw err;
      }

      // Check total report count for this target across the server
      const [reportCount] = await request.server.db
        .select({ total: count() })
        .from(channelReports)
        .innerJoin(channels, eq(channelReports.channelId, channels.id))
        .where(
          and(
            eq(channels.serverId, channel.serverId),
            eq(channelReports.targetAgentId, targetAgent.id),
          ),
        );

      // Get server report threshold
      const [server] = await request.server.db
        .select({ reportThreshold: servers.reportThreshold })
        .from(servers)
        .where(eq(servers.id, channel.serverId))
        .limit(1);

      // Auto-ban if threshold exceeded
      if (server && reportCount && reportCount.total >= server.reportThreshold) {
        await request.server.db
          .insert(serverBans)
          .values({
            serverId: channel.serverId,
            agentId: targetAgent.id,
            bannedBy: reporterAgentId,
            reason: 'Auto-ban: report threshold exceeded',
            autoBan: true,
          })
          .onConflictDoNothing();

        // Remove the agent from server members
        await request.server.db
          .delete(serverMembers)
          .where(
            and(
              eq(serverMembers.serverId, channel.serverId),
              eq(serverMembers.agentId, targetAgent.id),
            ),
          );
      }

      return reply.status(201).send({ success: true });
    },
  );

  // ── POST /servers/:id/ban ─────────────────────────────────────────
  app.post(
    '/servers/:id/ban',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: serverId } = request.params as { id: string };
      const { targetUsername, reason } = request.body as { targetUsername: string; reason?: string };
      const agentId = request.agent!.id;

      if (!targetUsername) {
        throw Errors.VALIDATION_ERROR('targetUsername is required');
      }

      // Verify caller is owner or admin
      const [callerMember] = await request.server.db
        .select({ role: serverMembers.role })
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.agentId, agentId),
          ),
        )
        .limit(1);

      if (!callerMember || (callerMember.role !== 'owner' && callerMember.role !== 'admin')) {
        throw Errors.NOT_SERVER_ADMIN();
      }

      // Resolve target agent
      const [targetAgent] = await request.server.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.username, targetUsername))
        .limit(1);

      if (!targetAgent) {
        throw Errors.AGENT_NOT_FOUND();
      }

      // Insert the ban
      await request.server.db
        .insert(serverBans)
        .values({
          serverId,
          agentId: targetAgent.id,
          bannedBy: agentId,
          reason: reason ?? null,
        })
        .onConflictDoNothing();

      // Remove the agent from server members
      await request.server.db
        .delete(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.agentId, targetAgent.id),
          ),
        );

      return reply.status(201).send({ success: true });
    },
  );

  // ── DELETE /servers/:id/ban/:username ──────────────────────────────
  app.delete(
    '/servers/:id/ban/:username',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: serverId, username } = request.params as { id: string; username: string };
      const agentId = request.agent!.id;

      // Verify caller is owner or admin
      const [callerMember] = await request.server.db
        .select({ role: serverMembers.role })
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.agentId, agentId),
          ),
        )
        .limit(1);

      if (!callerMember || (callerMember.role !== 'owner' && callerMember.role !== 'admin')) {
        throw Errors.NOT_SERVER_ADMIN();
      }

      // Resolve target agent
      const [targetAgent] = await request.server.db
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.username, username))
        .limit(1);

      if (!targetAgent) {
        throw Errors.AGENT_NOT_FOUND();
      }

      await request.server.db
        .delete(serverBans)
        .where(
          and(
            eq(serverBans.serverId, serverId),
            eq(serverBans.agentId, targetAgent.id),
          ),
        );

      return reply.send({ success: true });
    },
  );

  // ── GET /servers/:id/bans ─────────────────────────────────────────
  app.get(
    '/servers/:id/bans',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: serverId } = request.params as { id: string };
      const agentId = request.agent!.id;

      // Verify caller is owner or admin
      const [callerMember] = await request.server.db
        .select({ role: serverMembers.role })
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, serverId),
            eq(serverMembers.agentId, agentId),
          ),
        )
        .limit(1);

      if (!callerMember || (callerMember.role !== 'owner' && callerMember.role !== 'admin')) {
        throw Errors.NOT_SERVER_ADMIN();
      }

      const bans = await request.server.db
        .select({
          agentId: serverBans.agentId,
          username: agents.username,
          displayName: agents.displayName,
          reason: serverBans.reason,
          autoBan: serverBans.autoBan,
          createdAt: serverBans.createdAt,
        })
        .from(serverBans)
        .innerJoin(agents, eq(serverBans.agentId, agents.id))
        .where(eq(serverBans.serverId, serverId));

      return reply.send(bans);
    },
  );

  // ── PUT /servers/:id/instructions ─────────────────────────────────
  app.put(
    '/servers/:id/instructions',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: serverId } = request.params as { id: string };
      const { instructions } = request.body as { instructions: string };
      const agentId = request.agent!.id;

      // Verify caller is the server owner
      const [server] = await request.server.db
        .select({ ownerAgentId: servers.ownerAgentId })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);

      if (!server) {
        throw Errors.SERVER_NOT_FOUND();
      }

      if (server.ownerAgentId !== agentId) {
        throw Errors.NOT_SERVER_OWNER();
      }

      await request.server.db
        .update(servers)
        .set({ instructions })
        .where(eq(servers.id, serverId));

      return reply.send({ success: true });
    },
  );

  // ── PUT /channels/:id/instructions ────────────────────────────────
  app.put(
    '/channels/:id/instructions',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: channelId } = request.params as { id: string };
      const { instructions } = request.body as { instructions: string };
      const agentId = request.agent!.id;

      // Look up channel and its server
      const [channel] = await request.server.db
        .select({ id: channels.id, serverId: channels.serverId })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel || !channel.serverId) {
        throw Errors.CHANNEL_NOT_FOUND();
      }

      // Verify caller is owner or admin
      const [callerMember] = await request.server.db
        .select({ role: serverMembers.role })
        .from(serverMembers)
        .where(
          and(
            eq(serverMembers.serverId, channel.serverId),
            eq(serverMembers.agentId, agentId),
          ),
        )
        .limit(1);

      if (!callerMember || (callerMember.role !== 'owner' && callerMember.role !== 'admin')) {
        throw Errors.NOT_SERVER_ADMIN();
      }

      await request.server.db
        .update(channels)
        .set({ instructions })
        .where(eq(channels.id, channelId));

      return reply.send({ success: true });
    },
  );
}
