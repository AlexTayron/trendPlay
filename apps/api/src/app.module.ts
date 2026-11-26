import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TenantRlsMiddleware } from './common/middleware/tenant-rls.middleware.js';
import { DatabaseModule } from './common/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DriveModule } from './modules/drive/drive.module.js';
import { YoutubeModule } from './modules/youtube/youtube.module.js';
import { RagModule } from './modules/rag/rag.module.js';
import { LearningModule } from './modules/learning/learning.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'devcore_jwt_secret_dev_key',
        signOptions: { expiresIn: '7d' },
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    DriveModule,
    YoutubeModule,
    RagModule,
    LearningModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantRlsMiddleware).forRoutes('*');
  }
}

