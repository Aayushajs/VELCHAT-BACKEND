import { buildEnvelope, parseEnvelope } from './event-envelope';

describe('event envelope (§G7)', () => {
  it('builds an envelope with all mandatory fields', () => {
    const env = buildEnvelope({
      eventType: 'message.sent',
      key: 'conv-1',
      producer: 'chat-service',
      tenantId: 'org-A',
      payload: { conversationId: 'conv-1', seq: 42 },
    });
    expect(env.event_type).toBe('message.sent');
    expect(env.schema_version).toBe(1);
    expect(env.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.tenant_id).toBe('org-A');
    expect(env.producer).toBe('chat-service');
    expect(env.key).toBe('conv-1');
    expect(typeof env.occurred_at).toBe('string');
  });

  it('defaults tenant_id to null for non-tenant events', () => {
    const env = buildEnvelope({
      eventType: 'directory.updated',
      key: 'k',
      producer: 's',
      payload: {},
    });
    expect(env.tenant_id).toBeNull();
  });

  it('round-trips through JSON', () => {
    const env = buildEnvelope({ eventType: 'x', key: 'k', producer: 'p', payload: { a: 1 } });
    const parsed = parseEnvelope(JSON.stringify(env));
    expect(parsed).toEqual(env);
  });

  it('rejects a malformed envelope (missing field)', () => {
    expect(() => parseEnvelope(JSON.stringify({ event_type: 'x' }))).toThrow(
      /Malformed event envelope/,
    );
  });

  it('rejects an empty value', () => {
    expect(() => parseEnvelope(null)).toThrow(/Empty Kafka message/);
  });
});
