import { AdminService, type OrgRoleCheck } from '../../src/admin/admin.service';
import { ForbiddenError } from '@velchat/common';
import type { AdminRepository } from '../../src/admin/admin.repository';
import type { Role } from '../../src/tenancy/tenancy.types';

function setup(role: Role | null) {
  const repo = {
    appendAudit: jest.fn(async () => undefined),
    queryAudit: jest.fn(async () => ({ rows: [], total: 0 })),
    getRetention: jest.fn(async () => null),
    upsertRetention: jest.fn(async () => undefined),
    createExport: jest.fn(async () => 'exp-1'),
    getExport: jest.fn(async () => null),
    listExports: jest.fn(async () => []),
  } as unknown as AdminRepository;
  const roleOf: OrgRoleCheck = jest.fn(async () => role);
  return { svc: new AdminService(repo, roleOf), repo };
}

describe('AdminService (§A14)', () => {
  it('blocks a non-admin from the audit log', async () => {
    const { svc } = setup('member');
    await expect(svc.auditLog('u1', 'org1', {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('blocks a non-member entirely', async () => {
    const { svc } = setup(null);
    await expect(svc.getRetention('stranger', 'org1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets an admin read the audit log', async () => {
    const { svc, repo } = setup('admin');
    await svc.auditLog('admin1', 'org1', { action: 'retention.updated' });
    expect(repo.queryAudit).toHaveBeenCalledWith('org1', { action: 'retention.updated' });
  });

  it('setRetention (owner) upserts + writes an audit entry', async () => {
    const { svc, repo } = setup('owner');
    await svc.setRetention('owner1', 'org1', 90, true);
    expect(repo.upsertRetention).toHaveBeenCalledWith('org1', 90, true, 'owner1');
    expect(repo.appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retention.updated', actorId: 'owner1' }),
    );
  });

  it('requestExport creates a job + audits it', async () => {
    const { svc, repo } = setup('admin');
    const res = await svc.requestExport('admin1', 'org1', { channels: ['c1'] });
    expect(res).toEqual({ exportId: 'exp-1', status: 'requested' });
    expect(repo.appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.export.requested' }),
    );
  });
});
