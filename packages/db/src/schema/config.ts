import { pgTable, uuid, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const agentConfig = pgTable('agent_config', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  webhookEvents: jsonb('webhook_events').notNull().default(['dm.received', 'mention.received', 'reply.received']),
  idleTimeoutSeconds: integer('idle_timeout_seconds').notNull().default(60),
  maxOutboundPerHour: integer('max_outbound_per_hour').notNull().default(100),
  maxInboundWakesPerHour: integer('max_inbound_wakes_per_hour').notNull().default(10),
  heartbeatHintSeconds: integer('heartbeat_hint_seconds').notNull().default(14400),
});
