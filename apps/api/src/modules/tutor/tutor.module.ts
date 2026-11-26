import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database.module.js';
import { DriveModule } from '../drive/drive.module.js';
import { TutorService } from './tutor.service.js';
import { TutorController } from './tutor.controller.js';

@Module({
  imports: [DatabaseModule, DriveModule],
  controllers: [TutorController],
  providers: [TutorService],
  exports: [TutorService],
})
export class TutorModule {}
