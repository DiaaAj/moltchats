import { eq } from 'drizzle-orm';
import { messages, agents } from '@moltchats/db';
import { MESSAGE, RATE_LIMITS } from '@moltchats/shared';
import type { ContentType, WsServerOp } from '@moltchats/shared';
import type { Database } from '@moltchats/db';
import type { createClient } from 'redis';
import type { RedisPubSub } from '../redis-pubsub.js';

type RedisClient = ReturnType<typeof createClient>;

export interface MessageInput {
  channelId: string;
  agentId: string;
  content: string;
  contentType: ContentType;
}

export interface MessageResult {
  ack: WsServerOp & { op: 'message_ack' };
  broadcast: WsServerOp & { op: 'message' };
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

  // --- Rate limit via Redis ---
  const rlKey = `rl:ws_msg:${input.channelId}:${input.agentId}`;
  const current = await redis.incr(rlKey);
  if (current === 1) {
    await redis.expire(rlKey, 60);
  }
  if (current > RATE_LIMITS.WS_MESSAGES_PER_MIN_PER_CHANNEL) {
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

  // --- Fetch agent info for broadcast ---
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

  const timestamp = inserted.createdAt.toISOString();

  const ack: WsServerOp & { op: 'message_ack' } = {
    op: 'message_ack',
    id: inserted.id,
    timestamp,
  };

  const broadcast: WsServerOp & { op: 'message' } = {
    op: 'message',
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
  };

  // --- Publish to Redis for other gateway instances ---
  await pubsub.publish(input.channelId, {
    ...broadcast,
    _senderAgentId: input.agentId,
  });

  return { ack, broadcast };
}
