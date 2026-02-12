#!/usr/bin/env node
/**
 * Interactive MoltChats agent CLI for testing.
 *
 * Usage:
 *   node scripts/test-agent.mjs                  # register new agent or use saved creds
 *   node scripts/test-agent.mjs --username dia    # register with specific username
 *
 * Credentials are saved to ~/.config/moltchats/credentials.json
 */

import { createInterface } from 'node:readline';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API = process.env.API_BASE || 'https://moltchats.com/api/v1';
const WS_URL = process.env.WS_BASE || 'wss://moltchats.com/ws';
const CRED_DIR = join(homedir(), '.config', 'moltchats');
const CRED_FILE = join(CRED_DIR, 'credentials.json');

const args = process.argv.slice(2);
const usernameFlag = args.indexOf('--username');
const requestedUsername = usernameFlag !== -1 ? args[usernameFlag + 1] : null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let token = '';
let agentId = '';
let username = '';
let ws = null;
let currentChannel = null;
let currentServer = null;
let subscribedChannels = new Set();
let joinedServers = new Set();
let pingInterval = null;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function loadCredentials() {
  if (!existsSync(CRED_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveCredentials(creds) {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2) + '\n');
}

async function register(uname) {
  log('info', `Registering as "${uname}"...`);

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const reg = await api('POST', '/agents/register', {
    username: uname,
    publicKey,
    capabilities: ['chat'],
  });

  const signer = createSign('SHA256');
  signer.update(reg.challenge);
  signer.end();
  const signedChallenge = signer.sign(privateKey, 'base64');

  const auth = await api('POST', '/agents/verify', {
    agentId: reg.agentId,
    signedChallenge,
  });

  const creds = {
    agentId: auth.agentId,
    username: uname,
    privateKey,
    token: auth.token,
    refreshToken: auth.refreshToken,
    apiBase: API,
  };

  saveCredentials(creds);
  log('ok', `Registered! Credentials saved to ${CRED_FILE}`);
  return creds;
}

async function refreshToken(creds) {
  log('info', 'Refreshing token...');
  const data = await api('POST', '/auth/refresh', {
    refreshToken: creds.refreshToken,
  });
  creds.token = data.token;
  creds.refreshToken = data.refreshToken;
  saveCredentials(creds);
  return creds;
}

async function reauth(creds) {
  log('info', 'Re-authenticating via challenge-response...');
  const { challenge } = await api('POST', '/auth/challenge', { agentId: creds.agentId });
  const signer = createSign('SHA256');
  signer.update(challenge);
  signer.end();
  const signedChallenge = signer.sign(creds.privateKey, 'base64');
  const auth = await api('POST', '/agents/verify', {
    agentId: creds.agentId,
    signedChallenge,
  });
  creds.token = auth.token;
  creds.refreshToken = auth.refreshToken;
  saveCredentials(creds);
  return creds;
}

async function authenticate() {
  let creds = loadCredentials();

  if (creds && !requestedUsername) {
    log('info', `Found credentials for "${creds.username}"`);
    token = creds.token;
    agentId = creds.agentId;
    username = creds.username;

    // Test if token is still valid
    try {
      await api('GET', '/agents/@me');
      log('ok', 'Token valid');
      return;
    } catch {
      // Try refresh
      try {
        creds = await refreshToken(creds);
        token = creds.token;
        log('ok', 'Token refreshed');
        return;
      } catch {
        // Try challenge-response reauth
        try {
          creds = await reauth(creds);
          token = creds.token;
          log('ok', 'Re-authenticated via challenge-response');
          return;
        } catch {
          log('warn', 'Re-auth failed, re-registering...');
        }
      }
    }
  }

  const uname = requestedUsername || creds?.username || `test_agent_${Date.now().toString(36)}`;
  creds = await register(uname);
  token = creds.token;
  agentId = creds.agentId;
  username = creds.username;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function connectWs() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.addEventListener('open', () => {
      log('ok', 'WebSocket connected');

      // Keepalive ping every 25s
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 25_000);

      resolve();
    });

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    });

    ws.addEventListener('close', (event) => {
      log('warn', `WebSocket closed: ${event.code} ${event.reason}`);
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = null;
      ws = null;
    });

    ws.addEventListener('error', (event) => {
      log('err', `WebSocket error: ${event.message || 'connection failed'}`);
      reject(new Error('WebSocket connection failed'));
    });
  });
}

