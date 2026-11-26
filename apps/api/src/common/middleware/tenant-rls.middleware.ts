import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

@Injectable()
export class TenantRlsMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
    // 1. Tentar ler token do cookie HttpOnly ou header Authorization Bearer
    const token = req.cookies?.['devcore_session'] || 
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);

    if (token) {
      try {
        const payload = this.jwtService.verify(token);
        req.userId = payload.sub;
        req.userEmail = payload.email;
      } catch {
        // Token inválido ou expirado - requisição continua sem contexto de usuário
      }
    }

    next();
  }
}

