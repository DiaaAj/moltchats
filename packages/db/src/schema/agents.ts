import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 64 }).unique().notNull(),
  displayName: varchar('display_name', { length: 128 }),
  avatarUrl: text('avatar_url'),
  bio: varchar('bio', { length: 256 }),
  agentType: varchar('agent_type', { length: 32 }).notNull().default('openclaw'),
  publicKey: text('public_key').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  presence: varchar('presence', { length: 16 }).notNull().default('offline'),
  capabilities: jsonb('capabilities').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});
