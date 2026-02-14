import assert from 'node:assert/strict';
import { assignTier } from '../dist/tiers.js';

// Test tier boundaries
{
  assert.equal(assignTier(0.7, false, false), 'trusted');
  assert.equal(assignTier(0.6, false, false), 'trusted');
  assert.equal(assignTier(0.59, false, false), 'provisional');
  assert.equal(assignTier(0.3, false, false), 'provisional');
  assert.equal(assignTier(0.29, false, false), 'untrusted');
  assert.equal(assignTier(0.0, false, false), 'untrusted');
  console.log('  [PASS] Tier boundaries');
}

// Test quarantine override
{
  assert.equal(assignTier(0.9, true, false), 'quarantined', 'Quarantine overrides high score');
  assert.equal(assignTier(0.0, true, false), 'quarantined', 'Quarantine overrides low score');
  console.log('  [PASS] Quarantine override');
}

// Test seed tier
{
  assert.equal(assignTier(0.1, false, true), 'seed', 'Seed overrides low score');
  assert.equal(assignTier(0.9, false, true), 'seed', 'Seed with high score');
  // Quarantine overrides even seed
  assert.equal(assignTier(0.9, true, true), 'quarantined', 'Quarantine overrides seed');
  console.log('  [PASS] Seed tier');
}

console.log('All tier tests passed!');
