import { ForbiddenError } from '@velchat/common';
import { roleAtLeast, type Role } from '../tenancy/tenancy.types';
import {
  AdminRepository,
  type AuditFilters,
  type ExportJob,
  type RetentionPolicy,
} from './admin.repository';

/** Resolves a user's role in an org (injected from the tenancy repository). */
export type OrgRoleCheck = (userId: string, orgId: string) => Promise<Role | null>;

/**
 * Admin console / compliance (§A14). Every operation is gated by org RBAC (admin+) and writes an
 * append-only audit entry. Retention + legal hold drive data lifecycle; compliance export records an
 * eDiscovery job (the export blob is produced asynchronously and lands in media-service).
 */
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly roleOf: OrgRoleCheck,
  ) {}

  private async assertAdmin(actorId: string, orgId: string): Promise<void> {
    const role = await this.roleOf(actorId, orgId);
    if (!role || !roleAtLeast(role, 'admin')) {
      throw new ForbiddenError('requires org admin or owner');
    }
  }

  async auditLog(
    actorId: string,
    orgId: string,
    filters: AuditFilters,
  ): Promise<{ rows: unknown[]; total: number }> {
    await this.assertAdmin(actorId, orgId);
    return this.repo.queryAudit(orgId, filters);
  }

  async getRetention(actorId: string, orgId: string): Promise<RetentionPolicy> {
    await this.assertAdmin(actorId, orgId);
    return (
      (await this.repo.getRetention(orgId)) ?? {
        org_id: orgId,
        retention_days: null,
        legal_hold: false,
        updated_at: new Date(0).toISOString(),
      }
    );
  }

  async setRetention(
    actorId: string,
    orgId: string,
    retentionDays: number | null,
    legalHold: boolean,
  ): Promise<RetentionPolicy> {
    await this.assertAdmin(actorId, orgId);
    await this.repo.upsertRetention(orgId, retentionDays, legalHold, actorId);
    await this.repo.appendAudit({
      orgId,
      actorId,
      action: 'retention.updated',
      targetType: 'org',
      targetId: orgId,
      metadata: { retentionDays, legalHold },
    });
    return this.getRetention(actorId, orgId);
  }

  async requestExport(
    actorId: string,
    orgId: string,
    scope: Record<string, unknown> | null,
  ): Promise<{ exportId: string; status: string }> {
    await this.assertAdmin(actorId, orgId);
    const exportId = await this.repo.createExport(orgId, actorId, scope);
    await this.repo.appendAudit({
      orgId,
      actorId,
      action: 'compliance.export.requested',
      targetType: 'export',
      targetId: exportId,
      metadata: scope ?? {},
    });
    return { exportId, status: 'requested' };
  }

  async getExport(actorId: string, orgId: string, exportId: string): Promise<ExportJob | null> {
    await this.assertAdmin(actorId, orgId);
    return this.repo.getExport(orgId, exportId);
  }

  async listExports(actorId: string, orgId: string): Promise<ExportJob[]> {
    await this.assertAdmin(actorId, orgId);
    return this.repo.listExports(orgId);
  }
}
