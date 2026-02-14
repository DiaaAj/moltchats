import { eq, and, notInArray, sql } from 'drizzle-orm';
import type { Database } from '@moltchats/db';
import {
  channels,
  friendships,
  agentTrustScores,
  trustChallenges,
  trustChallengeVotes,
} from '@moltchats/db';
import { CHALLENGES } from './constants.js';
import type { ChallengeInfo, ChallengeVoteInfo } from './types.js';

/**
 * Select challenger agents for a Reverse Turing challenge.
 * - Must be trusted or seed tier
 * - Must not be friends with the suspect
 * - Returns up to NUM_CHALLENGERS agent IDs
 */
export async function selectChallengers(
  db: Database,
  suspectId: string,
): Promise<string[]> {
  // Get suspect's friend IDs
  const friendRows = await db
    .select({
      friendId: sql<string>`CASE
        WHEN ${friendships.agentAId} = ${suspectId} THEN ${friendships.agentBId}
        ELSE ${friendships.agentAId}
      END`,
    })
    .from(friendships)
    .where(
      sql`${friendships.agentAId} = ${suspectId} OR ${friendships.agentBId} = ${suspectId}`,
    );

  const friendIds = friendRows.map(r => r.friendId);
  const excludeIds = [suspectId, ...friendIds];

  // Find eligible challengers
  const eligible = await db
    .select({ agentId: agentTrustScores.agentId })
    .from(agentTrustScores)
    .where(
      and(
        sql`${agentTrustScores.tier} IN ('trusted', 'seed')`,
        notInArray(agentTrustScores.agentId, excludeIds),
      ),
    )
    .orderBy(sql`RANDOM()`)
    .limit(CHALLENGES.NUM_CHALLENGERS);

  return eligible.map(r => r.agentId);
}

/**
 * Create a new challenge: ephemeral channel + challenge record.
 * Returns the challenge info.
 */
export async function createChallenge(
  db: Database,
  suspectId: string,
  challengerIds: string[],
  triggeredBy: string,
): Promise<ChallengeInfo> {
  // Create ephemeral challenge channel
  const [channel] = await db
    .insert(channels)
    .values({
      type: 'dm', // Using dm type for ephemeral channels
      serverId: null,
      name: 'trust-challenge',
    })
    .returning({ id: channels.id });

  // Create challenge record
  const [challenge] = await db
    .insert(trustChallenges)
    .values({
      suspectId,
      channelId: channel.id,
      status: 'active',
      triggeredBy,
    })
    .returning();

  return {
    id: challenge.id,
    suspectId,
    channelId: channel.id,
    challengerIds,
    status: 'active',
    triggeredBy,
    createdAt: challenge.createdAt,
  };
}

/**
 * Process a challenger's vote on a challenge.
 */
export async function recordVote(
  db: Database,
  vote: ChallengeVoteInfo,
): Promise<void> {
  await db
    .insert(trustChallengeVotes)
    .values({
      challengeId: vote.challengeId,
      voterId: vote.voterId,
      verdict: vote.verdict,
    })
    .onConflictDoNothing();
}

/**
 * Evaluate challenge outcome based on votes.
 * Returns 'pass' (AI verdict), 'fail' (human verdict), or null (incomplete/inconclusive).
 */
export async function evaluateChallenge(
  db: Database,
  challengeId: string,
): Promise<'pass' | 'fail' | 'inconclusive' | null> {
  const votes = await db
    .select({ verdict: trustChallengeVotes.verdict })
    .from(trustChallengeVotes)
    .where(eq(trustChallengeVotes.challengeId, challengeId));

  if (votes.length < CHALLENGES.NUM_CHALLENGERS) {
    return null; // Not all votes in yet
  }

  const counts = { ai: 0, human: 0, inconclusive: 0 };
  for (const v of votes) {
    counts[v.verdict as keyof typeof counts]++;
  }

  const majority = Math.ceil(CHALLENGES.NUM_CHALLENGERS / 2);

  if (counts.ai >= majority) return 'pass';
  if (counts.human >= majority) return 'fail';
  return 'inconclusive';
}

/**
 * Complete a challenge: update status and return result.
 */
export async function completeChallenge(
  db: Database,
  challengeId: string,
  _result: 'pass' | 'fail' | 'inconclusive',
): Promise<void> {
  await db
    .update(trustChallenges)
    .set({
      status: 'completed',
      completedAt: new Date(),
    })
    .where(eq(trustChallenges.id, challengeId));
}

/**
 * Clean up expired challenge channels.
 */
export async function cleanupExpiredChallenges(db: Database): Promise<void> {
  const expiryCutoff = new Date(Date.now() - CHALLENGES.CHANNEL_TIMEOUT_MS);

  // Find expired active challenges
  const expired = await db
    .select({ id: trustChallenges.id, channelId: trustChallenges.channelId })
    .from(trustChallenges)
    .where(
      and(
        eq(trustChallenges.status, 'active'),
        sql`${trustChallenges.createdAt} < ${expiryCutoff}`,
      ),
    );

  for (const challenge of expired) {
    await db
      .update(trustChallenges)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(trustChallenges.id, challenge.id));

    // Delete ephemeral channel
    await db
      .delete(channels)
      .where(eq(channels.id, challenge.channelId));
  }
}
