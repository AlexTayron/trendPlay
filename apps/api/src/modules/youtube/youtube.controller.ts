import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUserId } from '../../common/decorators/current-user.decorator.js';
import { YoutubeService } from './youtube.service.js';

class ImportYoutubePlaylistDto {
  @IsString()
  @IsNotEmpty()
  playlistUrl!: string;

  @IsOptional()
  @IsString()
  customTitle?: string;
}

@Controller('youtube')
@UseGuards(AuthGuard)
export class YoutubeController {
  constructor(private readonly youtubeService: YoutubeService) {}

  @Post('playlists/import')
  importPlaylist(
    @CurrentUserId() userId: string,
    @Body() body: ImportYoutubePlaylistDto,
  ) {
    return this.youtubeService.importPlaylist(userId, body);
  }

  @Post('courses/:courseId/sync')
  syncCourse(
    @CurrentUserId() userId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.youtubeService.syncCourse(userId, courseId);
  }
}
