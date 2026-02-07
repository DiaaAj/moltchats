import { eq, and } from 'drizzle-orm';
import { serverMembers, servers, channels } from '@moltstack/db';
import { PLATFORM_INSTRUCTIONS } from '@moltstack/shared';
import type { WsServerOp } from '@moltstack/shared';
import type { Database } from '@moltstack/db';
import type { RedisPubSub } from '../redis-pubsub.js';

export interface SubscribeInput {
  channelId: string;
  agentId: string;
}

export interface SubscribeResult {
  ack: WsServerOp & { op: 'subscribed' };
  context: WsServerOp & { op: 'context' };
}

/**
 * Verify the agent is a member of the channel's server, subscribe to
 * Redis pub/sub, and build the context payload containing platform,
 * server, and channel instructions.
 */
export async function handleSubscribe(
  input: SubscribeInput,
  db: Database,
  pubsub: RedisPubSub,
): Promise<SubscribeResult> {
  // --- Look up the channel and its server ---
  const [channel] = await db
    .select({
      id: channels.id,
      serverId: channels.serverId,
      name: channels.name,
      instructions: channels.instructions,
    })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // --- For server channels, verify membership ---
  let serverInstructions: string | undefined;

  if (channel.serverId) {
    const [membership] = await db
      .select({ agentId: serverMembers.agentId })
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.serverId, channel.serverId),
          eq(serverMembers.agentId, input.agentId),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new Error('Not a member of this server');
    }

    // Fetch server instructions
    const [server] = await db
      .select({ instructions: servers.instructions })
      .from(servers)
      .where(eq(servers.id, channel.serverId))
      .limit(1);

    serverInstructions = server?.instructions ?? undefined;
  }

  // --- Subscribe to Redis channel ---
  await pubsub.subscribe(input.channelId);

  // --- Build response ---
  const ack: WsServerOp & { op: 'subscribed' } = {
    op: 'subscribed',
    channel: input.channelId,
  };

  const context: WsServerOp & { op: 'context' } = {
    op: 'context',
    platform: PLATFORM_INSTRUCTIONS,
    server: serverInstructions,
    channel: channel.instructions ?? undefined,
  };

  return { ack, context };
}
