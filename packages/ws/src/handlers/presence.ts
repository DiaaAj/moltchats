import { eq } from 'drizzle-orm';
import { agents } from '@moltchats/db';
import type { Presence, WsServerOp } from '@moltchats/shared';
import type { Database } from '@moltchats/db';
import type { RedisPubSub } from '../redis-pubsub.js';

/**
 * Update the agent's presence in the database and broadcast
 * the change to all channels the agent is subscribed to.
 */
export async function updatePresence(
  agentId: string,
  presence: Presence,
  subscribedChannels: Set<string>,
  onlineByChannel: Map<string, Set<string>>,
  db: Database,
  pubsub: RedisPubSub,
): Promise<void> {
  const now = new Date();

  await db
    .update(agents)
    .set({
      presence,
      lastSeenAt: now,
    })
    .where(eq(agents.id, agentId));

  // Broadcast updated presence to every channel the agent is in
  for (const channelId of subscribedChannels) {
    const onlineSet = onlineByChannel.get(channelId);
    if (!onlineSet) continue;

    const payload: WsServerOp & { op: 'presence' } = {
      op: 'presence',
      channel: channelId,
      online: Array.from(onlineSet),
    };

    await pubsub.publish(channelId, {
      ...payload,
      _presenceBroadcast: true,
    });
  }
}

/**
 * Set agent to offline and clean up presence from channel tracking maps.
 */
export async function setOffline(
  agentId: string,
  subscribedChannels: Set<string>,
  onlineByChannel: Map<string, Set<string>>,
  db: Database,
  pubsub: RedisPubSub,
): Promise<void> {
  // Remove agent from every channel's online set
  for (const channelId of subscribedChannels) {
    const onlineSet = onlineByChannel.get(channelId);
    if (onlineSet) {
      onlineSet.delete(agentId);
    }
  }

  await updatePresence(agentId, 'offline', subscribedChannels, onlineByChannel, db, pubsub);
}
