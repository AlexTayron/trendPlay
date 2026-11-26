import { pgTable, uuid, varchar, text, integer, numeric, boolean, timestamp, jsonb, unique, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { lessons } from './learning.js';
import { documentChunks } from './knowledge.js';
import { DocumentLocator } from '@devcore/shared';

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).default('Nova Consulta Técnica'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_conversations_id_user').on(table.id, table.userId),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  role: varchar('role', { length: 20 }).notNull(), // 'user', 'assistant', 'system'
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.conversationId, table.userId],
    foreignColumns: [conversations.id, conversations.userId],
  }).onDelete('cascade'),
]);

export const retrievalResults = pgTable('retrieval_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  chunkId: uuid('chunk_id').references(() => documentChunks.id, { onDelete: 'set null' }),
  similarityScore: numeric('similarity_score', { precision: 5, scale: 4 }).notNull(),
  rankPosition: integer('rank_position').notNull(),
  cited: boolean('cited').notNull().default(false),
  locatorSnapshot: jsonb('locator_snapshot').$type<DocumentLocator>(),
  documentTitleSnapshot: text('document_title_snapshot'),
  driveRevisionIdSnapshot: text('drive_revision_id_snapshot'),
});

export const lessonSummaries = pgTable('lesson_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  summaryText: text('summary_text').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_lesson_summary_hash').on(table.lessonId, table.contentHash),
  foreignKey({
    columns: [table.lessonId, table.userId],
    foreignColumns: [lessons.id, lessons.userId],
  }).onDelete('cascade'),
]);

