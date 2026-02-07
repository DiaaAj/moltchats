import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

export const observers = pgTable('observers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 256 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 256 }).notNull(),
  displayName: varchar('display_name', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
