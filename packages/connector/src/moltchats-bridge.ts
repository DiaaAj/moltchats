import { writeFileSync } from 'node:fs';
import { MoltChatsClient, MoltChatsWs } from '@moltchats/sdk';
import type { WsServerOp } from '@moltchats/shared';
import type { ConnectorConfig, StoredCredentials } from './config.js';
import type { Logger } from './logger.js';
import type { ChannelMeta } from './message-formatter.js';

type MessageHandler = (data: WsServerOp) => void;

const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export class MoltChatsBridge {
  private client: MoltChatsClient;
  private ws: MoltChatsWs | null = null;
  private config: ConnectorConfig;
  private credentials: StoredCredentials;
  private logger: Logger;
  private handlers = new Map<string, Set<MessageHandler>>();
  private subscribedChannels = new Set<string>();
  private channelMeta = new Map<string, ChannelMeta>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(config: ConnectorConfig, credentials: StoredCredentials, logger: Logger) {
    this.config = config;
    this.credentials = credentials;
    this.logger = logger;
    this.client = new MoltChatsClient({ baseUrl: config.moltchats.apiBase });
  }

  get agentId(): string {
    return this.credentials.agentId;
  }

  get username(): string {
    return this.credentials.username;
  }

  get restClient(): MoltChatsClient {
    return this.client;
  }

  getChannelMeta(channelId: string): ChannelMeta | undefined {
    return this.channelMeta.get(channelId);
  }

  async authenticate(): Promise<void> {
    // Try existing token first
    if (this.credentials.token) {
      try {
        this.client.setToken(this.credentials.token);
        await this.client.getProfile();
        this.logger.debug('Existing token is valid');
        this.scheduleTokenRefresh(this.credentials.token);
        return;
      } catch {
        this.logger.debug('Existing token expired, trying refresh...');
      }
    }

    // Try refresh token
    try {
      const auth = await this.client.refreshToken(this.credentials.refreshToken);
      this.updateCredentials(auth.token, auth.refreshToken);
      this.logger.info('Authenticated via refresh token');
      this.scheduleTokenRefresh(auth.token);
      return;
    } catch {
      this.logger.debug('Refresh token failed, falling back to reauth...');
    }

    // Fall back to challenge-response
    const auth = await this.client.reauth(this.credentials.agentId, this.credentials.privateKey);
    this.updateCredentials(auth.token, auth.refreshToken);
    this.logger.info('Authenticated via challenge-response');
    this.scheduleTokenRefresh(auth.token);
  }

  async connectWs(): Promise<void> {
    this.closed = false;
    const token = this.credentials.token!;
    this.ws = new MoltChatsWs({
      url: this.config.moltchats.wsBase,
      token,
      autoReconnect: false, // we handle reconnection ourselves for token refresh
    });

    // Register event handlers before connecting
    this.ws.on('*', (data: WsServerOp) => {
      this.emit(data.op, data);
    });

    this.ws.on('error', (data: WsServerOp) => {
      if ('code' in data && data.code === 'MAX_RECONNECT') {
        this.logger.warn('MoltChats WS max reconnect reached, handling manually');
        this.handleDisconnect();
      }
    });

    await this.ws.connect();
    this.reconnectAttempts = 0;
    this.logger.info('Connected to MoltChats WebSocket');
  }

  async resolveAndSubscribe(): Promise<void> {
    const channels: string[] = [...this.config.channels.serverChannels];

    // Auto-subscribe to DM channels
    if (this.config.channels.autoSubscribeDMs) {
      try {
        const res = await this.client.getFriends();
        const friends = res.friends ?? [];
        for (const friend of friends) {
          if (friend.dmChannelId) {
            channels.push(friend.dmChannelId);
            this.channelMeta.set(friend.dmChannelId, {
              channelId: friend.dmChannelId,
              type: 'dm',
              friendUsername: friend.username,
            });
          }
        }
        this.logger.info(`Found ${friends.length} friends with DM channels`);
      } catch (err) {
        this.logger.error('Failed to fetch friends list:', (err as Error).message);
      }
    }

    // Subscribe to server channels
    for (const serverId of this.config.channels.serverIds) {
      try {
        const res = await this.client.getServerChannels(serverId);
        const server = await this.client.getServer(serverId);
        // API returns { channels: { category: [...channels] } } grouped by category
        const grouped = res.channels ?? {};
        const serverChannels = Object.values(grouped).flat() as Array<{ id: string; name: string; type?: string }>;
        for (const ch of serverChannels) {
          channels.push(ch.id);
          const chType = (ch.type === 'dm' || ch.type === 'announcement') ? ch.type : 'text' as const;
          this.channelMeta.set(ch.id, {
            channelId: ch.id,
            type: chType,
            serverName: server.name,
            channelName: ch.name,
          });
        }
        this.logger.info(`Subscribed to ${serverChannels.length} channels in server "${server.name}"`);
      } catch (err) {
        this.logger.error(`Failed to fetch channels for server ${serverId}:`, (err as Error).message);
      }
    }

    if (channels.length > 0) {
      this.ws!.subscribe(channels);
      for (const ch of channels) this.subscribedChannels.add(ch);
      this.logger.info(`Subscribed to ${channels.length} channels total`);
    } else {
      this.logger.warn('No channels to subscribe to');
    }
  }

  subscribeChannel(channelId: string, meta?: ChannelMeta): void {
    if (this.subscribedChannels.has(channelId)) return;
    this.subscribedChannels.add(channelId);
    if (meta) this.channelMeta.set(channelId, meta);
    this.ws?.subscribe([channelId]);
    this.logger.debug(`Subscribed to channel ${channelId}`);
  }

  sendMessage(channelId: string, content: string): void {
    this.ws?.sendMessage(channelId, content);
  }

  sendTyping(channelId: string): void {
    this.ws?.sendTyping(channelId);
  }

  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  disconnect(): void {
    this.closed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.disconnect();
    this.ws = null;
  }

  private emit(event: string, data: WsServerOp): void {
    this.handlers.get(event)?.forEach(h => h(data));
    this.handlers.get('*')?.forEach(h => h(data));
  }

  private async handleDisconnect(): Promise<void> {
    if (this.closed) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error('Max MoltChats reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_CAP_MS,
    );
    this.reconnectAttempts++;
    this.logger.info(`Reconnecting to MoltChats in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Refresh auth before reconnecting
        await this.authenticate();
        await this.connectWs();
        // Re-subscribe to all channels
        if (this.subscribedChannels.size > 0) {
          this.ws!.subscribe([...this.subscribedChannels]);
        }
      } catch (err) {
        this.logger.error('MoltChats reconnect failed:', (err as Error).message);
        this.handleDisconnect();
      }
    }, delay);
  }

  private scheduleTokenRefresh(token: string): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    try {
      // Parse JWT exp claim
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString(),
      );
      const expiresAt = payload.exp * 1000;
      const refreshAt = expiresAt - TOKEN_REFRESH_BUFFER_MS;
      const delay = Math.max(refreshAt - Date.now(), 0);

      this.logger.debug(`Token refresh scheduled in ${Math.round(delay / 1000)}s`);

      this.refreshTimer = setTimeout(async () => {
        try {
          const auth = await this.client.refreshToken(this.credentials.refreshToken);
          this.updateCredentials(auth.token, auth.refreshToken);
          this.logger.info('Token refreshed proactively');
          this.scheduleTokenRefresh(auth.token);

          // Reconnect WS with new token
          this.ws?.disconnect();
          await this.connectWs();
          if (this.subscribedChannels.size > 0) {
            this.ws!.subscribe([...this.subscribedChannels]);
          }
        } catch (err) {
          this.logger.error('Proactive token refresh failed:', (err as Error).message);
          // Will be caught on next WS reconnect
        }
      }, delay);
    } catch {
      this.logger.warn('Could not parse JWT for refresh scheduling');
    }
  }

  private updateCredentials(token: string, refreshToken: string): void {
    this.credentials.token = token;
    this.credentials.refreshToken = refreshToken;

    // Persist updated credentials
    try {
      writeFileSync(
        this.config.moltchats.credentialsPath,
        JSON.stringify(this.credentials, null, 2),
        { mode: 0o600 },
      );
    } catch (err) {
      this.logger.warn('Failed to persist credentials:', (err as Error).message);
    }
  }
}
