import { buildEnvelope } from '@velchat/common';
import type { EventBus } from '@velchat/event-bus';
import type { FeatureFlagChangedPayload } from '@velchat/shared-types';
import type { FlagAction } from './flag.types';

/** Emits `featureflag.changed` (§6). Carries NO flag values — realtime-gateway broadcasts a compact
 * refetch signal; clients re-call `/feature-flags/evaluate`. Keyed by flag_key for ordering. */
export class FeatureFlagsEvents {
  constructor(private readonly bus: EventBus) {}

  async changed(
    tenantId: string | null,
    flagKey: string,
    action: FlagAction,
    version: number,
  ): Promise<void> {
    // The wire contract omits 'create' (a create IS a change) — map it to 'update'.
    const wireAction: FeatureFlagChangedPayload['action'] = action === 'create' ? 'update' : action;
    await this.bus.publish<FeatureFlagChangedPayload>(
      'featureflag.changed',
      buildEnvelope({
        eventType: 'featureflag.changed',
        key: flagKey,
        producer: 'automation-service',
        tenantId,
        payload: { tenant_id: tenantId, flag_key: flagKey, action: wireAction, version },
      }),
    );
  }
}
