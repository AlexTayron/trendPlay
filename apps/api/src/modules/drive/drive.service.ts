import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import pg from 'pg';
import { drive_v3, google } from 'googleapis';
import {
  DriveConnectionStatus,
  DriveFileEntry,
  DriveFolderListResponse,
  DriveItemsListResponse,
  ImportDriveFolderResult,
  ImportRootFolderResult,
  PickerTokenResponse,
} from '@devcore/shared';
import { AuthService } from '../auth/auth.service.js';
import { YoutubeService } from '../youtube/youtube.service.js';
import { TokenCryptoService } from '../../common/crypto/token-crypto.service.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  md5Checksum?: string | null;
  modifiedTime?: string | null;
  parentId?: string | null;
  durationSeconds: number;
}

export interface PickedDriveFileInput {
  id: string;
  name: string;
  mimeType?: string;
}

type FileCategory = 'folder' | 'video' | 'audio' | 'transcript' | 'code' | 'document' | 'ignore';

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return name.trim();
  return name.slice(0, idx).trim();
}

function normalizeStem(name: string): string {
  return stripExtension(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

function classifyDriveItem(mimeType: string, name: string): FileCategory {
  const lowerName = name.toLowerCase();
  if (
    lowerName === '.ds_store' ||
    lowerName === 'thumbs.db' ||
    lowerName === 'desktop.ini' ||
    lowerName.startsWith('._')
  ) {
    return 'ignore';
  }

  if (mimeType === FOLDER_MIME) return 'folder';

  const ext = getExtension(name);
  if (
    mimeType.startsWith('video/') ||
    ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'ogv'].includes(ext)
  ) {
    return 'video';
  }

  if (
    mimeType.startsWith('audio/') ||
    ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'].includes(ext)
  ) {
    return 'audio';
  }

  if (['vtt', 'srt'].includes(ext)) {
    return 'transcript';
  }

  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'py',
      'go',
      'java',
      'kt',
      'rs',
      'c',
      'cpp',
      'cs',
      'sql',
      'json',
      'yaml',
      'yml',
      'toml',
      'sh',
      'bash',
      'html',
      'css',
      'scss',
      'dockerfile',
    ].includes(ext)
  ) {
    return 'code';
  }

  if (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.google-apps.document' ||
    mimeType === 'application/vnd.google-apps.presentation' ||
    mimeType === 'application/vnd.google-apps.spreadsheet' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('text/') ||
    [
      'pdf',
      'md',
      'markdown',
      'txt',
      'doc',
      'docx',
      'ppt',
      'pptx',
      'zip',
      'epub',
      'png',
      'jpg',
      'jpeg',
      'webp',
      'gif',
      'svg',
      'bmp',
    ].includes(ext)
  ) {
    return 'document';
  }

  return 'ignore';
}

