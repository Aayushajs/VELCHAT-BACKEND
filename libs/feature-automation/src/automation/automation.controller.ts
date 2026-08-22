import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import {
  CreateBotDto,
  RegisterCommandDto,
  DispatchSlashDto,
  CreateReminderDto,
  CreateWorkflowDto,
  TriggerWorkflowDto,
} from './automation.dto';

/**
 * Bots, slash commands, workflows, reminders (§B17 / §A4.7). Routed via the gateway under /automation.
 */
@ApiTags('automation')
@ApiBearerAuth('access-token')
@Controller('automation')
export class AutomationController {
  constructor(private readonly svc: AutomationService) {}

  @Post('bots')
  @ApiOperation({ summary: 'Register a bot (returns the token once)' })
  @ApiCreatedResponse({ description: 'Bot created + one-time token.' })
  createBot(@Body() body: CreateBotDto) {
    return this.svc.createBot(body);
  }

  @Get('bots')
  @ApiOperation({ summary: 'List bots in a workspace' })
  @ApiQuery({ name: 'workspaceId' })
  listBots(@Query('workspaceId') workspaceId: string) {
    return this.svc.listBots(workspaceId);
  }

  @Post('commands')
  @ApiOperation({ summary: 'Register a slash command → bot' })
  registerCommand(@Body() body: RegisterCommandDto) {
    return this.svc.registerCommand(body);
  }

  @Get('commands')
  @ApiOperation({ summary: 'List slash commands in a workspace' })
  @ApiQuery({ name: 'workspaceId' })
  listCommands(@Query('workspaceId') workspaceId: string) {
    return this.svc.listCommands(workspaceId);
  }

  @Post('slash')
  @ApiOperation({
    summary: 'Dispatch a slash command to its bot (round-trip)',
    description: 'Finds the bot, HMAC-signs the payload, POSTs the webhook, returns the bot reply.',
  })
  @ApiOkResponse({ description: 'Bot response (or ok:false + error).' })
  dispatch(@Body() body: DispatchSlashDto) {
    return this.svc.dispatchSlash(body);
  }

  @Post('reminders')
  @ApiOperation({ summary: 'Schedule a reminder (/remind) — durable job' })
  @ApiCreatedResponse({ description: 'Reminder scheduled.' })
  reminder(@Body() body: CreateReminderDto) {
    return this.svc.createReminder(body);
  }

  @Post('workflows')
  @ApiOperation({ summary: 'Create a workflow (trigger → steps)' })
  @ApiCreatedResponse({ description: 'Workflow created.' })
  createWorkflow(@Body() body: CreateWorkflowDto) {
    return this.svc.createWorkflow(body);
  }

  @Get('workflows')
  @ApiOperation({ summary: 'List workflows in a workspace' })
  @ApiQuery({ name: 'workspaceId' })
  listWorkflows(@Query('workspaceId') workspaceId: string) {
    return this.svc.listWorkflows(workspaceId);
  }

  @Post('workflows/:id/trigger')
  @ApiOperation({ summary: 'Fire a workflow (enqueues its first step durably)' })
  trigger(@Param('id') id: string, @Body() body: TriggerWorkflowDto) {
    return this.svc.triggerWorkflow(id, body.context ?? {});
  }

  @Post('workflows/:id/enable')
  @ApiOperation({ summary: 'Enable a workflow' })
  enable(@Param('id') id: string) {
    return this.svc.setEnabled(id, true);
  }

  @Post('workflows/:id/disable')
  @ApiOperation({ summary: 'Disable a workflow' })
  disable(@Param('id') id: string) {
    return this.svc.setEnabled(id, false);
  }
}
