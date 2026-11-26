import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../middleware/tenant-rls.middleware.js';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.userId) {
      throw new UnauthorizedException('Sessão inválida ou não autenticada.');
    }
    return true;
  }
}

