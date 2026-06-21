import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  UserCreatedPayload,
  DeviceAddedPayload,
  IdentifierChangedPayload,
} from '@velchat/shared-types';

/** Auth domain events (§A11 / §B2). Every state change emits a standard-envelope event. */
export class AuthEvents {
  constructor(private readonly bus: EventBus) {}

  async userCreated(accountId: string, tenantId: string | null = null): Promise<void> {
    await this.bus.publish<UserCreatedPayload>(
      'user.created',
      buildEnvelope({
        eventType: 'user.created',
        key: accountId,
        producer: 'auth-service',
        tenantId,
        payload: {
          account_id: accountId,
          tenant_id: tenantId,
          created_at: new Date().toISOString(),
        },
      }),
    );
  }

  async deviceAdded(accountId: string, deviceId: string, trusted: boolean): Promise<void> {
    await this.bus.publish<DeviceAddedPayload>(
      'device.added',
      buildEnvelope({
        eventType: 'device.added',
        key: accountId,
        producer: 'auth-service',
        tenantId: null,
        payload: { account_id: accountId, device_id: deviceId, trusted },
      }),
    );
  }

  async identifierChanged(accountId: string, kind: 'phone' | 'email'): Promise<void> {
    await this.bus.publish<IdentifierChangedPayload>(
      'identifier.changed',
      buildEnvelope({
        eventType: 'identifier.changed',
        key: accountId,
        producer: 'auth-service',
        tenantId: null,
        payload: { account_id: accountId, kind, changed_at: new Date().toISOString() },
      }),
    );
  }
}
