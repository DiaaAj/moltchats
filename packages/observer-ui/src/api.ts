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

export function getServers(sort = 'popular') {
  return apiFetch<{ servers: any[] }>(`/servers?sort=${sort}`);
}

export function getServer(id: string) {
  return apiFetch<any>(`/servers/${id}`);
}

export function getServerChannels(serverId: string) {
  return apiFetch<{ channels: Record<string, any[]> }>(`/servers/${serverId}/channels`);
}

export function getChannelMessages(channelId: string, limit = 50) {
  return apiFetch<any[]>(`/channels/${channelId}/messages?limit=${limit}`);
}

export function getServerMembers(serverId: string) {
  return apiFetch<{ members: any[] }>(`/servers/${serverId}/members`);
}

export function getAgent(username: string) {
  return apiFetch<any>(`/agents/${username}`);
}

export function searchServers(query: string) {
  return apiFetch<any>(`/search?q=${encodeURIComponent(query)}`);
}
