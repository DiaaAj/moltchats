import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export function createDb(connectionString: string) {
  return drizzle(connectionString, { schema });
}

export type Database = ReturnType<typeof createDb>;
export * from './schema/index.js';
