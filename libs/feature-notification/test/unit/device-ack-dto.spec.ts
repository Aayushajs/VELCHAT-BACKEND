import { ValidationPipe } from '@nestjs/common';
import { DeviceAckDto } from '../../src/notify/notification.dto';
import { parseDeviceAck } from '../../src/notify/push-ack';

/**
 * The ack body has to survive the GLOBAL pipe before the controller ever sees it, and that pipe is
 * strict in a way that is easy to get wrong:
 *
 *     whitelist: true, forbidNonWhitelisted: true, transform: true
 *     (libs/common/src/nest/bootstrap.ts)
 *
 * `forbidNonWhitelisted` means a DTO property with no class-validator decorator does not merely
 * get stripped — the entire request is REJECTED with 400. An undecorated `upToSeq` therefore
 * failed every single ack, and the failure was invisible from the outside: a refused ack looks
 * exactly like the missing-second-tick bug this endpoint exists to fix.
 *
 * These tests run the real pipe with the real options, so that trap cannot be re-opened.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const META = { type: 'body' as const, metatype: DeviceAckDto };

const BODY = {
  deviceId: 'dev-1',
  pushToken: 'tok-1',
  conversationId: 'c1',
  upToSeq: 42,
  state: 'delivered',
};

describe('DeviceAckDto through the global ValidationPipe', () => {
  it('accepts the body the Android client actually sends', async () => {
    const out = (await pipe.transform({ ...BODY }, META)) as DeviceAckDto;
    expect(out.upToSeq).toBe(42);
    expect(out.deviceId).toBe('dev-1');
    expect(out.state).toBe('delivered');
  });

  it('KEEPS upToSeq — an undecorated property would be rejected outright', async () => {
    // The regression guard. If the decorators are ever removed from `upToSeq`, this fails here
    // rather than as a silent 400 on every device in the field.
    const out = (await pipe.transform({ ...BODY }, META)) as DeviceAckDto;
    expect(out).toHaveProperty('upToSeq');
  });

  it('coerces a stringified seq instead of 400-ing it', async () => {
    // Every value in an FCM data payload is a string on the wire, so a client that echoes `seq`
    // straight back sends "42". Rejecting that would break the one path this endpoint serves.
    const out = (await pipe.transform({ ...BODY, upToSeq: '42' }, META)) as DeviceAckDto;
    expect(out.upToSeq).toBe(42);
  });

  it('rejects a seq that is not a positive integer', async () => {
    await expect(pipe.transform({ ...BODY, upToSeq: 0 }, META)).rejects.toThrow();
    await expect(pipe.transform({ ...BODY, upToSeq: -1 }, META)).rejects.toThrow();
    await expect(pipe.transform({ ...BODY, upToSeq: 'soon' }, META)).rejects.toThrow();
  });

  it('rejects an unknown state', async () => {
    await expect(pipe.transform({ ...BODY, state: 'typing' }, META)).rejects.toThrow();
  });

  it.each(['deviceId', 'pushToken', 'conversationId', 'state'])(
    'rejects a missing %s',
    async (field) => {
      const body: Record<string, unknown> = { ...BODY };
      delete body[field];
      await expect(pipe.transform(body, META)).rejects.toThrow();
    },
  );

  it('rejects an unexpected extra property (anti mass-assignment)', async () => {
    await expect(pipe.transform({ ...BODY, userId: 'someone-else' }, META)).rejects.toThrow();
  });

  it('produces something the pure parser then accepts', async () => {
    // The two layers must agree. The pipe guards the HTTP edge; `parseDeviceAck` is what the
    // service trusts, and a body that passes one but not the other is a 400 nobody can explain.
    const out = await pipe.transform({ ...BODY, upToSeq: '7' }, META);
    expect(parseDeviceAck(out)).toEqual({
      deviceId: 'dev-1',
      pushToken: 'tok-1',
      conversationId: 'c1',
      upToSeq: 7,
      state: 'delivered',
    });
  });
});
