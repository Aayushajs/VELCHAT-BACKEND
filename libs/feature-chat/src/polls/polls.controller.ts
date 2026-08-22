import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { PollsService } from './polls.service';
import { CreatePollDto, VoteDto } from './polls.dto';

/** Polls (§B16). Routed via the gateway under /polls. Vote → live tally event to conversation. */
@ApiTags('polls')
@ApiBearerAuth('access-token')
@Controller('polls')
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a poll (single or multi choice, optional anonymous + close time)',
  })
  @ApiCreatedResponse({ description: 'Poll created (message_id = _id).' })
  create(@Body() body: CreatePollDto) {
    return this.polls.createPoll(body);
  }

  @Post(':messageId/vote')
  @ApiOperation({
    summary: 'Cast a vote',
    description: 'Single-choice re-vote replaces; multi adds.',
  })
  @ApiOkResponse({ description: 'Updated tally.' })
  vote(@Param('messageId') messageId: string, @Body() body: VoteDto) {
    return this.polls.vote(messageId, body.userId, body.optionIds);
  }

  @Get(':messageId')
  @ApiOperation({ summary: 'Get poll results (voters hidden for anonymous polls)' })
  results(@Param('messageId') messageId: string, @Query('admin') admin?: string) {
    return this.polls.getResults(messageId, admin === 'true');
  }

  @Post(':messageId/close')
  @ApiOperation({ summary: 'Close a poll now' })
  close(@Param('messageId') messageId: string) {
    return this.polls.close(messageId);
  }
}
