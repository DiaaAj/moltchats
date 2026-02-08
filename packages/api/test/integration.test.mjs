/**
 * Integration tests for MoltChats API.
 *
 * Prerequisites:
 *   - PostgreSQL and Redis running (docker compose up -d)
 *   - Database migrated (pnpm db:migrate or apply migration SQL)
 *   - API server running on PORT with JWT_SECRET set
 *
 * Usage:
 *   JWT_SECRET=test-secret PORT=4200 node --import tsx packages/api/src/index.ts &
 *   node --test packages/api/test/integration.test.mjs
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';

const BASE = process.env.API_URL || 'http://localhost:4200';
const API = `${BASE}/api/v1`;

async function json(method, path, body, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

function makeKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function sign(privateKey, challenge) {
  const s = createSign('SHA256');
  s.update(challenge);
  s.end();
  return s.sign(privateKey, 'base64');
}

async function registerAgent(username) {
  const { publicKey, privateKey } = makeKeyPair();
  const reg = await json('POST', '/agents/register', { username, publicKey });
  assert.equal(reg.status, 201, `Registration failed: ${JSON.stringify(reg.data)}`);
  const signature = sign(privateKey, reg.data.challenge);
  const ver = await json('POST', '/agents/verify', { agentId: reg.data.agentId, signedChallenge: signature });
  assert.equal(ver.status, 200, `Verification failed: ${JSON.stringify(ver.data)}`);
  return { id: reg.data.agentId, token: ver.data.token, refreshToken: ver.data.refreshToken, privateKey };
}

describe('MoltChats API Integration Tests', () => {
  let alice, bob;

  before(async () => {
    // Check health
    const health = await fetch(`${BASE}/health`);
    assert.equal(health.status, 200, 'API server not running');
  });

  describe('Auth', () => {
    it('should register and verify an agent', async () => {
      alice = await registerAgent(`int_alice_${Date.now()}`);
      assert.ok(alice.id, 'Should return agent ID');
      assert.ok(alice.token, 'Should return JWT token');
      assert.ok(alice.refreshToken, 'Should return refresh token');
    });

    it('should register a second agent', async () => {
      bob = await registerAgent(`int_bob_${Date.now()}`);
      assert.ok(bob.id);
    });

    it('should reject invalid credentials', async () => {
      const res = await json('GET', '/agents/@me', undefined, 'invalid-token');
      assert.equal(res.status, 401);
    });

    it('should refresh token and revoke old one', async () => {
      const oldToken = alice.token;
      const res = await json('POST', '/auth/refresh', { refreshToken: alice.refreshToken });
      assert.equal(res.status, 200);
      assert.ok(res.data.token);
      alice.token = res.data.token;
      alice.refreshToken = res.data.refreshToken;

      // Old token should be revoked
      const old = await json('GET', '/agents/@me', undefined, oldToken);
      assert.equal(old.status, 401);

      // New token should work
      const fresh = await json('GET', '/agents/@me', undefined, alice.token);
      assert.equal(fresh.status, 200);
    });
  });

  describe('Profiles', () => {
    it('should get own profile', async () => {
      const res = await json('GET', '/agents/@me', undefined, alice.token);
      assert.equal(res.status, 200);
      assert.ok(res.data.username.startsWith('int_alice_'));
    });

    it('should update profile', async () => {
      const res = await json('PATCH', '/agents/@me', {
        displayName: 'Alice Bot',
        bio: 'Integration test agent',
      }, alice.token);
      assert.equal(res.status, 200);
      assert.equal(res.data.displayName, 'Alice Bot');
    });
  });

  describe('Friends', () => {
    it('should send and accept friend request', async () => {
      const bobProfile = await json('GET', '/agents/@me', undefined, bob.token);
      const send = await json('POST', '/friends/request', { target: bobProfile.data.username }, alice.token);
      assert.equal(send.status, 201);

      const requests = await json('GET', '/friends/requests', undefined, bob.token);
      assert.equal(requests.status, 200);
      assert.ok(requests.data.incoming.length >= 1);

      const accept = await json('POST', '/friends/accept', {
        requestId: requests.data.incoming[0].id,
      }, bob.token);
      assert.equal(accept.status, 200);
      assert.ok(accept.data.dmChannelId, 'Should create DM channel');
    });

    it('should list friends', async () => {
      const res = await json('GET', '/friends', undefined, alice.token);
      assert.equal(res.status, 200);
      assert.ok(res.data.friends.length >= 1);
    });
  });

  describe('Servers & Channels', () => {
    let serverId, channelId;

    it('should create a server', async () => {
      const res = await json('POST', '/servers', {
        name: 'Int Test Server',
        description: 'Integration test server',
        tags: ['testing'],
      }, alice.token);
      assert.equal(res.status, 201);
      serverId = res.data.server.id;
      assert.ok(serverId);
    });

    it('should list public servers', async () => {
      const res = await json('GET', '/servers', undefined, alice.token);
      assert.equal(res.status, 200);
      assert.ok(res.data.servers.length >= 1);
    });

    it('should get server channels (auto-created #general)', async () => {
      const res = await json('GET', `/servers/${serverId}/channels`, undefined, alice.token);
      assert.equal(res.status, 200);
      const allChannels = Object.values(res.data.channels).flat();
      assert.ok(allChannels.length >= 1, 'Should have at least #general');
    });

    it('should create a channel', async () => {
      const res = await json('POST', `/servers/${serverId}/channels`, {
        name: 'test-channel',
        topic: 'Test channel',
        category: 'Tests',
      }, alice.token);
      assert.equal(res.status, 201);
      channelId = res.data.channel.id;
    });

    it('should allow bob to join', async () => {
      const res = await json('POST', `/servers/${serverId}/join`, {}, bob.token);
      assert.ok([200, 201].includes(res.status), `Expected 200 or 201, got ${res.status}`);
    });

    it('should send and retrieve messages', async () => {
      const msg = await json('POST', `/channels/${channelId}/messages`, {
        content: 'Hello from integration test!',
      }, alice.token);
      assert.equal(msg.status, 201);

      const history = await json('GET', `/channels/${channelId}/messages`, undefined, bob.token);
      assert.equal(history.status, 200);
      assert.ok(history.data.length >= 1);
      assert.equal(history.data[0].content, 'Hello from integration test!');
    });

    it('should react to messages and increment karma', async () => {
      const history = await json('GET', `/channels/${channelId}/messages`, undefined, bob.token);
      const messageId = history.data[0].id;

      const react = await json('POST', `/messages/${messageId}/react`, { emoji: '🤖' }, bob.token);
      assert.equal(react.status, 201);

      const aliceProfile = await json('GET', '/agents/@me', undefined, alice.token);
      assert.ok(aliceProfile.data.karma >= 1, 'Karma should be at least 1');
    });
  });

  describe('Blocks', () => {
    it('should block and unblock an agent', async () => {
      const bobProfile = await json('GET', '/agents/@me', undefined, bob.token);
      const block = await json('POST', `/blocks/${bobProfile.data.username}`, undefined, alice.token);
      assert.ok([200, 201].includes(block.status));

      const blocks = await json('GET', '/blocks', undefined, alice.token);
      assert.equal(blocks.status, 200);
      assert.ok(blocks.data.blocked.length >= 1);

      const unblock = await json('DELETE', `/blocks/${bobProfile.data.username}`, undefined, alice.token);
      assert.equal(unblock.status, 200);
    });
  });

  describe('Moderation', () => {
    it('should report an agent in a channel', async () => {
      // Get a channel from alice's server
      const servers = await json('GET', '/servers', undefined, alice.token);
      const testServer = servers.data.servers.find(s => s.name === 'Int Test Server');
      if (!testServer) return;

      const chs = await json('GET', `/servers/${testServer.id}/channels`, undefined, alice.token);
      const allChannels = Object.values(chs.data.channels).flat();
      if (allChannels.length === 0) return;

      const bobProfile = await json('GET', '/agents/@me', undefined, bob.token);
      const report = await json('POST', `/channels/${allChannels[0].id}/report`, {
        targetUsername: bobProfile.data.username,
        reason: 'Testing report system',
      }, alice.token);
      assert.equal(report.status, 201);
    });
  });
});
