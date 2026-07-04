import type { PostgresClient } from '@velchat/database';
import type { MailCampaignRow } from '@velchat/database';
import { uuidv7 } from '@velchat/common';

export interface CreateCampaignInput {
  name: string;
  subject: string;
  template: string;
  html?: string | null;
  text?: string | null;
  ctaText?: string | null;
  ctaUrl?: string | null;
  recipients: string[];
  mode: string;
  scheduledAt?: Date | null;
  recurrence?: unknown;
  endsAt?: Date | null;
  maxOccurrences?: number | null;
  nextRunAt: Date | null;
  createdBy?: string | null;
}

/** Mail-campaign data access (Postgres). Parameterized queries; atomic claim for the worker. */
export class CampaignRepository {
  constructor(private readonly pg: PostgresClient) {}

  async create(i: CreateCampaignInput): Promise<MailCampaignRow> {
    const id = uuidv7();
    const res = await this.pg.pool.query(
      `INSERT INTO mail_campaigns
         (id, name, subject, template, html, text, cta_text, cta_url, recipients, mode,
          scheduled_at, recurrence, ends_at, max_occurrences, next_run_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'active')
       RETURNING *`,
      [
        id,
        i.name,
        i.subject,
        i.template,
        i.html ?? null,
        i.text ?? null,
        i.ctaText ?? null,
        i.ctaUrl ?? null,
        JSON.stringify(i.recipients),
        i.mode,
        i.scheduledAt ?? null,
        i.recurrence ? JSON.stringify(i.recurrence) : null,
        i.endsAt ?? null,
        i.maxOccurrences ?? null,
        i.nextRunAt,
      ],
    );
    return res.rows[0] as MailCampaignRow;
  }

  async list(): Promise<MailCampaignRow[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM mail_campaigns ORDER BY created_at DESC LIMIT 200',
    );
    return res.rows as MailCampaignRow[];
  }

  async get(id: string): Promise<MailCampaignRow | null> {
    const res = await this.pg.pool.query('SELECT * FROM mail_campaigns WHERE id = $1', [id]);
    return (res.rows[0] as MailCampaignRow | undefined) ?? null;
  }

  async setStatus(id: string, status: string): Promise<MailCampaignRow | null> {
    const res = await this.pg.pool.query(
      'UPDATE mail_campaigns SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, status],
    );
    return (res.rows[0] as MailCampaignRow | undefined) ?? null;
  }

  /** Force an immediate run: re-activate + set next_run_at = now (worker picks it up next tick). */
  async triggerNow(id: string): Promise<MailCampaignRow | null> {
    const res = await this.pg.pool.query(
      `UPDATE mail_campaigns SET status = 'active', next_run_at = now(), updated_at = now()
       WHERE id = $1 AND status <> 'canceled' RETURNING *`,
      [id],
    );
    return (res.rows[0] as MailCampaignRow | undefined) ?? null;
  }

  /**
   * Atomically claim due campaigns. We reserve each by clearing next_run_at (so a concurrent worker
   * / replica won't re-pick it — FOR UPDATE SKIP LOCKED), then the caller sends and calls recordRun
   * to set the real next run. Returns the rows as they were (recurrence/occurrences unchanged).
   */
  async claimDue(now: Date, limit: number): Promise<MailCampaignRow[]> {
    const res = await this.pg.pool.query(
      `UPDATE mail_campaigns SET next_run_at = NULL, updated_at = now()
       WHERE id IN (
         SELECT id FROM mail_campaigns
         WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= $1
         ORDER BY next_run_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [now, limit],
    );
    return res.rows as MailCampaignRow[];
  }

  async recordRun(
    id: string,
    r: { occurrences: number; nextRunAt: Date | null; status: string },
  ): Promise<void> {
    await this.pg.pool.query(
      `UPDATE mail_campaigns
         SET occurrences = $2, next_run_at = $3, status = $4, updated_at = now()
       WHERE id = $1`,
      [id, r.occurrences, r.nextRunAt, r.status],
    );
  }

  async logSend(
    campaignId: string,
    recipient: string,
    runAt: Date,
    status: 'sent' | 'failed',
    error: string | null,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO mail_campaign_sends (id, campaign_id, recipient, run_at, status, error)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv7(), campaignId, recipient, runAt, status, error],
    );
  }
}
