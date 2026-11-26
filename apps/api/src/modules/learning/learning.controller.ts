import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { LearningService } from './learning.service.js';

class CreateLessonNoteDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeSeconds?: number;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

class UpdateLessonProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  watchedDeltaSeconds?: number;
}

class UpdateCourseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  instructorName?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}

@Controller('learning')
@UseGuards(AuthGuard)
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('dashboard')
  getDashboard(@CurrentUserId() userId: string) {
    return this.learningService.getDashboard(userId);
  }

  @Get('courses')
  getCourses(@CurrentUserId() userId: string) {
    return this.learningService.getCourses(userId);
  }

  @Get('courses/:courseId')
  getCourseDetail(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.learningService.getCourseDetail(userId, courseId);
  }

  @Patch('courses/:courseId')
  updateCourse(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
    @Body() body: UpdateCourseDto,
  ) {
    return this.learningService.updateCourse(userId, courseId, body);
  }

  @Delete('courses/:courseId')
  archiveCourse(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.learningService.archiveCourse(userId, courseId);
  }

  @Get('lessons/:lessonId/notes')
  getLessonNotes(
    @CurrentUserId() userId: string,
    @Param('lessonId') lessonId: string,
  ) {
    return this.learningService.getLessonNotes(userId, lessonId);
  }

  @Post('lessons/:lessonId/notes')
  createLessonNote(
    @CurrentUserId() userId: string,
    @Param('lessonId') lessonId: string,
    @Body() body: CreateLessonNoteDto,
  ) {
    return this.learningService.createLessonNote({
      userId,
      lessonId,
      timeSeconds: body.timeSeconds,
      content: body.content,
    });
  }

  @Delete('lessons/:lessonId/notes/:noteId')
  deleteLessonNote(
    @CurrentUserId() userId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.learningService.deleteLessonNote(userId, noteId);
  }

  @Put('lessons/:lessonId/progress')
  async updateLessonProgress(
    @CurrentUserId() userId: string,
    @Param('lessonId') lessonId: string,
    @Body() body: UpdateLessonProgressDto,
  ) {
    await this.learningService.updateLessonProgress({
      userId,
      lessonId,
      positionSeconds: body.positionSeconds,
      durationSeconds: body.durationSeconds,
      isCompleted: body.isCompleted,
      watchedDeltaSeconds: body.watchedDeltaSeconds,
    });
    return { success: true };
  }
}
