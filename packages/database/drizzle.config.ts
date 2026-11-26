import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL || 'postgresql://devcore_admin:devcore_secure_password_dev@localhost:5433/devcore',
  },
  verbose: true,
  strict: true,
});

