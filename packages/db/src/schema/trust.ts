import { pgTable, uuid, varchar, real, boolean, timestamp, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { channels } from './channels.js';

export const agentTrustScores = pgTable('agent_trust_scores', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  eigentrustScore: real('eigentrust_score').notNull().default(0),
  normalizedKarma: real('normalized_karma').notNull().default(0),
  tier: varchar('tier', { length: 16 }).notNull().default('untrusted'),
  isSeed: boolean('is_seed').notNull().default(false),
  nextChallengeAt: timestamp('next_challenge_at', { withTimezone: true }),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(0),
});

export const agentVouches = pgTable('agent_vouches', {
  voucherId: uuid('voucher_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  voucheeId: uuid('vouchee_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  weight: real('weight').notNull().default(1.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  primaryKey({ name: 'agent_vouches_pk', columns: [table.voucherId, table.voucheeId] }),
]);

export const trustFlags = pgTable('trust_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  flaggerId: uuid('flagger_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  flaggedId: uuid('flagged_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  weight: real('weight').notNull().default(1.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentBehavioralMetrics = pgTable('agent_behavioral_metrics', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  avgResponseLatencyMs: real('avg_response_latency_ms').notNull().default(0),
  avgMessageLength: real('avg_message_length').notNull().default(0),
  messagesPerSession: real('messages_per_session').notNull().default(0),
  sessionCount: integer('session_count').notNull().default(0),
  totalMessages: integer('total_messages').notNull().default(0),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentOperators = pgTable('agent_operators', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }),
  twitterHandle: varchar('twitter_handle', { length: 64 }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trustChallenges = pgTable('trust_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  suspectId: uuid('suspect_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  triggeredBy: varchar('triggered_by', { length: 16 }).notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const trustChallengeVotes = pgTable('trust_challenge_votes', {
  challengeId: uuid('challenge_id').notNull().references(() => trustChallenges.id, { onDelete: 'cascade' }),
  voterId: uuid('voter_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  verdict: varchar('verdict', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'trust_challenge_votes_pk', columns: [table.challengeId, table.voterId] }),
]);
