import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import pg from 'pg';
import { ImportDriveFolderResult } from '@devcore/shared';

export const YOUTUBE_PLAYLIST_MIME = 'application/vnd.devcore.youtube-playlist';
export const YOUTUBE_VIDEO_MIME = 'video/youtube';

interface YoutubePlaylistVideoItem {
  videoId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl?: string | null;
}

interface ParsedYoutubePlaylist {
  playlistId: string;
  title: string;
  channelTitle?: string | null;
  thumbnailUrl?: string | null;
  videos: YoutubePlaylistVideoItem[];
}

export function extractYoutubePlaylistId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // URL completa (playlist?list=... ou watch?v=...&list=...)
  const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch?.[1]) {
    return listMatch[1];
  }

  // ID direto de playlist (ex.: PL..., UU..., OLAK..., RD...)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  return '';
}

function parseIso8601Duration(iso?: string | null): number {
  if (!iso) return 0;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseClockDuration(text?: string | null): number {
  if (!text) return 0;
  const parts = text
    .trim()
    .split(':')
    .map((p) => Number(p.replace(/\D/g, '')));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return parts[0] ?? 0;
}

function extractBalancedJsonObject(html: string, marker: string): Record<string, unknown> | null {
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) return null;

  const startIdx = html.indexOf('{', markerIdx + marker.length);
  if (startIdx < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonStr = html.slice(startIdx, i + 1);
        try {
          return JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function readText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  if (typeof obj['simpleText'] === 'string') return obj['simpleText'];
  if (Array.isArray(obj['runs'])) {
    return obj['runs']
      .map((r) => (r && typeof r === 'object' && typeof (r as Record<string, unknown>)['text'] === 'string'
        ? String((r as Record<string, unknown>)['text'])
        : ''))
      .join('');
  }
  return '';
}

function extractVideosFromContents(
  contents: unknown[],
): { videos: YoutubePlaylistVideoItem[]; continuationToken: string | null } {
  const videos: YoutubePlaylistVideoItem[] = [];
  let continuationToken: string | null = null;

  for (const entry of contents) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;

    const videoRenderer = rec['playlistVideoRenderer'] as Record<string, unknown> | undefined;
    if (videoRenderer) {
      const videoId = typeof videoRenderer['videoId'] === 'string' ? videoRenderer['videoId'] : '';
      const isPlayable = videoRenderer['isPlayable'] !== false;
      const title = readText(videoRenderer['title']).trim();
      if (videoId && isPlayable && title && title !== '[Deleted video]' && title !== '[Private video]') {
        const rawLengthSeconds = Number(videoRenderer['lengthSeconds'] || 0);
        const durationSeconds =
          rawLengthSeconds > 0
            ? rawLengthSeconds
            : parseClockDuration(readText(videoRenderer['lengthText']));

        videos.push({
          videoId,
          title,
          durationSeconds,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
      }
      continue;
    }

    const contRenderer = rec['continuationItemRenderer'] as Record<string, unknown> | undefined;
    if (contRenderer) {
      const endpoint = contRenderer['continuationEndpoint'] as Record<string, unknown> | undefined;
      const command = endpoint?.['continuationCommand'] as Record<string, unknown> | undefined;
      if (typeof command?.['token'] === 'string') {
        continuationToken = command['token'];
      }
    }
  }

  return { videos, continuationToken };
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  constructor(private readonly pgPool: pg.Pool) {}

  private async fetchViaOfficialApi(
    playlistId: string,
    apiKey: string,
  ): Promise<ParsedYoutubePlaylist | null> {
    try {
      const metaUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}`;
      const metaRes = await fetch(metaUrl);
      if (!metaRes.ok) {
        return null;
      }

      const metaJson = (await metaRes.json()) as {
        items?: Array<{
          snippet?: {
            title?: string;
            channelTitle?: string;
            thumbnails?: Record<string, { url?: string }>;
          };
        }>;
      };
      const metaItem = metaJson.items?.[0];
      if (!metaItem?.snippet) {
        return null;
      }

      const title = metaItem.snippet.title || 'Playlist do YouTube';
      const channelTitle = metaItem.snippet.channelTitle || null;
      const thumbs = metaItem.snippet.thumbnails;
      const thumbnailUrl =
        thumbs?.['maxres']?.url ||
        thumbs?.['standard']?.url ||
        thumbs?.['high']?.url ||
        thumbs?.['medium']?.url ||
        null;

      const rawItems: Array<{ videoId: string; title: string }> = [];
      let pageToken = '';

      for (let page = 0; page < 20; page++) {
        const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50&key=${encodeURIComponent(apiKey)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const itemsRes = await fetch(itemsUrl);
        if (!itemsRes.ok) break;

        const itemsJson = (await itemsRes.json()) as {
          nextPageToken?: string;
          items?: Array<{
            snippet?: { title?: string; resourceId?: { videoId?: string } };
            contentDetails?: { videoId?: string };
          }>;
        };

        for (const item of itemsJson.items || []) {
          const vid = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '';
          const vTitle = item.snippet?.title?.trim() || '';
          if (vid && vTitle && vTitle !== 'Deleted video' && vTitle !== 'Private video') {
            rawItems.push({ videoId: vid, title: vTitle });
          }
        }

        if (!itemsJson.nextPageToken) break;
        pageToken = itemsJson.nextPageToken;
      }

      // Buscar durações em lotes de 50 vídeos
      const durationMap = new Map<string, number>();
      for (let i = 0; i < rawItems.length; i += 50) {
        const batchIds = rawItems
          .slice(i, i + 50)
          .map((x) => x.videoId)
          .join(',');
        const vidUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(batchIds)}&key=${encodeURIComponent(apiKey)}`;
        const vidRes = await fetch(vidUrl);
        if (!vidRes.ok) continue;

        const vidJson = (await vidRes.json()) as {
          items?: Array<{ id?: string; contentDetails?: { duration?: string } }>;
        };
        for (const v of vidJson.items || []) {
          if (v.id) {
            durationMap.set(v.id, parseIso8601Duration(v.contentDetails?.duration));
          }
        }
      }

      const videos: YoutubePlaylistVideoItem[] = rawItems.map((item) => ({
        videoId: item.videoId,
        title: item.title,
        durationSeconds: durationMap.get(item.videoId) || 0,
        thumbnailUrl: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      }));

      return {
        playlistId,
        title,
        channelTitle,
        thumbnailUrl: thumbnailUrl || videos[0]?.thumbnailUrl || null,
        videos,
      };
    } catch (err) {
      this.logger.debug('Fallback para parser público do YouTube após erro na API v3.', err);
      return null;
    }
  }

  private async fetchViaPublicPage(playlistId: string): Promise<ParsedYoutubePlaylist> {
    const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=pt-BR`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+667',
      },
    });

    if (!res.ok) {
      throw new BadRequestException(
        `Não foi possível acessar a playlist no YouTube (HTTP ${res.status}). Verifique se o link está correto e se a playlist é pública ou não listada.`,
      );
    }

    const html = await res.text();
    const initialData =
      extractBalancedJsonObject(html, 'var ytInitialData =') ||
      extractBalancedJsonObject(html, 'window["ytInitialData"] =');

    if (!initialData) {
      throw new BadRequestException(
        'Não foi possível ler os dados da playlist do YouTube. Verifique se a playlist é pública ou configure YOUTUBE_API_KEY no .env.',
      );
    }

    const metadata = initialData['metadata'] as Record<string, unknown> | undefined;
    const playlistMeta = metadata?.['playlistMetadataRenderer'] as
      | Record<string, unknown>
      | undefined;

    const header = initialData['header'] as Record<string, unknown> | undefined;
    const playlistHeader = header?.['playlistHeaderRenderer'] as
      | Record<string, unknown>
      | undefined;
    const pageHeader = header?.['pageHeaderRenderer'] as Record<string, unknown> | undefined;

    const microformat = initialData['microformat'] as Record<string, unknown> | undefined;
    const microRenderer = microformat?.['microformatDataRenderer'] as
      | Record<string, unknown>
      | undefined;

    let title =
      (typeof playlistMeta?.['title'] === 'string' && playlistMeta['title']) ||
      readText(playlistHeader?.['title']) ||
      (typeof pageHeader?.['pageTitle'] === 'string' && pageHeader['pageTitle']) ||
      (typeof microRenderer?.['title'] === 'string' && microRenderer['title']) ||
      'Playlist do YouTube';

    title = title.replace(/\s*-\s*YouTube$/i, '').trim() || 'Playlist do YouTube';

    let channelTitle: string | null = readText(playlistHeader?.['ownerText']).trim() || null;

    // Fallback para encontrar nome do canal no novo layout pageHeaderViewModel
    if (!channelTitle && pageHeader) {
      const serializedHeader = JSON.stringify(pageHeader);
      const byMatch = serializedHeader.match(/"content":"(?:por|by)\s+([^"]+)"/i);
      if (byMatch?.[1]) {
        channelTitle = byMatch[1];
      }
    }

    // Extrair lista de vídeos
    const contentsRoot = initialData['contents'] as Record<string, unknown> | undefined;
    const twoCol = contentsRoot?.['twoColumnBrowseResultsRenderer'] as
      | Record<string, unknown>
      | undefined;
    const tabs = Array.isArray(twoCol?.['tabs']) ? twoCol['tabs'] : [];
    const firstTab = tabs[0] as Record<string, unknown> | undefined;
    const tabRenderer = firstTab?.['tabRenderer'] as Record<string, unknown> | undefined;
    const tabContent = tabRenderer?.['content'] as Record<string, unknown> | undefined;
    const sectionList = tabContent?.['sectionListRenderer'] as Record<string, unknown> | undefined;
    const sections = Array.isArray(sectionList?.['contents']) ? sectionList['contents'] : [];

    let playlistContents: unknown[] = [];
    for (const sec of sections) {
      if (!sec || typeof sec !== 'object') continue;
      const itemSec = (sec as Record<string, unknown>)['itemSectionRenderer'] as
        | Record<string, unknown>
        | undefined;
      const itemContents = Array.isArray(itemSec?.['contents']) ? itemSec['contents'] : [];
      for (const ic of itemContents) {
        if (!ic || typeof ic !== 'object') continue;
        const pvl = (ic as Record<string, unknown>)['playlistVideoListRenderer'] as
          | Record<string, unknown>
          | undefined;
        if (pvl && Array.isArray(pvl['contents'])) {
          playlistContents = pvl['contents'];
          break;
        }
      }
      if (playlistContents.length > 0) break;
    }

    const firstPage = extractVideosFromContents(playlistContents);
    const allVideos: YoutubePlaylistVideoItem[] = [...firstPage.videos];
    let continuationToken = firstPage.continuationToken;

    // Paginação para playlists com mais de 100 vídeos
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const innertubeKey = apiKeyMatch?.[1];

    if (continuationToken && innertubeKey) {
      for (let page = 0; page < 10 && continuationToken; page++) {
        try {
          const contRes = await fetch(
            `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(innertubeKey)}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              },
              body: JSON.stringify({
                context: {
                  client: {
                    clientName: 'WEB',
                    clientVersion: '2.20250101.00.00',
                    hl: 'pt',
                    gl: 'BR',
                  },
                },
                continuation: continuationToken,
              }),
            },
          );
          if (!contRes.ok) break;
          const contJson = (await contRes.json()) as {
            onResponseReceivedActions?: Array<{
              appendContinuationItemsAction?: { continuationItems?: unknown[] };
            }>;
          };
          const nextItems =
            contJson.onResponseReceivedActions?.[0]?.appendContinuationItemsAction
              ?.continuationItems || [];
          if (nextItems.length === 0) break;

          const parsedNext = extractVideosFromContents(nextItems);
          allVideos.push(...parsedNext.videos);
          continuationToken = parsedNext.continuationToken;
        } catch {
          break;
        }
      }
    }

    if (allVideos.length === 0) {
      throw new BadRequestException(
        'Nenhum vídeo disponível encontrado nessa playlist. Confira se a playlist é pública ou não listada (playlists privadas não podem ser lidas sem permissão).',
      );
    }

    const microThumbs = (microRenderer?.['thumbnail'] as Record<string, unknown> | undefined)?.[
      'thumbnails'
    ];
    let thumbnailUrl: string | null = null;
    if (Array.isArray(microThumbs) && microThumbs.length > 0) {
      const lastThumb = microThumbs[microThumbs.length - 1] as Record<string, unknown> | undefined;
      if (typeof lastThumb?.['url'] === 'string') {
        thumbnailUrl = lastThumb['url'];
      }
    }
    if (!thumbnailUrl && allVideos[0]) {
      thumbnailUrl = allVideos[0].thumbnailUrl || null;
    }

    return {
      playlistId,
      title,
      channelTitle,
      thumbnailUrl,
      videos: allVideos,
    };
  }

  /**
   * Importa ou re-sincroniza uma playlist do YouTube como Curso completo no DevCore.
   */
  async importPlaylist(
    userId: string,
    params: { playlistUrl: string; customTitle?: string },
  ): Promise<ImportDriveFolderResult> {
    const playlistId = extractYoutubePlaylistId(params.playlistUrl);
    if (!playlistId) {
      throw new BadRequestException(
        'Link ou ID de playlist do YouTube inválido. Exemplo: https://www.youtube.com/playlist?list=PL...',
      );
    }

    const ytApiKey = process.env.YOUTUBE_API_KEY?.trim();
    let parsed: ParsedYoutubePlaylist | null = null;

    if (ytApiKey && !ytApiKey.startsWith('your_')) {
      parsed = await this.fetchViaOfficialApi(playlistId, ytApiKey);
    }

    if (!parsed) {
      parsed = await this.fetchViaPublicPage(playlistId);
    }

    return this.persistPlaylist(userId, parsed, params.customTitle?.trim());
  }

  private async persistPlaylist(
    userId: string,
    playlist: ParsedYoutubePlaylist,
    customTitle?: string,
  ): Promise<ImportDriveFolderResult> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const playlistKey = `yt:playlist:${playlist.playlistId}`;
      const displayTitle = (customTitle || playlist.title || 'Playlist do YouTube').slice(0, 255);

      // 1. Upsert da fonte da playlist em drive_sources
      const playlistSourceRes = await client.query(
        `
        INSERT INTO drive_sources (
          user_id, drive_file_id, name, mime_type, is_folder, parent_drive_id, is_active, updated_at
        )
        VALUES ($1, $2, $3, $4, true, NULL, true, now())
        ON CONFLICT (user_id, drive_file_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          mime_type = EXCLUDED.mime_type,
          is_folder = true,
          is_active = true,
          updated_at = now()
        RETURNING id;
      `,
        [userId, playlistKey, displayTitle, YOUTUBE_PLAYLIST_MIME],
      );
      const playlistSourceId: string = playlistSourceRes.rows[0].id;

      // 2. Buscar ou criar o curso
      const existingCourse = await client.query(
        `
        SELECT id, title FROM courses
         WHERE user_id = app_user_id() AND drive_source_id = $1
         LIMIT 1;
      `,
        [playlistSourceId],
      );

      let courseId: string;
      let courseTitle: string;

      if (existingCourse.rows.length > 0) {
        courseId = existingCourse.rows[0].id;
        courseTitle = customTitle || existingCourse.rows[0].title;
        await client.query(
          `
          UPDATE courses
             SET title = COALESCE($2, title),
                 instructor_name = COALESCE(instructor_name, $3),
                 thumbnail_url = COALESCE(thumbnail_url, $4),
                 is_archived = false,
                 updated_at = now()
           WHERE id = $1;
        `,
          [
            courseId,
            customTitle || null,
            playlist.channelTitle?.slice(0, 150) || null,
            playlist.thumbnailUrl || null,
          ],
        );
      } else {
        const createdCourse = await client.query(
          `
          INSERT INTO courses (
            user_id, drive_source_id, title, description, instructor_name, thumbnail_url
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, title;
        `,
          [
            userId,
            playlistSourceId,
            displayTitle,
            `Playlist do YouTube (${playlist.videos.length} aulas).`,
            playlist.channelTitle?.slice(0, 150) || 'YouTube',
            playlist.thumbnailUrl || null,
          ],
        );
        courseId = createdCourse.rows[0].id;
        courseTitle = createdCourse.rows[0].title;
      }

      // Garantir matrícula automática
      await client.query(
        `
        INSERT INTO enrollments (user_id, course_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, course_id) DO NOTHING;
      `,
        [userId, courseId],
      );

      // 3. Módulo principal da playlist
      const existingMod = await client.query(
        `
        SELECT id FROM modules
         WHERE user_id = app_user_id() AND course_id = $1 AND drive_source_id = $2
         LIMIT 1;
      `,
        [courseId, playlistSourceId],
      );

      let moduleId: string;
      if (existingMod.rows.length > 0) {
        moduleId = existingMod.rows[0].id;
      } else {
        const createdMod = await client.query(
          `
          INSERT INTO modules (user_id, course_id, drive_source_id, title, order_index)
          VALUES ($1, $2, $3, $4, 1)
          RETURNING id;
        `,
          [userId, courseId, playlistSourceId, 'Módulo 01 — Aulas da Playlist'],
        );
        moduleId = createdMod.rows[0].id;
      }

      // 4. Upsert de todos os vídeos mantendo progresso e notas existentes
      let lessonsCount = 0;
      const seenIds = new Set<string>();

      for (const video of playlist.videos) {
        if (seenIds.has(video.videoId)) continue;
        seenIds.add(video.videoId);
        lessonsCount++;

        const videoKey = `yt:video:${video.videoId}`;
        const videoSourceRes = await client.query(
          `
          INSERT INTO drive_sources (
            user_id, drive_file_id, name, mime_type, is_folder, parent_drive_id, is_active, updated_at
          )
          VALUES ($1, $2, $3, $4, false, $5, true, now())
          ON CONFLICT (user_id, drive_file_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            mime_type = EXCLUDED.mime_type,
            parent_drive_id = EXCLUDED.parent_drive_id,
            is_active = true,
            updated_at = now()
          RETURNING id;
        `,
          [userId, videoKey, video.title.slice(0, 255), YOUTUBE_VIDEO_MIME, playlistKey],
        );
        const mediaSourceId: string = videoSourceRes.rows[0].id;

        const existingLesson = await client.query(
          `
          SELECT id FROM lessons
           WHERE user_id = app_user_id() AND module_id = $1 AND media_source_id = $2
           LIMIT 1;
        `,
          [moduleId, mediaSourceId],
        );

        if (existingLesson.rows.length > 0) {
          await client.query(
            `
            UPDATE lessons
               SET title = $1,
                   order_index = $2,
                   duration_seconds = CASE WHEN $3 > 0 THEN $3 ELSE duration_seconds END
             WHERE id = $4;
          `,
            [
              video.title.slice(0, 255),
              lessonsCount,
              video.durationSeconds,
              existingLesson.rows[0].id,
            ],
          );
        } else {
          await client.query(
            `
            INSERT INTO lessons (user_id, module_id, media_source_id, title, order_index, duration_seconds)
            VALUES ($1, $2, $3, $4, $5, $6);
          `,
            [
              userId,
              moduleId,
              mediaSourceId,
              video.title.slice(0, 255),
              lessonsCount,
              video.durationSeconds,
            ],
          );
        }
      }

      // Recalcular total_hours do curso
      await client.query(
        `
        UPDATE courses c
           SET total_hours = COALESCE((
                 SELECT ROUND(SUM(l.duration_seconds)::numeric / 3600.0, 2)
                   FROM lessons l
                   JOIN modules m ON m.id = l.module_id
                  WHERE m.course_id = c.id
               ), 0),
               updated_at = now()
         WHERE c.id = $1;
      `,
        [courseId],
      );

      await client.query('COMMIT');

      return {
        courseId,
        title: courseTitle,
        modulesCount: 1,
        lessonsCount,
        documentsCount: 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Re-sincroniza um curso de playlist do YouTube para buscar vídeos novos.
   */
  async syncCourse(userId: string, courseId: string): Promise<ImportDriveFolderResult> {
    const client = await this.pgPool.connect();
    let driveFileId: string | null = null;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const res = await client.query(
        `
        SELECT ds.drive_file_id AS "driveFileId"
          FROM courses c
          LEFT JOIN drive_sources ds ON ds.id = c.drive_source_id AND ds.user_id = c.user_id
         WHERE c.id = $1 AND c.user_id = app_user_id();
      `,
        [courseId],
      );

      await client.query('COMMIT');

      if (res.rows.length === 0) {
        throw new NotFoundException('Curso não encontrado.');
      }
      driveFileId = res.rows[0].driveFileId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (!driveFileId || !driveFileId.startsWith('yt:playlist:')) {
      throw new BadRequestException('Este curso não está vinculado a uma playlist do YouTube.');
    }

    const playlistId = driveFileId.slice('yt:playlist:'.length);
    return this.importPlaylist(userId, { playlistUrl: playlistId });
  }
}
