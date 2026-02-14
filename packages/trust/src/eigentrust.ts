import type { PairwiseInteraction, TrustMatrix } from './types.js';
import { EIGENTRUST } from './constants.js';

/**
 * Build a trust matrix from pairwise interactions.
 * Returns normalized agent indices and a stochastic matrix.
 */
export function buildTrustMatrix(
  agentIds: string[],
  interactions: PairwiseInteraction[],
): TrustMatrix {
  const n = agentIds.length;
  const idxMap = new Map<string, number>();
  agentIds.forEach((id, i) => idxMap.set(id, i));

  // Initialize matrix with zeros
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  // Fill raw weights
  for (const { fromAgentId, toAgentId, weight } of interactions) {
    const i = idxMap.get(fromAgentId);
    const j = idxMap.get(toAgentId);
    if (i === undefined || j === undefined) continue;
    if (i === j) continue; // No self-trust
    matrix[i][j] += weight;
  }

  // Clamp negative entries to 0 (negative interactions reduce but don't go below 0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] < 0) matrix[i][j] = 0;
    }
  }

  // Normalize rows to stochastic matrix
  for (let i = 0; i < n; i++) {
    const rowSum = matrix[i].reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      for (let j = 0; j < n; j++) {
        matrix[i][j] /= rowSum;
      }
    } else {
      // No outgoing trust: distribute uniformly
      for (let j = 0; j < n; j++) {
        matrix[i][j] = 1 / n;
      }
    }
  }

  return { agentIds, matrix };
}

/**
 * Run EigenTrust power iteration.
 *
 * t(k+1) = (1 - alpha) * C^T * t(k) + alpha * p
 *
 * Where:
 * - C is the row-normalized trust matrix
 * - p is the pre-trust vector (uniform over seed agents)
 * - alpha is the damping factor
 *
 * Returns a score vector normalized to [0, 1].
 */
export function computeEigenTrust(
  trustMatrix: TrustMatrix,
  seedIndices: number[],
): number[] {
  const n = trustMatrix.agentIds.length;
  if (n === 0) return [];

  const alpha = EIGENTRUST.DAMPING;
  const { matrix } = trustMatrix;

  // Pre-trust vector: uniform over seeds (or uniform over all if no seeds)
  const p = new Array(n).fill(0);
  if (seedIndices.length > 0) {
    const seedWeight = 1 / seedIndices.length;
    for (const idx of seedIndices) {
      p[idx] = seedWeight;
    }
  } else {
    const uniform = 1 / n;
    for (let i = 0; i < n; i++) p[i] = uniform;
  }

  // Initialize trust vector uniformly
  let t = new Array(n).fill(1 / n);

  for (let iter = 0; iter < EIGENTRUST.MAX_ITERATIONS; iter++) {
    const tNew = new Array(n).fill(0);

    // C^T * t: column j of C^T = row j of C transposed
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        tNew[j] += matrix[i][j] * t[i];
      }
    }

    // Apply damping: t_new = (1 - alpha) * C^T * t + alpha * p
    for (let j = 0; j < n; j++) {
      tNew[j] = (1 - alpha) * tNew[j] + alpha * p[j];
    }

    // Check convergence
    let maxDiff = 0;
    for (let j = 0; j < n; j++) {
      maxDiff = Math.max(maxDiff, Math.abs(tNew[j] - t[j]));
    }

    t = tNew;

    if (maxDiff < EIGENTRUST.CONVERGENCE_THRESHOLD) break;
  }

  // Normalize to [0, 1]
  const maxScore = Math.max(...t);
  if (maxScore > 0) {
    for (let i = 0; i < n; i++) {
      t[i] /= maxScore;
    }
  }

  return t;
}
