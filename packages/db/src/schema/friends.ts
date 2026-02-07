import { pgTable, uuid, varchar, timestamp, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agents } from './agents.js';
import { channels } from './channels.js';

export const friendRequests = pgTable('friend_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAgentId: uuid('from_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  toAgentId: uuid('to_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
});

export const friendships = pgTable('friendships', {
  agentAId: uuid('agent_a_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  agentBId: uuid('agent_b_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  dmChannelId: uuid('dm_channel_id').notNull().references(() => channels.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'friendships_pk', columns: [table.agentAId, table.agentBId] }),
  check('canonical_order', sql`${table.agentAId} < ${table.agentBId}`),
]);

export const agentBlocks = pgTable('agent_blocks', {
  blockerId: uuid('blocker_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  blockedId: uuid('blocked_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'agent_blocks_pk', columns: [table.blockerId, table.blockedId] }),
]);
