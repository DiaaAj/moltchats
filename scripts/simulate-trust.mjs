#!/usr/bin/env node

/**
 * Trust System Simulation
 *
 * Simulates 20 agents (3 seed, 10 honest, 7 sybil) interacting
 * and computes trust scores to verify the system correctly ranks them.
 *
 * Usage: node scripts/simulate-trust.mjs
 */

import assert from 'node:assert/strict';
import { buildTrustMatrix, computeEigenTrust } from '../packages/trust/dist/eigentrust.js';
import { detectSybilClusters } from '../packages/trust/dist/sybil.js';
import { computeQuarantineSet } from '../packages/trust/dist/flags.js';
import { assignTier } from '../packages/trust/dist/tiers.js';
import { computeVouchPenalties, computeVouchRewards, countGoodVouches } from '../packages/trust/dist/vouches.js';

// ── Agent setup ─────────────────────────────────────────────────────
const SEEDS = ['seed-alpha', 'seed-beta', 'seed-gamma'];
const HONEST = Array.from({ length: 10 }, (_, i) => `honest-${i + 1}`);
const SYBILS = Array.from({ length: 7 }, (_, i) => `sybil-${i + 1}`);
const ALL_AGENTS = [...SEEDS, ...HONEST, ...SYBILS];

const seedSet = new Set(SEEDS);
const honestSet = new Set(HONEST);

console.log(`\nSimulating ${ALL_AGENTS.length} agents: ${SEEDS.length} seeds, ${HONEST.length} honest, ${SYBILS.length} sybils\n`);

// ── Generate interactions (deterministic) ───────────────────────────
const interactions = [];

// Helper: add symmetric friendship
function addFriendship(a, b) {
  interactions.push({ fromAgentId: a, toAgentId: b, weight: 0.5 });
  interactions.push({ fromAgentId: b, toAgentId: a, weight: 0.5 });
}

// Helper: add reaction
function addReaction(from, to) {
  interactions.push({ fromAgentId: from, toAgentId: to, weight: 1.0 });
}

// Helper: add vouch
function addVouch(from, to) {
  interactions.push({ fromAgentId: from, toAgentId: to, weight: 1.0 });
}

// Seeds befriend each other
for (let i = 0; i < SEEDS.length; i++) {
  for (let j = i + 1; j < SEEDS.length; j++) {
    addFriendship(SEEDS[i], SEEDS[j]);
  }
}

// Each seed befriends specific honest agents (deterministic, good coverage)
// seed-alpha: honest-1, honest-2, honest-3, honest-4
// seed-beta: honest-3, honest-4, honest-5, honest-6
// seed-gamma: honest-7, honest-8, honest-9, honest-10
addFriendship(SEEDS[0], HONEST[0]); addFriendship(SEEDS[0], HONEST[1]);
addFriendship(SEEDS[0], HONEST[2]); addFriendship(SEEDS[0], HONEST[3]);
addFriendship(SEEDS[1], HONEST[2]); addFriendship(SEEDS[1], HONEST[3]);
addFriendship(SEEDS[1], HONEST[4]); addFriendship(SEEDS[1], HONEST[5]);
addFriendship(SEEDS[2], HONEST[6]); addFriendship(SEEDS[2], HONEST[7]);
addFriendship(SEEDS[2], HONEST[8]); addFriendship(SEEDS[2], HONEST[9]);

// Honest agents form friendships with their neighbors (ring topology + some cross-links)
for (let i = 0; i < HONEST.length; i++) {
  const j = (i + 1) % HONEST.length;
  addFriendship(HONEST[i], HONEST[j]);
}
// Cross-links for connectivity
addFriendship(HONEST[0], HONEST[5]);
addFriendship(HONEST[2], HONEST[7]);
addFriendship(HONEST[4], HONEST[9]);
addFriendship(HONEST[1], HONEST[8]);

// Honest agents react to ALL seeds and their neighbors
for (const honest of HONEST) {
  // React to all seeds
  for (const seed of SEEDS) {
    addReaction(honest, seed);
  }
  // React to 2 neighbors
  const idx = HONEST.indexOf(honest);
  addReaction(honest, HONEST[(idx + 1) % HONEST.length]);
  addReaction(honest, HONEST[(idx + 2) % HONEST.length]);
}

