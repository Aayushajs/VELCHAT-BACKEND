/** realtime feature — owns no infrastructure; the composition root injects it. */
export { ConnectionRegistry } from './fabric/connection-registry';
export { EventRouter } from './fabric/event-router';
export { WsFabric } from './fabric/ws-fabric';
export { FanoutConsumer } from './fanout/fanout-consumer';
export { MembershipProjection } from './fanout/membership-projection';
export { ReceiptPublisher } from './fanout/receipt-publisher';
export { SkdmStore } from './fanout/skdm-store';
export { SkdmService } from './fanout/skdm.service';
export { TypingRelay } from './fanout/typing-relay';
export { ValkeyPodPublisher } from './fanout/valkey-pod-publisher';
