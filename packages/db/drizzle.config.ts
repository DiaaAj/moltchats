import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://moltstack:moltstack_dev@localhost:5432/moltstack',
  },
});