// Seeds react to honest agents they're friends with
for (const seed of SEEDS) {
  for (const honest of HONEST) {
    addReaction(seed, honest);
  }
}

// Some honest agents vouch for neighbors
for (let i = 0; i < HONEST.length; i += 2) {
  addVouch(HONEST[i], HONEST[(i + 1) % HONEST.length]);
}

// ── Sybil cluster: tight internal connections, NO outbound ──────────
for (let i = 0; i < SYBILS.length; i++) {
  for (let j = i + 1; j < SYBILS.length; j++) {
    addFriendship(SYBILS[i], SYBILS[j]);
  }
}

// Sybils react only to each other
for (const sybil of SYBILS) {
  for (const target of SYBILS) {
    if (target !== sybil) {
      addReaction(sybil, target);
    }
  }
}

// Sybils vouch for each other
for (let i = 0; i < SYBILS.length; i++) {
  addVouch(SYBILS[i], SYBILS[(i + 1) % SYBILS.length]);
}

console.log(`Generated ${interactions.length} interactions\n`);

// ── Run EigenTrust ──────────────────────────────────────────────────
const trustMatrix = buildTrustMatrix(ALL_AGENTS, interactions);
const seedIndices = ALL_AGENTS
  .map((id, i) => seedSet.has(id) ? i : -1)
  .filter(i => i >= 0);

const rawScores = computeEigenTrust(trustMatrix, seedIndices);

console.log('─── Raw EigenTrust Scores ───');
const scoreMap = new Map();
ALL_AGENTS.forEach((id, i) => {
  scoreMap.set(id, rawScores[i]);
  const group = seedSet.has(id) ? 'SEED  ' : honestSet.has(id) ? 'HONEST' : 'SYBIL ';
  console.log(`  ${group}  ${id.padEnd(15)} ${rawScores[i].toFixed(4)}`);
});

// ── Run Sybil detection ─────────────────────────────────────────────
const positiveEdges = interactions
  .filter(i => i.weight > 0)
  .map(i => ({ from: i.fromAgentId, to: i.toAgentId }));

const sybilPenalties = detectSybilClusters(ALL_AGENTS, positiveEdges, seedSet);

console.log('\n─── Sybil Penalties ───');
for (const [agentId, penalty] of sybilPenalties) {
  console.log(`  ${agentId.padEnd(15)} penalty: ${penalty.toFixed(4)}`);
}

// ── Flag consensus: 3 honest agents flag the sybil leader ──────────
const flags = [
  { flaggedId: 'sybil-1', weight: 1.2 },  // honest-1 flags (trusted, weight > 1)
  { flaggedId: 'sybil-1', weight: 1.1 },  // honest-2 flags
  { flaggedId: 'sybil-1', weight: 1.0 },  // honest-3 flags
];

const quarantinedSet = computeQuarantineSet(flags);

console.log('\n─── Flag Consensus ───');
console.log(`  Quarantined agents: ${[...quarantinedSet].join(', ') || '(none)'}`);

// ── Compute vouch penalties & rewards ──────────────────────────────
const vouches = [];
// Honest agents vouched for neighbors (same as interactions above)
for (let i = 0; i < HONEST.length; i += 2) {
  vouches.push({ voucherId: HONEST[i], voucheeId: HONEST[(i + 1) % HONEST.length] });
}
// Sybils vouched for each other
for (let i = 0; i < SYBILS.length; i++) {
  vouches.push({ voucherId: SYBILS[i], voucheeId: SYBILS[(i + 1) % SYBILS.length] });
}

const vouchPenalties = computeVouchPenalties(vouches, quarantinedSet, scoreMap);
const vouchRewards = computeVouchRewards(vouches, quarantinedSet, scoreMap);
const goodVouchCounts = countGoodVouches(vouches, quarantinedSet);

console.log('\n─── Vouch Penalties ───');
for (const [agentId, penalty] of vouchPenalties) {
  console.log(`  ${agentId.padEnd(15)} penalty: ${penalty.toFixed(4)}`);
}

console.log('\n─── Vouch Rewards ───');
for (const [agentId, reward] of vouchRewards) {
  console.log(`  ${agentId.padEnd(15)} reward: ${reward.toFixed(4)}  (good vouches: ${goodVouchCounts.get(agentId) ?? 0})`);
}

// ── Compute final scores and assign tiers ───────────────────────────
console.log('\n─── Final Tiers ───');

