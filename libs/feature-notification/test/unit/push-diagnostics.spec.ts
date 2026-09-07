import { NotificationService } from '../../src/notify/notification.service';
import type { NotificationRepository } from '../../src/notify/notification.repository';
import type { MembersProjection } from '../../src/notify/members.projection';
import type { DeviceReceiptEmitter } from '../../src/notify/push-ack';
import type { Logger } from '@velchat/common';

/**
 * `pushDiagnostics` exists because both ways push silently does nothing are invisible from
 * outside the process:
 *
 *  - no `FCM_*` env → `createPushRouter` returns a LOG sender, every push "succeeds", and no
 *    phone ever hears anything;
 *  - no event bus wired into this feature → a device ack returns `acked:false`.
 *
 * The value of the endpoint is entirely in `delivers` being FALSE in those cases, so that is
 * what these tests pin.
 */
function svc(opts: { kind?: string; withEmitter?: boolean } = {}) {
  const repo = {} as unknown as NotificationRepository;
  const members = {} as unknown as MembersProjection;
  const logger = { debug: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const receipts: DeviceReceiptEmitter = { emit: jest.fn(async () => undefined) };
  return new NotificationService(
    repo,
    members,
    logger,
    opts.withEmitter === false ? undefined : receipts,
    opts.kind === undefined ? undefined : { kind: opts.kind },
  );
}

describe('pushDiagnostics', () => {
  it('reports a real FCM route as delivering', () => {
    expect(svc({ kind: 'mobile:fcm,web:webpush' }).pushDiagnostics()).toEqual({
      transport: 'mobile:fcm,web:webpush',
      delivers: true,
      canAck: true,
    });
  });

  it('reports a bare log sender as NOT delivering', () => {
    // This is the missing-`FCM_*` deployment. It must be unmistakable.
    expect(svc({ kind: 'log' }).pushDiagnostics().delivers).toBe(false);
  });

  it('reports a composite with no mobile route as NOT delivering', () => {
    // Web push configured but FCM absent: pushes to phones fall through to the log sender, and
    // "some transport exists" would be a dangerously reassuring answer.
    expect(svc({ kind: 'mobile:none,web:webpush' }).pushDiagnostics().delivers).toBe(false);
  });

  it('reports an unwired sender as unknown and not delivering', () => {
    expect(svc().pushDiagnostics()).toEqual({
      transport: 'unknown',
      delivers: false,
      canAck: true,
    });
  });

  it('reports canAck:false when no receipt emitter is wired', () => {
    expect(svc({ kind: 'mobile:fcm,web:none', withEmitter: false }).pushDiagnostics()).toEqual({
      transport: 'mobile:fcm,web:none',
      delivers: true,
      canAck: false,
    });
  });

  it('never returns anything that could be a credential', () => {
    const out = svc({ kind: 'mobile:fcm,web:webpush' }).pushDiagnostics();
    expect(Object.keys(out).sort()).toEqual(['canAck', 'delivers', 'transport']);
    expect(JSON.stringify(out)).not.toMatch(/key|token|secret|email|@/i);
  });
});
