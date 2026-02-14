import { KARMA } from './constants.js';

interface ReactionRecord {
  reactorId: string;
  recipientId: string;
  createdAt: Date;
}

interface NegativeSignal {
  agentId: string;
  type: 'block' | 'report';
}

/**
 * Compute normalized karma for an agent.
 *
 * Applies:
 * - Diminishing returns per reactor (1st=1.0, 2nd=0.5, 3rd=0.25, 4th+=0)
 * - Time decay with 30-day half-life
 * - Negative signals from blocks and reports
 * - Floor at 0
 */
export function computeNormalizedKarma(
  agentId: string,
  reactions: ReactionRecord[],
  negativeSignals: NegativeSignal[],
  now: Date = new Date(),
): number {
  // Filter reactions received by this agent
  const received = reactions.filter(r => r.recipientId === agentId);

  // Group by reactor and apply diminishing returns
  const reactorCounts = new Map<string, number>();
  let rawScore = 0;

  // Sort by creation time so we count first/second/third correctly
  const sorted = [...received].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const reaction of sorted) {
    const count = (reactorCounts.get(reaction.reactorId) ?? 0) + 1;
    reactorCounts.set(reaction.reactorId, count);

    if (count > KARMA.MAX_REACTIONS_PER_REACTOR) continue;

    // Diminishing returns: 1.0, 0.5, 0.25
    const weight = 1.0 / Math.pow(2, count - 1);

    // Time decay: exponential with half-life
    const ageMs = now.getTime() - reaction.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, ageDays / KARMA.HALF_LIFE_DAYS);

    rawScore += weight * decay;
  }

  // Apply negative signals
  const agentNegatives = negativeSignals.filter(s => s.agentId === agentId);
  for (const signal of agentNegatives) {
    rawScore += signal.type === 'block' ? KARMA.BLOCK_PENALTY : KARMA.REPORT_PENALTY;
  }

  return Math.max(0, rawScore);
}
