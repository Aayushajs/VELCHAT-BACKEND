import { parseDeviceAck } from '../../src/notify/push-ack';

const VALID = {
  deviceId: 'dev-1',
  pushToken: 'fcm-token-abc',
  conversationId: 'conv-1',
  upToSeq: 42,
  state: 'delivered',
};

describe('parseDeviceAck (§B4.4 device-authenticated receipts)', () => {
  it('accepts a well-formed delivered ack', () => {
    expect(parseDeviceAck(VALID)).toEqual({
      deviceId: 'dev-1',
      pushToken: 'fcm-token-abc',
      conversationId: 'conv-1',
      upToSeq: 42,
      state: 'delivered',
    });
  });

  it('accepts a string seq — every FCM data value is a string on the wire', () => {
    expect(parseDeviceAck({ ...VALID, upToSeq: '42' })?.upToSeq).toBe(42);
    expect(parseDeviceAck({ ...VALID, upToSeq: undefined, seq: '7' })?.upToSeq).toBe(7);
  });

  it('accepts `token` as an alias for `pushToken`', () => {
    const { pushToken, ...rest } = VALID;
    expect(parseDeviceAck({ ...rest, token: pushToken })?.pushToken).toBe('fcm-token-abc');
  });

  it('trims surrounding whitespace rather than rejecting', () => {
    expect(parseDeviceAck({ ...VALID, deviceId: '  dev-1  ' })?.deviceId).toBe('dev-1');
  });

  it('accepts read as well as delivered', () => {
    expect(parseDeviceAck({ ...VALID, state: 'read' })?.state).toBe('read');
  });

  it.each([
    ['no body', null],
    ['a string body', 'delivered'],
    ['a missing deviceId', { ...VALID, deviceId: undefined }],
    ['an empty deviceId', { ...VALID, deviceId: '   ' }],
    ['a missing push token', { ...VALID, pushToken: undefined }],
    ['a missing conversationId', { ...VALID, conversationId: '' }],
    ['an unknown state', { ...VALID, state: 'typing' }],
    ['a missing state', { ...VALID, state: undefined }],
    ['seq 0', { ...VALID, upToSeq: 0 }],
    ['a negative seq', { ...VALID, upToSeq: -3 }],
    ['a non-numeric seq', { ...VALID, upToSeq: 'soon' }],
    ['an infinite seq', { ...VALID, upToSeq: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, body) => {
    expect(parseDeviceAck(body)).toBeNull();
  });

  it('rejects an over-long token instead of putting it in a query', () => {
    expect(parseDeviceAck({ ...VALID, pushToken: 'x'.repeat(4097) })).toBeNull();
  });

  it('floors a fractional seq — a watermark is a row index, not a measurement', () => {
    expect(parseDeviceAck({ ...VALID, upToSeq: 42.9 })?.upToSeq).toBe(42);
  });
});
