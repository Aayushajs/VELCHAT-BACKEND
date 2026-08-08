import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type {
  UserCreatedPayload,
  DeviceAddedPayload,
  DeviceListChangedPayload,
  IdentifierChangedPayload,
  ContactRegisteredPayload,
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

  async deviceListChanged(accountId: string, epoch: number): Promise<void> {
    await this.bus.publish<DeviceListChangedPayload>(
      'device.list.changed',
      buildEnvelope({
        eventType: 'device.list.changed',
        key: accountId,
        producer: 'auth-service',
        tenantId: null,
        payload: { account_id: accountId, epoch, changed_at: new Date().toISOString() },
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

  /** A newly-discoverable account → tell the owners who hold its number so their contact list
   * flips "on VelChat" live (§contact-sync). No-op when nobody has them as a contact. */
  async contactRegistered(accountId: string, ownerIds: string[]): Promise<void> {
    if (ownerIds.length === 0) return;
    await this.bus.publish<ContactRegisteredPayload>(
      'contact.registered',
      buildEnvelope({
        eventType: 'contact.registered',
        key: accountId,
        producer: 'auth-service',
        tenantId: null,
        payload: {
          account_id: accountId,
          owner_ids: ownerIds,
          registered_at: new Date().toISOString(),
        },
      }),
    );
  }
}
