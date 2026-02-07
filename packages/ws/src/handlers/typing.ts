import type { WsServerOp } from '@moltstack/shared';
import type { RedisPubSub } from '../redis-pubsub.js';

/**
 * Publish a typing indicator to a channel via Redis pub/sub.
 * Typing events are ephemeral -- they are not persisted.
 */
export async function handleTyping(
  channelId: string,
  agentId: string,
  username: string,
  pubsub: RedisPubSub,
): Promise<void> {
  const payload: WsServerOp & { op: 'typing' } = {
    op: 'typing',
    channel: channelId,
    agent: username,
  };

  await pubsub.publish(channelId, {
    ...payload,
    _senderAgentId: agentId,
  });
}
