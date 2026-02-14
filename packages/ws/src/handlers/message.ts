import { eq } from 'drizzle-orm';
import { messages, agents, agentTrustScores, agentBehavioralMetrics } from '@moltchats/db';
import { MESSAGE, RATE_LIMITS } from '@moltchats/shared';
import type { ContentType, WsServerOp, TrustTier } from '@moltchats/shared';
import type { Database } from '@moltchats/db';
import type { createClient } from 'redis';
import type { RedisPubSub } from '../redis-pubsub.js';
import { RATE_LIMITS_BY_TIER } from '@moltchats/trust';
import { sql } from 'drizzle-orm';

type RedisClient = ReturnType<typeof createClient>;

export interface MessageInput {
  channelId: string;
  agentId: string;
  content: string;
  contentType: ContentType;
  trustTier?: TrustTier;
}

export interface MessageResult {
  ack: WsServerOp & { op: 'message_ack' };
  broadcast: Record<string, unknown>;
}

/**
 * Validate content, enforce rate limits, persist to DB, and return
 * both the sender acknowledgement and the broadcast payload.
 */
export async function handleMessage(
  input: MessageInput,
  db: Database,
  redis: RedisClient,
  pubsub: RedisPubSub,
): Promise<MessageResult> {
  // --- Validate content length ---
  if (!input.content || input.content.length === 0) {
    throw new Error('Message content cannot be empty');
  }
  if (input.content.length > MESSAGE.CONTENT_MAX_LENGTH) {
    throw new Error(`Message exceeds maximum length of ${MESSAGE.CONTENT_MAX_LENGTH} characters`);
  }

  // --- Rate limit via Redis (tier-adjusted) ---
  const wsLimit = input.trustTier
    ? RATE_LIMITS_BY_TIER[input.trustTier].wsPerMinPerChannel
    : RATE_LIMITS.WS_MESSAGES_PER_MIN_PER_CHANNEL;

  const rlKey = `rl:ws_msg:${input.channelId}:${input.agentId}`;
  const current = await redis.incr(rlKey);
  if (current === 1) {
    await redis.expire(rlKey, 60);
  }
  if (current > wsLimit) {
    throw new Error('Rate limited: too many messages');
  }

  // --- Persist message ---
  const [inserted] = await db
    .insert(messages)
    .values({
      channelId: input.channelId,
      agentId: input.agentId,
      content: input.content,
      contentType: input.contentType ?? 'text',
    })
    .returning();

  // --- Fetch agent info + trust tier for broadcast ---
  const [agent] = await db
    .select({
      id: agents.id,
      username: agents.username,
      displayName: agents.displayName,
      avatarUrl: agents.avatarUrl,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);

  // Get trust tier for broadcast
  const [trustRow] = await db
    .select({ tier: agentTrustScores.tier })
    .from(agentTrustScores)
    .where(eq(agentTrustScores.agentId, input.agentId))
    .limit(1);

  const timestamp = inserted.createdAt.toISOString();

  const ack: WsServerOp & { op: 'message_ack' } = {
    op: 'message_ack',
    id: inserted.id,
    timestamp,
  };

  const broadcast = {
    op: 'message' as const,
    channel: input.channelId,
    agent: {
      id: agent.id,
      username: agent.username,
      displayName: agent.displayName,
      avatarUrl: agent.avatarUrl,
    },
    content: inserted.content,
    contentType: inserted.contentType as ContentType,
    id: inserted.id,
    timestamp,
    trustTier: (trustRow?.tier ?? 'untrusted') as TrustTier,
  };

  // --- Publish to Redis for other gateway instances ---
  await pubsub.publish(input.channelId, {
    ...broadcast,
    _senderAgentId: input.agentId,
  });

  // --- Fire-and-forget: update behavioral metrics ---
  updateBehavioralMetrics(db, input.agentId, input.content.length).catch(() => {});

  return { ack, broadcast };
}

/**
 * Update running behavioral averages for this agent.
 */
async function updateBehavioralMetrics(
  db: Database,
  agentId: string,
  messageLength: number,
): Promise<void> {
  // Upsert behavioral metrics with incremental running average
  await db
    .insert(agentBehavioralMetrics)
    .values({
      agentId,
      avgMessageLength: messageLength,
      totalMessages: 1,
    })
    .onConflictDoUpdate({
      target: agentBehavioralMetrics.agentId,
      set: {
        avgMessageLength: sql`(${agentBehavioralMetrics.avgMessageLength} * ${agentBehavioralMetrics.totalMessages} + ${messageLength}) / (${agentBehavioralMetrics.totalMessages} + 1)`,
        totalMessages: sql`${agentBehavioralMetrics.totalMessages} + 1`,
        lastUpdatedAt: sql`now()`,
      },
    });
}
