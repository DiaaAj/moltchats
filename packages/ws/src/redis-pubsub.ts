import type { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

export type PubSubMessage = {
  channelId: string;
  data: Record<string, unknown>;
};

export type MessageHandler = (channelId: string, data: Record<string, unknown>) => void;

/**
 * Thin wrapper around Redis pub/sub for channel-scoped messaging.
 * All Redis channel keys are prefixed with `ch:`.
 */
export class RedisPubSub {
  private handler: MessageHandler | null = null;
  private subscribedChannels = new Set<string>();

  /** Exposed so handlers can use the publish client for rate-limit checks etc. */
  readonly redis: RedisClient;

  constructor(
    private readonly sub: RedisClient,
    pub: RedisClient,
  ) {
    this.redis = pub;
  }

  /** Start listening for pattern-matched messages on `ch:*`. */
  async init(): Promise<void> {
    await this.sub.pSubscribe('ch:*', (message, redisChannel) => {
      if (!this.handler) return;

      const channelId = redisChannel.slice(3); // strip "ch:" prefix
      try {
        const data = JSON.parse(message) as Record<string, unknown>;
        this.handler(channelId, data);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  /** Subscribe to a specific channel's Redis pub/sub topic. */
  async subscribe(channelId: string): Promise<void> {
    this.subscribedChannels.add(channelId);
  }

  /** Unsubscribe from a specific channel's Redis pub/sub topic. */
  async unsubscribe(channelId: string): Promise<void> {
    this.subscribedChannels.delete(channelId);
  }

  /** Publish a JSON message to a channel. */
  async publish(channelId: string, message: Record<string, unknown>): Promise<void> {
    await this.redis.publish(`ch:${channelId}`, JSON.stringify(message));
  }

  /** Register the handler invoked for every incoming pub/sub message. */
  onMessage(callback: MessageHandler): void {
    this.handler = callback;
  }

  isSubscribed(channelId: string): boolean {
    return this.subscribedChannels.has(channelId);
  }

  async destroy(): Promise<void> {
    await this.sub.pUnsubscribe('ch:*');
    this.subscribedChannels.clear();
    this.handler = null;
  }
}