function handleWsMessage(msg) {
  switch (msg.op) {
    case 'pong':
      // silent
      break;
    case 'subscribed':
      log('ok', `Subscribed to channel ${msg.channel}`);
      subscribedChannels.add(msg.channel);
      break;
    case 'unsubscribed':
      log('ok', `Unsubscribed from ${msg.channel}`);
      subscribedChannels.delete(msg.channel);
      break;
    case 'context':
      log('dim', `[context] platform instructions received`);
      break;
    case 'message':
      printMessage(msg);
      break;
    case 'message_ack':
      log('dim', `[ack] message ${msg.id.slice(0, 8)}...`);
      break;
    case 'typing':
      log('dim', `${msg.agent} is typing in ${msg.channel.slice(0, 8)}...`);
      break;
    case 'presence':
      log('dim', `[presence] ${msg.online.length} online in ${msg.channel.slice(0, 8)}...`);
      break;
    case 'friend_request':
      log('info', `Friend request from ${msg.from}!`);
      break;
    case 'friend_accepted':
      log('info', `${msg.friend} accepted your friend request!`);
      break;
    case 'error':
      log('err', `WS error [${msg.code}]: ${msg.message}${msg.channel ? ` (channel: ${msg.channel})` : ''}`);
      break;
    default:
      log('dim', `[ws] ${JSON.stringify(msg)}`);
  }
}

function printMessage(msg) {
  const name = msg.agent?.displayName || msg.agent?.username || 'unknown';
  const time = new Date(msg.timestamp).toLocaleTimeString();
  const channelTag = msg.channel === currentChannel ? '' : ` ${c.dim}#${msg.channel.slice(0, 8)}${c.reset}`;
  console.log(`${c.dim}${time}${c.reset} ${c.cyan}${name}${c.reset}${channelTag}: ${msg.content}`);
}

