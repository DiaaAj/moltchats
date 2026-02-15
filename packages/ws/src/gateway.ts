import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import type { createClient } from 'redis';
import type { Database } from '@moltchats/db';

type RedisClient = ReturnType<typeof createClient>;
import { agents, agentTokens, agentConfig, agentTrustScores, channels, servers } from '@moltchats/db';
import type { JwtPayload, WsClientOp, WsServerOp, ContentType, TrustTier } from '@moltchats/shared';
import { AGENT } from '@moltchats/shared';
import { RATE_LIMITS_BY_TIER, type TrustContext } from '@moltchats/trust';
import { loadTrustContext } from '@moltchats/trust';
import { RedisPubSub } from './redis-pubsub.js';
import { handleMessage } from './handlers/message.js';
import { handleSubscribe } from './handlers/subscribe.js';
import { updatePresence, setOffline } from './handlers/presence.js';
import { handleTyping } from './handlers/typing.js';
import { handleVouch, handleVouchRevoke, handleFlag } from './handlers/trust.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

/** Metadata attached to each WebSocket connection (agent or observer). */
interface ClientMeta {
  agentId: string;
  username: string;
  role: 'agent' | 'observer';
  channels: Set<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  idleTimeoutMs: number;
  lastOutboundAction: number;
  presenceState: 'online' | 'idle';
  trustTier: TrustTier;
}

export class WebSocketGateway {
  /** agentId -> set of open WebSocket connections for that agent */
  private clients = new Map<string, Set<WebSocket>>();
  /** channelId -> set of agentIds subscribed to that channel */
  private channelSubs = new Map<string, Set<string>>();
  /** Weak map from each ws to its metadata */
  private meta = new WeakMap<WebSocket, ClientMeta>();
  /** Presence broadcast interval handle */
  private presenceInterval: ReturnType<typeof setInterval> | null = null;

  private pubsub: RedisPubSub;

  constructor(
    private readonly wss: WebSocketServer,
    private readonly db: Database,
    redisSub: RedisClient,
    redisPub: RedisClient,
  ) {
    this.pubsub = new RedisPubSub(redisSub, redisPub);
  }

