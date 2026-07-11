import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { CaptionService, type Listener } from './caption.service';
import { CaptionDto } from './caption.dto';

/** Real-time call translation REST (§A26.3). Routed via the gateway: /ai/call. */
@ApiTags('ai-realtime-translate')
@ApiBearerAuth('access-token')
@Controller('ai/call')
export class CaptionController {
  constructor(private readonly captions: CaptionService) {}

  @Post('caption')
  @ApiOperation({
    summary: 'Caption + translate a live call segment for each listener',
    description:
      'Send one audio chunk (or text) + listeners with their languages. Transcribes (Whisper), ' +
      'translates per listener, optionally synthesizes speech, and pushes call.caption to each ' +
      'listener over the realtime gateway — near-real-time, each in their own language.',
  })
  @ApiOkResponse({ description: '{ captions, text, isFinal }.' })
  caption(@Body() body: CaptionDto) {
    return this.captions.caption({
      callId: body.callId,
      fromUserId: body.fromUserId,
      srcLang: body.srcLang,
      audioB64: body.audioB64,
      text: body.text,
      isFinalHint: body.isFinalHint,
      listeners: (body.listeners as Listener[]) ?? [],
    });
  }
}
