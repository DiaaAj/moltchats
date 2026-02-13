import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Logger } from './logger.js';

export interface OpenClawConfig {
  gatewayUrl: string;
  authToken: string;
  sessionKey: string;
}

export type ChatEventState = 'delta' | 'final' | 'aborted' | 'error';

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  state: ChatEventState;
  message?: unknown;
  errorMessage?: string;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ChatEventHandler = (event: ChatEvent) => void;

const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_CAP_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;
const RUN_TIMEOUT_MS = 300000; // 5 minutes

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private config: OpenClawConfig;
  private logger: Logger;
  private pending = new Map<string, PendingRequest>();
  private chatHandlers = new Set<ChatEventHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private _connected = false;

  constructor(config: OpenClawConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  get connected(): boolean {
    return this._connected;
  }

  onChat(handler: ChatEventHandler): () => void {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    this.closed = false;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.gatewayUrl);

      let handshakeComplete = false;

      this.ws.on('open', () => {
        this.logger.debug('OpenClaw Gateway WS connected, waiting for challenge...');
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          return;
        }

        // Handle connect.challenge during handshake
        if (!handshakeComplete && frame.type === 'event' && frame.event === 'connect.challenge') {
          this.sendRaw({
            type: 'req',
            id: randomUUID(),
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'gateway-client',
                displayName: 'MoltChats Connector',
                version: '0.3.0',
                platform: process.platform,
                mode: 'backend',
                instanceId: randomUUID(),
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write', 'operator.admin'],
              caps: [],
              auth: { token: this.config.authToken },
            },
          });
          return;
        }

        // Handle connect response
        if (!handshakeComplete && frame.type === 'res') {
          const resFrame = frame as { ok?: boolean; error?: { message?: string } };
          if (resFrame.ok === false) {
            const errMsg = resFrame.error?.message ?? 'Gateway handshake failed';
            reject(new Error(errMsg));
            return;
          }
          handshakeComplete = true;
          this._connected = true;
          this.reconnectAttempts = 0;
          this.logger.info('Connected to OpenClaw Gateway');
          resolve();
          return;
        }

        // Dispatch normal frames
        this.handleFrame(frame);
      });

      this.ws.on('close', () => {
        this._connected = false;
        if (!this.closed) {
          this.logger.warn('OpenClaw Gateway connection lost');
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        if (!handshakeComplete) {
          reject(err);
        } else {
          this.logger.error('OpenClaw Gateway WS error:', err.message);
        }
      });
    });
  }

  async chatSend(message: string): Promise<{ runId: string }> {
    const id = randomUUID();
    const idempotencyKey = randomUUID();

    const payload = await this.request(id, 'chat.send', {
      sessionKey: this.config.sessionKey,
      message,
      idempotencyKey,
    }) as Record<string, unknown>;

    return { runId: (payload.runId as string) ?? idempotencyKey };
  }

  /**
   * Send chat.send and wait for the full streamed response.
   * Returns the final response text.
   */
  async chatSendAndWait(message: string): Promise<string> {
    const { runId } = await this.chatSend(message);
    return this.waitForRunCompletion(runId);
  }

  async chatInject(message: string, label?: string): Promise<void> {
    const id = randomUUID();
    await this.request(id, 'chat.inject', {
      sessionKey: this.config.sessionKey,
      message,
      ...(label ? { label } : {}),
    });
  }

  async chatAbort(runId: string): Promise<void> {
    const id = randomUUID();
    await this.request(id, 'chat.abort', {
      sessionKey: this.config.sessionKey,
      runId,
    });
  }

  disconnect(): void {
    this.closed = true;
    this._connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Reject all pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error('Client disconnected'));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private extractText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const key of ['text', 'content', 'message', 'response']) {
        if (typeof obj[key] === 'string') return obj[key] as string;
      }
    }
    return '';
  }

  private waitForRunCompletion(runId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let accumulated = '';
      const timeout = setTimeout(() => {
        off();
        this.chatAbort(runId).catch(() => {});
        reject(new Error(`Run ${runId} timed out after ${RUN_TIMEOUT_MS / 1000}s`));
      }, RUN_TIMEOUT_MS);

      const off = this.onChat((event) => {
        if (event.runId !== runId) return;

        switch (event.state) {
          case 'delta':
            accumulated = this.extractText(event.message) || accumulated;
            break;
          case 'final':
            clearTimeout(timeout);
            off();
            resolve(this.extractText(event.message) || accumulated);
            break;
          case 'aborted':
            clearTimeout(timeout);
            off();
            reject(new Error('Run was aborted'));
            break;
          case 'error':
            clearTimeout(timeout);
            off();
            reject(new Error(event.errorMessage ?? 'Run failed'));
            break;
        }
      });
    });
  }

  private async request(id: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.sendRaw({ type: 'req', id, method, params });
    });
  }

  private handleFrame(frame: Record<string, unknown>): void {
    if (frame.type === 'res') {
      const id = frame.id as string;
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (frame.ok === false) {
          const err = frame.error as Record<string, unknown> | undefined;
          pending.reject(new Error((err?.message as string) ?? 'Request failed'));
        } else {
          pending.resolve(frame.payload ?? frame.result ?? {});
        }
      }
      return;
    }

    if (frame.type === 'event' && frame.event === 'chat') {
      const event = frame.payload as ChatEvent;
      for (const handler of this.chatHandlers) {
        handler(event);
      }
      return;
    }
  }

  private sendRaw(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error('Max OpenClaw Gateway reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_CAP_MS,
    );
    this.reconnectAttempts++;
    this.logger.info(`Reconnecting to OpenClaw Gateway in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error('OpenClaw Gateway reconnect failed:', err.message);
      });
    }, delay);
  }
}
