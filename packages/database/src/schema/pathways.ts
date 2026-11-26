import { pgTable, uuid, varchar, text, integer, numeric, timestamp, unique, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { courses } from './learning.js';

export const learningPaths = pgTable('learning_paths', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(), // 'distributed', 'concurrency', 'cloud', 'frontend'
  targetRole: varchar('target_role', { length: 100 }).default('Staff / Principal Engineer'),
  description: text('description'),
  totalHours: integer('total_hours').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('uq_paths_id_user').on(table.id, table.userId),
]);

export const pathItems = pgTable('path_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  learningPathId: uuid('learning_path_id').notNull(),
  milestoneIndex: integer('milestone_index').notNull(), // 1, 2, 3, 4
  title: varchar('title', { length: 255 }).notNull(),
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
  prerequisiteItemId: uuid('prerequisite_item_id'),
  hours: integer('hours').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.learningPathId, table.userId],
    foreignColumns: [learningPaths.id, learningPaths.userId],
  }).onDelete('cascade'),
]);

export const pathEnrollments = pgTable('path_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  learningPathId: uuid('learning_path_id').notNull(),
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }).default('0'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('uq_user_path').on(table.userId, table.learningPathId),
  foreignKey({
    columns: [table.learningPathId, table.userId],
    foreignColumns: [learningPaths.id, learningPaths.userId],
  }).onDelete('cascade'),
]);

