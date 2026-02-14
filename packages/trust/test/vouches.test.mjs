import assert from 'node:assert/strict';
import { computeVouchPenalties, computeVouchRewards, countGoodVouches } from '../dist/vouches.js';

// ── computeVouchPenalties ────────────────────────────────────────────

// Test 1: Penalty for quarantined vouchee
{
  const vouches = [{ voucherId: 'a', voucheeId: 'b' }];
  const quarantined = new Set(['b']);
  const scores = new Map([['a', 0.8]]);
  const penalties = computeVouchPenalties(vouches, quarantined, scores);
  assert.ok(Math.abs(penalties.get('a') - 0.08) < 1e-9, 'Penalty = 10% of score');
  console.log('  [PASS] Penalty for quarantined vouchee');
}

// Test 2: No penalty for non-quarantined vouchee
{
  const vouches = [{ voucherId: 'a', voucheeId: 'b' }];
  const quarantined = new Set();
  const scores = new Map([['a', 0.8]]);
  const penalties = computeVouchPenalties(vouches, quarantined, scores);
  assert.equal(penalties.size, 0, 'No penalties when vouchee is fine');
  console.log('  [PASS] No penalty for non-quarantined vouchee');
}

// Test 3: Multiple quarantined vouchees stack penalties
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'b' },
    { voucherId: 'a', voucheeId: 'c' },
  ];
  const quarantined = new Set(['b', 'c']);
  const scores = new Map([['a', 1.0]]);
  const penalties = computeVouchPenalties(vouches, quarantined, scores);
  assert.ok(Math.abs(penalties.get('a') - 0.2) < 1e-9, 'Stacked penalty = 20%');
  console.log('  [PASS] Multiple quarantined vouchees stack penalties');
}

// ── computeVouchRewards ──────────────────────────────────────────────

// Test 4: Reward for good vouch
{
  const vouches = [{ voucherId: 'a', voucheeId: 'b' }];
  const quarantined = new Set();
  const scores = new Map([['a', 1.0]]);
  const rewards = computeVouchRewards(vouches, quarantined, scores);
  assert.ok(Math.abs(rewards.get('a') - 0.03) < 1e-9, 'Reward = 3% of score');
  console.log('  [PASS] Reward for good vouch');
}

// Test 5: No reward if vouchee is quarantined
{
  const vouches = [{ voucherId: 'a', voucheeId: 'b' }];
  const quarantined = new Set(['b']);
  const scores = new Map([['a', 1.0]]);
  const rewards = computeVouchRewards(vouches, quarantined, scores);
  assert.equal(rewards.size, 0, 'No reward for quarantined vouchee');
  console.log('  [PASS] No reward if vouchee is quarantined');
}

// Test 6: Multiple good vouches stack rewards
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'b' },
    { voucherId: 'a', voucheeId: 'c' },
    { voucherId: 'a', voucheeId: 'd' },
  ];
  const quarantined = new Set();
  const scores = new Map([['a', 1.0]]);
  const rewards = computeVouchRewards(vouches, quarantined, scores);
  assert.ok(Math.abs(rewards.get('a') - 0.09) < 1e-9, '3 vouches = 9% reward');
  console.log('  [PASS] Multiple good vouches stack rewards');
}

// Test 7: Rewards capped at MAX_VOUCH_REWARD (15%)
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'b' },
    { voucherId: 'a', voucheeId: 'c' },
    { voucherId: 'a', voucheeId: 'd' },
    { voucherId: 'a', voucheeId: 'e' },
    { voucherId: 'a', voucheeId: 'f' },
    { voucherId: 'a', voucheeId: 'g' }, // 6 vouches = 18%, capped at 15%
  ];
  const quarantined = new Set();
  const scores = new Map([['a', 1.0]]);
  const rewards = computeVouchRewards(vouches, quarantined, scores);
  assert.ok(Math.abs(rewards.get('a') - 0.15) < 1e-9, 'Capped at 15%');
  console.log('  [PASS] Rewards capped at MAX_VOUCH_REWARD');
}

// Test 8: Mixed — some quarantined, some not
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'b' }, // quarantined
    { voucherId: 'a', voucheeId: 'c' }, // good
    { voucherId: 'a', voucheeId: 'd' }, // good
  ];
  const quarantined = new Set(['b']);
  const scores = new Map([['a', 0.5]]);
  const rewards = computeVouchRewards(vouches, quarantined, scores);
  // 2 good vouches × 0.5 × 0.03 = 0.03
  assert.ok(Math.abs(rewards.get('a') - 0.03) < 1e-9, 'Only counts non-quarantined');
  console.log('  [PASS] Mixed vouches — only rewards non-quarantined');
}

// ── countGoodVouches ─────────────────────────────────────────────────

// Test 9: Counts only non-quarantined vouchees
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'b' },
    { voucherId: 'a', voucheeId: 'c' },
    { voucherId: 'a', voucheeId: 'd' },
  ];
  const quarantined = new Set(['c']);
  const counts = countGoodVouches(vouches, quarantined);
  assert.equal(counts.get('a'), 2, '2 good vouches out of 3');
  console.log('  [PASS] countGoodVouches counts only non-quarantined');
}

// Test 10: Empty vouches
{
  const counts = countGoodVouches([], new Set());
  assert.equal(counts.size, 0, 'Empty vouches → empty counts');
  console.log('  [PASS] countGoodVouches handles empty input');
}

// Test 11: Multiple vouchers
{
  const vouches = [
    { voucherId: 'a', voucheeId: 'x' },
    { voucherId: 'a', voucheeId: 'y' },
    { voucherId: 'b', voucheeId: 'x' },
  ];
  const quarantined = new Set();
  const counts = countGoodVouches(vouches, quarantined);
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
  console.log('  [PASS] countGoodVouches tracks per voucher');
}

console.log('All vouch tests passed!');
