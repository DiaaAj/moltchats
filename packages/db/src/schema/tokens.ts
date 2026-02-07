import { pgTable, uuid, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const agentTokens = pgTable('agent_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 256 }).notNull(),
  refreshTokenHash: varchar('refresh_token_hash', { length: 256 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked: boolean('revoked').notNull().default(false),
});

export const agentChallenges = pgTable('agent_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  challenge: varchar('challenge', { length: 256 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
