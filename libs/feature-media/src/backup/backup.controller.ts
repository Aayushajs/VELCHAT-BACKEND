import {
  Controller,
  Post,
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
import { BackupService } from './backup.service';

interface UploadedBlob {
  buffer: Buffer;
}

const MAX_BACKUP_BYTES = 500 * 1024 * 1024;

/** E2EE chat backup REST (§C21). The server only ever moves ciphertext. */
@ApiTags('backup')
@ApiBearerAuth('access-token')
@Controller('backups')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Post(':accountId')
  @ApiOperation({
    summary: 'Upload an encrypted backup',
    description:
      'Body: multipart `file` = ciphertext, `salt` = base64 KDF salt. New version each call.',
  })
  @ApiParam({ name: 'accountId', description: 'Owner account_id.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        salt: { type: 'string' },
        kdf: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ description: '{ version, size }.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BACKUP_BYTES } }))
  upload(
    @Param('accountId') accountId: string,
    @Body() body: { salt: string; kdf?: string },
    @UploadedFile() file?: UploadedBlob,
  ) {
    if (!file?.buffer) throw new ValidationError('multipart field "file" (ciphertext) is required');
    return this.backup.upload({
      accountId,
      ciphertext: file.buffer,
      salt: body.salt,
      kdf: body.kdf,
    });
  }

  @Get(':accountId/latest')
  @ApiOperation({
    summary: 'Fetch the latest backup for restore',
    description: 'Returns the KDF salt + a signed URL to the ciphertext; decrypt on-device.',
  })
  @ApiParam({ name: 'accountId', description: 'Owner account_id.' })
  @ApiOkResponse({ description: '{ version, size, kdf, salt, downloadUrl, createdAt }.' })
  latest(@Param('accountId') accountId: string, @Query('ttl') ttl?: string) {
    return this.backup.latest(accountId, ttl ? Number(ttl) : 300);
  }
}
