import { buildEnvelope, type Logger } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { AutomationJobRow, WorkflowRow } from '@velchat/database';
import { AutomationRepository } from './automation.repository';
import { signPayload } from './hmac';
import { nextRetry } from './backoff';

interface WorkflowStep {
  type: 'emit_event' | 'webhook' | 'delay';
  topic?: string;
  payload?: Record<string, unknown>;
  url?: string;
  secret?: string;
  body?: Record<string, unknown>;
  seconds?: number;
}

/**
 * Durable job runner (§B17): claims due `automation_jobs` (FOR UPDATE SKIP LOCKED), executes by kind
 * (reminder → emit event; webhook → signed POST; workflow_step → run step + chain the next), and
 * retries with exponential backoff / DLQ on failure. Overlap-guarded so slow jobs don't stack ticks.
 */
export class JobWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly repo: AutomationRepository,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly intervalMs = 5000,
    private readonly batch = 25,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const jobs = await this.repo.claimDueJobs(now, this.batch);
      for (const job of jobs) await this.run(job, now);
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'job runner pass failed (db not ready?)');
    } finally {
      this.running = false;
    }
  }

  private async run(job: AutomationJobRow, now: Date): Promise<void> {
    try {
      if (job.kind === 'reminder') await this.runReminder(job);
      else if (job.kind === 'webhook') await this.runWebhook(job);
      else if (job.kind === 'workflow_step') await this.runWorkflowStep(job, now);
      await this.repo.markJobDone(job.id);
    } catch (err) {
      const { dead, runAt } = nextRetry(job.attempts, now);
      const msg = err instanceof Error ? err.message : String(err);
      await this.repo.markJobRetryOrDead(job.id, job.attempts, dead, runAt, msg);
      this.logger.warn(
        { job: job.id, kind: job.kind, dead, attempts: job.attempts + 1 },
        'job failed',
      );
    }
  }

  private async runReminder(job: AutomationJobRow): Promise<void> {
    const p = job.payload as { text: string; userId: string; conversationId: string | null };
    await this.bus.publish(
      'reminder.fired',
      buildEnvelope({
        eventType: 'reminder.fired',
        key: p.userId,
        producer: 'automation-service',
        payload: { userId: p.userId, conversationId: p.conversationId, text: p.text },
      }),
    );
  }

  private async runWebhook(job: AutomationJobRow): Promise<void> {
    const p = job.payload as { url: string; secret?: string; body?: Record<string, unknown> };
    await this.post(p.url, p.body ?? {}, p.secret);
  }

  private async runWorkflowStep(job: AutomationJobRow, now: Date): Promise<void> {
    const p = job.payload as {
      workflowId: string;
      stepIndex: number;
      context: Record<string, unknown>;
    };
    const wf = await this.repo.getWorkflow(p.workflowId);
    if (!wf) return; // deleted → nothing to do
    const steps = (wf.steps as WorkflowStep[]) ?? [];
    const step = steps[p.stepIndex];
    if (!step) return; // past the end → workflow complete

    if (step.type === 'delay') {
      // Schedule the NEXT step later; this job is done.
      await this.scheduleNext(wf, p, now, (step.seconds ?? 0) * 1000);
      return;
    }
    await this.executeStep(step, wf);
    await this.scheduleNext(wf, p, now, 0);
  }

  private async scheduleNext(
    wf: WorkflowRow,
    p: { workflowId: string; stepIndex: number; context: Record<string, unknown> },
    now: Date,
    delayMs: number,
  ): Promise<void> {
    const steps = (wf.steps as WorkflowStep[]) ?? [];
    const nextIdx = p.stepIndex + 1;
    if (nextIdx >= steps.length) return; // last step — chain ends
    await this.repo.enqueueJob(
      'workflow_step',
      { workflowId: p.workflowId, stepIndex: nextIdx, context: p.context },
      new Date(now.getTime() + delayMs),
    );
  }

  private async executeStep(step: WorkflowStep, wf: WorkflowRow): Promise<void> {
    if (step.type === 'emit_event' && step.topic) {
      await this.bus.publish(
        step.topic,
        buildEnvelope({
          eventType: step.topic,
          key: wf.workflowId,
          producer: 'automation-service',
          payload: step.payload ?? {},
        }),
      );
    } else if (step.type === 'webhook' && step.url) {
      await this.post(step.url, step.body ?? {}, step.secret);
    }
  }

  private async post(url: string, body: Record<string, unknown>, secret?: string): Promise<void> {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret) headers['x-velchat-signature'] = signPayload(secret, raw);
    const res = await fetch(url, { method: 'POST', headers, body: raw });
    if (!res.ok) throw new Error(`webhook ${res.status}`);
  }
}
