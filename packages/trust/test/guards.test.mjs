import assert from 'node:assert/strict';
import {
  meetsMinTier,
  canCreateServer,
  canJoinServer,
  canSendFriendRequest,
  canSendMessage,
  canVouch,
} from '../dist/guards.js';

function ctx(tier) {
  return { tier, eigentrustScore: 0.5, isSeed: false };
}

// meetsMinTier
{
  assert.ok(meetsMinTier('seed', 'trusted'));
  assert.ok(meetsMinTier('trusted', 'trusted'));
  assert.ok(!meetsMinTier('provisional', 'trusted'));
  assert.ok(meetsMinTier('provisional', 'provisional'));
  assert.ok(!meetsMinTier('quarantined', 'untrusted'));
  console.log('  [PASS] meetsMinTier');
}

// canCreateServer
{
  assert.ok(canCreateServer(ctx('seed')));
  assert.ok(canCreateServer(ctx('trusted')));
  assert.ok(canCreateServer(ctx('provisional')));
  assert.ok(!canCreateServer(ctx('untrusted')));
  assert.ok(!canCreateServer(ctx('quarantined')));
  console.log('  [PASS] canCreateServer');
}

// canJoinServer
{
  assert.ok(canJoinServer(ctx('seed')));
  assert.ok(canJoinServer(ctx('trusted')));
  assert.ok(canJoinServer(ctx('provisional')));
  assert.ok(canJoinServer(ctx('untrusted')));
  assert.ok(!canJoinServer(ctx('quarantined')));
  console.log('  [PASS] canJoinServer');
}

// canSendFriendRequest
{
  assert.ok(canSendFriendRequest(ctx('seed')));
  assert.ok(canSendFriendRequest(ctx('trusted')));
  assert.ok(canSendFriendRequest(ctx('provisional')));
  assert.ok(canSendFriendRequest(ctx('untrusted')));
  assert.ok(!canSendFriendRequest(ctx('quarantined')));
  console.log('  [PASS] canSendFriendRequest');
}

// canSendMessage
{
  assert.ok(canSendMessage(ctx('seed')));
  assert.ok(canSendMessage(ctx('trusted')));
  assert.ok(canSendMessage(ctx('provisional')));
  assert.ok(canSendMessage(ctx('untrusted')));
  assert.ok(!canSendMessage(ctx('quarantined')));
  console.log('  [PASS] canSendMessage');
}

// canVouch
{
  assert.ok(canVouch(ctx('seed')));
  assert.ok(canVouch(ctx('trusted')));
  assert.ok(canVouch(ctx('provisional')));
  assert.ok(!canVouch(ctx('untrusted')));
  assert.ok(!canVouch(ctx('quarantined')));
  console.log('  [PASS] canVouch');
}

console.log('All guard tests passed!');
