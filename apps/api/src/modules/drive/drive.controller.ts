import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { DriveService } from './drive.service.js';

class PickedFileDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

class ImportCourseFolderDto {
  @IsString()
  @IsNotEmpty()
  folderId!: string;

  @IsOptional()
  @IsString()
  folderName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickedFileDto)
  selectedFiles?: PickedFileDto[];
}

class AttachFilesDto {
  @IsOptional()
  @IsString()
  moduleTitle?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickedFileDto)
  files!: PickedFileDto[];
}

@Controller('drive')
@UseGuards(AuthGuard)
export class DriveController {
  constructor(private readonly driveService: DriveService) {}

  @Get('status')
  getStatus(@CurrentUserId() userId: string) {
    return this.driveService.getConnectionStatus(userId);
  }

  @Get('picker-token')
  getPickerToken(@CurrentUserId() userId: string) {
    return this.driveService.getPickerToken(userId);
  }

  @Get('folders')
  listFolders(
    @CurrentUserId() userId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.driveService.listDriveFolders(userId, parentId || 'root');
  }

  @Get('items')
  listItems(
    @CurrentUserId() userId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.driveService.listDriveItems(userId, parentId || 'root');
  }

  @Post('courses/import')
  importCourseFolder(
    @CurrentUserId() userId: string,
    @Body() body: ImportCourseFolderDto,
  ) {
    return this.driveService.importCourseFolder(userId, body);
  }

  @Post('courses/import-root')
  importRootCoursesFolder(
    @CurrentUserId() userId: string,
    @Body() body: ImportCourseFolderDto,
  ) {
    return this.driveService.importRootCoursesFolder(userId, body.folderId);
  }

  @Post('courses/:courseId/sync')
  syncCourse(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.driveService.syncCourse(userId, courseId);
  }

  @Post('courses/:courseId/attach-files')
  attachFiles(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
    @Body() body: AttachFilesDto,
  ) {
    return this.driveService.attachPickedFilesToCourse(userId, courseId, body);
  }

  @Get('files/:driveFileId/stream')
  async streamFile(
    @CurrentUserId() userId: string,
    @Param('driveFileId') driveFileId: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.driveService.streamFile(
      userId,
      driveFileId,
      req,
      res,
      download === '1' || download === 'true',
    );
  }

  @Delete('disconnect')
  disconnect(@CurrentUserId() userId: string) {
    return this.driveService.disconnect(userId);
  }
}
