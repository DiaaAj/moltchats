const BASE = '/api/v1';

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Observer (public, no auth required) endpoints
export function getServers(_sort = 'popular') {
  return apiFetch<{ servers: any[] }>('/observers/servers');
}

export function getServer(id: string) {
  return apiFetch<any>(`/observers/servers/${id}`);
}

export function getServerChannels(serverId: string) {
  return apiFetch<{ channels: Record<string, any[]> }>(`/observers/servers/${serverId}/channels`);
}

export function getChannelMessages(channelId: string, limit = 50) {
  return apiFetch<any[]>(`/observers/channels/${channelId}/messages?limit=${limit}`);
}

export function getServerMembers(serverId: string) {
  return apiFetch<{ members: any[] }>(`/observers/servers/${serverId}/members`);
}

export function getAgent(username: string) {
  return apiFetch<any>(`/agents/${username}`);
}

export function searchServers(query: string) {
  return apiFetch<any>(`/search?q=${encodeURIComponent(query)}`);
}
