import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import pg from 'pg';
import {
  ContinueWatchingItem,
  CourseDetail,
  CourseSummary,
  DashboardOverview,
  DriveConnectionStatus,
  LessonDetail,
  LessonNote,
  LessonResource,
  ModuleWithLessons,
  UserProfile,
} from '@devcore/shared';

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(private readonly pgPool: pg.Pool) {}

  private async queryCourseSummaries(
    client: pg.PoolClient,
    courseIdFilter?: string,
  ): Promise<CourseSummary[]> {
    const params: unknown[] = [];
    let filterSql = 'WHERE c.is_archived = false';
    if (courseIdFilter) {
      params.push(courseIdFilter);
      filterSql = 'WHERE c.id = $1';
    }

    const res = await client.query(
      `
      SELECT
        c.id,
        c.user_id AS "userId",
        c.drive_source_id AS "driveSourceId",
        ds.drive_file_id AS "driveFolderId",
        CASE
          WHEN ds.mime_type = 'application/vnd.devcore.youtube-playlist'
            OR ds.drive_file_id LIKE 'yt:playlist:%' THEN 'youtube'
          ELSE 'drive'
        END AS "sourceType",
        c.title,
        c.description,
        c.instructor_name AS "instructorName",
        c.thumbnail_url AS "thumbnailUrl",
        COALESCE(c.total_hours, 0)::float8 AS "totalHours",
        c.is_archived AS "isArchived",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        COALESCE(mod_stats.modules_count, 0)::int AS "modulesCount",
        COALESCE(les_stats.lessons_count, 0)::int AS "lessonsCount",
        COALESCE(les_stats.completed_lessons_count, 0)::int AS "completedLessonsCount",
        COALESCE(les_stats.total_duration_seconds, 0)::int AS "totalDurationSeconds",
        COALESCE(les_stats.watched_seconds, 0)::int AS "watchedSeconds",
        last_lp.lesson_id AS "lastLessonId",
        last_lp.lesson_title AS "lastLessonTitle",
        last_lp.module_title AS "lastModuleTitle"
      FROM courses c
      LEFT JOIN drive_sources ds
        ON ds.id = c.drive_source_id AND ds.user_id = c.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS modules_count
          FROM modules m
         WHERE m.course_id = c.id
      ) mod_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(l.id) AS lessons_count,
          COUNT(l.id) FILTER (WHERE lp.is_completed = true) AS completed_lessons_count,
          COALESCE(SUM(l.duration_seconds), 0) AS total_duration_seconds,
          COALESCE(SUM(
            CASE
              WHEN lp.is_completed = true AND l.duration_seconds > 0 THEN l.duration_seconds
              ELSE LEAST(COALESCE(lp.last_position_seconds, 0), GREATEST(l.duration_seconds, COALESCE(lp.last_position_seconds, 0)))
            END
          ), 0) AS watched_seconds
        FROM modules m
        JOIN lessons l ON l.module_id = m.id
        LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = l.user_id
        WHERE m.course_id = c.id
      ) les_stats ON true
      LEFT JOIN LATERAL (
        SELECT l.id AS lesson_id, l.title AS lesson_title, m.title AS module_title
          FROM lesson_progress lp
          JOIN lessons l ON l.id = lp.lesson_id
          JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = c.id
         ORDER BY lp.updated_at DESC
         LIMIT 1
      ) last_lp ON true
      ${filterSql}
      ORDER BY c.updated_at DESC;
    `,
      params,
    );

    return res.rows.map((row) => {
      const lessonsCount = Number(row.lessonsCount || 0);
      const completedLessonsCount = Number(row.completedLessonsCount || 0);
      const progressPercent =
        lessonsCount > 0 ? Math.round((completedLessonsCount / lessonsCount) * 100) : 0;

      return {
        ...row,
        totalHours: Number(row.totalHours || 0),
        modulesCount: Number(row.modulesCount || 0),
        lessonsCount,
        completedLessonsCount,
        progressPercent,
        totalDurationSeconds: Number(row.totalDurationSeconds || 0),
        watchedSeconds: Number(row.watchedSeconds || 0),
      };
    });
  }

  /**
   * Visão consolidada do Dashboard com dados reais do usuário, Drive e cursos (sem mocks — D12).
   */
  async getDashboard(userId: string): Promise<DashboardOverview> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const userRes = await client.query(
        `
        SELECT id, email, full_name AS "fullName", avatar_url AS "avatarUrl",
               job_title AS "jobTitle", company, github_handle AS "githubHandle",
               linkedin_url AS "linkedinUrl", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM users
         WHERE id = app_user_id();
      `,
      );

      if (userRes.rows.length === 0) {
        throw new NotFoundException('Usuário não encontrado.');
      }
      const user: UserProfile = userRes.rows[0];

      const connRes = await client.query(`
        SELECT status, token_scope AS "tokenScope", expires_at AS "expiresAt"
          FROM google_connections
         WHERE user_id = app_user_id();
      `);
      const syncRes = await client.query(`
        SELECT last_synced_at AS "lastSyncedAt", sync_status AS "syncStatus",
               error_message AS "errorMessage"
          FROM drive_sync_states
         WHERE user_id = app_user_id();
      `);

      const conn = connRes.rows[0];
      const sync = syncRes.rows[0];
      const drive: DriveConnectionStatus = conn
        ? {
            connected: conn.status === 'active',
            status: conn.status,
            scope: conn.tokenScope,
            expiresAt: conn.expiresAt,
            lastSyncedAt: sync?.lastSyncedAt || null,
            syncStatus: sync?.syncStatus || 'idle',
            errorMessage: sync?.errorMessage || null,
          }
        : {
            connected: false,
            status: 'disconnected',
            syncStatus: 'idle',
          };

      const courses = await this.queryCourseSummaries(client);

      // Calcular sequência de dias estudando (streak) a partir de study_sessions
      const sessionsRes = await client.query(`
        SELECT study_date::text AS "studyDate", duration_seconds AS "durationSeconds"
          FROM study_sessions
         WHERE user_id = app_user_id()
         ORDER BY study_date DESC
         LIMIT 90;
      `);

      let streakDays = 0;
      let totalSessionSeconds = 0;
      const dateSet = new Set<string>();
      for (const row of sessionsRes.rows) {
        totalSessionSeconds += Number(row.durationSeconds || 0);
        dateSet.add(row.studyDate);
      }

      const cursor = new Date();
      const formatIsoDate = (d: Date) => d.toISOString().slice(0, 10);
      if (!dateSet.has(formatIsoDate(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (dateSet.has(formatIsoDate(cursor))) {
        streakDays++;
        cursor.setDate(cursor.getDate() - 1);
      }

      // Buscar item mais recente para "Continuar Estudando"
      const cwRes = await client.query(`
        SELECT
          c.id AS "courseId",
          c.title AS "courseTitle",
          c.instructor_name AS "instructorName",
          m.title AS "moduleTitle",
          l.id AS "lessonId",
          l.title AS "lessonTitle",
          l.duration_seconds AS "durationSeconds",
          lp.last_position_seconds AS "lastPositionSeconds"
        FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id
        JOIN modules m ON m.id = l.module_id
        JOIN courses c ON c.id = m.course_id
        WHERE c.is_archived = false
        ORDER BY lp.updated_at DESC
        LIMIT 1;
      `);

      let continueWatching: ContinueWatchingItem | null = null;
      if (cwRes.rows.length > 0) {
        const cw = cwRes.rows[0];
        const courseSummary = courses.find((c) => c.id === cw.courseId);
        continueWatching = {
          courseId: cw.courseId,
          courseTitle: cw.courseTitle,
          instructorName: cw.instructorName,
          moduleTitle: cw.moduleTitle,
          lessonId: cw.lessonId,
          lessonTitle: cw.lessonTitle,
          durationSeconds: Number(cw.durationSeconds || 0),
          lastPositionSeconds: Number(cw.lastPositionSeconds || 0),
          totalCourseSeconds: courseSummary?.totalDurationSeconds || 0,
          watchedCourseSeconds: courseSummary?.watchedSeconds || 0,
        };
      } else if (courses[0]) {
        const firstCourse = courses[0];
        const firstLessonRes = await client.query(
          `
          SELECT m.title AS "moduleTitle", l.id AS "lessonId",
                 l.title AS "lessonTitle", l.duration_seconds AS "durationSeconds"
            FROM modules m
            JOIN lessons l ON l.module_id = m.id
           WHERE m.course_id = $1
           ORDER BY m.order_index ASC, l.order_index ASC
           LIMIT 1;
        `,
          [firstCourse.id],
        );
        if (firstLessonRes.rows.length > 0) {
          const fl = firstLessonRes.rows[0];
          continueWatching = {
            courseId: firstCourse.id,
            courseTitle: firstCourse.title,
            instructorName: firstCourse.instructorName,
            moduleTitle: fl.moduleTitle,
            lessonId: fl.lessonId,
            lessonTitle: fl.lessonTitle,
            durationSeconds: Number(fl.durationSeconds || 0),
            lastPositionSeconds: 0,
            totalCourseSeconds: firstCourse.totalDurationSeconds,
            watchedCourseSeconds: firstCourse.watchedSeconds,
          };
        }
      }

      await client.query('COMMIT');

      const totalCourses = courses.length;
      const coursesCompleted = courses.filter(
        (c) => c.lessonsCount > 0 && c.completedLessonsCount >= c.lessonsCount,
      ).length;
      const coursesInProgress = courses.filter(
        (c) => c.lessonsCount > 0 && c.completedLessonsCount < c.lessonsCount,
      ).length;

      const totalLessons = courses.reduce((acc, c) => acc + c.lessonsCount, 0);
      const totalCompletedLessons = courses.reduce((acc, c) => acc + c.completedLessonsCount, 0);
      const totalWatchedFromLessons = courses.reduce((acc, c) => acc + c.watchedSeconds, 0);
      const overallCompletionPercent =
        totalLessons > 0 ? Math.round((totalCompletedLessons / totalLessons) * 100) : 0;

      return {
        user,
        drive,
        stats: {
          coursesInProgress,
          coursesCompleted,
          totalCourses,
          totalWatchedSeconds: Math.max(totalWatchedFromLessons, totalSessionSeconds),
          overallCompletionPercent,
          streakDays,
        },
        continueWatching,
        courses,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lista todos os cursos do estudante respeitando RLS
   */
  async getCourses(userId: string): Promise<CourseSummary[]> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const summaries = await this.queryCourseSummaries(client);
      await client.query('COMMIT');
      return summaries;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retorna os detalhes completos de um curso: módulos, aulas, materiais de apoio e progresso.
   */
  async getCourseDetail(userId: string, courseId: string): Promise<CourseDetail> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const summaries = await this.queryCourseSummaries(client, courseId);
      const course = summaries[0];
      if (!course) {
        throw new NotFoundException('Curso não encontrado.');
      }

      const modulesRes = await client.query(
        `
        SELECT m.id, m.user_id AS "userId", m.course_id AS "courseId",
               m.drive_source_id AS "driveSourceId", ds.drive_file_id AS "driveFolderId",
               m.title, m.order_index AS "orderIndex", m.created_at AS "createdAt"
          FROM modules m
          LEFT JOIN drive_sources ds ON ds.id = m.drive_source_id AND ds.user_id = m.user_id
         WHERE m.course_id = $1
         ORDER BY m.order_index ASC, m.created_at ASC;
      `,
        [courseId],
      );

      const lessonsRes = await client.query(
        `
        SELECT l.id, l.user_id AS "userId", l.module_id AS "moduleId",
               l.media_source_id AS "mediaSourceId",
               ds.drive_file_id AS "driveFileId",
               ds.mime_type AS "mimeType",
               l.title, l.order_index AS "orderIndex",
               l.duration_seconds AS "durationSeconds",
               l.created_at AS "createdAt",
               COALESCE(lp.last_position_seconds, 0) AS "lastPositionSeconds",
               COALESCE(lp.is_completed, false) AS "isCompleted"
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          LEFT JOIN drive_sources ds ON ds.id = l.media_source_id AND ds.user_id = l.user_id
          LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = l.user_id
         WHERE m.course_id = $1
         ORDER BY m.order_index ASC, l.order_index ASC, l.created_at ASC;
      `,
        [courseId],
      );

      const resourcesRes = await client.query(
        `
        SELECT ld.id, ld.lesson_id AS "lessonId", ld.document_id AS "documentId",
               ld.role, d.title, d.mime_type AS "mimeType", d.byte_size AS "byteSize",
               ds.drive_file_id AS "driveFileId"
          FROM lesson_documents ld
          JOIN lessons l ON l.id = ld.lesson_id
          JOIN modules m ON m.id = l.module_id
          JOIN documents d ON d.id = ld.document_id
          JOIN drive_sources ds ON ds.id = d.drive_source_id
         WHERE m.course_id = $1
         ORDER BY ld.created_at ASC;
      `,
        [courseId],
      );

      await client.query('COMMIT');

      const resourcesByLesson = new Map<string, LessonResource[]>();
      for (const r of resourcesRes.rows) {
        const list = resourcesByLesson.get(r.lessonId) || [];
        list.push({
          id: r.id,
          documentId: r.documentId,
          driveFileId: r.driveFileId,
          title: r.title,
          mimeType: r.mimeType,
          role: r.role,
          byteSize: Number(r.byteSize || 0),
        });
        resourcesByLesson.set(r.lessonId, list);
      }

      const lessonsByModule = new Map<string, LessonDetail[]>();
      for (const l of lessonsRes.rows) {
        const list = lessonsByModule.get(l.moduleId) || [];
        list.push({
          id: l.id,
          userId: l.userId,
          moduleId: l.moduleId,
          mediaSourceId: l.mediaSourceId,
          mediaDriveId: l.driveFileId,
          driveFileId: l.driveFileId,
          mimeType: l.mimeType,
          title: l.title,
          orderIndex: Number(l.orderIndex),
          durationSeconds: Number(l.durationSeconds || 0),
          createdAt: l.createdAt,
          lastPositionSeconds: Number(l.lastPositionSeconds || 0),
          isCompleted: Boolean(l.isCompleted),
          resources: resourcesByLesson.get(l.id) || [],
        });
        lessonsByModule.set(l.moduleId, list);
      }

      const modules: ModuleWithLessons[] = modulesRes.rows.map((m) => ({
        ...m,
        orderIndex: Number(m.orderIndex),
        lessons: lessonsByModule.get(m.id) || [],
      }));

      return {
        ...course,
        modules,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Edição manual dos metadados do curso (D1).
   */
  async updateCourse(
    userId: string,
    courseId: string,
    params: { title?: string; description?: string; instructorName?: string },
  ): Promise<CourseSummary> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const updated = await client.query(
        `
        UPDATE courses
           SET title = COALESCE($2, title),
               description = COALESCE($3, description),
               instructor_name = COALESCE($4, instructor_name),
               updated_at = now()
         WHERE id = $1 AND user_id = app_user_id()
         RETURNING id;
      `,
        [
          courseId,
          params.title?.trim() || null,
          params.description !== undefined ? params.description : null,
          params.instructorName !== undefined ? params.instructorName : null,
        ],
      );

      if (updated.rows.length === 0) {
        throw new NotFoundException('Curso não encontrado.');
      }

      const summaries = await this.queryCourseSummaries(client, courseId);
      const summary = summaries[0];
      if (!summary) {
        throw new NotFoundException('Curso não encontrado.');
      }
      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveCourse(userId: string, courseId: string): Promise<{ success: boolean }> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const res = await client.query(
        `UPDATE courses SET is_archived = true, updated_at = now() WHERE id = $1 AND user_id = app_user_id() RETURNING id;`,
        [courseId],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Curso não encontrado.');
      }
      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getLessonNotes(userId: string, lessonId: string): Promise<LessonNote[]> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const res = await client.query(
        `
        SELECT id, user_id AS "userId", lesson_id AS "lessonId", time_seconds AS "timeSeconds",
               content, lesson_title_snapshot AS "lessonTitleSnapshot",
               course_title_snapshot AS "courseTitleSnapshot",
               created_at AS "createdAt", updated_at AS "updatedAt"
          FROM lesson_notes
         WHERE lesson_id = $1
         ORDER BY time_seconds ASC NULLS LAST, created_at DESC;
      `,
        [lessonId],
      );

      await client.query('COMMIT');
      return res.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Salva uma nota em Markdown com timestamp de vídeo (RF20 / B.3)
   */
  async createLessonNote(params: {
    userId: string;
    lessonId?: string;
    timeSeconds?: number;
    content: string;
  }): Promise<LessonNote> {
    const { userId, lessonId, timeSeconds, content } = params;
    const client = await this.pgPool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      let lessonTitleSnapshot: string | null = null;
      let courseTitleSnapshot: string | null = null;

      if (lessonId) {
        const titleRes = await client.query(
          `
          SELECT l.title AS lesson_title, c.title AS course_title
            FROM lessons l
            JOIN modules m ON m.id = l.module_id
            JOIN courses c ON c.id = m.course_id
           WHERE l.id = $1 AND l.user_id = app_user_id();
        `,
          [lessonId],
        );

        if (titleRes.rows.length > 0) {
          lessonTitleSnapshot = titleRes.rows[0].lesson_title;
          courseTitleSnapshot = titleRes.rows[0].course_title;
        }
      }

      const insertRes = await client.query(
        `
        INSERT INTO lesson_notes (user_id, lesson_id, time_seconds, content, lesson_title_snapshot, course_title_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id AS "userId", lesson_id AS "lessonId", time_seconds AS "timeSeconds",
                  content, lesson_title_snapshot AS "lessonTitleSnapshot",
                  course_title_snapshot AS "courseTitleSnapshot",
                  created_at AS "createdAt", updated_at AS "updatedAt";
      `,
        [userId, lessonId, timeSeconds ?? null, content, lessonTitleSnapshot, courseTitleSnapshot],
      );

      await client.query('COMMIT');
      return insertRes.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Erro ao criar nota da aula', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteLessonNote(userId: string, noteId: string): Promise<{ success: boolean }> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      await client.query(`DELETE FROM lesson_notes WHERE id = $1 AND user_id = app_user_id();`, [
        noteId,
      ]);
      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Atualiza a posição atual de reprodução do vídeo (playhead), duração detectada e sessão diária.
   */
  async updateLessonProgress(params: {
    userId: string;
    lessonId: string;
    positionSeconds: number;
    durationSeconds: number;
    isCompleted?: boolean;
    watchedDeltaSeconds?: number;
  }): Promise<void> {
    const { userId, lessonId, positionSeconds, durationSeconds, isCompleted, watchedDeltaSeconds } =
      params;
    const client = await this.pgPool.connect();

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      // Se o player HTML5 descobriu a duração real do vídeo e o banco estava com 0, atualiza
      if (durationSeconds > 0) {
        await client.query(
          `
          UPDATE lessons
             SET duration_seconds = $2
           WHERE id = $1 AND duration_seconds = 0;
        `,
          [lessonId, durationSeconds],
        );
      }

      const computedCompleted =
        typeof isCompleted === 'boolean'
          ? isCompleted
          : durationSeconds > 0 && positionSeconds >= durationSeconds * 0.85;

      const preserveCompleted = typeof isCompleted === 'boolean';

      await client.query(
        `
        INSERT INTO lesson_progress (user_id, lesson_id, last_position_seconds, is_completed, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (user_id, lesson_id)
        DO UPDATE SET
          last_position_seconds = EXCLUDED.last_position_seconds,
          is_completed = CASE
            WHEN $5 THEN EXCLUDED.is_completed
            ELSE (lesson_progress.is_completed OR EXCLUDED.is_completed)
          END,
          updated_at = now();
      `,
        [userId, lessonId, positionSeconds, computedCompleted, preserveCompleted],
      );

      const safeDelta = Math.min(Math.max(Number(watchedDeltaSeconds || 0), 0), 120);
      if (safeDelta > 0) {
        await client.query(
          `
          INSERT INTO study_sessions (user_id, study_date, duration_seconds, events_count)
          VALUES ($1, CURRENT_DATE, $2, 1)
          ON CONFLICT (user_id, study_date)
          DO UPDATE SET
            duration_seconds = study_sessions.duration_seconds + EXCLUDED.duration_seconds,
            events_count = study_sessions.events_count + 1;
        `,
          [userId, safeDelta],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
