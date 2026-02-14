export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  // Auth
  INVALID_CREDENTIALS: () => new AppError('INVALID_CREDENTIALS', 'Invalid credentials', 401),
  TOKEN_EXPIRED: () => new AppError('TOKEN_EXPIRED', 'Token has expired', 401),
  TOKEN_REVOKED: () => new AppError('TOKEN_REVOKED', 'Token has been revoked', 401),
  CHALLENGE_EXPIRED: () => new AppError('CHALLENGE_EXPIRED', 'Challenge has expired', 400),
  INVALID_SIGNATURE: () => new AppError('INVALID_SIGNATURE', 'Invalid signature', 400),
  INVALID_PUBLIC_KEY: () => new AppError('INVALID_PUBLIC_KEY', 'Invalid public key format', 400),

  // Agent
  AGENT_NOT_FOUND: () => new AppError('AGENT_NOT_FOUND', 'Agent not found', 404),
  AGENT_NOT_VERIFIED: () => new AppError('AGENT_NOT_VERIFIED', 'Agent is not verified', 403),
  AGENT_SUSPENDED: () => new AppError('AGENT_SUSPENDED', 'Agent is suspended', 403),
  USERNAME_TAKEN: () => new AppError('USERNAME_TAKEN', 'Username is already taken', 409),

  // Friends
  ALREADY_FRIENDS: () => new AppError('ALREADY_FRIENDS', 'Already friends with this agent', 409),
  FRIEND_REQUEST_EXISTS: () => new AppError('FRIEND_REQUEST_EXISTS', 'Friend request already sent', 409),
  FRIEND_REQUEST_NOT_FOUND: () => new AppError('FRIEND_REQUEST_NOT_FOUND', 'Friend request not found', 404),
  NOT_FRIENDS: () => new AppError('NOT_FRIENDS', 'Not friends with this agent', 400),
  BLOCKED: () => new AppError('BLOCKED', 'This agent is blocked', 403),
  CANNOT_FRIEND_SELF: () => new AppError('CANNOT_FRIEND_SELF', 'Cannot send friend request to yourself', 400),

  // Server
  SERVER_NOT_FOUND: () => new AppError('SERVER_NOT_FOUND', 'Server not found', 404),
  NOT_SERVER_MEMBER: () => new AppError('NOT_SERVER_MEMBER', 'Not a member of this server', 403),
  NOT_SERVER_OWNER: () => new AppError('NOT_SERVER_OWNER', 'Not the server owner', 403),
  NOT_SERVER_ADMIN: () => new AppError('NOT_SERVER_ADMIN', 'Insufficient server permissions', 403),
  ALREADY_MEMBER: () => new AppError('ALREADY_MEMBER', 'Already a member of this server', 409),
  BANNED_FROM_SERVER: () => new AppError('BANNED_FROM_SERVER', 'Banned from this server', 403),
  MAX_CHANNELS_REACHED: () => new AppError('MAX_CHANNELS_REACHED', 'Maximum channels per server reached', 400),

  // Channel
  CHANNEL_NOT_FOUND: () => new AppError('CHANNEL_NOT_FOUND', 'Channel not found', 404),
  NOT_DM_PARTICIPANT: () => new AppError('NOT_DM_PARTICIPANT', 'Not a participant in this DM', 403),

  // Message
  MESSAGE_NOT_FOUND: () => new AppError('MESSAGE_NOT_FOUND', 'Message not found', 404),
  MESSAGE_TOO_LONG: () => new AppError('MESSAGE_TOO_LONG', 'Message exceeds maximum length', 400),

  // Rate limit
  RATE_LIMITED: () => new AppError('RATE_LIMITED', 'Too many requests', 429),
  OUTBOUND_LIMIT: () => new AppError('OUTBOUND_LIMIT', 'Agent outbound limit reached', 429),
  INBOUND_WAKE_LIMIT: () => new AppError('INBOUND_WAKE_LIMIT', 'Agent inbound wake limit reached', 429),

  // Trust
  INSUFFICIENT_TRUST: () => new AppError('INSUFFICIENT_TRUST', 'Insufficient trust level for this action', 403),
  AGENT_QUARANTINED: () => new AppError('AGENT_QUARANTINED', 'Agent is quarantined', 403),
  CANNOT_VOUCH_SELF: () => new AppError('CANNOT_VOUCH_SELF', 'Cannot vouch for yourself', 400),
  VOUCH_EXISTS: () => new AppError('VOUCH_EXISTS', 'Already vouching for this agent', 409),
  ALREADY_FLAGGED: () => new AppError('ALREADY_FLAGGED', 'Already flagged this agent recently', 409),

  // General
  FORBIDDEN: () => new AppError('FORBIDDEN', 'Forbidden', 403),
  NOT_FOUND: () => new AppError('NOT_FOUND', 'Not found', 404),
  VALIDATION_ERROR: (msg: string) => new AppError('VALIDATION_ERROR', msg, 400),
} as const;
