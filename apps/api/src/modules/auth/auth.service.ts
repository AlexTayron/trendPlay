import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { google } from 'googleapis';
import { AuthConfigStatus, UserProfile } from '@devcore/shared';
import { TokenCryptoService } from '../../common/crypto/token-crypto.service.js';

const DEFAULT_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function isPlaceholder(val?: string): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('your_') ||
    trimmed.includes('your_google_')
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly pgPool: pg.Pool,
    private readonly jwtService: JwtService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  getDriveScopes(): string[] {
    const configured = process.env.GOOGLE_DRIVE_SCOPE?.trim() || DEFAULT_DRIVE_SCOPE;
    return configured
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  getMaxRegisteredUsers(): number {
    const raw = process.env.MAX_REGISTERED_USERS?.trim();
    if (raw === undefined || raw === '') return 90;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 90;
    return Math.floor(parsed);
  }

  async getRegisteredUsersCount(): Promise<number> {
    let client: pg.PoolClient | null = null;
    try {
      client = await this.pgPool.connect();
      const res = await client.query<{ total: number }>(
        'SELECT get_registered_users_count() AS total;',
      );
      return Number(res.rows[0]?.total ?? 0);
    } catch {
      // Se a função 0001_user_registration_limit.sql ainda não tiver sido aplicada, evita derrubar /auth/config
      return 0;
    } finally {
      client?.release();
    }
  }

  async getConfigStatus(): Promise<AuthConfigStatus> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const pickerApiKey = process.env.GOOGLE_PICKER_API_KEY;
    const scopes = this.getDriveScopes();
    const maxUsers = this.getMaxRegisteredUsers();
    const registeredUsersCount = await this.getRegisteredUsersCount();
    const registrationsOpen = maxUsers === 0 || registeredUsersCount < maxUsers;

    return {
      googleConfigured: !isPlaceholder(clientId) && !isPlaceholder(clientSecret),
      pickerConfigured: !isPlaceholder(pickerApiKey),
      driveScope: scopes.join(' '),
      maxUsers,
      registeredUsersCount,
      registrationsOpen,
    };
  }

  createOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl =
      process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/auth/google/callback';

    if (isPlaceholder(clientId) || isPlaceholder(clientSecret)) {
      throw new BadRequestException(
        'Credenciais do Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) ainda não configuradas no .env.',
      );
    }

    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  }

  buildGoogleAuthorizationUrl(state: string): string {
    const oauthClient = this.createOAuth2Client();
    const driveScopes = this.getDriveScopes();
    const scopes = Array.from(new Set(['openid', 'email', 'profile', ...driveScopes]));

    return oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopes,
      state,
    });
  }

  /**
   * Conclui o fluxo OAuth 2.0 Authorization Code:
   * 1. Troca `code` por `id_token`, `access_token` e `refresh_token`.
   * 2. Valida o `id_token` (D19: somente e-mail verificado).
   * 3. Provisiona/recupera usuário via `get_or_create_user` e salva os tokens do Drive criptografados em `google_connections`.
   */
  async handleGoogleAuthorizationCode(
    code: string,
  ): Promise<{ user: UserProfile; token: string }> {
    const oauthClient = this.createOAuth2Client();
    const clientId = process.env.GOOGLE_CLIENT_ID!;

    try {
      const { tokens } = await oauthClient.getToken(code);

      if (!tokens.id_token) {
        throw new UnauthorizedException('O Google não retornou um ID Token válido.');
      }

      const ticket = await oauthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new UnauthorizedException('Token Google inválido ou e-mail não verificado.');
      }

      const grantedScope = tokens.scope || this.getDriveScopes().join(' ');
      const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3500 * 1000);

      return await this.provisionGoogleProfile(
        {
          googleId: payload.sub,
          email: payload.email,
          name: payload.name || payload.email,
          avatarUrl: payload.picture,
          emailVerified: true,
        },
        tokens.access_token
          ? {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token || null,
              scope: grantedScope,
              expiresAt,
            }
          : undefined,
      );
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      this.logger.error('Erro ao trocar authorization code do Google OAuth.', error);
      throw new UnauthorizedException('Falha ao concluir autenticação com o Google.');
    }
  }

  /**
   * Autentica ou provisiona o usuário utilizando a função SECURITY DEFINER `get_or_create_user` (B.2 / D19).
   * Mantém o RLS totalmente ativo sem necessidade de BYPASSRLS na role devcore_app.
   */
  async handleGoogleIdToken(idToken: string): Promise<{ user: UserProfile; token: string }> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (isPlaceholder(clientId)) {
      throw new UnauthorizedException('GOOGLE_CLIENT_ID não configurado.');
    }

    try {
      const oauthClient = new google.auth.OAuth2(clientId);
      const ticket = await oauthClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new UnauthorizedException('Token Google inválido ou e-mail não verificado.');
      }

      return this.provisionGoogleProfile({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email,
        avatarUrl: payload.picture,
        emailVerified: true,
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn('Falha ao validar o ID token do Google.');
      throw new UnauthorizedException('Falha na autenticação Google.');
    }
  }

  private async provisionGoogleProfile(
    profile: {
      googleId: string;
      email: string;
      name: string;
      avatarUrl?: string;
      emailVerified?: boolean;
    },
    driveTokens?: {
      accessToken: string;
      refreshToken: string | null;
      scope: string;
      expiresAt: Date;
    },
  ): Promise<{ user: UserProfile; token: string }> {
    let client: pg.PoolClient;
    try {
      client = await this.pgPool.connect();
    } catch (error) {
      this.logger.error('Falha ao conectar no PostgreSQL durante login Google.', error);
      throw new ServiceUnavailableException(
        'Banco de dados PostgreSQL indisponível na porta 5433. Inicie o Docker e execute "docker compose up -d".',
      );
    }

    try {
      await client.query('BEGIN');

      const maxUsers = this.getMaxRegisteredUsers();
      let resProvision: pg.QueryResult<{ user_id: string }>;

      // 1. Invocar função segura get_or_create_user_with_limit (propriedade de devcore_auth)
      try {
        await client.query('SAVEPOINT sp_user_limit');
        resProvision = await client.query(
          `
          SELECT get_or_create_user_with_limit($1, $2, $3, $4, $5, $6, $7) AS user_id;
        `,
          [
            'google',
            profile.googleId,
            profile.email,
            profile.emailVerified ?? true,
            profile.name,
            profile.avatarUrl || null,
            maxUsers,
          ],
        );
        await client.query('RELEASE SAVEPOINT sp_user_limit');
      } catch (fnErr: unknown) {
        const pgErr = fnErr as { code?: string; message?: string };
        if (pgErr?.code === 'P0001' || pgErr?.message?.includes('registration_limit_reached')) {
          await client.query('ROLLBACK');
          // Revoga token recém-emitido (best-effort) para não deixar sessão órfã no Google
          if (driveTokens?.accessToken) {
            fetch(
              `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(driveTokens.accessToken)}`,
              { method: 'POST' },
            ).catch(() => undefined);
          }
          throw new ForbiddenException(
            `Limite máximo de ${maxUsers} contas atingido. Novas inscrições estão encerradas no momento.`,
          );
        }
        // Fallback seguro caso 0001_user_registration_limit.sql ainda não tenha sido aplicada no banco
        if (pgErr?.code === '42883') {
          await client.query('ROLLBACK TO SAVEPOINT sp_user_limit');
          this.logger.warn(
            'Função get_or_create_user_with_limit não encontrada no PostgreSQL. Aplique packages/database/migrations/0001_user_registration_limit.sql.',
          );
          resProvision = await client.query(
            `
            SELECT get_or_create_user($1, $2, $3, $4, $5, $6) AS user_id;
          `,
            [
              'google',
              profile.googleId,
              profile.email,
              profile.emailVerified ?? true,
              profile.name,
              profile.avatarUrl || null,
            ],
          );
        } else {
          throw fnErr;
        }
      }

      const userId = resProvision.rows[0]?.user_id;
      if (!userId) {
        throw new UnauthorizedException('Não foi possível provisionar o usuário.');
      }

      // 2. Definir contexto RLS para a transação atual
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      // 3. Atualizar avatar/nome se mudou e persistir conexão Google Drive criptografada
      if (profile.avatarUrl) {
        await client.query(
          `
          UPDATE users
             SET avatar_url = COALESCE($1, avatar_url),
                 updated_at = now()
           WHERE id = app_user_id();
        `,
          [profile.avatarUrl],
        );
      }

      if (driveTokens) {
        const encryptedAccess = this.tokenCrypto.encrypt(driveTokens.accessToken);
        const encryptedRefresh = driveTokens.refreshToken
          ? this.tokenCrypto.encrypt(driveTokens.refreshToken)
          : '';

        await client.query(
          `
          INSERT INTO google_connections (
            user_id, encrypted_access_token, encrypted_refresh_token,
            token_scope, expires_at, status, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 'active', now())
          ON CONFLICT (user_id)
          DO UPDATE SET
            encrypted_access_token = EXCLUDED.encrypted_access_token,
            encrypted_refresh_token = CASE
              WHEN EXCLUDED.encrypted_refresh_token <> '' THEN EXCLUDED.encrypted_refresh_token
              ELSE google_connections.encrypted_refresh_token
            END,
            token_scope = EXCLUDED.token_scope,
            expires_at = EXCLUDED.expires_at,
            status = 'active',
            updated_at = now();
        `,
          [
            userId,
            encryptedAccess,
            encryptedRefresh,
            driveTokens.scope,
            driveTokens.expiresAt.toISOString(),
          ],
        );

        await client.query(
          `
          INSERT INTO drive_sync_states (user_id, sync_status)
          VALUES ($1, 'idle')
          ON CONFLICT (user_id) DO NOTHING;
        `,
          [userId],
        );
      }

      // 4. Buscar perfil completo respeitando RLS
      const userRes = await client.query(
        `
        SELECT id, email, full_name AS "fullName", avatar_url AS "avatarUrl",
               job_title AS "jobTitle", company, github_handle AS "githubHandle",
               linkedin_url AS "linkedinUrl", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM users
         WHERE id = $1;
      `,
        [userId],
      );

      await client.query('COMMIT');

      const user = userRes.rows[0];
      const token = this.jwtService.sign({
        sub: user.id,
        email: user.email,
        name: user.fullName,
      });

      return { user, token };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Erro no fluxo de login Google com get_or_create_user', error);
      throw new UnauthorizedException('Falha na autenticação ou email não verificado.');
    } finally {
      client.release();
    }
  }

  /**
   * Retorna os dados do usuário logado via RLS (app_user_id())
   */
  async getMe(userId: string): Promise<UserProfile> {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const res = await client.query(`
        SELECT id, email, full_name AS "fullName", avatar_url AS "avatarUrl",
               job_title AS "jobTitle", company, github_handle AS "githubHandle",
               linkedin_url AS "linkedinUrl", created_at AS "createdAt", updated_at AS "updatedAt"
          FROM users
         WHERE id = app_user_id();
      `);

      if (res.rows.length === 0) {
        throw new UnauthorizedException('Usuário não encontrado');
      }

      await client.query('COMMIT');
      return res.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
