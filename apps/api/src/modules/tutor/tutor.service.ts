import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import https from 'node:https';
import pg from 'pg';
import type {
  TutorChatResponse,
  TutorContextSummary,
  TutorHistoryResponse,
  TutorMessageItem,
  TutorStatusResponse,
} from '@devcore/shared';
import { DriveService } from '../drive/drive.service.js';

interface CachedText {
  text: string;
  expiresAt: number;
}

interface CourseContextBundle {
  systemPrompt: string;
  summary: TutorContextSummary;
  lessonTitle: string | null;
  courseTitle: string;
}

const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const FALLBACK_GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function isPlaceholder(val?: string | null): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return !trimmed || trimmed.startsWith('your_') || trimmed.startsWith('sua_') || trimmed.startsWith('cole_');
}

function isReadableTextFile(mimeType: string, name: string): boolean {
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType === 'application/vnd.google-apps.presentation'
  ) {
    return true;
  }
  const lower = name.toLowerCase();
  return /\.(vtt|srt|txt|md|markdown|ts|tsx|js|jsx|py|go|java|sql|json|yaml|yml|html|css|sh)$/.test(
    lower,
  );
}

function stripVttNoise(raw: string): string {
  return raw
    .replace(/^WEBVTT.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  private readonly textCache = new Map<string, CachedText>();
  private discoveredModelCache: { model: string; expiresAt: number } | null = null;

  constructor(
    private readonly pgPool: pg.Pool,
    private readonly driveService: DriveService,
  ) {}

  private getGeminiApiKey(): string | null {
    const direct = process.env.GEMINI_API_KEY?.trim();
    if (!isPlaceholder(direct)) return direct!;

    const llmKey = process.env.LLM_API_KEY?.trim();
    const provider = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    if (!isPlaceholder(llmKey) && (provider === 'gemini' || llmKey!.startsWith('AIza'))) {
      return llmKey!;
    }
    return null;
  }

  private getConfiguredModel(): string {
    const explicit = process.env.GEMINI_MODEL?.trim();
    if (explicit) return explicit;
    const llmProvider = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    const llmModel = process.env.LLM_MODEL?.trim();
    if (llmProvider === 'gemini' && llmModel && llmModel.startsWith('gemini')) {
      return llmModel;
    }
    return DEFAULT_GEMINI_MODEL;
  }

  getStatus(): TutorStatusResponse {
    return {
      configured: Boolean(this.getGeminiApiKey()),
      provider: 'gemini',
      model: this.getConfiguredModel(),
    };
  }

  private httpsRequestIpv4(
    targetUrl: string,
    options: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: options.method || 'GET',
          headers: options.headers,
          family: 4,
          timeout: 30_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              text: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timeout ao comunicar com o Gemini.')));
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  private async httpRequest(
    targetUrl: string,
    options: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{ ok: boolean; status: number; text: string }> {
    try {
      const res = await fetch(targetUrl, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch {
      const fallback = await this.httpsRequestIpv4(targetUrl, options);
      return {
        ok: fallback.status >= 200 && fallback.status < 300,
        status: fallback.status,
        text: fallback.text,
      };
    }
  }

  private getCachedText(key: string): string | null {
    const entry = this.textCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.textCache.delete(key);
      return null;
    }
    return entry.text;
  }

  private setCachedText(key: string, text: string, ttlMs = 15 * 60 * 1000): void {
    if (this.textCache.size > 150) {
      const firstKey = this.textCache.keys().next().value;
      if (firstKey) this.textCache.delete(firstKey);
    }
    this.textCache.set(key, { text, expiresAt: Date.now() + ttlMs });
  }

  private async fetchDriveTextSnippet(
    userId: string,
    driveFileId: string,
    mimeType: string,
    name: string,
  ): Promise<string | null> {
    const cacheKey = `drive:${userId}:${driveFileId}`;
    const cached = this.getCachedText(cacheKey);
    if (cached !== null) return cached;

    try {
      const { accessToken } = await this.driveService.getValidAccessToken(userId);
      const isGoogleDoc = mimeType.startsWith('application/vnd.google-apps.');
      const url = isGoogleDoc
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}/export?mimeType=text/plain`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media&supportsAllDrives=true`;

      const res = await this.httpRequest(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Range: isGoogleDoc ? '' : 'bytes=0-32768',
        },
      });

      if (!res.ok && res.status !== 206) {
        return null;
      }

      let content = res.text;
      if (/\.(vtt|srt)$/i.test(name)) {
        content = stripVttNoise(content);
      }
      content = content.trim().slice(0, 10_000);
      if (content) {
        this.setCachedText(cacheKey, content);
      }
      return content || null;
    } catch {
      return null;
    }
  }

  /**
   * Busca best-effort da legenda/transcrição pública de uma aula do YouTube (se disponível).
   */
  private async fetchYoutubeCaptionSnippet(videoId: string): Promise<string | null> {
    const cacheKey = `yt-caption:${videoId}`;
    const cached = this.getCachedText(cacheKey);
    if (cached !== null) return cached || null;

    try {
      const watchRes = await this.httpRequest(
        `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=pt-BR`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+667',
          },
        },
      );
      if (!watchRes.ok) {
        this.setCachedText(cacheKey, '', 5 * 60 * 1000);
        return null;
      }

      const match = watchRes.text.match(/"captionTracks":(\[[\s\S]*?\])/);
      if (!match?.[1]) {
        this.setCachedText(cacheKey, '', 10 * 60 * 1000);
        return null;
      }

      const tracks = JSON.parse(match[1]) as Array<{
        baseUrl?: string;
        languageCode?: string;
      }>;

      const preferred =
        tracks.find((t) => t.languageCode?.startsWith('pt')) ||
        tracks.find((t) => t.languageCode?.startsWith('en')) ||
        tracks[0];

      if (!preferred?.baseUrl) {
        this.setCachedText(cacheKey, '', 10 * 60 * 1000);
        return null;
      }

      const capRes = await this.httpRequest(preferred.baseUrl);
      if (!capRes.ok) {
        this.setCachedText(cacheKey, '', 5 * 60 * 1000);
        return null;
      }

      const segments: string[] = [];
      const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
      let m: RegExpExecArray | null;
      while ((m = textRegex.exec(capRes.text)) !== null) {
        if (m[1]) {
          segments.push(decodeHtmlEntities(m[1]));
        }
      }

      const transcript = segments.join(' ').trim().slice(0, 14_000);
      this.setCachedText(cacheKey, transcript, 30 * 60 * 1000);
      return transcript || null;
    } catch {
      this.setCachedText(cacheKey, '', 5 * 60 * 1000);
      return null;
    }
  }

  /**
   * Monta todo o contexto específico do curso + aula atual (grade completa, notas do aluno,
   * transcrições e materiais anexados) respeitando RLS.
   */
  private async buildCourseContext(
    userId: string,
    courseId: string,
    lessonId?: string,
    currentTimeSeconds?: number,
    fetchExternalMaterials = true,
  ): Promise<CourseContextBundle> {
    const client = await this.pgPool.connect();
    let courseRow: {
      id: string;
      title: string;
      description: string | null;
      instructorName: string | null;
    };
    let modulesRows: Array<{ id: string; title: string; orderIndex: number }>;
    let lessonsRows: Array<{
      id: string;
      moduleId: string;
      title: string;
      orderIndex: number;
      durationSeconds: number;
      isCompleted: boolean;
      lastPositionSeconds: number;
      driveFileId: string | null;
      mimeType: string | null;
    }>;
    let notesRows: Array<{
      lessonId: string | null;
      lessonTitle: string | null;
      timeSeconds: number | null;
      content: string;
    }>;
    let resourcesRows: Array<{
      lessonId: string;
      role: string;
      title: string;
      mimeType: string;
      driveFileId: string;
      fileName: string;
    }>;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const cRes = await client.query(
        `
        SELECT id, title, description, instructor_name AS "instructorName"
          FROM courses
         WHERE id = $1 AND user_id = app_user_id();
      `,
        [courseId],
      );
      if (cRes.rows.length === 0) {
        throw new NotFoundException('Curso não encontrado.');
      }
      courseRow = cRes.rows[0];

      const mRes = await client.query(
        `
        SELECT id, title, order_index AS "orderIndex"
          FROM modules
         WHERE course_id = $1
         ORDER BY order_index ASC, created_at ASC;
      `,
        [courseId],
      );
      modulesRows = mRes.rows;

      const lRes = await client.query(
        `
        SELECT l.id, l.module_id AS "moduleId", l.title, l.order_index AS "orderIndex",
               l.duration_seconds AS "durationSeconds",
               COALESCE(lp.is_completed, false) AS "isCompleted",
               COALESCE(lp.last_position_seconds, 0) AS "lastPositionSeconds",
               ds.drive_file_id AS "driveFileId",
               ds.mime_type AS "mimeType"
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = l.user_id
          LEFT JOIN drive_sources ds ON ds.id = l.media_source_id AND ds.user_id = l.user_id
         WHERE m.course_id = $1
         ORDER BY m.order_index ASC, l.order_index ASC;
      `,
        [courseId],
      );
      lessonsRows = lRes.rows;

      const nRes = await client.query(
        `
        SELECT ln.lesson_id AS "lessonId",
               COALESCE(l.title, ln.lesson_title_snapshot) AS "lessonTitle",
               ln.time_seconds AS "timeSeconds",
               ln.content
          FROM lesson_notes ln
          JOIN lessons l ON l.id = ln.lesson_id
          JOIN modules m ON m.id = l.module_id
         WHERE m.course_id = $1
         ORDER BY (ln.lesson_id = $2) DESC, ln.updated_at DESC
         LIMIT 25;
      `,
        [courseId, lessonId || null],
      );
      notesRows = nRes.rows;

      const rRes = await client.query(
        `
        SELECT ld.lesson_id AS "lessonId", ld.role, d.title, d.mime_type AS "mimeType",
               ds.drive_file_id AS "driveFileId", ds.name AS "fileName"
          FROM lesson_documents ld
          JOIN lessons l ON l.id = ld.lesson_id
          JOIN modules m ON m.id = l.module_id
          JOIN documents d ON d.id = ld.document_id
          JOIN drive_sources ds ON ds.id = d.drive_source_id
         WHERE m.course_id = $1
         ORDER BY (ld.lesson_id = $2) DESC,
                  CASE ld.role WHEN 'transcript' THEN 0 WHEN 'code' THEN 1 ELSE 2 END ASC;
      `,
        [courseId, lessonId || null],
      );
      resourcesRows = rRes.rows;

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const activeLesson =
      (lessonId && lessonsRows.find((l) => l.id === lessonId)) || lessonsRows[0] || null;
    const activeModule = activeLesson
      ? modulesRows.find((m) => m.id === activeLesson.moduleId) || null
      : null;

    // Extrair conteúdo de transcrições / textos / código anexados (priorizando a aula atual)
    const extractedMaterials: Array<{ label: string; content: string }> = [];
    let hasTranscript = false;

    if (fetchExternalMaterials) {
      const readableResources = resourcesRows
        .filter((r) => isReadableTextFile(r.mimeType, r.fileName))
        .slice(0, 4);

      for (const res of readableResources) {
        const snippet = await this.fetchDriveTextSnippet(
          userId,
          res.driveFileId,
          res.mimeType,
          res.fileName,
        );
        if (snippet) {
          if (res.role === 'transcript' || /\.(vtt|srt)$/i.test(res.fileName)) {
            hasTranscript = true;
          }
          extractedMaterials.push({
            label: `[${res.role.toUpperCase()}] ${res.title} (${res.fileName})`,
            content: snippet,
          });
        }
      }

      // Se a aula ativa for um vídeo do YouTube e ainda não houver transcrição, tentar legenda pública
      if (
        !hasTranscript &&
        activeLesson?.driveFileId &&
        activeLesson.driveFileId.startsWith('yt:video:')
      ) {
        const videoId = activeLesson.driveFileId.slice('yt:video:'.length);
        const ytTranscript = await this.fetchYoutubeCaptionSnippet(videoId);
        if (ytTranscript) {
          hasTranscript = true;
          extractedMaterials.unshift({
            label: `[TRANSCRIÇÃO YOUTUBE] ${activeLesson.title}`,
            content: ytTranscript,
          });
        }
      }
    }

    // Montar syllabus legível do curso
    const curriculumLines: string[] = [];
    for (const mod of modulesRows) {
      curriculumLines.push(`Módulo: ${mod.title}`);
      const modLessons = lessonsRows.filter((l) => l.moduleId === mod.id);
      for (const les of modLessons) {
        const marker = les.id === activeLesson?.id ? ' [AULA ATUAL]' : '';
        const status = les.isCompleted ? ' (concluída)' : '';
        const dur = les.durationSeconds > 0 ? ` [${formatClock(les.durationSeconds)}]` : '';
        curriculumLines.push(`  - ${les.orderIndex}. ${les.title}${dur}${status}${marker}`);
      }
    }

    const notesText =
      notesRows.length > 0
        ? notesRows
            .map((n) => {
              const ts =
                n.timeSeconds !== null && n.timeSeconds !== undefined
                  ? ` (${formatClock(n.timeSeconds)})`
                  : '';
              return `- [${n.lessonTitle || 'Aula'}${ts}]: ${n.content}`;
            })
            .join('\n')
        : 'Nenhuma anotação do aluno registrada ainda.';

    const materialsText =
      extractedMaterials.length > 0
        ? extractedMaterials
            .map((m) => `### ${m.label}\n${m.content}`)
            .join('\n\n')
            .slice(0, 28_000)
        : 'Nenhuma transcrição ou arquivo de texto adicional carregado para esta aula; baseie-se na ementa do curso, no título da aula atual e no conhecimento técnico consolidado sobre o tema do curso.';

    const playheadInfo =
      typeof currentTimeSeconds === 'number' && currentTimeSeconds > 0
        ? formatClock(currentTimeSeconds)
        : activeLesson?.lastPositionSeconds
          ? formatClock(activeLesson.lastPositionSeconds)
          : '00:00';

    const systemPrompt = [
      `Você é o Tutor Técnico IA do DevCore, especializado EXCLUSIVAMENTE no curso "${courseRow.title}".`,
      `Responda sempre em português do Brasil (pt-BR), de forma clara, didática, direta e prática (usando exemplos de código e listas curtas quando ajudar).`,
      `Use o contexto real do curso abaixo para conectar sua explicação exatamente ao módulo, à aula atual e às anotações do estudante.`,
      `Se houver transcrição ou material de apoio carregado abaixo, priorize-o como fonte principal. Se algo não estiver explícito nos materiais do curso, explique o conceito técnico corretamente deixando claro quando está complementando além da aula.`,
      ``,
      `=== DADOS DO CURSO ===`,
      `Título: ${courseRow.title}`,
      courseRow.instructorName ? `Instrutor/Canal: ${courseRow.instructorName}` : '',
      courseRow.description ? `Descrição: ${courseRow.description}` : '',
      activeModule ? `Módulo atual: ${activeModule.title}` : '',
      activeLesson ? `Aula atual: ${activeLesson.title} (minuto atual: ${playheadInfo})` : '',
      ``,
      `=== EMENTA COMPLETA DO CURSO ===`,
      curriculumLines.join('\n').slice(0, 12_000),
      ``,
      `=== ANOTAÇÕES DO ESTUDANTE NESTE CURSO ===`,
      notesText.slice(0, 4_000),
      ``,
      `=== MATERIAIS E TRANSCRIÇÕES CARREGADOS ===`,
      materialsText,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      systemPrompt,
      courseTitle: courseRow.title,
      lessonTitle: activeLesson?.title || null,
      summary: {
        courseTitle: courseRow.title,
        activeLessonTitle: activeLesson?.title || null,
        modulesCount: modulesRows.length,
        lessonsCount: lessonsRows.length,
        notesCount: notesRows.length,
        resourcesLoaded: extractedMaterials.length,
        hasTranscript,
      },
    };
  }

  /**
   * Busca o histórico salvo de conversa do Tutor para a aula (ou curso).
   */
  async getHistory(
    userId: string,
    courseId: string,
    lessonId?: string,
  ): Promise<TutorHistoryResponse> {
    const context = await this.buildCourseContext(userId, courseId, lessonId, undefined, false);

    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const convRes = lessonId
        ? await client.query(
            `
            SELECT id FROM conversations
             WHERE user_id = app_user_id() AND lesson_id = $1
             ORDER BY created_at DESC
             LIMIT 1;
          `,
            [lessonId],
          )
        : await client.query(
            `
            SELECT c.id FROM conversations c
            JOIN lessons l ON l.id = c.lesson_id
            JOIN modules m ON m.id = l.module_id
            WHERE c.user_id = app_user_id() AND m.course_id = $1
            ORDER BY c.created_at DESC
            LIMIT 1;
          `,
            [courseId],
          );

      if (convRes.rows.length === 0) {
        await client.query('COMMIT');
        return {
          conversationId: null,
          messages: [],
          contextSummary: context.summary,
        };
      }

      const conversationId: string = convRes.rows[0].id;
      const msgRes = await client.query(
        `
        SELECT id, role, content, created_at AS "createdAt"
          FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC
         LIMIT 60;
      `,
        [conversationId],
      );

      await client.query('COMMIT');

      const messages: TutorMessageItem[] = msgRes.rows
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));

      return {
        conversationId,
        messages,
        contextSummary: context.summary,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async discoverGeminiModels(apiKey: string): Promise<{ models: string[]; error?: string }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await this.httpRequest(url, { method: 'GET' });
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(res.text) as { error?: { message?: string } };
        if (j.error?.message) errMsg = j.error.message;
      } catch {
        // mantém status
      }
      return { models: [], error: errMsg };
    }

    try {
      const data = JSON.parse(res.text) as {
        models?: Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      const eligible = (data.models || [])
        .filter(
          (m) =>
            m.name &&
            m.name.includes('gemini') &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m) => m.name!.replace(/^models\//, ''));

      // Priorizar modelos flash mais novos (não-experimental / não-tts / não-image)
      const ranked = [...eligible].sort((a, b) => {
        const score = (name: string) => {
          let s = 0;
          if (name.includes('flash')) s += 50;
          if (name.includes('3.') || name.includes('3-')) s += 30;
          if (name.includes('2.5')) s += 25;
          if (name.includes('2.0')) s += 15;
          if (name.includes('latest')) s += 10;
          if (name.includes('lite')) s -= 5;
          if (name.includes('preview') || name.includes('exp')) s -= 8;
          if (name.includes('tts') || name.includes('image') || name.includes('thinking')) s -= 40;
          return s;
        };
        return score(b) - score(a);
      });

      this.logger.log(`Modelos Gemini descobertos na conta: ${ranked.slice(0, 6).join(', ')}`);
      return { models: ranked };
    } catch {
      return { models: [] };
    }
  }

  private async callGemini(
    apiKey: string,
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ text: string; modelUsed: string }> {
    const preferredModel =
      this.discoveredModelCache && this.discoveredModelCache.expiresAt > Date.now()
        ? this.discoveredModelCache.model
        : this.getConfiguredModel();

    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    });

    const tryModel = async (
      model: string,
    ): Promise<{ ok: true; text: string } | { ok: false; status: number; errMsg: string }> => {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await this.httpRequest(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      if (res.ok) {
        const parsed = JSON.parse(res.text) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const replyText =
          parsed.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || '')
            .join('')
            .trim() || '';

        if (replyText) {
          return { ok: true, text: replyText };
        }
        return { ok: false, status: 502, errMsg: 'O Gemini retornou uma resposta vazia.' };
      }

      let apiErr = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(res.text) as { error?: { message?: string } };
        if (errJson.error?.message) {
          apiErr = errJson.error.message;
        }
      } catch {
        // mantém HTTP status
      }
      return { ok: false, status: res.status, errMsg: apiErr };
    };

    // 1. Tenta o modelo preferido / cacheado primeiro
    const initialList = Array.from(new Set([preferredModel, ...FALLBACK_GEMINI_MODELS]));
    let lastErrorMessage = 'Falha ao consultar a API do Google Gemini.';
    let shouldDiscoverFallback = true;

    const isRetryableAcrossModels = (status: number) =>
      status === 404 || status === 429 || status === 503;

    for (const model of initialList) {
      const attempt = await tryModel(model);
      if (attempt.ok) {
        this.discoveredModelCache = { model, expiresAt: Date.now() + 60 * 60 * 1000 };
        return { text: attempt.text, modelUsed: model };
      }
      lastErrorMessage = `Erro no Gemini (${model}): ${attempt.errMsg}`;
      if (isRetryableAcrossModels(attempt.status)) {
        this.logger.warn(`Modelo Gemini ${model} retornou ${attempt.status}: ${attempt.errMsg}`);
        continue;
      }
      shouldDiscoverFallback = false;
      this.logger.error(lastErrorMessage);
      break;
    }

    // 2. Se os modelos padrão deram 404/429/503, descobre dinamicamente os modelos ativos na chave!
    if (shouldDiscoverFallback) {
      const discovered = await this.discoverGeminiModels(apiKey);
      if (discovered.error) {
        throw new ServiceUnavailableException(
          `Erro ao validar sua GEMINI_API_KEY no Google AI Studio: ${discovered.error}`,
        );
      }

      const extraModels = discovered.models.filter((m) => !initialList.includes(m)).slice(0, 6);
      for (const model of extraModels) {
        const attempt = await tryModel(model);
        if (attempt.ok) {
          this.discoveredModelCache = { model, expiresAt: Date.now() + 60 * 60 * 1000 };
          return { text: attempt.text, modelUsed: model };
        }
        lastErrorMessage = `Erro no Gemini (${model}): ${attempt.errMsg}`;
        if (!isRetryableAcrossModels(attempt.status)) {
          this.logger.error(lastErrorMessage);
          break;
        }
        this.logger.warn(`Fallback Gemini ${model} retornou ${attempt.status}: ${attempt.errMsg}`);
      }
    }

    throw new ServiceUnavailableException(lastErrorMessage);
  }

  /**
   * Envia uma pergunta ao Tutor Gemini com contexto do curso/aula e salva no PostgreSQL.
   */
  async chat(
    userId: string,
    courseId: string,
    params: { lessonId?: string; message: string; currentTimeSeconds?: number },
  ): Promise<TutorChatResponse> {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      throw new BadRequestException(
        'GEMINI_API_KEY não configurada no servidor. Crie uma chave gratuita em aistudio.google.com/apikey e adicione GEMINI_API_KEY=... no .env / .env.prod.',
      );
    }

    const cleanMessage = params.message.trim();
    if (!cleanMessage) {
      throw new BadRequestException('Digite uma pergunta para o Tutor.');
    }

    const context = await this.buildCourseContext(
      userId,
      courseId,
      params.lessonId,
      params.currentTimeSeconds,
      true,
    );

    // 1. Garantir conversa e salvar mensagem do usuário
    const client = await this.pgPool.connect();
    let conversationId: string;
    let userMessage: TutorMessageItem;
    let recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const existingConv = params.lessonId
        ? await client.query(
            `SELECT id FROM conversations WHERE user_id = app_user_id() AND lesson_id = $1 ORDER BY created_at DESC LIMIT 1;`,
            [params.lessonId],
          )
        : await client.query(
            `SELECT id FROM conversations WHERE user_id = app_user_id() AND lesson_id IS NULL AND title = $1 ORDER BY created_at DESC LIMIT 1;`,
            [`Tutor: ${context.courseTitle}`.slice(0, 255)],
          );

      if (existingConv.rows.length > 0) {
        conversationId = existingConv.rows[0].id;
      } else {
        const convTitle = (context.lessonTitle || `Tutor: ${context.courseTitle}`).slice(0, 255);
        const createdConv = await client.query(
          `
          INSERT INTO conversations (user_id, lesson_id, title)
          VALUES ($1, $2, $3)
          RETURNING id;
        `,
          [userId, params.lessonId || null, convTitle],
        );
        conversationId = createdConv.rows[0].id;
      }

      const insertedUser = await client.query(
        `
        INSERT INTO messages (user_id, conversation_id, role, content)
        VALUES ($1, $2, 'user', $3)
        RETURNING id, role, content, created_at AS "createdAt";
      `,
        [userId, conversationId, cleanMessage],
      );
      userMessage = insertedUser.rows[0];

      const histRes = await client.query(
        `
        SELECT role, content
          FROM (
            SELECT role, content, created_at
              FROM messages
             WHERE conversation_id = $1
             ORDER BY created_at DESC
             LIMIT 14
          ) sub
         ORDER BY created_at ASC;
      `,
        [conversationId],
      );
      recentHistory = histRes.rows.filter(
        (r) => r.role === 'user' || r.role === 'assistant',
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // 2. Chamar Google Gemini fora da transação do banco
    const { text: replyText, modelUsed } = await this.callGemini(
      apiKey,
      context.systemPrompt,
      recentHistory,
    );

    // 3. Persistir resposta do Tutor
    const replyClient = await this.pgPool.connect();
    let assistantMessage: TutorMessageItem;
    try {
      await replyClient.query('BEGIN');
      await replyClient.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const insertedAssistant = await replyClient.query(
        `
        INSERT INTO messages (user_id, conversation_id, role, content)
        VALUES ($1, $2, 'assistant', $3)
        RETURNING id, role, content, created_at AS "createdAt";
      `,
        [userId, conversationId, replyText],
      );
      assistantMessage = insertedAssistant.rows[0];

      await replyClient.query('COMMIT');
    } catch (error) {
      await replyClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      replyClient.release();
    }

    return {
      conversationId,
      userMessage,
      assistantMessage,
      model: modelUsed,
      contextSummary: context.summary,
    };
  }

  async clearConversation(userId: string, conversationId: string): Promise<{ success: boolean }> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      await client.query(
        `DELETE FROM conversations WHERE id = $1 AND user_id = app_user_id();`,
        [conversationId],
      );
      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
