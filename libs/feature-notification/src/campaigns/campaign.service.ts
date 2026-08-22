import { NotFoundError, ValidationError, type Logger } from '@velchat/common';
import type { CampaignRecurrence, MailCampaignRow } from '@velchat/database';
import {
  welcomeEmail,
  notificationEmail,
  renderEmail,
  type Mailer,
  type EmailContent,
} from '@velchat/mail';
import { CampaignRepository, type CreateCampaignInput } from './campaign.repository';
import { computeNextRun, isCampaignComplete } from './recurrence';

export interface CreateCampaignRequest {
  name: string;
  subject: string;
  template: 'welcome' | 'notification' | 'custom';
  html?: string;
  text?: string;
  ctaText?: string;
  ctaUrl?: string;
  recipients: string[];
  mode: 'immediate' | 'scheduled' | 'recurring';
  scheduledAt?: string; // ISO
  recurrence?: CampaignRecurrence;
  endsAt?: string; // ISO
  maxOccurrences?: number;
  createdBy?: string;
}

/** Bulk mail campaigns: create (immediate/scheduled/recurring), control, and the send engine. */
export class CampaignService {
  constructor(
    private readonly repo: CampaignRepository,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCampaign(
    req: CreateCampaignRequest,
  ): Promise<{ message: string; campaign: MailCampaignRow }> {
    if (!Array.isArray(req.recipients) || req.recipients.length === 0) {
      throw new ValidationError('recipients must be a non-empty array of email addresses');
    }
    const now = this.now();
    let nextRunAt: Date | null;

    if (req.mode === 'immediate') {
      nextRunAt = now;
    } else if (req.mode === 'scheduled') {
      if (!req.scheduledAt)
        throw new ValidationError('scheduledAt is required for a scheduled campaign');
      nextRunAt = new Date(req.scheduledAt);
    } else {
      // recurring
      if (!req.recurrence || (!req.recurrence.everyDays && !req.recurrence.daysOfWeek?.length)) {
        throw new ValidationError(
          'recurrence { everyDays and/or daysOfWeek[] } is required for a recurring campaign',
        );
      }
      nextRunAt = req.scheduledAt ? new Date(req.scheduledAt) : now;
    }

    const input: CreateCampaignInput = {
      name: req.name,
      subject: req.subject,
      template: req.template,
      html: req.html ?? null,
      text: req.text ?? null,
      ctaText: req.ctaText ?? null,
      ctaUrl: req.ctaUrl ?? null,
      recipients: req.recipients,
      mode: req.mode,
      scheduledAt: req.scheduledAt ? new Date(req.scheduledAt) : null,
      recurrence: req.recurrence ?? null,
      endsAt: req.endsAt ? new Date(req.endsAt) : null,
      maxOccurrences: req.maxOccurrences ?? null,
      nextRunAt,
      createdBy: req.createdBy ?? null,
    };
    const campaign = await this.repo.create(input);
    return {
      message: `Campaign "${campaign.name}" created (${campaign.mode}) for ${req.recipients.length} recipient(s).`,
      campaign,
    };
  }

  async list(): Promise<MailCampaignRow[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<MailCampaignRow> {
    const c = await this.repo.get(id);
    if (!c) throw new NotFoundError('Campaign not found');
    return c;
  }

  async pause(id: string): Promise<{ message: string; campaign: MailCampaignRow }> {
    const c = await this.repo.setStatus(id, 'paused');
    if (!c) throw new NotFoundError('Campaign not found');
    return { message: 'Campaign paused.', campaign: c };
  }

  async resume(id: string): Promise<{ message: string; campaign: MailCampaignRow }> {
    const c = await this.repo.setStatus(id, 'active');
    if (!c) throw new NotFoundError('Campaign not found');
    return { message: 'Campaign resumed.', campaign: c };
  }

  async cancel(id: string): Promise<{ message: string; campaign: MailCampaignRow }> {
    const c = await this.repo.setStatus(id, 'canceled');
    if (!c) throw new NotFoundError('Campaign not found');
    return { message: 'Campaign canceled.', campaign: c };
  }

  async sendNow(id: string): Promise<{ message: string; campaign: MailCampaignRow }> {
    const c = await this.repo.triggerNow(id);
    if (!c) throw new NotFoundError('Campaign not found (or canceled)');
    return { message: 'Campaign queued to send now.', campaign: c };
  }

  /** Worker entry point: send every campaign whose next_run_at is due, then reschedule/complete it. */
  async runDue(now: Date, batch = 10): Promise<number> {
    const due = await this.repo.claimDue(now, batch);
    for (const c of due) {
      await this.runOne(c, now);
    }
    return due.length;
  }

  private async runOne(c: MailCampaignRow, now: Date): Promise<void> {
    const content = this.renderContent(c);
    const recipients = Array.isArray(c.recipients) ? (c.recipients as string[]) : [];
    let sent = 0;
    for (const to of recipients) {
      try {
        await this.mailer.send({
          to,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
        await this.repo.logSend(c.id, to, now, 'sent', null);
        sent++;
      } catch (err) {
        await this.repo.logSend(
          c.id,
          to,
          now,
          'failed',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const occurrences = c.occurrences + 1;
    let nextRunAt: Date | null = null;
    if (c.mode === 'recurring') {
      const rec = (c.recurrence as CampaignRecurrence | null) ?? {};
      nextRunAt = computeNextRun(rec, now);
    }
    const complete =
      c.mode !== 'recurring' ||
      isCampaignComplete(
        { occurrences, maxOccurrences: c.maxOccurrences, endsAt: c.endsAt },
        nextRunAt,
        now,
      );

    await this.repo.recordRun(c.id, {
      occurrences,
      nextRunAt: complete ? null : nextRunAt,
      status: complete ? 'completed' : 'active',
    });
    this.logger.info(
      {
        campaign: c.id,
        sent,
        total: recipients.length,
        occurrences,
        next: complete ? null : nextRunAt,
      },
      'campaign run complete',
    );
  }

  /** Build the email {subject, html, text} for a campaign from its template + fields. */
  private renderContent(c: MailCampaignRow): EmailContent {
    if (c.template === 'notification') {
      return notificationEmail({
        title: c.subject,
        message: c.text ?? '',
        ctaText: c.ctaText ?? undefined,
        ctaUrl: c.ctaUrl ?? undefined,
      });
    }
    if (c.template === 'welcome') {
      const w = welcomeEmail();
      return { subject: c.subject, html: w.html, text: w.text };
    }
    // custom: use provided html, else render the body text through the branded layout.
    const html =
      c.html ??
      renderEmail({
        heading: c.subject,
        paragraphs: c.text ? [c.text] : [],
        cta: c.ctaText && c.ctaUrl ? { label: c.ctaText, url: c.ctaUrl } : undefined,
      });
    return { subject: c.subject, html, text: c.text ?? '' };
  }
}
