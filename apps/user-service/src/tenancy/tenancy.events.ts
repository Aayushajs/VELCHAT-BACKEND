import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { MemberAddedPayload, OrgCreatedPayload } from '@velchat/shared-types';
import type { Role, ScopeType } from './tenancy.types';

/** Tenancy events (§A11) → notification, search (directory), cache invalidation. */
export class TenancyEvents {
  constructor(private readonly bus: EventBus) {}

  async orgCreated(orgId: string, name: string, createdBy: string): Promise<void> {
    await this.bus.publish<OrgCreatedPayload>(
      'org.created',
      buildEnvelope({
        eventType: 'org.created',
        key: orgId,
        producer: 'user-service',
        tenantId: orgId,
        payload: {
          org_id: orgId,
          name,
          created_by: createdBy,
          created_at: new Date().toISOString(),
        },
      }),
    );
  }

  async memberAdded(
    scopeType: ScopeType,
    scopeId: string,
    userId: string,
    role: Role,
  ): Promise<void> {
    await this.bus.publish<MemberAddedPayload>(
      'member.added',
      buildEnvelope({
        eventType: 'member.added',
        key: scopeId,
        producer: 'user-service',
        tenantId: scopeType === 'workspace' ? null : scopeId,
        payload: {
          scope_type: scopeType,
          scope_id: scopeId,
          user_id: userId,
          role,
          added_at: new Date().toISOString(),
        },
      }),
    );
  }
}