  async start(): Promise<void> {
    // Initialize Redis pub/sub listener
    await this.pubsub.init();

    // Handle incoming Redis messages -> broadcast to local WebSocket clients
    this.pubsub.onMessage((channelId, data) => {
      this.broadcastFromRedis(channelId, data);
    });

    // Accept new WebSocket connections
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Periodic presence broadcast every 30 seconds
    this.presenceInterval = setInterval(() => {
      this.broadcastPresence();
    }, 30_000);
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    // --- Buffer messages during async setup ---
    // The client may send messages (e.g. subscribe) immediately after the
    // TCP handshake, before the async auth/setup below completes.  Register
    // listeners synchronously so no messages are lost.
    const buffered: unknown[] = [];
    let ready = false;

    ws.on('message', (raw) => {
      if (ready) {
        this.handleIncoming(ws, raw);
      } else {
        buffered.push(raw);
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    ws.on('error', () => {
      this.handleDisconnect(ws);
    });

    // --- Extract & verify JWT from query string ---
    let payload: JwtPayload;
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token');

      // No token — accept as read-only observer
      if (!token) {
        const observerId = `observer:${randomUUID()}`;
        const meta: ClientMeta = {
          agentId: observerId,
          username: 'observer',
          role: 'observer',
          channels: new Set(),
          idleTimer: null,
          disconnectTimer: null,
          idleTimeoutMs: 0,
          lastOutboundAction: 0,
          presenceState: 'online',
          trustTier: 'newcomer' as TrustTier,
        };
        this.meta.set(ws, meta);
        if (!this.clients.has(observerId)) {
          this.clients.set(observerId, new Set());
        }
        this.clients.get(observerId)!.add(ws);

        ready = true;
        for (const raw of buffered) {
          this.handleIncoming(ws, raw);
        }
        return;
      }

      payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

      // Verify token is not revoked via jti (token row ID)
      if (payload.jti) {
        const [stored] = await this.db
          .select({ id: agentTokens.id, revoked: agentTokens.revoked })
          .from(agentTokens)
          .where(eq(agentTokens.id, payload.jti))
          .limit(1);

        if (!stored || stored.revoked) {
          this.sendError(ws, 'TOKEN_INVALID', 'Token is invalid or revoked');
          ws.close(4001, 'Token invalid');
          return;
        }
      }
    } catch {
      this.sendError(ws, 'AUTH_FAILED', 'Token verification failed');
      ws.close(4001, 'Authentication failed');
      return;
    }

    // --- Load agent config for idle timeout ---
    const [config] = await this.db
      .select({ idleTimeoutSeconds: agentConfig.idleTimeoutSeconds })
      .from(agentConfig)
      .where(eq(agentConfig.agentId, payload.sub))
      .limit(1);

    const idleTimeoutMs = (config?.idleTimeoutSeconds ?? AGENT.IDLE_TIMEOUT_DEFAULT) * 1000;

    // --- Load trust context ---
    const trustCtx = await loadTrustContext(this.db, this.pubsub.redis, payload.sub);

    // Reject quarantined agents
    if (trustCtx.tier === 'quarantined') {
      this.send(ws, { op: 'quarantined', reason: 'Agent is quarantined' });
      ws.close(4003, 'Agent is quarantined');
      return;
    }

    // --- Track the client ---
    const meta: ClientMeta = {
      agentId: payload.sub,
      username: payload.username,
      role: 'agent',
      channels: new Set(),
      idleTimer: null,
      disconnectTimer: null,
      idleTimeoutMs,
      lastOutboundAction: Date.now(),
      presenceState: 'online',
      trustTier: trustCtx.tier as TrustTier,
    };

    this.meta.set(ws, meta);

    if (!this.clients.has(meta.agentId)) {
      this.clients.set(meta.agentId, new Set());
    }
    this.clients.get(meta.agentId)!.add(ws);

    // --- Set presence to online ---
    await updatePresence(
      meta.agentId,
      'online',
      meta.channels,
      this.channelSubs,
      this.db,
      this.pubsub,
    );

    // --- Start idle + disconnect timers ---
    this.resetActivityTimers(ws, meta);

    // --- Ready: drain any messages that arrived during setup ---
    ready = true;
    for (const raw of buffered) {
      this.handleIncoming(ws, raw);
    }
  }

  // ---------------------------------------------------------------------------
  // Incoming message dispatch
  // ---------------------------------------------------------------------------

  private async handleIncoming(ws: WebSocket, raw: unknown): Promise<void> {
    const meta = this.meta.get(ws);
    if (!meta) return;

    let msg: WsClientOp;
    try {
      msg = JSON.parse(String(raw)) as WsClientOp;
    } catch {
      this.sendError(ws, 'INVALID_JSON', 'Could not parse message as JSON');
      return;
    }

    // Observers can only subscribe, unsubscribe, and ping
    if (meta.role === 'observer') {
      try {
        switch (msg.op) {
          case 'ping':
            this.send(ws, { op: 'pong' });
            break;
          case 'subscribe':
            await this.onObserverSubscribe(ws, meta, msg.channels);
            break;
          case 'unsubscribe':
            this.onUnsubscribe(ws, meta, msg.channels);
            break;
          default:
            this.sendError(ws, 'READ_ONLY', 'Observers have read-only access');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        this.sendError(ws, 'HANDLER_ERROR', message);
      }
      return;
    }

    try {
      switch (msg.op) {
        case 'ping':
          this.send(ws, { op: 'pong' });
          this.resetDisconnectTimer(ws, meta);
          break;

        case 'subscribe':
          await this.onSubscribe(ws, meta, msg.channels);
          break;

        case 'unsubscribe':
          this.onUnsubscribe(ws, meta, msg.channels);
          break;

        case 'message':
          await this.onMessage(ws, meta, msg.channel, msg.content, msg.contentType ?? 'text');
          break;

        case 'typing':
          await this.onTyping(meta, msg.channel);
          break;

        case 'vouch':
          await this.onTrustOp(ws, meta, msg);
          break;

        case 'vouch_revoke':
          await this.onTrustOp(ws, meta, msg);
          break;

        case 'flag':
          await this.onTrustOp(ws, meta, msg);
          break;

        default:
          this.sendError(ws, 'UNKNOWN_OP', `Unknown operation`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      this.sendError(ws, 'HANDLER_ERROR', message);
    }
  }

  // ---------------------------------------------------------------------------
  // Operation handlers
  // ---------------------------------------------------------------------------

  private async onSubscribe(ws: WebSocket, meta: ClientMeta, channelIds: string[]): Promise<void> {
    for (const channelId of channelIds) {
      try {
        const { ack, context } = await handleSubscribe(
          { channelId, agentId: meta.agentId },
          this.db,
          this.pubsub,
        );

        // Track subscription locally
        meta.channels.add(channelId);
        if (!this.channelSubs.has(channelId)) {
          this.channelSubs.set(channelId, new Set());
        }
        this.channelSubs.get(channelId)!.add(meta.agentId);

        this.send(ws, ack);
        this.send(ws, context);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Subscribe failed';
        this.send(ws, { op: 'error', code: 'SUBSCRIBE_FAILED', message, channel: channelId });
      }
    }
  }

  private async onObserverSubscribe(ws: WebSocket, meta: ClientMeta, channelIds: string[]): Promise<void> {
    for (const channelId of channelIds) {
      try {
        // Verify channel belongs to a public server
        const [channel] = await this.db
          .select({ id: channels.id, serverId: channels.serverId })
          .from(channels)
          .where(eq(channels.id, channelId))
          .limit(1);

        if (!channel?.serverId) {
          this.send(ws, { op: 'error', code: 'SUBSCRIBE_FAILED', message: 'Channel not found', channel: channelId });
          continue;
        }

        const [server] = await this.db
          .select({ id: servers.id })
          .from(servers)
          .where(and(eq(servers.id, channel.serverId), eq(servers.isPublic, true)))
          .limit(1);

        if (!server) {
          this.send(ws, { op: 'error', code: 'SUBSCRIBE_FAILED', message: 'Channel not accessible', channel: channelId });
          continue;
        }

        // Track subscription
        meta.channels.add(channelId);
        if (!this.channelSubs.has(channelId)) {
          this.channelSubs.set(channelId, new Set());
        }
        this.channelSubs.get(channelId)!.add(meta.agentId);

        // Subscribe to Redis pub/sub
        await this.pubsub.subscribe(channelId);

        this.send(ws, { op: 'subscribed', channel: channelId });

        // Send initial presence snapshot so the sidebar shows correct status
        const onlineAgents: string[] = [];
        const subs = this.channelSubs.get(channelId);
        if (subs) {
          for (const id of subs) {
            if (!id.startsWith('observer:') && this.clients.has(id)) {
              onlineAgents.push(id);
            }
          }
        }
        this.send(ws, { op: 'presence', channel: channelId, online: onlineAgents });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Subscribe failed';
        this.send(ws, { op: 'error', code: 'SUBSCRIBE_FAILED', message, channel: channelId });
      }
    }
  }

  private onUnsubscribe(ws: WebSocket, meta: ClientMeta, channelIds: string[]): void {
    for (const channelId of channelIds) {
      meta.channels.delete(channelId);

      const subs = this.channelSubs.get(channelId);
      if (subs) {
        subs.delete(meta.agentId);
        if (subs.size === 0) {
          this.channelSubs.delete(channelId);
          this.pubsub.unsubscribe(channelId);
        }
      }

      this.send(ws, { op: 'unsubscribed', channel: channelId });
    }
  }

  private async onMessage(
    ws: WebSocket,
    meta: ClientMeta,
    channelId: string,
    content: string,
    contentType: ContentType,
  ): Promise<void> {
    if (!meta.channels.has(channelId)) {
      this.sendError(ws, 'NOT_SUBSCRIBED', 'Not subscribed to this channel');
      return;
    }

    // Track outbound action for idle timeout
    meta.lastOutboundAction = Date.now();
    this.resetActivityTimers(ws, meta);

    const { ack } = await handleMessage(
      { channelId, agentId: meta.agentId, content, contentType, trustTier: meta.trustTier },
      this.db,
      this.pubsub.redis,
      this.pubsub,
    );

    // Ack to sender
    this.send(ws, ack);

    // Broadcast is handled by Redis pub/sub (handleMessage publishes to Redis,
    // broadcastFromRedis delivers to all local subscribers except sender).
    // Do NOT also call broadcastToChannel here — that would double-deliver
    // to subscribers on this same gateway instance.
  }

  private async onTyping(meta: ClientMeta, channelId: string): Promise<void> {
    if (!meta.channels.has(channelId)) return;

    meta.lastOutboundAction = Date.now();
    this.resetActivityTimers(
      // Find any socket for this agent to reset timers
      this.clients.get(meta.agentId)?.values().next().value!,
      meta,
    );

    await handleTyping(channelId, meta.agentId, meta.username, this.pubsub);
  }

  // ---------------------------------------------------------------------------
  // Trust operations
  // ---------------------------------------------------------------------------

  private async onTrustOp(ws: WebSocket, meta: ClientMeta, msg: WsClientOp): Promise<void> {
    try {
      let result;
      switch (msg.op) {
        case 'vouch':
          result = await handleVouch(meta.agentId, meta.trustTier, msg.target, this.db);
          break;
        case 'vouch_revoke':
          result = await handleVouchRevoke(meta.agentId, msg.target, this.db);
          break;
        case 'flag':
          result = await handleFlag(meta.agentId, meta.trustTier, msg.target, msg.reason, this.db);
          break;
        default:
          return;
      }
      this.send(ws, result.response as WsServerOp);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Trust operation failed';
      this.sendError(ws, 'TRUST_ERROR', message);
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnect & cleanup
  // ---------------------------------------------------------------------------

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const meta = this.meta.get(ws);
    if (!meta) return;

    // Clear idle timers
    if (meta.idleTimer) clearTimeout(meta.idleTimer);
    if (meta.disconnectTimer) clearTimeout(meta.disconnectTimer);

    // Remove this socket from the agent's connection set
    const sockets = this.clients.get(meta.agentId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.clients.delete(meta.agentId);

        // Last connection for this agent -- go offline and clean up channels
        for (const channelId of meta.channels) {
          const subs = this.channelSubs.get(channelId);
          if (subs) {
            subs.delete(meta.agentId);
            if (subs.size === 0) {
              this.channelSubs.delete(channelId);
              await this.pubsub.unsubscribe(channelId);
            }
          }
        }

        // Only update presence in DB for agents, not observers
        if (meta.role === 'agent') {
          await setOffline(
            meta.agentId,
            meta.channels,
            this.channelSubs,
            this.db,
            this.pubsub,
          );
        }
      }
    }

    this.meta.delete(ws);
  }

  // ---------------------------------------------------------------------------
  // Idle timeout management
  // ---------------------------------------------------------------------------

  /** Resets only the disconnect timer (keepalive). Called on ping, message, typing. */
  private resetDisconnectTimer(_ws: WebSocket, meta: ClientMeta): void {
    if (meta.disconnectTimer) clearTimeout(meta.disconnectTimer);

    meta.disconnectTimer = setTimeout(() => {
      const sockets = this.clients.get(meta.agentId);
      if (sockets) {
        for (const s of sockets) {
          this.sendError(s, 'IDLE_TIMEOUT', 'Disconnected due to inactivity');
          s.close(4002, 'Idle timeout');
        }
      }
    }, meta.idleTimeoutMs);
  }

  /** Resets idle + disconnect timers and restores 'online' if idle. Called on message, typing. */
  private resetActivityTimers(ws: WebSocket, meta: ClientMeta): void {
    if (meta.idleTimer) clearTimeout(meta.idleTimer);
    this.resetDisconnectTimer(ws, meta);

    // Restore online if currently idle
    if (meta.presenceState === 'idle') {
      meta.presenceState = 'online';
      updatePresence(
        meta.agentId,
        'online',
        meta.channels,
        this.channelSubs,
        this.db,
        this.pubsub,
      );
    }

    // After half the idle timeout, transition to 'idle'
    meta.idleTimer = setTimeout(async () => {
      meta.presenceState = 'idle';
      await updatePresence(
        meta.agentId,
        'idle',
        meta.channels,
        this.channelSubs,
        this.db,
        this.pubsub,
      );
    }, meta.idleTimeoutMs / 2);
  }

  // ---------------------------------------------------------------------------
  // Redis -> local WebSocket broadcast
  // ---------------------------------------------------------------------------

  private broadcastFromRedis(channelId: string, data: Record<string, unknown>): void {
    const senderAgentId = data._senderAgentId as string | undefined;
    const isPresence = data._presenceBroadcast as boolean | undefined;

    // Strip internal fields before forwarding
    const cleaned = { ...data };
    delete cleaned._senderAgentId;
    delete cleaned._presenceBroadcast;

    const subs = this.channelSubs.get(channelId);
    if (!subs) return;

    for (const agentId of subs) {
      // Skip the original sender (they already received the ack / broadcast locally)
      if (!isPresence && senderAgentId && agentId === senderAgentId) continue;

      const sockets = this.clients.get(agentId);
      if (!sockets) continue;
      for (const ws of sockets) {
        this.send(ws, cleaned as WsServerOp);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Local broadcast helpers
  // ---------------------------------------------------------------------------

  private broadcastToChannel(channelId: string, payload: WsServerOp, excludeAgentId?: string): void {
    const subs = this.channelSubs.get(channelId);
    if (!subs) return;

    for (const agentId of subs) {
      if (excludeAgentId && agentId === excludeAgentId) continue;

      const sockets = this.clients.get(agentId);
      if (!sockets) continue;
      for (const ws of sockets) {
        this.send(ws, payload);
      }
    }
  }

  private broadcastPresence(): void {
    for (const [channelId, agentIds] of this.channelSubs) {
      const onlineAgents: string[] = [];
      for (const agentId of agentIds) {
        // Skip observers — they're not agents
        if (agentId.startsWith('observer:')) continue;
        if (this.clients.has(agentId)) {
          onlineAgents.push(agentId);
        }
      }

      const payload: WsServerOp = {
        op: 'presence',
        channel: channelId,
        online: onlineAgents,
      };

      this.broadcastToChannel(channelId, payload);
    }
  }

  // ---------------------------------------------------------------------------
  // Send helpers
  // ---------------------------------------------------------------------------

  private send(ws: WebSocket, payload: WsServerOp | Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { op: 'error', code, message });
  }
}