export function extractDriveId(input: string): string {
  const trimmed = input.trim();
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];

  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) return fileMatch[1];

  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) return idParamMatch[1];

  return trimmed;
}

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);

  constructor(
    private readonly pgPool: pg.Pool,
    private readonly authService: AuthService,
    private readonly youtubeService: YoutubeService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  async getConnectionStatus(userId: string): Promise<DriveConnectionStatus> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

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

      await client.query('COMMIT');

      const conn = connRes.rows[0];
      const sync = syncRes.rows[0];

      if (!conn) {
        return {
          connected: false,
          status: 'disconnected',
          syncStatus: 'idle',
        };
      }

      return {
        connected: conn.status === 'active',
        status: conn.status,
        scope: conn.tokenScope,
        expiresAt: conn.expiresAt,
        lastSyncedAt: sync?.lastSyncedAt || null,
        syncStatus: sync?.syncStatus || 'idle',
        errorMessage: sync?.errorMessage || null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retorna um access_token válido para o usuário, renovando automaticamente
   * via refresh_token criptografado quando expirar em menos de 5 minutos.
   */
  async getValidAccessToken(userId: string): Promise<{
    accessToken: string;
    expiresAt: Date;
    scope: string;
  }> {
    const client = await this.pgPool.connect();
    let encryptedAccess: string;
    let encryptedRefresh: string;
    let expiresAt: Date;
    let scope: string;
    let status: string;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const res = await client.query(`
        SELECT encrypted_access_token, encrypted_refresh_token,
               token_scope, expires_at, status
          FROM google_connections
         WHERE user_id = app_user_id();
      `);

      await client.query('COMMIT');

      if (res.rows.length === 0) {
        throw new UnauthorizedException(
          'Conta Google Drive não conectada. Faça login com o Google para conectar.',
        );
      }

      const row = res.rows[0];
      encryptedAccess = row.encrypted_access_token;
      encryptedRefresh = row.encrypted_refresh_token;
      expiresAt = new Date(row.expires_at);
      scope = row.token_scope;
      status = row.status;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (status === 'revoked') {
      throw new UnauthorizedException(
        'Conexão com o Google Drive foi revogada. Reconecte sua conta.',
      );
    }

    const fiveMinutesMs = 5 * 60 * 1000;
    if (status === 'active' && expiresAt.getTime() > Date.now() + fiveMinutesMs) {
      return {
        accessToken: this.tokenCrypto.decrypt(encryptedAccess),
        expiresAt,
        scope,
      };
    }

    if (!encryptedRefresh) {
      throw new UnauthorizedException(
        'Token do Google Drive expirado e sem refresh token disponível. Reconecte sua conta Google.',
      );
    }

    const refreshToken = this.tokenCrypto.decrypt(encryptedRefresh);
    const oauthClient = this.authService.createOAuth2Client();
    oauthClient.setCredentials({ refresh_token: refreshToken });

    try {
      const { credentials } = await oauthClient.refreshAccessToken();
      if (!credentials.access_token) {
        throw new Error('Google não retornou um novo access_token.');
      }

      const nextExpiresAt = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3500 * 1000);
      const nextScope = credentials.scope || scope;
      const nextEncryptedAccess = this.tokenCrypto.encrypt(credentials.access_token);
      const nextEncryptedRefresh = credentials.refresh_token
        ? this.tokenCrypto.encrypt(credentials.refresh_token)
        : encryptedRefresh;

      const updateClient = await this.pgPool.connect();
      try {
        await updateClient.query('BEGIN');
        await updateClient.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        await updateClient.query(
          `
          UPDATE google_connections
             SET encrypted_access_token = $1,
                 encrypted_refresh_token = $2,
                 token_scope = $3,
                 expires_at = $4,
                 status = 'active',
                 updated_at = now()
           WHERE user_id = app_user_id();
        `,
          [nextEncryptedAccess, nextEncryptedRefresh, nextScope, nextExpiresAt.toISOString()],
        );
        await updateClient.query('COMMIT');
      } catch (dbErr) {
        await updateClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        updateClient.release();
      }

      return {
        accessToken: credentials.access_token,
        expiresAt: nextExpiresAt,
        scope: nextScope,
      };
    } catch (error) {
      this.logger.warn(`Falha ao renovar token do Google Drive para usuário ${userId}`, error);
      const errClient = await this.pgPool.connect();
      try {
        await errClient.query('BEGIN');
        await errClient.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        await errClient.query(
          `UPDATE google_connections SET status = 'expired', updated_at = now() WHERE user_id = app_user_id();`,
        );
        await errClient.query('COMMIT');
      } catch {
        await errClient.query('ROLLBACK').catch(() => undefined);
      } finally {
        errClient.release();
      }

      throw new UnauthorizedException(
        'Sessão do Google Drive expirou. Clique em "Reconectar Google Drive".',
      );
    }
  }

  /**
   * D21: Emite somente um access_token de curta duração para o Google Picker no navegador.
   * O refresh_token permanece exclusivamente no backend criptografado.
   */
  async getPickerToken(userId: string): Promise<PickerTokenResponse> {
    const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim() || '';
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
    const appId = process.env.GOOGLE_APP_ID?.trim() || clientId.split('-')[0] || null;

    if (!apiKey || apiKey.startsWith('your_')) {
      throw new BadRequestException(
        'GOOGLE_PICKER_API_KEY não configurada no .env. Configure a API Key no Google Cloud Console.',
      );
    }

    const { accessToken, expiresAt } = await this.getValidAccessToken(userId);
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      apiKey,
      appId,
      clientId,
    };
  }

  private createDriveClient(accessToken: string): drive_v3.Drive {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Lista as subpastas diretas de uma pasta no Google Drive em ordem natural
   * para navegação hierárquica limpa a partir de "Meu Drive" (root).
   */
  async listDriveFolders(
    userId: string,
    parentId = 'root',
  ): Promise<DriveFolderListResponse> {
    const cleanParentId = parentId.trim() === 'root' || !parentId.trim()
      ? 'root'
      : extractDriveId(parentId);

    const { accessToken } = await this.getValidAccessToken(userId);
    const drive = this.createDriveClient(accessToken);

    let parentName = 'Meu Drive';
    if (cleanParentId !== 'root') {
      try {
        const meta = await drive.files.get({
          fileId: cleanParentId,
          fields: 'id, name',
          supportsAllDrives: true,
        });
        parentName = meta.data.name || 'Pasta do Drive';
      } catch {
        parentName = 'Pasta do Drive';
      }
    }

    const folders: Array<{ id: string; name: string; modifiedTime?: string | null }> = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${cleanParentId.replace(/'/g, "\\'")}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'nextPageToken, files(id, name, modifiedTime)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files || []) {
        if (!f.id || !f.name) continue;
        folders.push({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime || null,
        });
      }

      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    folders.sort((a, b) => naturalCompare(a.name, b.name));

    return {
      parentId: cleanParentId,
      parentName,
      folders,
    };
  }

  /**
   * Lista pastas e arquivos suportados dentro de uma pasta no Drive em ordem natural
   * para seleção limpa de arquivos (vídeos, áudios, PDFs, código) dentro de um curso.
   */
  async listDriveItems(
    userId: string,
    parentId = 'root',
  ): Promise<DriveItemsListResponse> {
    const cleanParentId =
      parentId.trim() === 'root' || !parentId.trim() ? 'root' : extractDriveId(parentId);

    const { accessToken } = await this.getValidAccessToken(userId);
    const drive = this.createDriveClient(accessToken);

    let parentName = 'Meu Drive';
    if (cleanParentId !== 'root') {
      try {
        const meta = await drive.files.get({
          fileId: cleanParentId,
          fields: 'id, name',
          supportsAllDrives: true,
        });
        parentName = meta.data.name || 'Pasta do Drive';
      } catch {
        parentName = 'Pasta do Drive';
      }
    }

    const folders: Array<{ id: string; name: string; modifiedTime?: string | null }> = [];
    const files: DriveFileEntry[] = [];
    let pageToken: string | undefined;

    do {
      const res = await drive.files.list({
        q: `'${cleanParentId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields:
          'nextPageToken, files(id, name, mimeType, size, modifiedTime, videoMediaMetadata(durationMillis))',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files || []) {
        if (!f.id || !f.name || !f.mimeType) continue;
        if (f.mimeType === FOLDER_MIME) {
          folders.push({
            id: f.id,
            name: f.name,
            modifiedTime: f.modifiedTime || null,
          });
        } else {
          const category = classifyDriveItem(f.mimeType, f.name);
          if (category === 'ignore') continue;
          const durationMillis = Number(f.videoMediaMetadata?.durationMillis || 0);
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: Number(f.size || 0),
            durationSeconds: durationMillis > 0 ? Math.round(durationMillis / 1000) : 0,
            modifiedTime: f.modifiedTime || null,
          });
        }
      }

      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    folders.sort((a, b) => naturalCompare(a.name, b.name));
    files.sort((a, b) => naturalCompare(a.name, b.name));

    return {
      parentId: cleanParentId,
      parentName,
      folders,
      files,
    };
  }

  /**
   * Importa em lote todas as subpastas de uma pasta raiz organizada de cursos.
   * Cada subpasta direta dentro da pasta raiz vira um Curso completo na plataforma.
   */
  async importRootCoursesFolder(
    userId: string,
    rootFolderId: string,
  ): Promise<ImportRootFolderResult> {
    const listing = await this.listDriveFolders(userId, rootFolderId);

    if (listing.folders.length === 0) {
      throw new BadRequestException(
        `Nenhuma subpasta de curso encontrada dentro de "${listing.parentName}". Se esta pasta já é um curso único, use "Importar como Curso".`,
      );
    }

    const courses: ImportDriveFolderResult[] = [];
    for (const folder of listing.folders) {
      const imported = await this.importCourseFolder(userId, {
        folderId: folder.id,
        folderName: folder.name,
      });
      courses.push(imported);
    }

    return {
      rootFolderName: listing.parentName,
      coursesImported: courses.length,
      totalModules: courses.reduce((sum, c) => sum + c.modulesCount, 0),
      totalLessons: courses.reduce((sum, c) => sum + c.lessonsCount, 0),
      courses,
    };
  }

  private async listFolderChildren(drive: drive_v3.Drive, folderId: string): Promise<DriveItem[]> {
    const items: DriveItem[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields:
          'nextPageToken, files(id, name, mimeType, size, md5Checksum, modifiedTime, parents, videoMediaMetadata(durationMillis))',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      const files = response.data.files || [];
      for (const f of files) {
        if (!f.id || !f.name || !f.mimeType) continue;
        const durationMillis = Number(f.videoMediaMetadata?.durationMillis || 0);
        items.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          md5Checksum: f.md5Checksum || null,
          modifiedTime: f.modifiedTime || null,
          parentId: f.parents?.[0] || folderId,
          durationSeconds: durationMillis > 0 ? Math.round(durationMillis / 1000) : 0,
        });
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return items.sort((a, b) => naturalCompare(a.name, b.name));
  }

  private async collectFolderFilesRecursively(
    drive: drive_v3.Drive,
    folderId: string,
    prefix = '',
    depth = 0,
  ): Promise<Array<DriveItem & { displayTitle: string }>> {
    if (depth > 6) return [];

    const children = await this.listFolderChildren(drive, folderId);
    const result: Array<DriveItem & { displayTitle: string }> = [];

    for (const item of children) {
      if (item.mimeType === FOLDER_MIME) {
        const subPrefix = prefix ? `${prefix} / ${item.name}` : item.name;
        const nested = await this.collectFolderFilesRecursively(
          drive,
          item.id,
          subPrefix,
          depth + 1,
        );
        result.push(...nested);
      } else {
        const cleanName = stripExtension(item.name);
        result.push({
          ...item,
          displayTitle: prefix ? `${prefix} — ${cleanName}` : cleanName,
        });
      }
    }

    return result;
  }

  private async setSyncState(
    userId: string,
    syncStatus: 'idle' | 'syncing' | 'error',
    errorMessage: string | null = null,
    markSynced = false,
  ): Promise<void> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      await client.query(
        `
        INSERT INTO drive_sync_states (user_id, sync_status, last_synced_at, error_message)
        VALUES ($1, $2, CASE WHEN $4 THEN now() ELSE NULL END, $3)
        ON CONFLICT (user_id)
        DO UPDATE SET
          sync_status = EXCLUDED.sync_status,
          last_synced_at = CASE WHEN $4 THEN now() ELSE drive_sync_states.last_synced_at END,
          error_message = EXCLUDED.error_message;
      `,
        [userId, syncStatus, errorMessage, markSynced],
      );
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
  }

  private async upsertDriveSource(
    client: pg.PoolClient,
    userId: string,
    item: {
      driveFileId: string;
      name: string;
      mimeType: string;
      isFolder: boolean;
      parentDriveId?: string | null;
    },
  ): Promise<string> {
    const res = await client.query(
      `
      INSERT INTO drive_sources (
        user_id, drive_file_id, name, mime_type, is_folder, parent_drive_id, is_active, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, true, now())
      ON CONFLICT (user_id, drive_file_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        mime_type = EXCLUDED.mime_type,
        is_folder = EXCLUDED.is_folder,
        parent_drive_id = COALESCE(EXCLUDED.parent_drive_id, drive_sources.parent_drive_id),
        is_active = true,
        updated_at = now()
      RETURNING id;
    `,
      [
        userId,
        item.driveFileId,
        item.name.slice(0, 255),
        item.mimeType.slice(0, 150),
        item.isFolder,
        item.parentDriveId || null,
      ],
    );
    return res.rows[0].id;
  }

  private async upsertDocument(
    client: pg.PoolClient,
    userId: string,
    driveSourceId: string,
    item: DriveItem,
  ): Promise<string> {
    const contentHash =
      item.md5Checksum ||
      crypto
        .createHash('sha256')
        .update(`${item.id}:${item.modifiedTime || ''}:${item.size}`)
        .digest('hex');

    const existing = await client.query(
      `
      SELECT id FROM documents
       WHERE user_id = app_user_id() AND drive_source_id = $1
       LIMIT 1;
    `,
      [driveSourceId],
    );

    if (existing.rows.length > 0) {
      const docId = existing.rows[0].id;
      await client.query(
        `
        UPDATE documents
           SET title = $1,
               mime_type = $2,
               content_hash = $3,
               byte_size = $4,
               updated_at = now()
         WHERE id = $5;
      `,
        [stripExtension(item.name).slice(0, 255), item.mimeType.slice(0, 150), contentHash, item.size, docId],
      );
      return docId;
    }

    const inserted = await client.query(
      `
      INSERT INTO documents (
        user_id, drive_source_id, title, mime_type, content_hash, byte_size, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb)
      RETURNING id;
    `,
      [
        userId,
        driveSourceId,
        stripExtension(item.name).slice(0, 255),
        item.mimeType.slice(0, 150),
        contentHash,
        item.size,
        JSON.stringify({ driveFileId: item.id, originalName: item.name }),
      ],
    );
    return inserted.rows[0].id;
  }

  /**
   * Importa ou sincroniza uma pasta de curso do Google Drive:
   * - Pasta escolhida => Curso
   * - Subpastas diretas => Módulos (arquivos soltos na raiz vão para um módulo principal)
   * - Vídeos/Áudios => Aulas (ou documentos/PDFs se o módulo não tiver vídeos)
   * - PDFs, slides, transcrições (.vtt/.srt) e código => Documentos vinculados às aulas
   */
  async importCourseFolder(
    userId: string,
    params: {
      folderId: string;
      folderName?: string;
      selectedFiles?: PickedDriveFileInput[];
    },
  ): Promise<ImportDriveFolderResult> {
    const cleanFolderId = extractDriveId(params.folderId);
    if (!cleanFolderId) {
      throw new BadRequestException('Informe o ID ou link da pasta do Google Drive.');
    }

    await this.setSyncState(userId, 'syncing', null, false);

    try {
      const { accessToken, scope } = await this.getValidAccessToken(userId);
      const drive = this.createDriveClient(accessToken);

      // 1. Buscar metadados da pasta selecionada
      let folderName = params.folderName?.trim() || '';
      let folderParentId: string | null = null;
      try {
        const folderMeta = await drive.files.get({
          fileId: cleanFolderId,
          fields: 'id, name, mimeType, parents',
          supportsAllDrives: true,
        });

        if (folderMeta.data.mimeType && folderMeta.data.mimeType !== FOLDER_MIME) {
          throw new BadRequestException(
            'O item selecionado não é uma pasta do Google Drive. Selecione a pasta do curso.',
          );
        }

        folderName = folderMeta.data.name || folderName || 'Curso do Google Drive';
        folderParentId = folderMeta.data.parents?.[0] || null;
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        this.logger.warn(`Não foi possível ler metadados da pasta ${cleanFolderId}`, err);
        throw new BadRequestException(
          'Não foi possível acessar esta pasta no Google Drive. Selecione-a novamente pelo Google Picker para conceder permissão ao DevCore.',
        );
      }

      // 2. Listar conteúdo da pasta no Drive
      const topChildren = await this.listFolderChildren(drive, cleanFolderId);

      const moduleBuckets: Array<{
        driveFolderId: string | null;
        title: string;
        files: Array<DriveItem & { displayTitle: string }>;
      }> = [];

      const directFiles: Array<DriveItem & { displayTitle: string }> = [];
      const subfolders: DriveItem[] = [];
      let coverImageItem: DriveItem | null = null;

      for (const child of topChildren) {
        if (child.mimeType === FOLDER_MIME) {
          subfolders.push(child);
        } else {
          const isCoverImage =
            !coverImageItem &&
            (child.mimeType.startsWith('image/') ||
              /\.(png|jpe?g|webp|gif)$/i.test(child.name)) &&
            /^(capa|cover|thumb|thumbnail|banner|folder|poster)([\s._-]|$)/i.test(
              stripExtension(child.name).trim(),
            );
          if (isCoverImage) {
            coverImageItem = child;
          } else {
            directFiles.push({
              ...child,
              displayTitle: stripExtension(child.name),
            });
          }
        }
      }

      if (directFiles.length > 0) {
        moduleBuckets.push({
          driveFolderId: null,
          title: subfolders.length > 0 ? '00 — Introdução e Materiais Gerais' : 'Módulo 01 — Aulas do Curso',
          files: directFiles,
        });
      }

      for (const folder of subfolders) {
        const nestedFiles = await this.collectFolderFilesRecursively(drive, folder.id);
        moduleBuckets.push({
          driveFolderId: folder.id,
          title: folder.name,
          files: nestedFiles,
        });
      }

      // Se o usuário selecionou arquivos adicionais explícitos (útil com drive.file)
      if (params.selectedFiles && params.selectedFiles.length > 0 && moduleBuckets.length === 0) {
        const fetchedFiles: Array<DriveItem & { displayTitle: string }> = [];
        for (const picked of params.selectedFiles) {
          try {
            const meta = await drive.files.get({
              fileId: picked.id,
              fields: 'id, name, mimeType, size, md5Checksum, modifiedTime, parents, videoMediaMetadata(durationMillis)',
              supportsAllDrives: true,
            });
            const d = meta.data;
            if (!d.id || !d.name || !d.mimeType) continue;
            fetchedFiles.push({
              id: d.id,
              name: d.name,
              mimeType: d.mimeType,
              size: Number(d.size || 0),
              md5Checksum: d.md5Checksum || null,
              modifiedTime: d.modifiedTime || null,
              parentId: d.parents?.[0] || cleanFolderId,
              durationSeconds: Math.round(Number(d.videoMediaMetadata?.durationMillis || 0) / 1000),
              displayTitle: stripExtension(d.name),
            });
          } catch {
            // Ignora arquivo inacessível individualmente
          }
        }
        if (fetchedFiles.length > 0) {
          moduleBuckets.push({
            driveFolderId: null,
            title: 'Módulo 01 — Aulas Selecionadas',
            files: fetchedFiles.sort((a, b) => naturalCompare(a.name, b.name)),
          });
        }
      }

      // 3. Persistir no PostgreSQL dentro de uma transação RLS
      const result = await this.persistCourseStructure(userId, {
        folderId: cleanFolderId,
        folderName,
        folderParentId,
        coverImageItem,
        moduleBuckets,
      });

      await this.setSyncState(userId, 'idle', null, true);

      let warning: string | undefined;
      if (result.lessonsCount === 0) {
        const isDriveFileScope =
          scope.includes('drive.file') && !scope.includes('drive.readonly');
        warning = isDriveFileScope
          ? 'A pasta do curso foi importada, mas o Google Drive não listou arquivos internos com o escopo drive.file. Abra o curso e clique em "Adicionar arquivos (Picker)" para selecionar os vídeos/PDFs diretamente, ou configure GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.readonly no .env.'
          : 'A pasta do curso foi importada, mas nenhum vídeo ou material suportado foi encontrado dentro dela.';
      }

      return { ...result, warning };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao sincronizar curso do Drive.';
      await this.setSyncState(userId, 'error', msg, false);
      throw error;
    }
  }

  private async persistCourseStructure(
    userId: string,
    payload: {
      folderId: string;
      folderName: string;
      folderParentId: string | null;
      coverImageItem?: DriveItem | null;
      moduleBuckets: Array<{
        driveFolderId: string | null;
        title: string;
        files: Array<DriveItem & { displayTitle: string }>;
      }>;
    },
  ): Promise<Omit<ImportDriveFolderResult, 'warning'>> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const courseDriveSourceId = await this.upsertDriveSource(client, userId, {
        driveFileId: payload.folderId,
        name: payload.folderName,
        mimeType: FOLDER_MIME,
        isFolder: true,
        parentDriveId: payload.folderParentId,
      });

      let detectedCoverUrl: string | null = null;
      if (payload.coverImageItem) {
        await this.upsertDriveSource(client, userId, {
          driveFileId: payload.coverImageItem.id,
          name: payload.coverImageItem.name,
          mimeType: payload.coverImageItem.mimeType || 'image/jpeg',
          isFolder: false,
          parentDriveId: payload.folderId,
        });
        detectedCoverUrl = `drive-cover:${payload.coverImageItem.id}`;
      }

      // Buscar ou criar curso vinculado a essa pasta
      const existingCourse = await client.query(
        `
        SELECT id, title, thumbnail_url AS "thumbnailUrl" FROM courses
         WHERE user_id = app_user_id() AND drive_source_id = $1
         LIMIT 1;
      `,
        [courseDriveSourceId],
      );

      let courseId: string;
      let courseTitle: string;

      if (existingCourse.rows.length > 0) {
        courseId = existingCourse.rows[0].id;
        courseTitle = existingCourse.rows[0].title;
        const currentThumb: string | null = existingCourse.rows[0].thumbnailUrl || null;
        const shouldApplyDetectedCover =
          Boolean(detectedCoverUrl) &&
          (!currentThumb || currentThumb.startsWith('drive-cover:'));

        await client.query(
          `
          UPDATE courses
             SET is_archived = false,
                 thumbnail_url = CASE WHEN $2::boolean THEN $3 ELSE thumbnail_url END,
                 updated_at = now()
           WHERE id = $1;
        `,
          [courseId, shouldApplyDetectedCover, detectedCoverUrl],
        );
      } else {
        const createdCourse = await client.query(
          `
          INSERT INTO courses (user_id, drive_source_id, title, description, thumbnail_url)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, title;
        `,
          [
            userId,
            courseDriveSourceId,
            payload.folderName.slice(0, 255),
            `Curso sincronizado do Google Drive (${payload.folderName}).`,
            detectedCoverUrl,
          ],
        );
        courseId = createdCourse.rows[0].id;
        courseTitle = createdCourse.rows[0].title;
      }

      // Garantir matrícula automática do proprietário
      await client.query(
        `
        INSERT INTO enrollments (user_id, course_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, course_id) DO NOTHING;
      `,
        [userId, courseId],
      );

      let modulesCount = 0;
      let lessonsCount = 0;
      let documentsCount = 0;

      for (let mIdx = 0; mIdx < payload.moduleBuckets.length; mIdx++) {
        const bucket = payload.moduleBuckets[mIdx];
        if (!bucket) continue;
        let moduleDriveSourceId: string | null = null;

        if (bucket.driveFolderId) {
          moduleDriveSourceId = await this.upsertDriveSource(client, userId, {
            driveFileId: bucket.driveFolderId,
            name: bucket.title,
            mimeType: FOLDER_MIME,
            isFolder: true,
            parentDriveId: payload.folderId,
          });
        }

        // Localizar módulo existente pelo drive_source_id ou título dentro do curso
        let moduleId: string;
        const existingMod = moduleDriveSourceId
          ? await client.query(
              `SELECT id FROM modules WHERE user_id = app_user_id() AND course_id = $1 AND drive_source_id = $2 LIMIT 1;`,
              [courseId, moduleDriveSourceId],
            )
          : await client.query(
              `SELECT id FROM modules WHERE user_id = app_user_id() AND course_id = $1 AND drive_source_id IS NULL AND title = $2 LIMIT 1;`,
              [courseId, bucket.title.slice(0, 255)],
            );

        if (existingMod.rows.length > 0) {
          moduleId = existingMod.rows[0].id;
          await client.query(
            `UPDATE modules SET title = $1, order_index = $2 WHERE id = $3;`,
            [bucket.title.slice(0, 255), mIdx + 1, moduleId],
          );
        } else {
          const createdMod = await client.query(
            `
            INSERT INTO modules (user_id, course_id, drive_source_id, title, order_index)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
          `,
            [userId, courseId, moduleDriveSourceId, bucket.title.slice(0, 255), mIdx + 1],
          );
          moduleId = createdMod.rows[0].id;
        }
        modulesCount++;

        const mediaItems: Array<DriveItem & { displayTitle: string; category: FileCategory }> = [];
        const docItems: Array<DriveItem & { displayTitle: string; category: FileCategory }> = [];

        for (const f of bucket.files) {
          const category = classifyDriveItem(f.mimeType, f.name);
          if (category === 'ignore' || category === 'folder') continue;
          if (category === 'video' || category === 'audio') {
            mediaItems.push({ ...f, category });
          } else {
            docItems.push({ ...f, category });
          }
        }

        // Se o módulo só tiver documentos/PDFs e nenhum vídeo, cada documento vira uma aula lida no player
        const primaryLessonItems = mediaItems.length > 0 ? mediaItems : docItems;
        const attachmentItems = mediaItems.length > 0 ? docItems : [];

        const createdLessons: Array<{ id: string; stem: string }> = [];

        for (let lIdx = 0; lIdx < primaryLessonItems.length; lIdx++) {
          const file = primaryLessonItems[lIdx];
          if (!file) continue;
          const mediaSourceId = await this.upsertDriveSource(client, userId, {
            driveFileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            isFolder: false,
            parentDriveId: file.parentId || bucket.driveFolderId || payload.folderId,
          });

          const existingLesson = await client.query(
            `
            SELECT id FROM lessons
             WHERE user_id = app_user_id() AND module_id = $1 AND media_source_id = $2
             LIMIT 1;
          `,
            [moduleId, mediaSourceId],
          );

          let lessonId: string;
          if (existingLesson.rows.length > 0) {
            lessonId = existingLesson.rows[0].id;
            await client.query(
              `
              UPDATE lessons
                 SET title = $1,
                     order_index = $2,
                     duration_seconds = CASE WHEN $3 > 0 THEN $3 ELSE duration_seconds END
               WHERE id = $4;
            `,
              [file.displayTitle.slice(0, 255), lIdx + 1, file.durationSeconds, lessonId],
            );
          } else {
            const insertedLesson = await client.query(
              `
              INSERT INTO lessons (user_id, module_id, media_source_id, title, order_index, duration_seconds)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING id;
            `,
              [
                userId,
                moduleId,
                mediaSourceId,
                file.displayTitle.slice(0, 255),
                lIdx + 1,
                file.durationSeconds,
              ],
            );
            lessonId = insertedLesson.rows[0].id;
          }

          lessonsCount++;
          createdLessons.push({ id: lessonId, stem: normalizeStem(file.name) });

          // Se a própria aula for documento/PDF, também cria registro em `documents` para futuro RAG
          if (file.category !== 'video' && file.category !== 'audio') {
            const docId = await this.upsertDocument(client, userId, mediaSourceId, file);
            documentsCount++;
            await client.query(
              `
              INSERT INTO lesson_documents (user_id, lesson_id, document_id, role)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (lesson_id, document_id) DO NOTHING;
            `,
              [userId, lessonId, docId, file.category === 'code' ? 'code' : 'resource'],
            );
          }
        }

        // Vincular materiais de apoio (PDFs, transcrições, código) às aulas do módulo
        const lessonsWithTranscript = new Set<string>();
        for (const docFile of attachmentItems) {
          const docSourceId = await this.upsertDriveSource(client, userId, {
            driveFileId: docFile.id,
            name: docFile.name,
            mimeType: docFile.mimeType,
            isFolder: false,
            parentDriveId: docFile.parentId || bucket.driveFolderId || payload.folderId,
          });
          const docId = await this.upsertDocument(client, userId, docSourceId, docFile);
          documentsCount++;

          if (createdLessons.length === 0) continue;

          const docStem = normalizeStem(docFile.name);
          const matchedLesson =
            createdLessons.find(
              (l) => l.stem === docStem || l.stem.includes(docStem) || docStem.includes(l.stem),
            ) || createdLessons[0];

          if (!matchedLesson) continue;

          let role: 'transcript' | 'resource' | 'code' = 'resource';
          if (docFile.category === 'code') {
            role = 'code';
          } else if (docFile.category === 'transcript') {
            // Respeitar uq_one_transcript_per_lesson
            const existingTranscript = await client.query(
              `SELECT 1 FROM lesson_documents WHERE lesson_id = $1 AND role = 'transcript' LIMIT 1;`,
              [matchedLesson.id],
            );
            if (existingTranscript.rows.length === 0 && !lessonsWithTranscript.has(matchedLesson.id)) {
              role = 'transcript';
              lessonsWithTranscript.add(matchedLesson.id);
            }
          }

          await client.query(
            `
            INSERT INTO lesson_documents (user_id, lesson_id, document_id, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (lesson_id, document_id) DO NOTHING;
          `,
            [userId, matchedLesson.id, docId, role],
          );
        }
      }

      // Recalcular total_hours do curso a partir da duração total das aulas
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
        modulesCount,
        lessonsCount,
        documentsCount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Re-sincroniza um curso já importado usando sua pasta vinculada no Drive.
   */
  async syncCourse(userId: string, courseId: string): Promise<ImportDriveFolderResult> {
    const client = await this.pgPool.connect();
    let folderId: string | null = null;
    let courseTitle: string;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const res = await client.query(
        `
        SELECT c.title, ds.drive_file_id AS "driveFileId"
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

      courseTitle = res.rows[0].title;
      folderId = res.rows[0].driveFileId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (!folderId) {
      throw new BadRequestException('Este curso não possui uma fonte vinculada para sincronização.');
    }

    if (folderId.startsWith('yt:playlist:')) {
      return this.youtubeService.syncCourse(userId, courseId);
    }

    return this.importCourseFolder(userId, { folderId, folderName: courseTitle });
  }

  /**
   * Adiciona arquivos selecionados individualmente via Google Picker a um curso/módulo
   * (essencial quando o usuário usa escopo estrito `drive.file`).
   */
  async attachPickedFilesToCourse(
    userId: string,
    courseId: string,
    params: {
      moduleTitle?: string;
      files: PickedDriveFileInput[];
    },
  ): Promise<{ addedLessons: number; addedDocuments: number }> {
    if (!params.files || params.files.length === 0) {
      throw new BadRequestException('Nenhum arquivo selecionado.');
    }

    const { accessToken } = await this.getValidAccessToken(userId);
    const drive = this.createDriveClient(accessToken);

    // Buscar metadados reais de cada arquivo no Drive
    const fetchedItems: Array<DriveItem & { displayTitle: string; category: FileCategory }> = [];
    for (const f of params.files) {
      try {
        const meta = await drive.files.get({
          fileId: extractDriveId(f.id),
          fields:
            'id, name, mimeType, size, md5Checksum, modifiedTime, parents, videoMediaMetadata(durationMillis)',
          supportsAllDrives: true,
        });
        const d = meta.data;
        if (!d.id || !d.name || !d.mimeType) continue;
        const category = classifyDriveItem(d.mimeType, d.name);
        if (category === 'ignore' || category === 'folder') continue;
        fetchedItems.push({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          size: Number(d.size || 0),
          md5Checksum: d.md5Checksum || null,
          modifiedTime: d.modifiedTime || null,
          parentId: d.parents?.[0] || null,
          durationSeconds: Math.round(Number(d.videoMediaMetadata?.durationMillis || 0) / 1000),
          displayTitle: stripExtension(d.name),
          category,
        });
      } catch (err) {
        this.logger.warn(`Falha ao ler arquivo selecionado ${f.id}`, err);
      }
    }

    fetchedItems.sort((a, b) => naturalCompare(a.name, b.name));

    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const courseRes = await client.query(
        `SELECT id FROM courses WHERE id = $1 AND user_id = app_user_id();`,
        [courseId],
      );
      if (courseRes.rows.length === 0) {
        throw new NotFoundException('Curso não encontrado.');
      }

      const targetModuleTitle = (params.moduleTitle?.trim() || 'Módulo — Arquivos do Drive').slice(
        0,
        255,
      );

      let moduleId: string;
      const existingMod = await client.query(
        `SELECT id FROM modules WHERE course_id = $1 AND title = $2 LIMIT 1;`,
        [courseId, targetModuleTitle],
      );

      if (existingMod.rows.length > 0) {
        moduleId = existingMod.rows[0].id;
      } else {
        const maxOrderRes = await client.query(
          `SELECT COALESCE(MAX(order_index), 0) AS max_order FROM modules WHERE course_id = $1;`,
          [courseId],
        );
        const insertedMod = await client.query(
          `
          INSERT INTO modules (user_id, course_id, title, order_index)
          VALUES ($1, $2, $3, $4)
          RETURNING id;
        `,
          [userId, courseId, targetModuleTitle, Number(maxOrderRes.rows[0].max_order) + 1],
        );
        moduleId = insertedMod.rows[0].id;
      }

      const maxLessonRes = await client.query(
        `SELECT COALESCE(MAX(order_index), 0) AS max_order FROM lessons WHERE module_id = $1;`,
        [moduleId],
      );
      let nextOrder = Number(maxLessonRes.rows[0].max_order) + 1;

      let addedLessons = 0;
      let addedDocuments = 0;

      for (const item of fetchedItems) {
        const sourceId = await this.upsertDriveSource(client, userId, {
          driveFileId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          isFolder: false,
          parentDriveId: item.parentId,
        });

        const existingLesson = await client.query(
          `SELECT id FROM lessons WHERE module_id = $1 AND media_source_id = $2 LIMIT 1;`,
          [moduleId, sourceId],
        );

        let lessonId: string;
        if (existingLesson.rows.length > 0) {
          lessonId = existingLesson.rows[0].id;
        } else {
          const inserted = await client.query(
            `
            INSERT INTO lessons (user_id, module_id, media_source_id, title, order_index, duration_seconds)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id;
          `,
            [userId, moduleId, sourceId, item.displayTitle.slice(0, 255), nextOrder++, item.durationSeconds],
          );
          lessonId = inserted.rows[0].id;
          addedLessons++;
        }

        if (item.category !== 'video' && item.category !== 'audio') {
          const docId = await this.upsertDocument(client, userId, sourceId, item);
          addedDocuments++;
          await client.query(
            `
            INSERT INTO lesson_documents (user_id, lesson_id, document_id, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (lesson_id, document_id) DO NOTHING;
          `,
            [userId, lessonId, docId, item.category === 'code' ? 'code' : 'resource'],
          );
        }
      }

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
      return { addedLessons, addedDocuments };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * D2: Proxy autenticado de mídia com suporte a HTTP Range Requests (206 Partial Content).
   * Valida a propriedade do arquivo via RLS em `drive_sources` antes de abrir o stream no Drive.
   */
  async streamFile(
    userId: string,
    driveFileId: string,
    req: Request,
    res: Response,
    download = false,
  ): Promise<void> {
    const client = await this.pgPool.connect();
    let fileRecord: { name: string; mimeType: string } | null = null;

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const sourceRes = await client.query(
        `
        SELECT name, mime_type AS "mimeType"
          FROM drive_sources
         WHERE drive_file_id = $1 AND is_active = true
         LIMIT 1;
      `,
        [driveFileId],
      );

      await client.query('COMMIT');
      if (sourceRes.rows.length > 0) {
        fileRecord = sourceRes.rows[0];
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (!fileRecord) {
      throw new NotFoundException('Arquivo não encontrado na sua biblioteca do Google Drive.');
    }

    const { accessToken } = await this.getValidAccessToken(userId);
    const isGoogleNativeDoc = fileRecord.mimeType.startsWith('application/vnd.google-apps.');

    const upstreamUrl = isGoogleNativeDoc
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}/export?mimeType=application/pdf`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media&supportsAllDrives=true`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    const rangeHeader = req.headers.range;
    if (rangeHeader && !isGoogleNativeDoc) {
      headers['Range'] = rangeHeader;
    }

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      const errorText = await upstream.text().catch(() => '');
      this.logger.warn(
        `Drive stream falhou (${upstream.status}) para arquivo ${driveFileId}: ${errorText.slice(0, 200)}`,
      );
      res.status(upstream.status === 404 ? 404 : 502).json({
        message: 'Não foi possível carregar este arquivo do Google Drive.',
      });
      return;
    }

    const contentType = isGoogleNativeDoc
      ? 'application/pdf'
      : upstream.headers.get('content-type') || fileRecord.mimeType || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');

    const safeFileName = fileRecord.name.replace(/["\r\n]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${safeFileName}"`,
    );

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
    nodeStream.on('error', (err) => {
      if (!abortController.signal.aborted) {
        this.logger.debug(`Stream encerrado para ${driveFileId}: ${err.message}`);
      }
      if (!res.writableEnded) {
        res.end();
      }
    });
    nodeStream.pipe(res);
  }

  async disconnect(userId: string): Promise<{ success: boolean }> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      await client.query(`
        UPDATE google_connections
           SET status = 'revoked', updated_at = now()
         WHERE user_id = app_user_id();
      `);

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
