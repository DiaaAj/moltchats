import type { FastifyPluginAsync } from 'fastify';
import { eq, and, count, sql } from 'drizzle-orm';
import {
  agents,
  agentTrustScores,
  agentVouches,
  trustFlags,
  trustChallenges,
  trustChallengeVotes,
} from '@moltchats/db';
import { Errors } from '@moltchats/shared';

export const trustRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------
  // GET /trust/@me  -  Own trust info (authenticated)
  // ---------------------------------------------------------------
  app.get('/trust/@me', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const agentId = request.agent!.id;
    const db = request.server.db;

    // Trust score
    const [score] = await db
      .select()
      .from(agentTrustScores)
      .where(eq(agentTrustScores.agentId, agentId))
      .limit(1);

    // Vouches given
    const vouchesGiven = await db
      .select({
        voucheeId: agentVouches.voucheeId,
        username: agents.username,
        weight: agentVouches.weight,
        createdAt: agentVouches.createdAt,
      })
      .from(agentVouches)
      .innerJoin(agents, eq(agents.id, agentVouches.voucheeId))
      .where(
        and(
          eq(agentVouches.voucherId, agentId),
          sql`${agentVouches.revokedAt} IS NULL`,
        ),
      );

    // Vouches received
    const vouchesReceived = await db
      .select({
        voucherId: agentVouches.voucherId,
        username: agents.username,
        weight: agentVouches.weight,
        createdAt: agentVouches.createdAt,
      })
      .from(agentVouches)
      .innerJoin(agents, eq(agents.id, agentVouches.voucherId))
      .where(
        and(
          eq(agentVouches.voucheeId, agentId),
          sql`${agentVouches.revokedAt} IS NULL`,
        ),
      );

    // Flags received
    const [flagCount] = await db
      .select({ total: count() })
      .from(trustFlags)
      .where(eq(trustFlags.flaggedId, agentId));

    // Challenge history
    const challenges = await db
      .select({
        id: trustChallenges.id,
        status: trustChallenges.status,
        triggeredBy: trustChallenges.triggeredBy,
        createdAt: trustChallenges.createdAt,
        completedAt: trustChallenges.completedAt,
      })
      .from(trustChallenges)
      .where(eq(trustChallenges.suspectId, agentId))
      .orderBy(sql`${trustChallenges.createdAt} DESC`)
      .limit(10);

    return reply.send({
      tier: score?.tier ?? 'untrusted',
      eigentrustScore: score?.eigentrustScore ?? 0,
      normalizedKarma: score?.normalizedKarma ?? 0,
      isSeed: score?.isSeed ?? false,
      computedAt: score?.computedAt ?? null,
      vouchesGiven,
      vouchesReceived,
      flagsReceived: flagCount?.total ?? 0,
      challenges,
    });
  });

  // ---------------------------------------------------------------
  // GET /trust/:username  -  Public trust info
  // ---------------------------------------------------------------
  app.get<{ Params: { username: string } }>('/trust/:username', async (request, reply) => {
    const { username } = request.params;
    const db = request.server.db;

    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.username, username.toLowerCase()))
      .limit(1);

    if (!agent) {
      throw Errors.AGENT_NOT_FOUND();
    }

    const [score] = await db
      .select({
        tier: agentTrustScores.tier,
        eigentrustScore: agentTrustScores.eigentrustScore,
        isSeed: agentTrustScores.isSeed,
        computedAt: agentTrustScores.computedAt,
      })
      .from(agentTrustScores)
      .where(eq(agentTrustScores.agentId, agent.id))
      .limit(1);

    // Count vouches received (public info)
    const [vouchCount] = await db
      .select({ total: count() })
      .from(agentVouches)
      .where(
        and(
          eq(agentVouches.voucheeId, agent.id),
          sql`${agentVouches.revokedAt} IS NULL`,
        ),
      );

    return reply.send({
      username,
      tier: score?.tier ?? 'untrusted',
      eigentrustScore: score?.eigentrustScore ?? 0,
      isSeed: score?.isSeed ?? false,
      vouchesReceived: vouchCount?.total ?? 0,
      computedAt: score?.computedAt ?? null,
    });
  });

  // ---------------------------------------------------------------
  // GET /trust/challenge/:id  -  Challenge details (participants only)
  // ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/trust/challenge/:id', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const { id: challengeId } = request.params;
    const agentId = request.agent!.id;
    const db = request.server.db;

    const [challenge] = await db
      .select()
      .from(trustChallenges)
      .where(eq(trustChallenges.id, challengeId))
      .limit(1);

    if (!challenge) {
      throw Errors.NOT_FOUND();
    }

    // Check if the requester is a participant (suspect or challenger/voter)
    const isSubject = challenge.suspectId === agentId;
    const [isVoter] = await db
      .select({ voterId: trustChallengeVotes.voterId })
      .from(trustChallengeVotes)
      .where(
        and(
          eq(trustChallengeVotes.challengeId, challengeId),
          eq(trustChallengeVotes.voterId, agentId),
        ),
      )
      .limit(1);

    if (!isSubject && !isVoter) {
      throw Errors.FORBIDDEN();
    }

    // Get votes
    const votes = await db
      .select({
        voterId: trustChallengeVotes.voterId,
        verdict: trustChallengeVotes.verdict,
        createdAt: trustChallengeVotes.createdAt,
      })
      .from(trustChallengeVotes)
      .where(eq(trustChallengeVotes.challengeId, challengeId));

    return reply.send({
      ...challenge,
      votes,
    });
  });
};
