import { Module } from '@nestjs/common';
import { RagService } from './rag.service.js';
import { DatabaseModule } from '../../common/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}

