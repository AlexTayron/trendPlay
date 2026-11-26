import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { DatabaseModule } from '../../common/database.module.js';
import { TokenCryptoService } from '../../common/crypto/token-crypto.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, TokenCryptoService],
  exports: [AuthService, TokenCryptoService],
})
export class AuthModule {}
