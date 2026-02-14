import { SYBIL } from './constants.js';

interface Edge {
  from: string;
  to: string;
}

/**
 * Detect Sybil clusters using BFS on the positive-edge graph.
 *
 * The largest connected component is treated as the "main network" and
 * is exempt from penalty. All other components are evaluated: clusters
 * where agents lack connections outside the cluster get penalized
 * proportionally to their isolation ratio.
 *
 * An optional `seedAgentIds` set can be provided — any component containing
 * a seed agent is also exempt from penalty (anchored to the trusted core).
 *
 * Returns a map of agentId -> penalty (0 to MAX_PENALTY).
 */
export function detectSybilClusters(
  agentIds: string[],
  positiveEdges: Edge[],
  seedAgentIds?: Set<string>,
): Map<string, number> {
  // Build adjacency list (undirected)
  const adj = new Map<string, Set<string>>();
  for (const id of agentIds) {
    adj.set(id, new Set());
  }
  for (const { from, to } of positiveEdges) {
    adj.get(from)?.add(to);
    adj.get(to)?.add(from);
  }

  // Find connected components via BFS
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const id of agentIds) {
    if (visited.has(id)) continue;

    const cluster: string[] = [];
    const queue = [id];
    visited.add(id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);

      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    clusters.push(cluster);
  }

  // Find the largest cluster (the "main network")
  let largestSize = 0;
  let largestIdx = -1;
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].length > largestSize) {
      largestSize = clusters[i].length;
      largestIdx = i;
    }
  }

  // Compute penalties per cluster (skip largest and seed-anchored clusters)
  const penalties = new Map<string, number>();

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.length <= 1) continue; // Singletons aren't clusters

    // Skip the largest cluster — it's the main network
    if (ci === largestIdx) continue;

    // Skip clusters containing seed agents
    if (seedAgentIds && cluster.some(id => seedAgentIds.has(id))) continue;

    const clusterSet = new Set(cluster);

    // Count outbound edges per agent (connections outside cluster)
    let agentsBelowThreshold = 0;

    for (const agentId of cluster) {
      const neighbors = adj.get(agentId) ?? new Set();
      let outbound = 0;
      for (const n of neighbors) {
        if (!clusterSet.has(n)) outbound++;
      }
      if (outbound < SYBIL.MIN_OUTBOUND_EDGES) {
        agentsBelowThreshold++;
      }
    }

    // If most agents in cluster lack outbound connections, apply penalty
    const isolationRatio = agentsBelowThreshold / cluster.length;
    if (isolationRatio > 0.5) {
      const penalty = Math.min(SYBIL.MAX_PENALTY, isolationRatio * SYBIL.MAX_PENALTY);
      for (const agentId of cluster) {
        penalties.set(agentId, penalty);
      }
    }
  }

  return penalties;
}
