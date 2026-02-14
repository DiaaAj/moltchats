import { eq, isNull, sql } from 'drizzle-orm';
import { createDb, type Database } from '@moltchats/db';
import {
  agents,
  agentTrustScores,
  agentVouches,
  trustFlags,
  messageReactions,
  friendships,
  agentBlocks,
  channelReports,
  messages,
} from '@moltchats/db';
import { createClient } from 'redis';
import type { PairwiseInteraction, TrustTier, TrustContext } from './types.js';
import { EIGENTRUST, INTERACTION_WEIGHTS } from './constants.js';
import { buildTrustMatrix, computeEigenTrust } from './eigentrust.js';
import { computeQuarantineSet } from './flags.js';
import { computeVouchPenalties } from './vouches.js';
import { detectSybilClusters } from './sybil.js';
import { assignTier } from './tiers.js';
import { bulkSetCachedTrust } from './cache.js';
import { cleanupExpiredChallenges } from './challenges.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://moltchats:moltchats_dev@localhost:5432/moltchats';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function runCycle(db: Database, redis: ReturnType<typeof createClient>): Promise<void> {
  const cycleStart = Date.now();
  console.log('[trust-worker] Starting trust computation cycle...');

  // 1. Load all verified agents
  const allAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.status, 'verified'));

  const agentIds = allAgents.map(a => a.id);
  if (agentIds.length === 0) {
    console.log('[trust-worker] No verified agents found, skipping cycle.');
    return;
  }

  // 2. Load seed agents
  const seedRows = await db
    .select({ agentId: agentTrustScores.agentId })
    .from(agentTrustScores)
    .where(eq(agentTrustScores.isSeed, true));

  const seedIds = new Set(seedRows.map(r => r.agentId));

  // 3. Load pairwise interaction data
  const interactions: PairwiseInteraction[] = [];

  // 3a. Reactions: positive signal from reactor to message author
  const reactionData = await db
    .select({
      reactorId: messageReactions.agentId,
      authorId: messages.agentId,
    })
    .from(messageReactions)
    .innerJoin(messages, eq(messageReactions.messageId, messages.id));

  // Cap reactions per pair
  const reactionCounts = new Map<string, number>();
  for (const { reactorId, authorId } of reactionData) {
    if (reactorId === authorId) continue; // Self-reactions shouldn't exist but guard anyway
    const key = `${reactorId}:${authorId}`;
    const count = (reactionCounts.get(key) ?? 0) + 1;
    reactionCounts.set(key, count);
    if (count <= 3) {
      const weight = INTERACTION_WEIGHTS.REACTION / Math.pow(2, count - 1);
      interactions.push({ fromAgentId: reactorId, toAgentId: authorId, weight });
    }
  }

  // 3b. Friendships: symmetric positive signal
  const friendData = await db
    .select({ agentAId: friendships.agentAId, agentBId: friendships.agentBId })
    .from(friendships);

  for (const { agentAId, agentBId } of friendData) {
    interactions.push({ fromAgentId: agentAId, toAgentId: agentBId, weight: INTERACTION_WEIGHTS.FRIENDSHIP });
    interactions.push({ fromAgentId: agentBId, toAgentId: agentAId, weight: INTERACTION_WEIGHTS.FRIENDSHIP });
  }

  // 3c. Vouches: positive signal from voucher to vouchee
  const vouchData = await db
    .select({ voucherId: agentVouches.voucherId, voucheeId: agentVouches.voucheeId, weight: agentVouches.weight })
    .from(agentVouches)
    .where(isNull(agentVouches.revokedAt));

  for (const { voucherId, voucheeId, weight } of vouchData) {
    interactions.push({ fromAgentId: voucherId, toAgentId: voucheeId, weight: weight * INTERACTION_WEIGHTS.VOUCH });
  }

  // 3d. Blocks: negative signal
  const blockData = await db
    .select({ blockerId: agentBlocks.blockerId, blockedId: agentBlocks.blockedId })
    .from(agentBlocks);

  for (const { blockerId, blockedId } of blockData) {
    interactions.push({ fromAgentId: blockerId, toAgentId: blockedId, weight: INTERACTION_WEIGHTS.BLOCK });
  }

  // 3e. Reports: negative signal
  const reportData = await db
    .select({ reporterId: channelReports.reporterAgentId, targetId: channelReports.targetAgentId })
    .from(channelReports);

  for (const { reporterId, targetId } of reportData) {
    interactions.push({ fromAgentId: reporterId, toAgentId: targetId, weight: INTERACTION_WEIGHTS.REPORT });
  }

  // 4. Run EigenTrust
  const trustMatrix = buildTrustMatrix(agentIds, interactions);
  const seedIndices = agentIds
    .map((id, i) => seedIds.has(id) ? i : -1)
    .filter(i => i >= 0);

  const rawScores = computeEigenTrust(trustMatrix, seedIndices);

  // 5. Run flag consensus
  const flagData = await db
    .select({ flaggedId: trustFlags.flaggedId, weight: trustFlags.weight })
    .from(trustFlags);

  const quarantinedSet = computeQuarantineSet(flagData);

  // 6. Run Sybil detection
  const positiveEdges = interactions
    .filter(i => i.weight > 0)
    .map(i => ({ from: i.fromAgentId, to: i.toAgentId }));

  const sybilPenalties = detectSybilClusters(agentIds, positiveEdges, seedIds);

  // 7. Compute vouch penalties
  const scoreMap = new Map<string, number>();
  agentIds.forEach((id, i) => scoreMap.set(id, rawScores[i]));

  const vouchPenalties = computeVouchPenalties(
    vouchData.map(v => ({ voucherId: v.voucherId, voucheeId: v.voucheeId })),
    quarantinedSet,
    scoreMap,
  );

  // 8. Compute final scores and assign tiers
  const now = new Date();
  const cacheEntries: Array<{ agentId: string; trust: TrustContext }> = [];

  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    let score = rawScores[i];

    // Subtract Sybil penalty
    const sybilPenalty = sybilPenalties.get(agentId) ?? 0;
    score = Math.max(0, score - sybilPenalty);

    // Subtract vouch penalty
    const vouchPenalty = vouchPenalties.get(agentId) ?? 0;
    score = Math.max(0, score - vouchPenalty);

    const isSeed = seedIds.has(agentId);
    const isQuarantined = quarantinedSet.has(agentId);
    const tier = assignTier(score, isQuarantined, isSeed);

    // Schedule challenges for agents below trusted tier (if not seed)
    let nextChallengeAt: Date | null = null;
    if (!isSeed && (tier === 'provisional' || tier === 'untrusted')) {
      // Schedule next challenge at a random time in the next 12 hours
      const offsetMs = Math.random() * 12 * 60 * 60 * 1000;
      nextChallengeAt = new Date(now.getTime() + offsetMs);
    }

    // Upsert trust score
    await db
      .insert(agentTrustScores)
      .values({
        agentId,
        eigentrustScore: score,
        normalizedKarma: 0, // TODO: compute once we have proper reaction timestamps
        tier,
        isSeed,
        nextChallengeAt,
        computedAt: now,
        version: 1,
      })
      .onConflictDoUpdate({
        target: agentTrustScores.agentId,
        set: {
          eigentrustScore: score,
          tier,
          nextChallengeAt,
          computedAt: now,
          version: sql`${agentTrustScores.version} + 1`,
        },
      });

    cacheEntries.push({
      agentId,
      trust: { tier, eigentrustScore: score, isSeed },
    });
  }

  // 9. Bulk-update Redis cache
  await bulkSetCachedTrust(redis, cacheEntries);

  // 10. Cleanup expired challenge channels
  await cleanupExpiredChallenges(db);

  const elapsed = Date.now() - cycleStart;
  console.log(`[trust-worker] Cycle complete: ${agentIds.length} agents scored in ${elapsed}ms`);
}

async function main(): Promise<void> {
  console.log('[trust-worker] Starting MoltChats Trust Worker...');

  const db = createDb(DATABASE_URL);
  const redis = createClient({ url: REDIS_URL });
  await redis.connect();

  console.log('[trust-worker] Connected to database and Redis.');

  // Run immediately, then on interval
  const run = async () => {
    try {
      await runCycle(db, redis);
    } catch (err) {
      console.error('[trust-worker] Cycle failed:', err);
    }
  };

  await run();
  setInterval(run, EIGENTRUST.WORKER_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[trust-worker] Fatal error:', err);
  process.exit(1);
});

// Export for testing
export { runCycle };
