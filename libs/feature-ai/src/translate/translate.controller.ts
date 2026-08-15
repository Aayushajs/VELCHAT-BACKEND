import { Controller, Get, Post, Put, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { TranslateService } from './translate.service';
import { TranslateDto, DetectDto, SetUserLangDto, SetChatPrefDto } from './translate.dto';

/**
 * Translation + language prefs (§A26 / §B20). Routed via the gateway under /ai. Server-side path is
 * for ENTERPRISE (server-readable) content only; personal E2EE translation runs on-device (§A26.1).
 */
@ApiTags('ai-translation')
@ApiBearerAuth('access-token')
@Controller('ai')
export class TranslateController {
  constructor(private readonly svc: TranslateService) {}

  @Post('translate')
  @ApiOperation({
    summary: 'Translate text (enterprise content)',
    description: 'Detects source, serves from cache, else self-hosted model. E2EE stays on-device.',
  })
  @ApiOkResponse({ description: 'Translated text + detected source + cache hit flag.' })
  translate(@Body() body: TranslateDto) {
    return this.svc.translate(body.text, body.target, body.source);
  }

  @Post('detect')
  @ApiOperation({ summary: 'Detect the language of text' })
  detect(@Body() body: DetectDto) {
    return this.svc.detect(body.text);
  }

  @Get('language')
  @ApiOperation({ summary: "Get a user's language prefs" })
  getUserLang(@Query('accountId') accountId: string) {
    return this.svc.getUserLang(accountId);
  }

  @Put('language')
  @ApiOperation({ summary: "Set a user's language prefs" })
  setUserLang(@Body() body: SetUserLangDto) {
    return this.svc.setUserLang(body.accountId, {
      uiLang: body.uiLang,
      preferredMsgLang: body.preferredMsgLang,
      autoTranslate: body.autoTranslate,
      captionLang: body.captionLang,
      voiceLang: body.voiceLang,
    });
  }

  @Get('translate/pref')
  @ApiOperation({ summary: 'Get per-chat translate pref' })
  getChatPref(
    @Query('accountId') accountId: string,
    @Query('conversationId') conversationId: string,
  ) {
    return this.svc.getChatPref(accountId, conversationId);
  }

  @Put('translate/pref')
  @ApiOperation({ summary: 'Set per-chat translate pref (off | auto | manual)' })
  setChatPref(@Body() body: SetChatPrefDto) {
    return this.svc.setChatPref(
      body.accountId,
      body.conversationId,
      body.mode,
      body.targetLang ?? null,
    );
  }
}
