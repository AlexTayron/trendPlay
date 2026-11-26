import { pgTable, uuid, varchar, text, integer, numeric, boolean, timestamp, unique, primaryKey, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { driveSources, documents } from './drive.js';

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  driveSourceId: uuid('drive_source_id'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  instructorName: varchar('instructor_name', { length: 150 }),
  thumbnailUrl: text('thumbnail_url'),
  totalHours: numeric('total_hours', { precision: 6, scale: 2 }).default('0'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_courses_id_user').on(table.id, table.userId),
  foreignKey({
    columns: [table.driveSourceId, table.userId],
    foreignColumns: [driveSources.id, driveSources.userId],
  }).onDelete('set null'),
]);

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  courseId: uuid('course_id').notNull(),
  driveSourceId: uuid('drive_source_id'),
  title: varchar('title', { length: 255 }).notNull(),
  orderIndex: integer('order_index').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_modules_id_user').on(table.id, table.userId),
  foreignKey({
    columns: [table.courseId, table.userId],
    foreignColumns: [courses.id, courses.userId],
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.driveSourceId, table.userId],
    foreignColumns: [driveSources.id, driveSources.userId],
  }).onDelete('set null'),
]);

export const lessons = pgTable('lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  moduleId: uuid('module_id').notNull(),
  mediaSourceId: uuid('media_source_id'),
  title: varchar('title', { length: 255 }).notNull(),
  orderIndex: integer('order_index').notNull().default(1),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_lessons_id_user').on(table.id, table.userId),
  foreignKey({
    columns: [table.moduleId, table.userId],
    foreignColumns: [modules.id, modules.userId],
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.mediaSourceId, table.userId],
    foreignColumns: [driveSources.id, driveSources.userId],
  }).onDelete('set null'),
]);

export const lessonDocuments = pgTable('lesson_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  documentId: uuid('document_id').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('resource'), // 'transcript', 'resource', 'code'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_lesson_doc').on(table.lessonId, table.documentId),
  foreignKey({
    columns: [table.lessonId, table.userId],
    foreignColumns: [lessons.id, lessons.userId],
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.documentId, table.userId],
    foreignColumns: [documents.id, documents.userId],
  }).onDelete('cascade'),
]);

export const lessonCodeAnchors = pgTable('lesson_code_anchors', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  timeSeconds: integer('time_seconds').notNull(),
  title: varchar('title', { length: 150 }).notNull(),
  codeContent: text('code_content').notNull(),
  language: varchar('language', { length: 50 }).notNull(),
  filePath: varchar('file_path', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.lessonId, table.userId],
    foreignColumns: [lessons.id, lessons.userId],
  }).onDelete('cascade'),
]);

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull().unique(),
});

export const courseTags = pgTable('course_tags', {
  courseId: uuid('course_id').notNull(),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.courseId, table.tagId] }),
  foreignKey({
    columns: [table.courseId, table.userId],
    foreignColumns: [courses.id, courses.userId],
  }).onDelete('cascade'),
]);
