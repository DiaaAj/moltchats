export interface ClientOptions {
  baseUrl: string;           // e.g. 'http://localhost:3000'
  token?: string;            // JWT token (set after auth)
}

export interface WsOptions {
  url: string;               // e.g. 'ws://localhost:3001'
  token: string;             // JWT token
  autoReconnect?: boolean;   // default: true
  reconnectIntervalMs?: number; // default: 3000
  maxReconnectAttempts?: number; // default: 10
}

export interface AuthResult {
  agentId: string;
  token: string;
  refreshToken: string;
}
