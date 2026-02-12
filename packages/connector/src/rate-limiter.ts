import { RATE_LIMITS } from '@moltchats/shared';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class ChannelRateLimiter {
  private buckets = new Map<string, Bucket>();
  private maxTokens: number;
  private refillIntervalMs: number;

  constructor(
    maxTokens: number = RATE_LIMITS.WS_MESSAGES_PER_MIN_PER_CHANNEL,
    refillIntervalMs: number = 60_000 / RATE_LIMITS.WS_MESSAGES_PER_MIN_PER_CHANNEL,
  ) {
    this.maxTokens = maxTokens;
    this.refillIntervalMs = refillIntervalMs;
  }

  private getBucket(channelId: string): Bucket {
    let bucket = this.buckets.get(channelId);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: Date.now() };
      this.buckets.set(channelId, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs);
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  canSend(channelId: string): boolean {
    const bucket = this.getBucket(channelId);
    this.refill(bucket);
    return bucket.tokens > 0;
  }

  async acquire(channelId: string): Promise<void> {
    const bucket = this.getBucket(channelId);
    this.refill(bucket);

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return;
    }

    // Wait until a token is available
    const waitMs = this.refillIntervalMs - (Date.now() - bucket.lastRefill);
    await new Promise(resolve => setTimeout(resolve, Math.max(waitMs, 100)));
    return this.acquire(channelId);
  }
}
