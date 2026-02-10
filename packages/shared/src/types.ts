export type AgentStatus = 'pending' | 'verified' | 'suspended';
export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type ChannelType = 'text' | 'announcement' | 'dm';
export type ServerRole = 'owner' | 'admin' | 'member';
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';
export type ContentType = 'text' | 'code';
export type WebhookEvent = 'dm.received' | 'mention.received' | 'reply.received' | 'friend_request.received' | 'channel.message';

export interface AgentProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  agentType: string;
  status: AgentStatus;
  presence: Presence;
  capabilities: string[];
  karma: number;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface ServerInfo {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  ownerId: string;
  isPublic: boolean;
  memberCount: number;
  tags: string[];
  createdAt: Date;
}

export interface ChannelInfo {
  id: string;
  serverId: string | null;
  category: string | null;
  name: string | null;
  type: ChannelType;
  topic: string | null;
  position: number;
}

export interface MessagePayload {
  id: string;
  channelId: string;
  agent: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  content: string;
  contentType: ContentType;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  editedAt: Date | null;
}

// WebSocket operation types
export type WsClientOp =
  | { op: 'subscribe'; channels: string[] }
  | { op: 'unsubscribe'; channels: string[] }
  | { op: 'message'; channel: string; content: string; contentType?: ContentType }
  | { op: 'typing'; channel: string }
  | { op: 'ping' };

export type WsServerOp =
  | { op: 'subscribed'; channel: string }
  | { op: 'unsubscribed'; channel: string }
  | { op: 'message'; channel: string; agent: MessagePayload['agent']; content: string; contentType: ContentType; id: string; timestamp: string }
  | { op: 'message_ack'; id: string; timestamp: string }
  | { op: 'presence'; channel: string; online: string[] }
  | { op: 'typing'; channel: string; agent: string }
  | { op: 'friend_request'; from: string }
  | { op: 'friend_accepted'; friend: string }
  | { op: 'context'; platform: string; server?: string; channel?: string }
  | { op: 'pong' }
  | { op: 'error'; code: string; message: string; channel?: string };

export interface WebhookPayload {
  event: WebhookEvent;
  agentId: string;
  from: { username: string; displayName: string | null };
  channelId?: string;
  messagePreview?: string;
  timestamp: string;
}

export interface AgentConfig {
  webhookUrl: string | null;
  webhookEvents: WebhookEvent[];
  idleTimeoutSeconds: number;
  maxOutboundPerHour: number;
  maxInboundWakesPerHour: number;
  heartbeatHintSeconds: number;
}

export interface JwtPayload {
  sub: string; // agent_id
  username: string;
  role: 'agent' | 'observer';
  jti?: string; // token row ID for revocation checks
  iat: number;
  exp: number;
}
