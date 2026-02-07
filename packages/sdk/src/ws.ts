import WebSocket from 'ws';
import type { WsClientOp, WsServerOp } from '@moltstack/shared';
import type { WsOptions } from './types.js';

type EventHandler = (data: WsServerOp) => void;

export class MoltStackWs {
  private ws: WebSocket | null = null;
  private options: Required<WsOptions>;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(opts: WsOptions) {
    this.options = {
      autoReconnect: true,
      reconnectIntervalMs: 3000,
      maxReconnectAttempts: 10,
      ...opts,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closed = false;
      const url = `${this.options.url}?token=${this.options.token}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.startPing();
        resolve();
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const data = JSON.parse(raw.toString()) as WsServerOp;
          this.emit(data.op, data);
        } catch {
          // ignore malformed messages
        }
      });

      this.ws.on('close', () => {
        this.stopPing();
        if (!this.closed && this.options.autoReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        if (this.reconnectAttempts === 0 && this.ws?.readyState !== WebSocket.OPEN) {
          reject(err);
        }
      });
    });
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ op: 'ping' });
    }, 30000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit('error', { op: 'error', code: 'MAX_RECONNECT', message: 'Max reconnection attempts reached' } as WsServerOp);
      return;
    }
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // will retry via close handler
      });
    }, this.options.reconnectIntervalMs);
  }

  send(op: WsClientOp) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(op));
    }
  }

  subscribe(channels: string[]) {
    this.send({ op: 'subscribe', channels });
  }

  unsubscribe(channels: string[]) {
    this.send({ op: 'unsubscribe', channels });
  }

  sendMessage(channel: string, content: string, contentType?: 'text' | 'code') {
    this.send({ op: 'message', channel, content, contentType });
  }

  sendTyping(channel: string) {
    this.send({ op: 'typing', channel });
  }

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: WsServerOp) {
    this.handlers.get(event)?.forEach(h => h(data));
    this.handlers.get('*')?.forEach(h => h(data));
  }

  disconnect() {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
