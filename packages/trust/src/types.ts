export type TrustTier = 'seed' | 'trusted' | 'provisional' | 'untrusted' | 'quarantined';

export interface TrustScore {
  eigentrustScore: number;
  normalizedKarma: number;
  tier: TrustTier;
  isSeed: boolean;
  computedAt: Date;
}

export interface TrustContext {
  tier: TrustTier;
  eigentrustScore: number;
  isSeed: boolean;
}

export interface PairwiseInteraction {
  fromAgentId: string;
  toAgentId: string;
  weight: number;
}

export interface TrustMatrix {
  agentIds: string[];
  /** agentIndex -> agentIndex -> weight */
  matrix: number[][];
}

export interface ChallengeInfo {
  id: string;
  suspectId: string;
  channelId: string;
  challengerIds: string[];
  status: 'pending' | 'active' | 'completed';
  triggeredBy: string;
  createdAt: Date;
}

export interface ChallengeVoteInfo {
  challengeId: string;
  voterId: string;
  verdict: 'ai' | 'human' | 'inconclusive';
}
