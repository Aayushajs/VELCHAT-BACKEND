import type { PostgresClient } from '@velchat/database';
import type { BotRow, SlashCommandRow, WorkflowRow, AutomationJobRow } from '@velchat/database';
import { uuidv7 } from '@velchat/common';

/** automation-service data access (Postgres, §B17). Parameterized queries; atomic job claim. */
export class AutomationRepository {
  constructor(private readonly pg: PostgresClient) {}

  // ── bots ──
  async createBot(b: {
    workspaceId: string;
    name: string;
    tokenHash: string;
    scopes: string[];
    webhookUrl?: string | null;
    webhookSecret: string;
  }): Promise<BotRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO bots(bot_id, workspace_id, name, token_hash, scopes, webhook_url, webhook_secret)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        uuidv7(),
        b.workspaceId,
        b.name,
        b.tokenHash,
        b.scopes,
        b.webhookUrl ?? null,
        b.webhookSecret,
      ],
    );
    return res.rows[0] as BotRow;
  }

  async listBots(workspaceId: string): Promise<BotRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM bots WHERE workspace_id = $1 ORDER BY created_at DESC',
      [workspaceId],
    );
    return res.rows as BotRow[];
  }

  async getBot(botId: string): Promise<BotRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM bots WHERE bot_id = $1', [botId]);
    return (res.rows[0] as BotRow | undefined) ?? null;
  }

  // ── slash commands ──
  async registerCommand(c: {
    workspaceId: string;
    command: string;
    botId: string;
    description?: string | null;
  }): Promise<SlashCommandRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO slash_commands(id, workspace_id, command, bot_id, description)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, command) DO UPDATE SET bot_id = $4, description = $5
       RETURNING *`,
      [uuidv7(), c.workspaceId, c.command, c.botId, c.description ?? null],
    );
    return res.rows[0] as SlashCommandRow;
  }

  async listCommands(workspaceId: string): Promise<SlashCommandRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM slash_commands WHERE workspace_id = $1 ORDER BY command',
      [workspaceId],
    );
    return res.rows as SlashCommandRow[];
  }

  async findCommand(workspaceId: string, command: string): Promise<SlashCommandRow | null> {
    const res = await this.pg.pool.query(
      'SELECT * FROM slash_commands WHERE workspace_id = $1 AND command = $2',
      [workspaceId, command],
    );
    return (res.rows[0] as SlashCommandRow | undefined) ?? null;
  }

  // ── workflows ──
  async createWorkflow(w: {
    workspaceId: string;
    name: string;
    trigger: unknown;
    steps: unknown;
  }): Promise<WorkflowRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO workflows(workflow_id, workspace_id, name, trigger, steps)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [uuidv7(), w.workspaceId, w.name, JSON.stringify(w.trigger), JSON.stringify(w.steps)],
    );
    return res.rows[0] as WorkflowRow;
  }

  async getWorkflow(id: string): Promise<WorkflowRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM workflows WHERE workflow_id = $1', [id]);
    return (res.rows[0] as WorkflowRow | undefined) ?? null;
  }

  async listWorkflows(workspaceId: string): Promise<WorkflowRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM workflows WHERE workspace_id = $1 ORDER BY created_at DESC',
      [workspaceId],
    );
    return res.rows as WorkflowRow[];
  }

  async setWorkflowEnabled(id: string, enabled: boolean): Promise<WorkflowRow | null> {
    const res = await this.pg.pool.query(
      'UPDATE workflows SET enabled = $2 WHERE workflow_id = $1 RETURNING *',
      [id, enabled],
    );
    return (res.rows[0] as WorkflowRow | undefined) ?? null;
  }

  // ── durable jobs ──
  async enqueueJob(kind: string, payload: unknown, runAt: Date): Promise<AutomationJobRow> {
    const res = await this.pg.pool.query(
      `INSERT INTO automation_jobs(id, kind, payload, run_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [uuidv7(), kind, JSON.stringify(payload), runAt],
    );
    return res.rows[0] as AutomationJobRow;
  }

  /** Atomically claim due jobs (FOR UPDATE SKIP LOCKED) so replicas don't double-run. */
  async claimDueJobs(now: Date, limit: number): Promise<AutomationJobRow[]> {
    const res = await this.pg.pool.query(
      `UPDATE automation_jobs SET status = 'running'
       WHERE id IN (
         SELECT id FROM automation_jobs
         WHERE status = 'pending' AND run_at <= $1
         ORDER BY run_at LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now, limit],
    );
    return res.rows as AutomationJobRow[];
  }

  async markJobDone(id: string): Promise<void> {
    await this.pg.pool.query("UPDATE automation_jobs SET status = 'done' WHERE id = $1", [id]);
  }

  async markJobRetryOrDead(
    id: string,
    attempts: number,
    dead: boolean,
    runAt: Date,
    error: string,
  ): Promise<void> {
    await this.pg.pool.query(
      `UPDATE automation_jobs
         SET status = $2, attempts = $3, run_at = $4, last_error = $5
       WHERE id = $1`,
      [id, dead ? 'dead' : 'pending', attempts + 1, runAt, error.slice(0, 500)],
    );
  }
}
