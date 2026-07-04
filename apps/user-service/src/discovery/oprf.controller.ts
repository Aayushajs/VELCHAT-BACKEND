import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { OprfService } from './oprf.service';
import { EvaluateDto, RegisterOprfDto, MatchOprfDto } from './oprf.dto';

/**
 * OPRF-based private contact discovery (§G2). Routed via the gateway under /discovery/oprf.
 * Supersedes the plain salted-hash flow (`/directory/hash`, `/contacts/discover`), which is
 * brute-forceable offline against the small E.164 keyspace. Here the server NEVER sees a plaintext
 * number: clients blind locally → this service only evaluates blinded values → clients unblind
 * locally and only then send the resulting opaque tokens back to register/match. Every evaluate and
 * match call is rate-limited per account, so enumerating candidate numbers costs a live, throttled
 * round-trip per guess — the offline-dictionary attack the naive hash approach was vulnerable to.
 */
@ApiTags('discovery')
@ApiBearerAuth('access-token')
@Controller('discovery/oprf')
export class OprfController {
  constructor(private readonly oprf: OprfService) {}

  @Get('key')
  @ApiOperation({
    summary: "Get the server's public OPRF parameters",
    description: 'Public (n, e) + active key version. Clients blind their numbers against this.',
  })
  @ApiOkResponse({ description: '{ n, e, version } — public RSA parameters, base64url.' })
  getKey() {
    return this.oprf.getPublicKey();
  }

  @Post('rotate')
  @ApiOperation({
    summary: 'Rotate the OPRF key (admin)',
    description: 'Generates a new key + republishes it as active. Old tokens become unverifiable.',
  })
  @ApiCreatedResponse({ description: 'New public key + version.' })
  rotate() {
    return this.oprf.rotateKey();
  }

  @Post('evaluate')
  @ApiOperation({
    summary: 'Blind-evaluate a batch of candidate numbers (server never sees plaintext)',
    description: 'Rate-limited per account. Max 2000 blinded values per request.',
  })
  @ApiOkResponse({ description: '{ version, evaluated: string[] } — same order as the request.' })
  evaluate(@Body() body: EvaluateDto) {
    return this.oprf.evaluateBatch(body.accountId, body.blinded, body.keyVersion);
  }

  @Put('register')
  @ApiOperation({
    summary: 'Opt in to discovery',
    description:
      'Registers a token this account derived for its own number via the blind protocol.',
  })
  @ApiOkResponse({ description: 'Registered.' })
  register(@Body() body: RegisterOprfDto) {
    return this.oprf.register(body.accountId, body.token, body.keyVersion);
  }

  @Delete('register/:accountId')
  @ApiOperation({ summary: 'Opt out of discovery entirely' })
  unregister(@Param('accountId') accountId: string) {
    return this.oprf.unregister(accountId);
  }

  @Post('match')
  @ApiOperation({
    summary: 'Match client-derived tokens against the discoverable set',
    description: 'Rate-limited per account. Non-matches are never stored or logged.',
  })
  @ApiOkResponse({ description: '{ matches: { token: accountId } } — only matches returned.' })
  match(@Body() body: MatchOprfDto) {
    return this.oprf.match(body.accountId, body.tokens);
  }
}
