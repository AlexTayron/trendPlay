import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Request, Response } from 'express';
import crypto from 'node:crypto';
import { AuthService } from './auth.service.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';

class GoogleCallbackDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('config')
  getConfig() {
    return this.authService.getConfigStatus();
  }

  @Get('google')
  async startGoogleOAuth(
    @Query('existing') existing: string | undefined,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    try {
      // Bloqueia novas inscrições ANTES de redirecionar ao Google quando o limite (ex.: 90) foi atingido.
      // Usuários já cadastrados ainda podem entrar com `?existing=1` (e o banco valida atomicamente no callback).
      if (existing !== '1') {
        const cfg = await this.authService.getConfigStatus();
        if (!cfg.registrationsOpen) {
          const msg = `Limite máximo de ${cfg.maxUsers} contas atingido. Novas inscrições estão encerradas no momento.`;
          return res.redirect(`${frontendUrl}/?auth_error=${encodeURIComponent(msg)}`);
        }
      }

      const state = crypto.randomBytes(24).toString('hex');
      res.cookie('devcore_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutos
      });

      const authUrl = this.authService.buildGoogleAuthorizationUrl(state);
      return res.redirect(authUrl);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Google OAuth não configurado.';
      return res.redirect(
        `${frontendUrl}/?auth_error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Get('google/callback')
  async googleOAuthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const expectedState = req.cookies?.['devcore_oauth_state'];
    res.clearCookie('devcore_oauth_state');

    if (oauthError) {
      return res.redirect(
        `${frontendUrl}/?auth_error=${encodeURIComponent(`Permissão negada pelo Google: ${oauthError}`)}`,
      );
    }

    if (!code || !state || !expectedState || state !== expectedState) {
      return res.redirect(
        `${frontendUrl}/?auth_error=${encodeURIComponent('Sessão OAuth expirada ou inválida. Tente conectar novamente.')}`,
      );
    }

    try {
      const { token } = await this.authService.handleGoogleAuthorizationCode(code);

      res.cookie('devcore_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
      });

      return res.redirect(`${frontendUrl}/?drive_connected=1`);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Falha na autenticação Google.';
      return res.redirect(
        `${frontendUrl}/?auth_error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Post('google/callback')
  async googleCallback(
    @Body() body: GoogleCallbackDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token } = await this.authService.handleGoogleIdToken(body.idToken);

    // Emissão de cookie seguro HttpOnly
    res.cookie('devcore_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    return { user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUserId() userId: string) {
    return this.authService.getMe(userId);
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('devcore_session');
    return { success: true };
  }
}
