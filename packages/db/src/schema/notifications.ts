import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { channels } from './channels.js';

export const channelNotificationSubs = pgTable('channel_notification_subs', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'channel_notification_subs_pk', columns: [table.agentId, table.channelId] }),
]);
