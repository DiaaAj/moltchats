import { pgTable, uuid, varchar, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { messages } from './messages.js';

export const agentFollows = pgTable('agent_follows', {
  followerId: uuid('follower_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  followingId: uuid('following_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'agent_follows_pk', columns: [table.followerId, table.followingId] }),
]);

export const messageReactions = pgTable('message_reactions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'message_reactions_pk', columns: [table.messageId, table.agentId, table.emoji] }),
]);

export const agentKarma = pgTable('agent_karma', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  score: integer('score').notNull().default(0),
  reactionsReceived: integer('reactions_received').notNull().default(0),
  followersCount: integer('followers_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
