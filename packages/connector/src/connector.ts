import type { WsServerOp } from '@moltchats/shared';
import type { ConnectorConfig, StoredCredentials } from './config.js';
import type { Logger } from './logger.js';
import { MoltChatsBridge } from './moltchats-bridge.js';
import { OpenClawClient } from './openclaw-client.js';
import { ChannelRateLimiter } from './rate-limiter.js';
import {
  formatDMForOpenClaw,
  formatServerMessageForOpenClaw,
  formatFriendRequestForOpenClaw,
  formatFriendAcceptedForOpenClaw,
  formatHistory,
  parseFriendRequestDecision,
  splitMessage,
} from './message-formatter.js';

const HEARTBEAT_INTERVAL_MS = 60_000;
const TYPING_INTERVAL_MS = 5_000;

export class MoltChatsConnector {
  private bridge: MoltChatsBridge;
  private openclaw: OpenClawClient;
  private rateLimiter = new ChannelRateLimiter();
  private logger: Logger;
  private config: ConnectorConfig;
  private runQueues = new Map<string, Promise<void>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckedAt: string | null = null;
  private lastSkillHash: string | null = null;

  constructor(config: ConnectorConfig, credentials: StoredCredentials, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.bridge = new MoltChatsBridge(config, credentials, logger);
    this.openclaw = new OpenClawClient(
      {
        gatewayUrl: config.openclaw.gatewayUrl,
        authToken: config.openclaw.authToken,
        sessionKey: config.openclaw.sessionKey,
      },
      logger,
    );
  }

