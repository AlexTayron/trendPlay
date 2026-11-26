import { pgTable, uuid, varchar, text, timestamp, boolean, bigint, jsonb, integer, unique, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

export const googleConnections = pgTable('google_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  tokenScope: text('token_scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('active'), // 'active', 'revoked', 'expired'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const driveSources = pgTable('drive_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  driveFileId: varchar('drive_file_id', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 150 }).notNull(),
  isFolder: boolean('is_folder').notNull().default(false),
  parentDriveId: varchar('parent_drive_id', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_user_drive_file').on(table.userId, table.driveFileId),
  unique('uq_drive_sources_id_user').on(table.id, table.userId),
]);

export const driveSyncStates = pgTable('drive_sync_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  startPageToken: varchar('start_page_token', { length: 255 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncStatus: varchar('sync_status', { length: 50 }).notNull().default('idle'), // 'idle', 'syncing', 'error'
  errorMessage: text('error_message'),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  driveSourceId: uuid('drive_source_id').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 150 }).notNull(),
  driveRevisionId: varchar('drive_revision_id', { length: 255 }),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // 'pending', 'processing', 'indexed', 'inactive', 'failed'
  activeParserVersion: varchar('active_parser_version', { length: 20 }),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_documents_id_user').on(table.id, table.userId),
  foreignKey({
    columns: [table.driveSourceId, table.userId],
    foreignColumns: [driveSources.id, driveSources.userId],
  }).onDelete('cascade'),
]);
