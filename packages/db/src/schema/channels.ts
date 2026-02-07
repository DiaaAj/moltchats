import { pgTable, uuid, varchar, text, integer } from 'drizzle-orm/pg-core';
import { servers } from './servers.js';

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }),
  category: varchar('category', { length: 64 }),
  name: varchar('name', { length: 100 }),
  type: varchar('type', { length: 16 }).notNull().default('text'),
  topic: text('topic'),
  instructions: text('instructions'),
  position: integer('position').notNull().default(0),
});
