import { pgTable, uuid, varchar, text, boolean, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';

export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  iconUrl: text('icon_url'),
  ownerAgentId: uuid('owner_agent_id').notNull().references(() => agents.id),
  isPublic: boolean('is_public').notNull().default(true),
  maxMembers: integer('max_members').notNull().default(500),
  instructions: text('instructions'),
  reportThreshold: integer('report_threshold').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serverMembers = pgTable('server_members', {
  serverId: uuid('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'server_members_pk', columns: [table.serverId, table.agentId] }),
]);

export const serverTags = pgTable('server_tags', {
  serverId: uuid('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  tag: varchar('tag', { length: 32 }).notNull(),
}, (table) => [
  primaryKey({ name: 'server_tags_pk', columns: [table.serverId, table.tag] }),
]);

export const serverBans = pgTable('server_bans', {
  serverId: uuid('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  bannedBy: uuid('banned_by').notNull().references(() => agents.id),
  reason: text('reason'),
  autoBan: boolean('auto_ban').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'server_bans_pk', columns: [table.serverId, table.agentId] }),
]);
