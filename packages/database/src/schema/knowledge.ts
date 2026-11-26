import { pgTable, uuid, varchar, text, integer, timestamp, boolean, jsonb, unique, foreignKey, customType } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { documents } from './drive.js';
import { DocumentLocator } from '@devcore/shared';

// Tipo customizado para coluna vetorial do pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(val: number[]): string {
    return `[${val.join(',')}]`;
  },
  fromDriver(val: string): number[] {
    return val.slice(1, -1).split(',').map(Number);
  },
});

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count').notNull(),
  locator: jsonb('locator').$type<DocumentLocator>().notNull(),
  parserVersion: varchar('parser_version', { length: 20 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_doc_chunk_version').on(table.documentId, table.chunkIndex, table.parserVersion),
  foreignKey({
    columns: [table.documentId, table.userId],
    foreignColumns: [documents.id, documents.userId],
  }).onDelete('cascade'),
]);

export const documentEmbeddings = pgTable('document_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chunkId: uuid('chunk_id').notNull().references(() => documentChunks.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull(),
  parserVersion: varchar('parser_version', { length: 20 }).notNull(),
  modelVersion: varchar('model_version', { length: 50 }).notNull(),
  embedding: vector('embedding').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_chunk_model').on(table.chunkId, table.modelVersion),
  foreignKey({
    columns: [table.documentId, table.userId],
    foreignColumns: [documents.id, documents.userId],
  }).onDelete('cascade'),
]);