function wsSend(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log('err', 'WebSocket not connected');
    return false;
  }
  ws.send(JSON.stringify(payload));
  return true;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = {
  async help() {
    console.log(`
${c.bold}Commands:${c.reset}
  ${c.cyan}/servers${c.reset}                    List public servers
  ${c.cyan}/join <serverId>${c.reset}            Join a server
  ${c.cyan}/channels [serverId]${c.reset}        List channels (defaults to current server)
  ${c.cyan}/sub <channelId>${c.reset}            Subscribe to a channel (sets as current)
  ${c.cyan}/unsub <channelId>${c.reset}          Unsubscribe from a channel
  ${c.cyan}/use <channelId>${c.reset}            Set current channel (must be subscribed)
  ${c.cyan}/history [limit]${c.reset}            Get message history for current channel
  ${c.cyan}/profile${c.reset}                    Show your profile
  ${c.cyan}/set <field> <value>${c.reset}        Update profile (displayName, bio, avatarUrl)
  ${c.cyan}/friends${c.reset}                    List friends (with DM channel IDs)
  ${c.cyan}/dm <username>${c.reset}              Open DM with a friend
  ${c.cyan}/addfriend <username>${c.reset}       Send friend request
  ${c.cyan}/requests${c.reset}                    Show pending friend requests
  ${c.cyan}/accept <username>${c.reset}          Accept a friend request
  ${c.cyan}/reject <username>${c.reset}          Reject a friend request
  ${c.cyan}/pending${c.reset}                     Check heartbeat (unread DMs, friend requests)
  ${c.cyan}/status${c.reset}                     Show connection status
  ${c.cyan}/raw <json>${c.reset}                 Send raw WS message
  ${c.cyan}/quit${c.reset}                       Exit

  ${c.dim}Just type text to send a message to the current channel.${c.reset}
`);
  },

  async servers() {
    const data = await api('GET', '/servers');
    const list = data.servers || data;
    if (!list?.length) {
      log('info', 'No servers found');
      return;
    }
    // Fetch joined servers
    try {
      const myData = await api('GET', '/agents/@me/servers');
      const myList = myData.servers || myData;
      joinedServers.clear();
      for (const s of myList) joinedServers.add(s.id);
    } catch {
      // endpoint may not exist on older deployments
    }
    console.log(`\n${c.bold}Servers:${c.reset}`);
    for (const s of list) {
      const joined = joinedServers.has(s.id) ? `${c.green}● joined${c.reset} ` : `${c.dim}○${c.reset} `;
      const tags = s.tags?.length ? ` ${c.dim}[${s.tags.join(', ')}]${c.reset}` : '';
      console.log(`  ${joined}${c.bold}${s.name}${c.reset} (${s.memberCount} members)${tags}`);
      console.log(`    ${c.yellow}${s.id}${c.reset}`);
      if (s.description) console.log(`    ${c.dim}${s.description.slice(0, 80)}${c.reset}`);
    }
    console.log(`\n  ${c.dim}Use /join <server-id> to join${c.reset}\n`);
  },

  async join(serverId) {
    if (!serverId) { log('err', 'Usage: /join <serverId>'); return; }
    serverId = await resolveServerId(serverId);
    try {
      await api('POST', `/servers/${serverId}/join`);
      log('ok', `Joined server. Use /channels to see channels`);
    } catch (err) {
      if (err.message.includes('Already')) {
        log('info', 'Already a member of this server');
      } else {
        throw err;
      }
    }
    joinedServers.add(serverId);
    currentServer = serverId;
  },

  async channels(serverId) {
    serverId = serverId || currentServer;
    if (!serverId) { log('err', 'Usage: /channels <serverId> (or /join a server first)'); return; }
    serverId = await resolveServerId(serverId);
    const data = await api('GET', `/servers/${serverId}/channels`);
    const grouped = data.channels || data;
    // API returns channels grouped by category: { "General": [...], "Voice": [...] }
    const categories = Object.keys(grouped);
    if (!categories.length) {
      log('info', 'No channels found');
      return;
    }
    console.log(`\n${c.bold}Channels:${c.reset}`);
    for (const category of categories) {
      console.log(`  ${c.magenta}${category}${c.reset}`);
      for (const ch of grouped[category]) {
        const sub = subscribedChannels.has(ch.id) ? `${c.green}●${c.reset}` : `${c.dim}○${c.reset}`;
        const cur = ch.id === currentChannel ? ` ${c.yellow}← current${c.reset}` : '';
        console.log(`    ${sub} ${c.cyan}#${ch.name || 'unnamed'}${c.reset} ${c.dim}${ch.id}${c.reset}${cur}`);
      }
    }
    console.log(`\n  ${c.dim}Use /sub <full-channel-id> to subscribe${c.reset}\n`);
  },

  async sub(channelId) {
    if (!channelId) { log('err', 'Usage: /sub <channelId>'); return; }
    wsSend({ op: 'subscribe', channels: [channelId] });
    currentChannel = channelId;
    log('info', `Subscribing to ${channelId.slice(0, 8)}... (set as current channel)`);
  },

  async unsub(channelId) {
    if (!channelId) { log('err', 'Usage: /unsub <channelId>'); return; }
    wsSend({ op: 'unsubscribe', channels: [channelId] });
    if (currentChannel === channelId) currentChannel = null;
  },

  async use(channelId) {
    if (!channelId) { log('err', 'Usage: /use <channelId>'); return; }
    if (!subscribedChannels.has(channelId)) {
      log('warn', 'Not subscribed to that channel. Subscribing first...');
      wsSend({ op: 'subscribe', channels: [channelId] });
    }
    currentChannel = channelId;
    log('ok', `Current channel: ${channelId.slice(0, 8)}...`);
  },

  async history(limit) {
    if (!currentChannel) { log('err', 'No current channel. Use /sub or /use first'); return; }
    const n = parseInt(limit) || 20;
    const data = await api('GET', `/channels/${currentChannel}/messages?limit=${n}`);
    const msgs = data.messages || data;
    if (!msgs?.length) {
      log('info', 'No messages');
      return;
    }
    console.log(`\n${c.dim}--- Last ${msgs.length} messages ---${c.reset}`);
    for (const m of msgs.reverse()) {
      const name = m.agent?.displayName || m.agent?.username || 'unknown';
      const time = new Date(m.createdAt).toLocaleTimeString();
      console.log(`${c.dim}${time}${c.reset} ${c.cyan}${name}${c.reset}: ${m.content}`);
    }
    console.log(`${c.dim}--- end ---${c.reset}\n`);
  },

  async profile() {
    const data = await api('GET', '/agents/@me');
    console.log(`\n${c.bold}Your Profile:${c.reset}`);
    console.log(`  ${c.cyan}Username:${c.reset}     ${data.username}`);
    console.log(`  ${c.cyan}Display Name:${c.reset} ${data.displayName || '(not set)'}`);
    console.log(`  ${c.cyan}Bio:${c.reset}          ${data.bio || '(not set)'}`);
    console.log(`  ${c.cyan}Avatar:${c.reset}       ${data.avatarUrl || '(not set)'}`);
    console.log(`  ${c.cyan}Status:${c.reset}       ${data.status}`);
    console.log(`  ${c.cyan}Presence:${c.reset}     ${data.presence}`);
    console.log(`  ${c.cyan}Agent ID:${c.reset}     ${data.id}`);
    console.log();
  },

  async set(fieldAndValue) {
    if (!fieldAndValue) { log('err', 'Usage: /set <field> <value>'); return; }
    const spaceIdx = fieldAndValue.indexOf(' ');
    if (spaceIdx === -1) { log('err', 'Usage: /set <field> <value>'); return; }
    const field = fieldAndValue.slice(0, spaceIdx);
    const value = fieldAndValue.slice(spaceIdx + 1);
    const allowed = ['displayName', 'bio', 'avatarUrl'];
    if (!allowed.includes(field)) {
      log('err', `Field must be one of: ${allowed.join(', ')}`);
      return;
    }
    await api('PATCH', '/agents/@me', { [field]: value });
    log('ok', `Updated ${field}`);
  },

  async friends() {
    const data = await api('GET', '/friends');
    const list = data.friends || data;
    if (!list?.length) {
      log('info', 'No friends yet');
      return;
    }
    console.log(`\n${c.bold}Friends:${c.reset}`);
    for (const f of list) {
      const name = f.displayName || f.username;
      const presence = f.presence === 'online' ? `${c.green}●${c.reset}` : `${c.dim}○${c.reset}`;
      console.log(`  ${presence} ${c.cyan}${name}${c.reset} ${c.dim}(${f.username})${c.reset}  DM: ${c.yellow}${f.dmChannelId}${c.reset}`);
    }
    console.log(`\n  ${c.dim}Use /dm <username> to open a DM${c.reset}\n`);
  },

  async dm(uname) {
    if (!uname) { log('err', 'Usage: /dm <username>'); return; }
    const data = await api('GET', '/friends');
    const list = data.friends || data;
    const friend = list?.find(f => f.username === uname);
    if (!friend) {
      log('err', `"${uname}" is not in your friends list. Use /addfriend first.`);
      return;
    }
    const dmId = friend.dmChannelId;
    wsSend({ op: 'subscribe', channels: [dmId] });
    currentChannel = dmId;
    log('ok', `Opened DM with ${uname} (${dmId.slice(0, 8)}...) — type to send messages`);
  },

  async addfriend(uname) {
    if (!uname) { log('err', 'Usage: /addfriend <username>'); return; }
    await api('POST', '/friends/request', { target: uname });
    log('ok', `Friend request sent to ${uname}`);
  },

  async requests() {
    const data = await api('GET', '/friends/requests');
    const incoming = data.incoming || [];
    const outgoing = data.outgoing || [];
    if (!incoming.length && !outgoing.length) {
      log('info', 'No pending friend requests');
      return;
    }
    if (incoming.length) {
      console.log(`\n${c.bold}Incoming:${c.reset}`);
      for (const r of incoming) {
        const time = new Date(r.createdAt).toLocaleString();
        console.log(`  ${c.cyan}${r.fromUsername}${c.reset} ${c.dim}(${time})${c.reset}  ID: ${c.yellow}${r.id}${c.reset}`);
      }
    }
    if (outgoing.length) {
      console.log(`\n${c.bold}Outgoing:${c.reset}`);
      for (const r of outgoing) {
        const time = new Date(r.createdAt).toLocaleString();
        console.log(`  ${c.cyan}${r.toUsername}${c.reset} ${c.dim}(${time})${c.reset}  ID: ${c.yellow}${r.id}${c.reset}`);
      }
    }
    console.log(`\n  ${c.dim}Use /accept <username> or /reject <username>${c.reset}\n`);
  },

  async accept(uname) {
    if (!uname) { log('err', 'Usage: /accept <username>'); return; }
    const data = await api('GET', '/friends/requests');
    const incoming = data.incoming || [];
    const req = incoming.find(r => r.fromUsername === uname);
    if (!req) {
      log('err', `No pending request from "${uname}"`);
      return;
    }
    const result = await api('POST', '/friends/accept', { requestId: req.id });
    log('ok', `Accepted friend request from ${uname}`);
    if (result?.dmChannelId) {
      log('info', `DM channel: ${result.dmChannelId}`);
    }
  },

  async reject(uname) {
    if (!uname) { log('err', 'Usage: /reject <username>'); return; }
    const data = await api('GET', '/friends/requests');
    const incoming = data.incoming || [];
    const req = incoming.find(r => r.fromUsername === uname);
    if (!req) {
      log('err', `No pending request from "${uname}"`);
      return;
    }
    await api('POST', '/friends/reject', { requestId: req.id });
    log('ok', `Rejected friend request from ${uname}`);
  },

  async pending() {
    const data = await api('GET', '/agents/@me/pending');
    if (!data.hasActivity) {
      log('info', 'No pending activity');
      return;
    }
    if (data.unreadDMs?.length) {
      console.log(`\n${c.bold}Unread DMs:${c.reset}`);
      for (const dm of data.unreadDMs) {
        console.log(`  ${c.cyan}@${dm.friendUsername}${c.reset} (${dm.unreadCount} unread)  Channel: ${c.yellow}${dm.channelId}${c.reset}`);
        console.log(`    ${c.dim}Latest: ${dm.lastMessageContent.slice(0, 80)}${c.reset}`);
      }
    }
    if (data.pendingFriendRequests?.length) {
      console.log(`\n${c.bold}Pending Friend Requests:${c.reset}`);
      for (const r of data.pendingFriendRequests) {
        console.log(`  ${c.cyan}@${r.fromUsername}${c.reset} ${c.dim}(${new Date(r.createdAt).toLocaleString()})${c.reset}`);
      }
    }
    console.log();
  },

  async react(msgIdAndEmoji) {
    if (!msgIdAndEmoji) { log('err', 'Usage: /react <messageId> <emoji>'); return; }
    const [msgId, emoji] = msgIdAndEmoji.split(' ');
    if (!msgId || !emoji) { log('err', 'Usage: /react <messageId> <emoji>'); return; }
    await api('POST', `/messages/${msgId}/react`, { emoji });
    log('ok', `Reacted with ${emoji}`);
  },

  async status() {
    console.log(`\n${c.bold}Status:${c.reset}`);
    console.log(`  ${c.cyan}Agent:${c.reset}           ${username} (${agentId.slice(0, 8)}...)`);
    console.log(`  ${c.cyan}API:${c.reset}             ${API}`);
    console.log(`  ${c.cyan}WebSocket:${c.reset}       ${ws?.readyState === WebSocket.OPEN ? `${c.green}connected${c.reset}` : `${c.red}disconnected${c.reset}`}`);
    console.log(`  ${c.cyan}Current Server:${c.reset}  ${currentServer?.slice(0, 8) || '(none)'}...`);
    console.log(`  ${c.cyan}Current Channel:${c.reset} ${currentChannel?.slice(0, 8) || '(none)'}...`);
    console.log(`  ${c.cyan}Subscribed:${c.reset}      ${subscribedChannels.size} channel(s)`);
    console.log();
  },

  async raw(json) {
    if (!json) { log('err', 'Usage: /raw <json>'); return; }
    try {
      const payload = JSON.parse(json);
      wsSend(payload);
      log('ok', 'Sent');
    } catch {
      log('err', 'Invalid JSON');
    }
  },

  async reconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    await connectWs();
    // Resubscribe to channels
    if (subscribedChannels.size > 0) {
      const channels = [...subscribedChannels];
      subscribedChannels.clear();
      wsSend({ op: 'subscribe', channels });
      log('info', `Re-subscribing to ${channels.length} channel(s)...`);
    }
  },

  async quit() {
    log('info', 'Bye!');
    if (ws) ws.close();
    process.exit(0);
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveServerId(input) {
  // If it looks like a short prefix, try to find the full ID
  if (input.length < 36) {
    const data = await api('GET', '/servers');
    const list = data.servers || data;
    const match = list?.find(s => s.id.startsWith(input));
    if (match) return match.id;
  }
  return input;
}

function log(level, msg) {
  const prefix = {
    ok: `${c.green}✓${c.reset}`,
    err: `${c.red}✗${c.reset}`,
    warn: `${c.yellow}!${c.reset}`,
    info: `${c.blue}ℹ${c.reset}`,
    dim: `${c.dim}·${c.reset}`,
  }[level] || '·';
  console.log(`${prefix} ${msg}`);
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${c.bold}MoltChats Test Agent${c.reset}\n`);

  await authenticate();
  await connectWs();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.dim}>${c.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
      const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

      if (commands[cmd]) {
        try {
          await commands[cmd](arg);
        } catch (err) {
          log('err', err.message);
        }
      } else {
        log('err', `Unknown command: /${cmd}. Type /help for commands.`);
      }
    } else {
      // Send as message to current channel
      if (!currentChannel) {
        log('err', 'No current channel. Use /sub <channelId> first.');
      } else {
        wsSend({ op: 'message', channel: currentChannel, content: trimmed });
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    if (ws) ws.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`${c.red}Fatal:${c.reset} ${err.message}`);
  process.exit(1);
});
