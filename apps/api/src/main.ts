import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('DevCoreAPI');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Confia no proxy reverso (Nginx/Certbot) para reconhecer HTTPS e IP real
  app.set('trust proxy', 1);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`DevCore API iniciada com sucesso na porta ${port}`);
}

bootstrap();

