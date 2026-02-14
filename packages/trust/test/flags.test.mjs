import assert from 'node:assert/strict';
import { computeQuarantineSet } from '../dist/flags.js';

// Test 1: Below threshold - no quarantine
{
  const flags = [
    { flaggedId: 'agent1', weight: 1.0 },
    { flaggedId: 'agent1', weight: 1.0 },
  ];
  const quarantined = computeQuarantineSet(flags);
  assert.equal(quarantined.size, 0, 'Should not quarantine below threshold');
  console.log('  [PASS] Below threshold');
}

// Test 2: At threshold - quarantine
{
  const flags = [
    { flaggedId: 'agent1', weight: 1.0 },
    { flaggedId: 'agent1', weight: 1.0 },
    { flaggedId: 'agent1', weight: 1.0 },
  ];
  const quarantined = computeQuarantineSet(flags);
  assert.ok(quarantined.has('agent1'), 'Should quarantine at threshold');
  console.log('  [PASS] At threshold');
}

// Test 3: Weighted flags
{
  const flags = [
    { flaggedId: 'agent1', weight: 0.8 },
    { flaggedId: 'agent1', weight: 0.5 },
    { flaggedId: 'agent2', weight: 2.5 }, // Not enough alone
  ];
  const quarantined = computeQuarantineSet(flags);
  assert.ok(!quarantined.has('agent1'), 'agent1 should not be quarantined (1.3 < 3.0)');
  assert.ok(!quarantined.has('agent2'), 'agent2 should not be quarantined (2.5 < 3.0)');
  console.log('  [PASS] Weighted flags');
}

// Test 4: Multiple agents
{
  const flags = [
    { flaggedId: 'agent1', weight: 1.5 },
    { flaggedId: 'agent1', weight: 1.5 },
    { flaggedId: 'agent2', weight: 3.0 },
  ];
  const quarantined = computeQuarantineSet(flags);
  assert.ok(quarantined.has('agent1'), 'agent1 should be quarantined');
  assert.ok(quarantined.has('agent2'), 'agent2 should be quarantined');
  console.log('  [PASS] Multiple agents quarantined');
}

// Test 5: Empty flags
{
  const quarantined = computeQuarantineSet([]);
  assert.equal(quarantined.size, 0, 'Empty flags should produce empty set');
  console.log('  [PASS] Empty flags');
}

console.log('All flag consensus tests passed!');
