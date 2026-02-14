import assert from 'node:assert/strict';
import { buildTrustMatrix, computeEigenTrust } from '../dist/eigentrust.js';

// Helper: create interactions
function interaction(from, to, weight = 1.0) {
  return { fromAgentId: from, toAgentId: to, weight };
}

// Test 1: Convergence with simple network
{
  const agents = ['a', 'b', 'c'];
  const interactions = [
    interaction('a', 'b', 1),
    interaction('b', 'c', 1),
    interaction('c', 'a', 1),
  ];
  const matrix = buildTrustMatrix(agents, interactions);
  const scores = computeEigenTrust(matrix, [0]); // 'a' is seed

  assert.equal(scores.length, 3);
  // All should have positive scores
  for (const s of scores) {
    assert.ok(s > 0, `Score ${s} should be positive`);
    assert.ok(s <= 1.0, `Score ${s} should be <= 1.0`);
  }
  // Seed should have highest score (or equal due to symmetric network)
  console.log('  [PASS] Convergence with simple network');
}

// Test 2: Seed anchoring
{
  const agents = ['seed1', 'trusted1', 'isolated1'];
  const interactions = [
    interaction('seed1', 'trusted1', 1),
    interaction('trusted1', 'seed1', 1),
    // isolated1 has no interactions
  ];
  const matrix = buildTrustMatrix(agents, interactions);
  const scores = computeEigenTrust(matrix, [0]); // seed1 is seed

  // seed1 and trusted1 should have higher scores than isolated1
  const seedIdx = 0;
  const trustedIdx = 1;
  const isolatedIdx = 2;

  assert.ok(scores[seedIdx] > scores[isolatedIdx], 'Seed should score higher than isolated');
  assert.ok(scores[trustedIdx] > scores[isolatedIdx], 'Trusted should score higher than isolated');
  console.log('  [PASS] Seed anchoring');
}

// Test 3: Sybil resistance
{
  const agents = ['seed', 'honest', 'sybil1', 'sybil2', 'sybil3'];
  const interactions = [
    interaction('seed', 'honest', 1),
    interaction('honest', 'seed', 1),
    // Sybils only interact with each other
    interaction('sybil1', 'sybil2', 1),
    interaction('sybil2', 'sybil3', 1),
    interaction('sybil3', 'sybil1', 1),
  ];
  const matrix = buildTrustMatrix(agents, interactions);
  const scores = computeEigenTrust(matrix, [0]); // seed is seed

  // Sybils should have lower trust than honest
  assert.ok(scores[1] > scores[2], 'Honest should score higher than sybil1');
  assert.ok(scores[1] > scores[3], 'Honest should score higher than sybil2');
  assert.ok(scores[1] > scores[4], 'Honest should score higher than sybil3');
  console.log('  [PASS] Sybil resistance');
}

// Test 4: Negative weights are clamped to 0
{
  const agents = ['a', 'b'];
  const interactions = [
    interaction('a', 'b', -5),
  ];
  const matrix = buildTrustMatrix(agents, interactions);

  // Negative entries should be clamped to 0
  assert.equal(matrix.matrix[0][1], 0.5, 'Negative weight should be clamped, row normalized uniformly');
  console.log('  [PASS] Negative weight clamping');
}

// Test 5: Empty network
{
  const scores = computeEigenTrust({ agentIds: [], matrix: [] }, []);
  assert.equal(scores.length, 0);
  console.log('  [PASS] Empty network');
}

console.log('All EigenTrust tests passed!');
