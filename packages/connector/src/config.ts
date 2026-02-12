import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LogLevel } from './logger.js';

export interface ConnectorConfig {
  moltchats: {
    apiBase: string;
    wsBase: string;
    credentialsPath: string;
  };
  openclaw: {
    gatewayUrl: string;
    authToken: string;
    sessionKey: string;
  };
  channels: {
    autoSubscribeDMs: boolean;
    serverChannels: string[];
    serverIds: string[];
  };
  logLevel: LogLevel;
}

export interface StoredCredentials {
  agentId: string;
  username: string;
  privateKey: string;
  refreshToken: string;
  apiBase: string;
  token?: string;
}

const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'moltchats', 'credentials.json');
const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'moltchats', 'connector.json');

function deriveWsBase(apiBase: string): string {
  const url = new URL(apiBase);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = url.port || (url.protocol === 'https:' ? '' : '3001');
  const portSuffix = port ? `:${port}` : '';
  return `${protocol}//${url.hostname}${portSuffix}/ws`;
}

export function loadConfig(): ConnectorConfig {
  // Load config file if it exists
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(DEFAULT_CONFIG_PATH)) {
    fileConfig = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf-8'));
  }

  const openclawFile = (fileConfig.openclaw ?? {}) as Record<string, unknown>;
  const channelsFile = (fileConfig.channels ?? {}) as Record<string, unknown>;
  const moltchatsFile = (fileConfig.moltchats ?? {}) as Record<string, unknown>;

  const credentialsPath =
    (process.env.MOLTCHATS_CREDENTIALS_PATH as string) ??
    (moltchatsFile.credentialsPath as string) ??
    DEFAULT_CREDENTIALS_PATH;

  const apiBase =
    (process.env.MOLTCHATS_API_BASE as string) ??
    (moltchatsFile.apiBase as string) ??
    'https://moltchats.com';

  const wsBase =
    (process.env.MOLTCHATS_WS_BASE as string) ??
    (moltchatsFile.wsBase as string) ??
    deriveWsBase(apiBase);

  const authToken =
    (process.env.OPENCLAW_AUTH_TOKEN as string) ??
    (openclawFile.authToken as string) ??
    '';

  if (!authToken) {
    throw new Error(
      'OpenClaw auth token is required. Set OPENCLAW_AUTH_TOKEN env var or openclaw.authToken in connector.json',
    );
  }

  return {
    moltchats: {
      apiBase,
      wsBase,
      credentialsPath,
    },
    openclaw: {
      gatewayUrl:
        (process.env.OPENCLAW_GATEWAY_URL as string) ??
        (openclawFile.gatewayUrl as string) ??
        'ws://127.0.0.1:18789',
      authToken,
      sessionKey:
        (process.env.OPENCLAW_SESSION_KEY as string) ??
        (openclawFile.sessionKey as string) ??
        'main',
    },
    channels: {
      autoSubscribeDMs: (channelsFile.autoSubscribeDMs as boolean) ?? true,
      serverChannels: (channelsFile.serverChannels as string[]) ?? [],
      serverIds: (channelsFile.serverIds as string[]) ?? [],
    },
    logLevel:
      (process.env.CONNECTOR_LOG_LEVEL as LogLevel) ??
      (fileConfig.logLevel as LogLevel) ??
      'info',
  };
}

export function loadCredentials(path: string): StoredCredentials {
  if (!existsSync(path)) {
    throw new Error(
      `MoltChats credentials not found at ${path}. Run create-moltchats-agent first.`,
    );
  }

  const raw = JSON.parse(readFileSync(path, 'utf-8'));

  if (!raw.agentId || !raw.username || !raw.privateKey || !raw.refreshToken) {
    throw new Error(`Invalid credentials file at ${path}. Missing required fields.`);
  }

  return raw as StoredCredentials;
}
