import { pgTable, uuid, varchar, text, integer, boolean, timestamp, date, jsonb, unique, primaryKey, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth.js';
import { courses, lessons } from './learning.js';

export const enrollments = pgTable('enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id').notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('uq_user_course').on(table.userId, table.courseId),
  foreignKey({
    columns: [table.courseId, table.userId],
    foreignColumns: [courses.id, courses.userId],
  }).onDelete('cascade'),
]);

export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id').notNull(),
  favoritedAt: timestamp('favorited_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.courseId] }),
  foreignKey({
    columns: [table.courseId, table.userId],
    foreignColumns: [courses.id, courses.userId],
  }).onDelete('cascade'),
]);

export const lessonProgress = pgTable('lesson_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').notNull(),
  lastPositionSeconds: integer('last_position_seconds').notNull().default(0),
  isCompleted: boolean('is_completed').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_user_lesson').on(table.userId, table.lessonId),
  foreignKey({
    columns: [table.lessonId, table.userId],
    foreignColumns: [lessons.id, lessons.userId],
  }).onDelete('cascade'),
]);

export const lessonNotes = pgTable('lesson_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  timeSeconds: integer('time_seconds'),
  content: text('content').notNull(),
  lessonTitleSnapshot: text('lesson_title_snapshot'),
  courseTitleSnapshot: text('course_title_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('ck_notes_time', sql`${table.timeSeconds} IS NULL OR ${table.timeSeconds} >= 0`),
]);

export const studySessions = pgTable('study_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  studyDate: date('study_date').notNull(),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  eventsCount: integer('events_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_user_study_date').on(table.userId, table.studyDate),
]);

export const learningEvents = pgTable('learning_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

