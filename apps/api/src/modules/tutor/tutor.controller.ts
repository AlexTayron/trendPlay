import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { TutorService } from './tutor.service.js';

class TutorChatDto {
  @IsOptional()
  @IsString()
  lessonId?: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentTimeSeconds?: number;
}

@Controller('tutor')
@UseGuards(AuthGuard)
export class TutorController {
  constructor(private readonly tutorService: TutorService) {}

  @Get('status')
  getStatus() {
    return this.tutorService.getStatus();
  }

  @Get('courses/:courseId/history')
  getHistory(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
    @Query('lessonId') lessonId?: string,
  ) {
    return this.tutorService.getHistory(userId, courseId, lessonId);
  }

  @Post('courses/:courseId/chat')
  chat(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
    @Body() body: TutorChatDto,
  ) {
    return this.tutorService.chat(userId, courseId, body);
  }

  @Delete('conversations/:conversationId')
  clearConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.tutorService.clearConversation(userId, conversationId);
  }
}
