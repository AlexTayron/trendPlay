import { Module } from '@nestjs/common';
import { LearningService } from './learning.service.js';
import { LearningController } from './learning.controller.js';
import { DatabaseModule } from '../../common/database.module.js';

@Module({
  imports: [DatabaseModule],
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}

