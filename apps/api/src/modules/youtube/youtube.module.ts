import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database.module.js';
import { YoutubeService } from './youtube.service.js';
import { YoutubeController } from './youtube.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [YoutubeController],
  providers: [YoutubeService],
  exports: [YoutubeService],
})
export class YoutubeModule {}
