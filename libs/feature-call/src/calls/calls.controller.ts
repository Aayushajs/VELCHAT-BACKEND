import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { AdmitDto, CreateCallDto, EndCallDto, JoinCallDto, ScheduleMeetingDto } from './calls.dto';

/** Call/meeting signaling REST (§B12). Routed via the gateway: /calls, /meetings. */
@ApiTags('calls')
@ApiBearerAuth('access-token')
@Controller()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  // Declared before `calls/:id` so the static path wins over the :id param route.
  @Get('calls/ice-servers')
  @ApiOperation({
    summary: 'WebRTC ICE servers (STUN/TURN) for a raw/P2P call',
    description:
      'Self-hosted coturn STUN + short-lived TURN credentials. Feed straight into ' +
      'new RTCPeerConnection({ iceServers }). Group calls use the LiveKit token from join instead.',
  })
  @ApiQuery({ name: 'userId', description: 'Account_id the TURN credential is bound to.' })
  @ApiOkResponse({ description: '{ iceServers: [{ urls, username?, credential? }] }.' })
  ice(@Query('userId') userId: string) {
    return this.calls.iceServers(userId);
  }

  @Post('calls')
  @ApiOperation({
    summary: 'Start a call/room',
    description:
      'Creates a LiveKit room; host joins immediately. Returns { callId, roomName, url, token }.',
  })
  @ApiCreatedResponse({ description: 'Call created + host join token.' })
  create(@Body() body: CreateCallDto) {
    return this.calls.createCall(body);
  }

  @Post('calls/:id/join')
  @ApiOperation({
    summary: 'Join a call',
    description:
      'Returns a LiveKit token, or { status: "lobby" } if the host must admit you first.',
  })
  @ApiParam({ name: 'id', description: 'Call id.' })
  @ApiCreatedResponse({ description: 'Join token or lobby status.' })
  join(@Param('id') id: string, @Body() body: JoinCallDto) {
    return this.calls.join(id, body.userId);
  }

  @Post('calls/:id/admit')
  @ApiOperation({ summary: 'Admit a lobby waiter (host only)' })
  @ApiParam({ name: 'id', description: 'Call id.' })
  @ApiCreatedResponse({ description: 'Admitted — the waiter can now join with a token.' })
  admit(@Param('id') id: string, @Body() body: AdmitDto) {
    return this.calls.admit(id, body.hostId, body.userId);
  }

  @Post('calls/:id/leave')
  @ApiOperation({ summary: 'Leave a call' })
  @ApiParam({ name: 'id', description: 'Call id.' })
  @ApiOkResponse({ description: 'Left.' })
  leave(@Param('id') id: string, @Body() body: JoinCallDto) {
    return this.calls.leave(id, body.userId);
  }

  @Post('calls/:id/end')
  @ApiOperation({ summary: 'End the call for everyone (host only)' })
  @ApiParam({ name: 'id', description: 'Call id.' })
  @ApiOkResponse({ description: '{ ended }.' })
  end(@Param('id') id: string, @Body() body: EndCallDto) {
    return this.calls.end(id, body.actorId);
  }

  @Get('calls/:id')
  @ApiOperation({ summary: 'Call info + participants' })
  @ApiParam({ name: 'id', description: 'Call id.' })
  @ApiOkResponse({ description: '{ call, participants }.' })
  info(@Param('id') id: string) {
    return this.calls.info(id);
  }

  @Post('meetings')
  @ApiOperation({
    summary: 'Schedule a meeting',
    description:
      'Creates a meeting room + metadata, emits meeting.scheduled. Returns { meetingId, callId, joinPath }.',
  })
  @ApiCreatedResponse({ description: 'Meeting scheduled.' })
  schedule(@Body() body: ScheduleMeetingDto) {
    return this.calls.scheduleMeeting(body);
  }
}