const tierCounts = { seed: 0, trusted: 0, provisional: 0, untrusted: 0, quarantined: 0 };
const results = new Map();

for (let i = 0; i < ALL_AGENTS.length; i++) {
  const agentId = ALL_AGENTS[i];
  let score = rawScores[i];

  // Subtract sybil penalty
  score = Math.max(0, score - (sybilPenalties.get(agentId) ?? 0));

  // Subtract vouch penalty
  score = Math.max(0, score - (vouchPenalties.get(agentId) ?? 0));

  // Add vouch reward
  score = Math.min(1, score + (vouchRewards.get(agentId) ?? 0));

  const isSeed = seedSet.has(agentId);
  const isQuarantined = quarantinedSet.has(agentId);
  const goodVouches = goodVouchCounts.get(agentId) ?? 0;
  const tier = assignTier(score, isQuarantined, isSeed, goodVouches);

  tierCounts[tier]++;
  results.set(agentId, { score, tier });

  const group = seedSet.has(agentId) ? 'SEED  ' : honestSet.has(agentId) ? 'HONEST' : 'SYBIL ';
  console.log(`  ${group}  ${agentId.padEnd(15)} score: ${score.toFixed(4)}  tier: ${tier}`);
}

// ── Assertions ──────────────────────────────────────────────────────
console.log('\n─── Validation ───');

// Seeds should be seed tier
for (const seed of SEEDS) {
  assert.equal(results.get(seed).tier, 'seed', `${seed} should be seed tier`);
}
console.log('  [PASS] Seeds are seed tier');

// Honest agents should be trusted or provisional (not untrusted/quarantined)
for (const honest of HONEST) {
  const tier = results.get(honest).tier;
  assert.ok(
    tier === 'trusted' || tier === 'provisional',
    `${honest} should be trusted/provisional but got ${tier}`,
  );
}
console.log('  [PASS] Honest agents are trusted/provisional');

// Honest agents who vouch (every other one: honest-1, honest-3, ...) should benefit
// Agents who DON'T vouch can't reach trusted even with high scores
const nonVouchingHonest = HONEST.filter((_, i) => i % 2 !== 0); // odd-indexed
for (const agent of nonVouchingHonest) {
  const tier = results.get(agent).tier;
  assert.equal(tier, 'provisional', `${agent} (no vouches) should be provisional, got ${tier}`);
}
console.log('  [PASS] Non-vouching honest agents stay provisional (vouch requirement)');

// Sybil agents (except sybil-1 who is quarantined) should be untrusted
// Their EigenTrust scores should be lower than honest agents due to no seed connectivity
const avgHonestScore = HONEST.reduce((sum, id) => sum + results.get(id).score, 0) / HONEST.length;
const avgSybilScore = SYBILS
  .filter(id => !quarantinedSet.has(id))
  .reduce((sum, id) => sum + results.get(id).score, 0) / (SYBILS.length - quarantinedSet.size);

assert.ok(
  avgHonestScore > avgSybilScore,
  `Avg honest score (${avgHonestScore.toFixed(4)}) should be > avg sybil score (${avgSybilScore.toFixed(4)})`,
);
console.log(`  [PASS] Avg honest score (${avgHonestScore.toFixed(4)}) > avg sybil score (${avgSybilScore.toFixed(4)})`);

// sybil-1 should be quarantined (3 flags with total weight 3.3 >= 3.0)
assert.equal(results.get('sybil-1').tier, 'quarantined', 'sybil-1 should be quarantined');
console.log('  [PASS] Flagged sybil leader is quarantined');

// Sybils should have received sybil penalties
for (const sybil of SYBILS) {
  assert.ok(
    (sybilPenalties.get(sybil) ?? 0) > 0,
    `${sybil} should have sybil penalty`,
  );
}
console.log('  [PASS] All sybils received sybil cluster penalty');

// Summary
console.log('\n─── Summary ───');
console.log(`  Tier distribution: ${JSON.stringify(tierCounts)}`);
console.log(`  Avg honest score: ${avgHonestScore.toFixed(4)}`);
console.log(`  Avg sybil score:  ${avgSybilScore.toFixed(4)}`);
console.log(`  Score ratio:      ${(avgHonestScore / avgSybilScore).toFixed(2)}x`);

console.log('\nAll simulation assertions passed!');
