import { uuidv7 } from '@velchat/common';
import type { PostgresClient } from '@velchat/database';

export interface AuditEntry {
  orgId: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditFilters {
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface RetentionPolicy {
  org_id: string;
  retention_days: number | null;
  legal_hold: boolean;
  updated_at: string;
}

export interface ExportJob {
  export_id: string;
  org_id: string;
  requested_by: string;
  scope: Record<string, unknown> | null;
  status: string;
  result_media_id: string | null;
  created_at: string;
}

/** Admin/compliance data access (§A14, Postgres). audit_log is append-only. */
export class AdminRepository {
  constructor(private readonly pg: PostgresClient) {}

  async appendAudit(e: AuditEntry): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO audit_log(org_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        e.orgId,
        e.actorId ?? null,
        e.action,
        e.targetType ?? null,
        e.targetId ?? null,
        e.metadata ? JSON.stringify(e.metadata) : null,
      ],
    );
  }

  async queryAudit(orgId: string, f: AuditFilters): Promise<{ rows: unknown[]; total: number }> {
    const page = Math.max(1, f.page ?? 1);
    const limit = Math.min(200, Math.max(1, f.limit ?? 50));
    const where = ['org_id = $1'];
    const params: unknown[] = [orgId];
    if (f.actorId) {
      params.push(f.actorId);
      where.push(`actor_id = $${params.length}`);
    }
    if (f.action) {
      params.push(f.action);
      where.push(`action = $${params.length}`);
    }
    if (f.from) {
      params.push(f.from);
      where.push(`ts >= $${params.length}`);
    }
    if (f.to) {
      params.push(f.to);
      where.push(`ts <= $${params.length}`);
    }
    const clause = where.join(' AND ');
    const total = await this.pg.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE ${clause}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const rows = await this.pg.pool.query(
      `SELECT * FROM audit_log WHERE ${clause} ORDER BY ts DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: rows.rows, total: (total.rows[0] as { n: number }).n };
  }

  async getRetention(orgId: string): Promise<RetentionPolicy | null> {
    const res = await this.pg.pool.query('SELECT * FROM retention_policies WHERE org_id = $1', [
      orgId,
    ]);
    return (res.rows[0] as RetentionPolicy | undefined) ?? null;
  }

  async upsertRetention(
    orgId: string,
    retentionDays: number | null,
    legalHold: boolean,
    updatedBy: string,
  ): Promise<void> {
    await this.pg.pool.query(
      `INSERT INTO retention_policies(org_id, retention_days, legal_hold, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id) DO UPDATE SET retention_days = $2, legal_hold = $3, updated_by = $4, updated_at = now()`,
      [orgId, retentionDays, legalHold, updatedBy],
    );
  }

  async createExport(
    orgId: string,
    requestedBy: string,
    scope: Record<string, unknown> | null,
  ): Promise<string> {
    const exportId = uuidv7();
    await this.pg.pool.query(
      `INSERT INTO compliance_exports(export_id, org_id, requested_by, scope, status)
       VALUES ($1, $2, $3, $4, 'requested')`,
      [exportId, orgId, requestedBy, scope ? JSON.stringify(scope) : null],
    );
    return exportId;
  }

  async getExport(orgId: string, exportId: string): Promise<ExportJob | null> {
    const res = await this.pg.pool.query(
      'SELECT * FROM compliance_exports WHERE org_id = $1 AND export_id = $2',
      [orgId, exportId],
    );
    return (res.rows[0] as ExportJob | undefined) ?? null;
  }

  async listExports(orgId: string): Promise<ExportJob[]> {
    const res = await this.pg.pool.query(
      'SELECT * FROM compliance_exports WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100',
      [orgId],
    );
    return res.rows as ExportJob[];
  }
}
