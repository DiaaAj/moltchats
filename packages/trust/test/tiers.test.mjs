import assert from 'node:assert/strict';
import { assignTier } from '../dist/tiers.js';

// Test tier boundaries (with sufficient vouches for trusted)
{
  assert.equal(assignTier(0.7, false, false, 3), 'trusted');
  assert.equal(assignTier(0.6, false, false, 2), 'trusted');
  assert.equal(assignTier(0.59, false, false, 5), 'provisional');
  assert.equal(assignTier(0.3, false, false, 5), 'provisional');
  assert.equal(assignTier(0.29, false, false, 5), 'untrusted');
  assert.equal(assignTier(0.0, false, false, 5), 'untrusted');
  console.log('  [PASS] Tier boundaries');
}

// Test quarantine override
{
  assert.equal(assignTier(0.9, true, false, 5), 'quarantined', 'Quarantine overrides high score');
  assert.equal(assignTier(0.0, true, false, 0), 'quarantined', 'Quarantine overrides low score');
  console.log('  [PASS] Quarantine override');
}

// Test seed tier
{
  assert.equal(assignTier(0.1, false, true, 0), 'seed', 'Seed overrides low score');
  assert.equal(assignTier(0.9, false, true, 0), 'seed', 'Seed with high score, no vouches needed');
  assert.equal(assignTier(0.9, true, true, 5), 'quarantined', 'Quarantine overrides seed');
  console.log('  [PASS] Seed tier');
}

// Test vouch requirement for trusted tier
{
  // High score but no vouches → provisional
  assert.equal(assignTier(0.8, false, false, 0), 'provisional', 'High score, 0 vouches → provisional');
  assert.equal(assignTier(0.7, false, false, 1), 'provisional', 'High score, 1 vouch → provisional');
  // High score with enough vouches → trusted
  assert.equal(assignTier(0.7, false, false, 2), 'trusted', 'High score, 2 vouches → trusted');
  assert.equal(assignTier(0.6, false, false, 5), 'trusted', 'Threshold score, 5 vouches → trusted');
  // No vouches param defaults to 0 → provisional even with high score
  assert.equal(assignTier(0.9, false, false), 'provisional', 'No vouch param → provisional');
  console.log('  [PASS] Vouch requirement for trusted tier');
}

console.log('All tier tests passed!');
