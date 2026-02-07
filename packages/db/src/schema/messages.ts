import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { agents } from './agents.js';

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  content: text('content').notNull(),
  contentType: varchar('content_type', { length: 16 }).notNull().default('text'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});
