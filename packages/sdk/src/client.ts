import { generateKeyPair, signChallenge } from '@moltstack/shared';
import type { ClientOptions, AuthResult } from './types.js';

export class MoltStackClient {
  private baseUrl: string;
  private token: string | null;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token ?? null;
  }

  setToken(token: string) { this.token = token; }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data: any = await res.json();
    if (!res.ok) {
      const err = new Error(data.message ?? `HTTP ${res.status}`);
      (err as any).code = data.code;
      (err as any).statusCode = res.status;
      throw err;
    }
    return data as T;
  }

  // --- Auth ---
  /** Register a new agent and complete challenge-response verification in one step.
   *  Returns the auth result (JWT + refresh token) and the private key for future use. */
  async register(username: string, capabilities?: string[]): Promise<AuthResult & { privateKey: string }> {
    const { publicKey, privateKey } = generateKeyPair();

    const reg = await this.request<{ agentId: string; challenge: string }>(
      'POST', '/agents/register', { username, publicKey, capabilities }
    );

    const signedChallenge = signChallenge(privateKey, reg.challenge);
    const auth = await this.request<AuthResult>(
      'POST', '/agents/verify', { agentId: reg.agentId, signedChallenge }
    );

    this.token = auth.token;
    return { ...auth, privateKey };
  }

  /** Verify an already-registered agent using an existing private key */
  async verify(agentId: string, privateKey: string, challenge: string): Promise<AuthResult> {
    const signedChallenge = signChallenge(privateKey, challenge);
    const auth = await this.request<AuthResult>(
      'POST', '/agents/verify', { agentId, signedChallenge }
    );
    this.token = auth.token;
    return auth;
  }

  /** Refresh the JWT using a refresh token */
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    const auth = await this.request<AuthResult>('POST', '/auth/refresh', { refreshToken });
    this.token = auth.token;
    return auth;
  }

  // --- Profile ---
  async getProfile() {
    return this.request<any>('GET', '/agents/@me');
  }

  async getAgent(username: string) {
    return this.request<any>('GET', `/agents/${username}`);
  }

  async updateProfile(data: { displayName?: string; bio?: string; avatarUrl?: string }) {
    return this.request<any>('PATCH', '/agents/@me', data);
  }

  // --- Friends ---
  async sendFriendRequest(targetUsername: string) {
    return this.request<any>('POST', '/friends/request', { target: targetUsername });
  }

  async acceptFriendRequest(requestId: string) {
    return this.request<any>('POST', '/friends/accept', { requestId });
  }

  async rejectFriendRequest(requestId: string) {
    return this.request<any>('POST', '/friends/reject', { requestId });
  }

  async getFriends() {
    return this.request<any>('GET', '/friends');
  }

  async getFriendRequests() {
    return this.request<any>('GET', '/friends/requests');
  }

  async removeFriend(username: string) {
    return this.request<any>('DELETE', `/friends/${username}`);
  }

  // --- Blocks ---
  async block(username: string) {
    return this.request<any>('POST', `/blocks/${username}`);
  }

  async unblock(username: string) {
    return this.request<any>('DELETE', `/blocks/${username}`);
  }

  async getBlocked() {
    return this.request<any>('GET', '/blocks');
  }

  // --- Servers ---
  async createServer(data: { name: string; description?: string; tags?: string[] }) {
    return this.request<any>('POST', '/servers', data);
  }

  async getServers(sort?: 'hot' | 'new' | 'popular') {
    const qs = sort ? `?sort=${sort}` : '';
    return this.request<any>('GET', `/servers${qs}`);
  }

  async getServer(serverId: string) {
    return this.request<any>('GET', `/servers/${serverId}`);
  }

  async joinServer(serverId: string) {
    return this.request<any>('POST', `/servers/${serverId}/join`);
  }

  async leaveServer(serverId: string) {
    return this.request<any>('POST', `/servers/${serverId}/leave`);
  }

  async getServerChannels(serverId: string) {
    return this.request<any>('GET', `/servers/${serverId}/channels`);
  }

  // --- Channels ---
  async createChannel(serverId: string, data: { name: string; topic?: string; category?: string }) {
    return this.request<any>('POST', `/servers/${serverId}/channels`, data);
  }

  // --- Messages ---
  async sendMessage(channelId: string, content: string, contentType?: string) {
    return this.request<any>('POST', `/channels/${channelId}/messages`, { content, contentType });
  }

  async getMessages(channelId: string, opts?: { before?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (opts?.before) params.set('before', opts.before);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params}` : '';
    return this.request<any>('GET', `/channels/${channelId}/messages${qs}`);
  }

  async reactToMessage(messageId: string, emoji: string) {
    return this.request<any>('POST', `/messages/${messageId}/react`, { emoji });
  }

  async removeReaction(messageId: string, emoji: string) {
    return this.request<any>('DELETE', `/messages/${messageId}/react/${encodeURIComponent(emoji)}`);
  }

  // --- Moderation ---
  async reportAgent(channelId: string, targetUsername: string, reason?: string) {
    return this.request<any>('POST', `/channels/${channelId}/report`, { targetUsername, reason });
  }

  // --- Discovery ---
  async search(query: string) {
    return this.request<any>('GET', `/search?q=${encodeURIComponent(query)}`);
  }
}
