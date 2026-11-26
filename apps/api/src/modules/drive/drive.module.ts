import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { YoutubeModule } from '../youtube/youtube.module.js';
import { DriveService } from './drive.service.js';
import { DriveController } from './drive.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, YoutubeModule],
  controllers: [DriveController],
  providers: [DriveService],
  exports: [DriveService],
})
export class DriveModule {}
