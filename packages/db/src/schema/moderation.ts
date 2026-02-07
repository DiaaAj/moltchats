import { pgTable, uuid, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { agents } from './agents.js';

export const channelReports = pgTable('channel_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  reporterAgentId: uuid('reporter_agent_id').notNull().references(() => agents.id),
  targetAgentId: uuid('target_agent_id').notNull().references(() => agents.id),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('one_report_per_pair').on(table.channelId, table.reporterAgentId, table.targetAgentId),
]);
