import type { TrustTier } from './types.js';

// ── Tier thresholds ──────────────────────────────────────────────────
export const TRUST_THRESHOLDS = {
  TRUSTED: 0.6,
  PROVISIONAL: 0.3,
  /** Minimum active non-quarantined vouches given to reach trusted tier */
  MIN_VOUCHES_FOR_TRUSTED: 2,
} as const;

// ── EigenTrust parameters ────────────────────────────────────────────
export const EIGENTRUST = {
  DAMPING: 0.15,
  MAX_ITERATIONS: 50,
  CONVERGENCE_THRESHOLD: 1e-6,
  WORKER_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
} as const;

// ── Karma normalization ──────────────────────────────────────────────
export const KARMA = {
  /** Diminishing returns: weight = 1 / 2^(n-1) for nth reaction from same reactor, 0 for 4th+ */
  MAX_REACTIONS_PER_REACTOR: 3,
  /** Time decay half-life in days */
  HALF_LIFE_DAYS: 30,
  /** Penalty for each block received */
  BLOCK_PENALTY: -2.0,
  /** Penalty for each report received */
  REPORT_PENALTY: -1.5,
} as const;

// ── Interaction weights for trust matrix ─────────────────────────────
export const INTERACTION_WEIGHTS = {
  REACTION: 1.0,       // capped per-reactor, normalized
  FRIENDSHIP: 0.5,
  VOUCH: 1.0,          // variable, uses vouch weight
  BLOCK: -0.5,
  REPORT: -0.3,
} as const;

// ── Flag consensus ───────────────────────────────────────────────────
export const FLAGS = {
  QUARANTINE_THRESHOLD: 3.0,
  COOLDOWN_HOURS: 24,
} as const;

// ── Vouch rules ──────────────────────────────────────────────────────
export const VOUCHES = {
  /** Penalty applied to voucher if vouchee is quarantined */
  VOUCHEE_QUARANTINE_PENALTY: 0.1, // 10% of voucher's score
  /** Reward per active vouch whose vouchee is not quarantined */
  GOOD_VOUCH_REWARD: 0.03, // 3% of voucher's score per good vouch
  /** Max total reward from vouching (cap to prevent gaming) */
  MAX_VOUCH_REWARD: 0.15, // 15% cap
  DEFAULT_WEIGHT: 1.0,
} as const;

// ── Sybil detection ──────────────────────────────────────────────────
export const SYBIL = {
  /** Minimum outbound edges per agent for a cluster to avoid penalty */
  MIN_OUTBOUND_EDGES: 2,
  /** Maximum penalty factor for isolated clusters */
  MAX_PENALTY: 0.8,
} as const;

// ── Behavioral monitoring ────────────────────────────────────────────
export const BEHAVIORAL = {
  /** Standard deviations from own baseline to flag as outlier */
  OUTLIER_THRESHOLD: 3,
  /** Penalty per behavioral anomaly in trust computation */
  ANOMALY_PENALTY: 0.05,
} as const;

// ── Challenges ───────────────────────────────────────────────────────
export const CHALLENGES = {
  /** Number of challengers per challenge */
  NUM_CHALLENGERS: 3,
  /** Challenge channel auto-delete timeout in ms */
  CHANNEL_TIMEOUT_MS: 60 * 60 * 1000, // 1 hour
  /** Challenges per day for agents below trusted tier */
  PER_DAY: 2,
  /** Flag ratio that triggers immediate challenge */
  FLAG_RATIO_TRIGGER: 0.5,
} as const;

// ── Rate limits by tier ──────────────────────────────────────────────
export const RATE_LIMITS_BY_TIER: Record<TrustTier, {
  apiPerMin: number;
  wsPerMinPerChannel: number;
  serversPerDay: number;
  friendReqPerHour: number;
}> = {
  seed:         { apiPerMin: 60, wsPerMinPerChannel: 15, serversPerDay: 10, friendReqPerHour: 30 },
  trusted:      { apiPerMin: 40, wsPerMinPerChannel: 10, serversPerDay: 5,  friendReqPerHour: 20 },
  provisional:  { apiPerMin: 20, wsPerMinPerChannel: 5,  serversPerDay: 2,  friendReqPerHour: 10 },
  untrusted:    { apiPerMin: 5,  wsPerMinPerChannel: 3,  serversPerDay: 0,  friendReqPerHour: 2 },
  quarantined:  { apiPerMin: 2,  wsPerMinPerChannel: 0,  serversPerDay: 0,  friendReqPerHour: 0 },
};

// ── Redis cache keys ─────────────────────────────────────────────────
export const CACHE = {
  TRUST_PREFIX: 'trust:',
  TTL_SECONDS: 3900, // 65 minutes (slightly longer than worker interval)
} as const;
