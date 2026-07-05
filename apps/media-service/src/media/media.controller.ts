import {
  Controller,
  Post,
  Put,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ValidationError } from '@velchat/common';
import { MediaService } from './media.service';
import { InitUploadDto, RenditionsDto } from './media.dto';

/** Minimal shape of a multer file (avoids pulling the Express namespace into types). */
interface UploadedMedia {
  buffer: Buffer;
  mimetype?: string;
}

const MAX_BYTES = 100 * 1024 * 1024;

/** Media upload/download REST (§B11). Routed via the gateway: /media, /files. */
@ApiTags('media')
@ApiBearerAuth('access-token')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @ApiOperation({
    summary: 'Reserve a media id',
    description:
      'Returns { mediaId, uploadPath }. PUT the bytes (ciphertext for personal) to uploadPath.',
  })
  @ApiCreatedResponse({ description: 'Reserved media id + upload path.' })
  init(@Body() body: InitUploadDto) {
    return this.media.initUpload(body);
  }

  @Put('uploads/:id')
  @ApiOperation({
    summary: 'Upload the bytes',
    description: 'Content-addressed + deduped. For personal media the body is opaque ciphertext.',
  })
  @ApiParam({ name: 'id', description: 'Media id from init.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({ description: '{ mediaId, status, deduped, storageKey }.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  complete(@Param('id') id: string, @UploadedFile() file?: UploadedMedia) {
    if (!file?.buffer) throw new ValidationError('multipart field "file" is required');
    return this.media.completeUpload(id, file.buffer, file.mimetype);
  }

  @Get()
  @ApiOperation({
    summary: 'Conversation media gallery',
    description: 'Ready media in a conversation, newest first (cursor by created_at).',
  })
  @ApiQuery({ name: 'conversationId', description: 'Conversation to list media for.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (default 50, max 100).' })
  @ApiQuery({ name: 'before', required: false, description: 'created_at cursor (ISO).' })
  @ApiOkResponse({ description: 'Array of media objects.' })
  gallery(
    @Query('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.media.gallery(conversationId, limit ? Number(limit) : 50, before);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Media metadata' })
  @ApiParam({ name: 'id', description: 'Media id.' })
  @ApiOkResponse({ description: 'Media object metadata.' })
  metadata(@Param('id') id: string) {
    return this.media.metadata(id);
  }

  @Get(':id/url')
  @ApiOperation({
    summary: 'Signed download URL',
    description: 'Short-lived signed URL for the blob.',
  })
  @ApiParam({ name: 'id', description: 'Media id.' })
  @ApiOkResponse({ description: '{ url, mime }.' })
  url(@Param('id') id: string, @Query('ttl') ttl?: string) {
    return this.media.downloadUrl(id, ttl ? Number(ttl) : 300);
  }

  @Post(':id/view')
  @ApiOperation({
    summary: 'Consume view-once media (§C22)',
    description:
      'Atomically claims the single view and returns a short-lived URL; a replay gets 410 Gone. ' +
      'The blob is deleted immediately (refcount-aware) so it can never be fetched again.',
  })
  @ApiParam({ name: 'id', description: 'Media id (must be view-once).' })
  @ApiOkResponse({ description: '{ url, mime } — valid once.' })
  view(@Param('id') id: string) {
    return this.media.consumeViewOnce(id);
  }

  @Patch(':id/renditions')
  @ApiOperation({
    summary: 'Write back transcode output (worker/AI, enterprise only)',
    description: 'Sets renditions/thumb/blurhash/dims/duration and emits file.transcoded.',
  })
  @ApiParam({ name: 'id', description: 'Media id.' })
  @ApiOkResponse({ description: 'Updated media object.' })
  renditions(@Param('id') id: string, @Body() body: RenditionsDto) {
    return this.media.applyRenditions(id, body);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete media (owner only)',
    description: 'Removes metadata; the blob is GC’d only when no other object references it.',
  })
  @ApiParam({ name: 'id', description: 'Media id.' })
  @ApiQuery({ name: 'actorId', description: 'Acting account_id (must be the owner).' })
  @ApiOkResponse({ description: '{ deleted, blobRemoved }.' })
  remove(@Param('id') id: string, @Query('actorId') actorId: string) {
    if (!actorId) throw new ValidationError('actorId is required');
    return this.media.deleteMedia(id, actorId);
  }
}
