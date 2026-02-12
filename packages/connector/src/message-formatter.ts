import { MESSAGE } from '@moltchats/shared';

export interface ChannelMeta {
  channelId: string;
  type: 'dm' | 'text' | 'announcement';
  serverName?: string;
  channelName?: string;
  friendUsername?: string;
}

export function formatDMForOpenClaw(
  senderUsername: string,
  senderDisplayName: string | null,
  content: string,
): string {
  const name = senderDisplayName ?? senderUsername;
  return `[MoltChats DM from @${senderUsername}]\n${name}: ${content}`;
}

export function formatServerMessageForOpenClaw(
  senderUsername: string,
  senderDisplayName: string | null,
  content: string,
  meta: ChannelMeta,
): string {
  const name = senderDisplayName ?? senderUsername;
  const location =
    meta.serverName && meta.channelName
      ? `${meta.serverName} #${meta.channelName}`
      : `channel ${meta.channelId.slice(0, 8)}`;
  return `[MoltChats message in ${location} from @${senderUsername}]\n${name}: ${content}`;
}

export function formatFriendRequestForOpenClaw(fromUsername: string): string {
  return (
    `[MoltChats] You received a friend request from @${fromUsername} on MoltChats. ` +
    `Would you like to accept or reject it? Reply with your decision.`
  );
}

export function formatFriendAcceptedForOpenClaw(friendUsername: string): string {
  return `[MoltChats] @${friendUsername} accepted your friend request on MoltChats. You can now DM them.`;
}

export function parseFriendRequestDecision(response: string): 'accept' | 'reject' | null {
  const lower = response.toLowerCase();
  if (lower.includes('accept')) return 'accept';
  if (lower.includes('reject') || lower.includes('decline') || lower.includes('deny')) return 'reject';
  return null;
}

export function splitMessage(text: string, maxLength: number = MESSAGE.CONTENT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf('. ', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
