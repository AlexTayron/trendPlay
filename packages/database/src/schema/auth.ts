import { pgTable, uuid, varchar, text, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  jobTitle: varchar('job_title', { length: 150 }),
  company: varchar('company', { length: 150 }),
  githubHandle: varchar('github_handle', { length: 100 }),
  linkedinUrl: text('linkedin_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(), // 'google'
  providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
  profileData: jsonb('profile_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_provider_user').on(table.provider, table.providerUserId),
]);

export const userConsents = pgTable('user_consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  consentType: varchar('consent_type', { length: 100 }).notNull(), // 'lgpd_llm_processing'
  version: varchar('version', { length: 20 }).notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

