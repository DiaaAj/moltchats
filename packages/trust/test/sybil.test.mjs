import assert from 'node:assert/strict';
import { detectSybilClusters } from '../dist/sybil.js';

// Test 1: Single component — largest cluster is exempt from penalty
{
  const agents = ['a', 'b', 'c', 'd'];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'd', to: 'a' },
  ];
  const penalties = detectSybilClusters(agents, edges);
  // Only one component — it's the largest, so it's exempt
  for (const agent of agents) {
    assert.equal(penalties.get(agent) ?? 0, 0, `${agent} should not be penalized (largest cluster)`);
  }
  console.log('  [PASS] Single cluster (largest) exempt from penalty');
}

// Test 2: Two equal clusters — largest is exempt, smaller is penalized
{
  const agents = ['honest1', 'honest2', 'honest3', 'honest4', 'sybil1', 'sybil2', 'sybil3'];
  const edges = [
    // Honest cluster (larger — 4 nodes)
    { from: 'honest1', to: 'honest2' },
    { from: 'honest2', to: 'honest3' },
    { from: 'honest3', to: 'honest4' },
    { from: 'honest4', to: 'honest1' },
    // Sybil cluster (smaller — 3 nodes)
    { from: 'sybil1', to: 'sybil2' },
    { from: 'sybil2', to: 'sybil3' },
    { from: 'sybil3', to: 'sybil1' },
  ];
  const penalties = detectSybilClusters(agents, edges);

  // Honest cluster (largest) is exempt
  for (const agent of ['honest1', 'honest2', 'honest3', 'honest4']) {
    assert.equal(penalties.get(agent) ?? 0, 0, `${agent} should not be penalized (largest cluster)`);
  }
  // Sybil cluster is penalized (smaller, fully isolated)
  for (const agent of ['sybil1', 'sybil2', 'sybil3']) {
    const p = penalties.get(agent) ?? 0;
    assert.ok(p > 0, `${agent} should have penalty (isolated smaller cluster)`);
  }
  console.log('  [PASS] Smaller isolated cluster penalized, largest exempt');
}

// Test 3: Singletons are not penalized
{
  const agents = ['lone'];
  const edges = [];
  const penalties = detectSybilClusters(agents, edges);
  assert.equal(penalties.get('lone') ?? 0, 0, 'Singleton should not be penalized');
  console.log('  [PASS] Singletons not penalized');
}

// Test 4: Bridged clusters form single component — no penalty
{
  const agents = ['a', 'b', 'c', 'd', 'e', 'f'];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
    { from: 'd', to: 'e' },
    { from: 'e', to: 'f' },
    { from: 'f', to: 'd' },
    // Bridge edges
    { from: 'a', to: 'd' },
    { from: 'b', to: 'e' },
    { from: 'c', to: 'f' },
  ];
  const penalties = detectSybilClusters(agents, edges);
  // All agents form a single component (the largest), no penalties
  for (const agent of agents) {
    assert.equal(penalties.get(agent) ?? 0, 0, `${agent} should not be penalized`);
  }
  console.log('  [PASS] Bridged clusters form single component — no penalty');
}

// Test 5: Empty graph
{
  const penalties = detectSybilClusters([], []);
  assert.equal(penalties.size, 0, 'Empty graph should have no penalties');
  console.log('  [PASS] Empty graph');
}

// Test 6: Seed-anchored cluster is exempt even if not largest
{
  const agents = ['seed1', 'a', 'b', 'c', 'd', 'e'];
  const edges = [
    // Seed cluster (smaller — 2 nodes)
    { from: 'seed1', to: 'a' },
    // Large non-seed cluster (4 nodes)
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'd', to: 'e' },
    { from: 'e', to: 'b' },
  ];
  const seedAgentIds = new Set(['seed1']);
  const penalties = detectSybilClusters(agents, edges, seedAgentIds);
  // Seed cluster exempt (has seed), large cluster exempt (largest)
  for (const agent of agents) {
    assert.equal(penalties.get(agent) ?? 0, 0, `${agent} should not be penalized`);
  }
  console.log('  [PASS] Seed-anchored cluster exempt from penalty');
}

// Test 7: Multiple small clusters — only non-seed, non-largest penalized
{
  const agents = ['seed1', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const edges = [
    // Main cluster (largest — 4 nodes)
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'd', to: 'a' },
    // Seed cluster (2 nodes, seed-anchored)
    { from: 'seed1', to: 'e' },
    // Sybil cluster 1 (2 nodes, isolated)
    { from: 'f', to: 'g' },
    // Sybil cluster 2 (2 nodes, isolated)
    { from: 'h', to: 'i' },
  ];
  const seedAgentIds = new Set(['seed1']);
  const penalties = detectSybilClusters(agents, edges, seedAgentIds);

  // Main cluster: exempt (largest)
  for (const agent of ['a', 'b', 'c', 'd']) {
    assert.equal(penalties.get(agent) ?? 0, 0, `${agent} exempt (largest)`);
  }
  // Seed cluster: exempt (has seed)
  assert.equal(penalties.get('seed1') ?? 0, 0, 'seed1 exempt (seed)');
  assert.equal(penalties.get('e') ?? 0, 0, 'e exempt (seed cluster)');
  // Sybil clusters: penalized
  for (const agent of ['f', 'g', 'h', 'i']) {
    const p = penalties.get(agent) ?? 0;
    assert.ok(p > 0, `${agent} should be penalized (isolated non-seed cluster)`);
  }
  console.log('  [PASS] Only non-seed, non-largest clusters penalized');
}

// Test 8: Penalty proportional to isolation
{
  // Three components: large main (5), small isolated (2)
  const agents = ['a', 'b', 'c', 'd', 'e', 'x', 'y'];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'd', to: 'e' },
    { from: 'e', to: 'a' },
    // Isolated pair
    { from: 'x', to: 'y' },
  ];
  const penalties = detectSybilClusters(agents, edges);
  const pX = penalties.get('x') ?? 0;
  const pY = penalties.get('y') ?? 0;
  assert.ok(pX > 0 && pX <= 0.8, `Penalty ${pX} should be in (0, 0.8]`);
  assert.equal(pX, pY, 'Penalties should be equal for symmetric cluster');
  console.log('  [PASS] Penalty proportional to isolation');
}

console.log('All Sybil detection tests passed!');
