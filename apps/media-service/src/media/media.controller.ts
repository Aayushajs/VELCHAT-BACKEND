import {
  Controller,
  Post,
  Put,
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
} from '@nestjs/swagger';
import { ValidationError } from '@velchat/common';
import { MediaService } from './media.service';
import { InitUploadDto } from './media.dto';

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
}
