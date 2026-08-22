import { randomBytes, createHash } from 'node:crypto';
import { NotFoundError, ValidationError, type Logger } from '@velchat/common';
import type { BotRow, SlashCommandRow, WorkflowRow, AutomationJobRow } from '@velchat/database';
import { AutomationRepository } from './automation.repository';
import { signPayload } from './hmac';

export interface SlashDispatch {
  workspaceId: string;
  command: string;
  args?: string;
  userId: string;
  conversationId?: string;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Bots, slash commands, workflows, reminders (§B17). Job execution lives in the worker. */
export class AutomationService {
  constructor(
    private readonly repo: AutomationRepository,
    private readonly logger: Logger,
    private readonly dispatchTimeoutMs = 5000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── bots ──
  async createBot(input: {
    workspaceId: string;
    name: string;
    scopes?: string[];
    webhookUrl?: string;
  }): Promise<{ message: string; bot: BotRow; token: string }> {
    if (!input.workspaceId || !input.name)
      throw new ValidationError('workspaceId and name are required');
    const token = randomBytes(24).toString('hex'); // shown once
    const bot = await this.repo.createBot({
      workspaceId: input.workspaceId,
      name: input.name,
      tokenHash: sha256(token),
      scopes: input.scopes ?? [],
      webhookUrl: input.webhookUrl ?? null,
      webhookSecret: randomBytes(24).toString('hex'),
    });
    return { message: 'Bot created — copy the token now, it is not shown again.', bot, token };
  }

  listBots(workspaceId: string): Promise<BotRow[]> {
    return this.repo.listBots(workspaceId);
  }

  // ── slash commands ──
  async registerCommand(input: {
    workspaceId: string;
    command: string;
    botId: string;
    description?: string;
  }): Promise<SlashCommandRow> {
    const command = input.command.replace(/^\//, '').trim();
    if (!command) throw new ValidationError('command is required');
    if (!(await this.repo.getBot(input.botId))) throw new NotFoundError('bot not found');
    return this.repo.registerCommand({ ...input, command });
  }

  listCommands(workspaceId: string): Promise<SlashCommandRow[]> {
    return this.repo.listCommands(workspaceId);
  }

  /** Slash command → bot round-trip (§B17 / flow C14): find bot, HMAC-sign, POST, return its reply. */
  async dispatchSlash(
    d: SlashDispatch,
  ): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    const command = d.command.replace(/^\//, '').trim();
    const cmd = await this.repo.findCommand(d.workspaceId, command);
    if (!cmd) throw new NotFoundError(`no such command: /${command}`);
    const bot = await this.repo.getBot(cmd.botId);
    if (!bot?.webhookUrl) throw new ValidationError('bot has no webhook configured');

    const body = JSON.stringify({
      type: 'slash_command',
      command,
      args: d.args ?? '',
      user_id: d.userId,
      conversation_id: d.conversationId ?? null,
      workspace_id: d.workspaceId,
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.dispatchTimeoutMs);
    try {
      const res = await fetch(bot.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-velchat-signature': signPayload(bot.webhookSecret, body),
        },
        body,
        signal: ctrl.signal,
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: `bot responded ${res.status}` };
      return { ok: true, response };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(t);
    }
  }

  // ── reminders (/remind → durable scheduled job) ──
  async createReminder(input: {
    text: string;
    remindAt: string;
    userId: string;
    conversationId?: string;
  }): Promise<{ message: string; job: AutomationJobRow }> {
    if (!input.text) throw new ValidationError('text is required');
    const runAt = new Date(input.remindAt);
    if (Number.isNaN(runAt.getTime()))
      throw new ValidationError('remindAt must be an ISO datetime');
    const job = await this.repo.enqueueJob(
      'reminder',
      { text: input.text, userId: input.userId, conversationId: input.conversationId ?? null },
      runAt,
    );
    return { message: `Reminder scheduled for ${runAt.toISOString()}.`, job };
  }

  // ── workflows ──
  createWorkflow(input: {
    workspaceId: string;
    name: string;
    trigger: unknown;
    steps: unknown[];
  }): Promise<WorkflowRow> {
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new ValidationError('steps must be a non-empty array');
    }
    return this.repo.createWorkflow(input);
  }

  listWorkflows(workspaceId: string): Promise<WorkflowRow[]> {
    return this.repo.listWorkflows(workspaceId);
  }

  async setEnabled(id: string, enabled: boolean): Promise<WorkflowRow> {
    const w = await this.repo.setWorkflowEnabled(id, enabled);
    if (!w) throw new NotFoundError('workflow not found');
    return w;
  }

  /** Fire a workflow: enqueue its first step as a durable job (steps chain in the worker). */
  async triggerWorkflow(
    id: string,
    context: Record<string, unknown> = {},
  ): Promise<{ message: string }> {
    const w = await this.repo.getWorkflow(id);
    if (!w) throw new NotFoundError('workflow not found');
    if (!w.enabled) throw new ValidationError('workflow is disabled');
    await this.repo.enqueueJob(
      'workflow_step',
      { workflowId: id, stepIndex: 0, context },
      this.now(),
    );
    this.logger.info({ workflow: id }, 'workflow triggered');
    return { message: 'Workflow triggered.' };
  }
}