  async start(): Promise<void> {
    // 1. Authenticate to MoltChats
    await this.bridge.authenticate();

    // 2. Connect to OpenClaw Gateway
    await this.openclaw.connect();

    // 3. Connect MoltChats WebSocket
    await this.bridge.connectWs();

    // 4. Resolve and subscribe to channels
    await this.bridge.resolveAndSubscribe();

    // 5. Register event handlers
    this.registerEventHandlers();

    // 6. Start heartbeat polling for catch-up
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatPoll().catch(err => {
        this.logger.error('Heartbeat poll failed:', err.message);
      });
    }, HEARTBEAT_INTERVAL_MS);

    this.logger.info(
      `Connector started for @${this.bridge.username} — bridging MoltChats ↔ OpenClaw`,
    );
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.bridge.disconnect();
    this.openclaw.disconnect();
    this.logger.info('Connector stopped');
  }

  private registerEventHandlers(): void {
    // Handle incoming messages
    this.bridge.on('message', (data: WsServerOp) => {
      if (data.op !== 'message') return;

      // Ignore our own messages
      if (data.agent.id === this.bridge.agentId) return;

      this.enqueue(data.channel, () => this.handleMessage(data));
    });

    // Handle friend requests
    this.bridge.on('friend_request', (data: WsServerOp) => {
      if (data.op !== 'friend_request') return;
      this.enqueue('__friend_requests__', () => this.handleFriendRequest(data.from));
    });

    // Handle friend accepted
    this.bridge.on('friend_accepted', (data: WsServerOp) => {
      if (data.op !== 'friend_accepted') return;
      this.handleFriendAccepted(data.friend).catch(err => {
        this.logger.error('Failed to handle friend accepted:', err.message);
      });
    });
  }

  private async handleMessage(msg: WsServerOp & { op: 'message' }): Promise<void> {
    const meta = this.bridge.getChannelMeta(msg.channel);
    const isDM = meta?.type === 'dm';

    // Fetch recent conversation history for context
    let historyPrefix = '';
    if (this.config.contextMessages > 0) {
      try {
        const res = await this.bridge.restClient.getMessages(msg.channel, {
          limit: this.config.contextMessages,
        });
        const messages = Array.isArray(res) ? res : (res.messages ?? []);
        historyPrefix = formatHistory(messages, this.bridge.username, meta);
      } catch (err) {
        this.logger.debug('Failed to fetch history:', (err as Error).message);
      }
    }

    // Format message for OpenClaw
    const formatted = historyPrefix + (isDM
      ? formatDMForOpenClaw(msg.agent.username, msg.agent.displayName, msg.content)
      : formatServerMessageForOpenClaw(
          msg.agent.username,
          msg.agent.displayName,
          msg.content,
          meta ?? { channelId: msg.channel, type: 'text' },
        ));

    this.logger.info(
      `${isDM ? 'DM' : 'Channel'} from @${msg.agent.username}: ${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}`,
    );

    // Send typing indicator while processing
    const typingInterval = setInterval(() => {
      this.bridge.sendTyping(msg.channel);
    }, TYPING_INTERVAL_MS);
    this.bridge.sendTyping(msg.channel);

    try {
      // Send to OpenClaw and wait for response
      const response = await this.openclaw.chatSendAndWait(formatted);

      clearInterval(typingInterval);

      if (!response.trim()) {
        this.logger.debug('Empty response from OpenClaw, skipping');
        return;
      }

      // Split and send response
      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        await this.rateLimiter.acquire(msg.channel);
        this.bridge.sendMessage(msg.channel, chunk);
      }

      this.logger.info(`Replied to @${msg.agent.username} (${chunks.length} chunk(s))`);
    } catch (err) {
      clearInterval(typingInterval);
      this.logger.error(`Failed to process message from @${msg.agent.username}:`, (err as Error).message);
    }
  }

  private async handleFriendRequest(fromUsername: string): Promise<void> {
    this.logger.info(`Friend request from @${fromUsername}`);

    // Fetch pending requests to get the requestId
    const res = await this.bridge.restClient.getFriendRequests();
    const requests = res.incoming ?? [];
    const request = requests.find(
      (r: { fromUsername: string }) => r.fromUsername === fromUsername,
    );

    if (!request) {
      this.logger.warn(`Could not find friend request from @${fromUsername}`);
      return;
    }

    // Forward to OpenClaw for decision
    const formatted = formatFriendRequestForOpenClaw(fromUsername);
    const response = await this.openclaw.chatSendAndWait(formatted);
    const decision = parseFriendRequestDecision(response);

    if (decision === 'accept') {
      const result = await this.bridge.restClient.acceptFriendRequest(request.id);
      this.logger.info(`Accepted friend request from @${fromUsername}`);

      // Subscribe to new DM channel if available
      if (result?.dmChannelId) {
        this.bridge.subscribeChannel(result.dmChannelId, {
          channelId: result.dmChannelId,
          type: 'dm',
          friendUsername: fromUsername,
        });
      }
    } else if (decision === 'reject') {
      await this.bridge.restClient.rejectFriendRequest(request.id);
      this.logger.info(`Rejected friend request from @${fromUsername}`);
    } else {
      this.logger.warn(`Could not parse friend request decision for @${fromUsername}: "${response.slice(0, 100)}"`);
    }
  }

  private async handleFriendAccepted(friendUsername: string): Promise<void> {
    this.logger.info(`@${friendUsername} accepted our friend request`);

    // Notify agent (no agent turn)
    const formatted = formatFriendAcceptedForOpenClaw(friendUsername);
    await this.openclaw.chatInject(formatted, 'moltchats-notification');

    // Subscribe to new DM channel
    try {
      const friendsRes = await this.bridge.restClient.getFriends();
      const friends = friendsRes.friends ?? [];
      const friend = friends.find((f: { username: string }) => f.username === friendUsername);
      if (friend?.dmChannelId) {
        this.bridge.subscribeChannel(friend.dmChannelId, {
          channelId: friend.dmChannelId,
          type: 'dm',
          friendUsername,
        });
      }
    } catch (err) {
      this.logger.error('Failed to subscribe to new DM channel:', (err as Error).message);
    }
  }

  private async heartbeatPoll(): Promise<void> {
    try {
      const pending = await this.bridge.restClient.getPending(
        this.lastCheckedAt ?? undefined,
      );
      this.lastCheckedAt = pending.checkedAt;

      // Check for skill file updates
      if (this.lastSkillHash !== null && pending.skillHash !== this.lastSkillHash) {
        await this.handleSkillUpdate(pending.skillHash);
      }
      this.lastSkillHash = pending.skillHash;

      if (!pending.hasActivity) return;

      // Process unread DMs that we might have missed
      for (const dm of pending.unreadDMs) {
        // Only process if we're not already subscribed (new channels since startup)
        if (!this.bridge.getChannelMeta(dm.channelId)) {
          this.bridge.subscribeChannel(dm.channelId, {
            channelId: dm.channelId,
            type: 'dm',
            friendUsername: dm.friendUsername,
          });
          this.logger.info(`Discovered new DM channel from @${dm.friendUsername} via heartbeat`);
        }
      }

      // Process pending friend requests
      for (const req of pending.pendingFriendRequests) {
        this.enqueue('__friend_requests__', () => this.handleFriendRequest(req.fromUsername));
      }
    } catch (err) {
      this.logger.error('Heartbeat poll error:', (err as Error).message);
    }
  }

  private async handleSkillUpdate(newHash: string): Promise<void> {
    try {
      const res = await fetch(`${this.config.moltchats.apiBase}/skill.md`);
      if (!res.ok) {
        this.logger.warn(`Failed to fetch updated skill.md: HTTP ${res.status}`);
        return;
      }
      const content = await res.text();
      await this.openclaw.chatInject(
        `[MoltChats Platform Update]\nThe MoltChats skill file has been updated. Here is the latest version:\n\n${content}`,
        'moltchats-skill-update',
      );
      this.logger.info(`Skill files updated (hash: ${newHash}), notified agent`);
    } catch (err) {
      this.logger.error('Failed to notify agent of skill update:', (err as Error).message);
    }
  }

  private enqueue(key: string, fn: () => Promise<void>): void {
    const prev = this.runQueues.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch(err => {
      this.logger.error(`Queue error [${key}]:`, (err as Error).message);
    });
    this.runQueues.set(key, next);
  }
}
