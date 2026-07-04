import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ResendService } from './resend.service';
import { RequestResendDto, FulfillResendDto } from './resend.dto';

/**
 * Decryption-failure resend protocol (§G1-1). Routed via the gateway under /messages. A recipient
 * whose device can't decrypt a message asks the sender to re-encrypt it (bounded retries); the
 * sender fulfils by uploading a fresh ciphertext. Prevents permanently-undecryptable messages from
 * being silently lost — the server never sees plaintext.
 */
@ApiTags('resend')
@ApiBearerAuth('access-token')
@Controller('messages')
export class ResendController {
  constructor(private readonly resend: ResendService) {}

  @Post(':messageId/resend-request')
  @ApiOperation({
    summary: "Ask the sender to re-send a message this device can't decrypt",
    description: 'Bounded retries; returns status requested | fulfilled | exhausted.',
  })
  @ApiOkResponse({ description: '{ status, attempts, message }.' })
  request(@Param('messageId') messageId: string, @Body() body: RequestResendDto) {
    return this.resend.requestResend(
      messageId,
      body.requesterId,
      body.requesterDeviceId,
      body.ratchetHint,
    );
  }

  @Post(':messageId/resend-fulfill')
  @ApiOperation({
    summary: 'Sender fulfils a resend request with a freshly re-encrypted ciphertext',
    description: 'Fresh-ratchet re-encryption preserves forward secrecy (§G1-1).',
  })
  @ApiOkResponse({ description: 'Fulfilled.' })
  fulfill(@Param('messageId') messageId: string, @Body() body: FulfillResendDto) {
    return this.resend.fulfillResend(messageId, body.requesterDeviceId, body.senderId);
  }

  @Get('resend/pending')
  @ApiOperation({
    summary: 'Pending resend requests a sender still needs to fulfil (flush-on-connect)',
  })
  pending(@Query('senderId') senderId: string) {
    return this.resend.pendingForSender(senderId);
  }
}
