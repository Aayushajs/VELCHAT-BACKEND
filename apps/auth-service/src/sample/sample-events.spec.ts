import { buildUserCreatedEvent, emitUserCreated } from './sample-events';

describe('auth-service sample events (§G7 envelope)', () => {
  it('builds a user.created envelope with mandatory tenant_id (§G6-4)', () => {
    const env = buildUserCreatedEvent({ accountId: 'acc-1', tenantId: 'org-A' });
    expect(env.event_type).toBe('user.created');
    expect(env.schema_version).toBe(1);
    expect(env.producer).toBe('auth-service');
    expect(env.tenant_id).toBe('org-A');
    expect(env.key).toBe('acc-1');
    expect(env.payload.account_id).toBe('acc-1');
    expect(env.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('publishes the envelope to the user.created topic', async () => {
    const sent: Array<{ topic: string; env: { event_id: string } }> = [];
    const publisher = {
      publish: async (topic: string, env: { event_id: string }) => {
        sent.push({ topic, env });
      },
    };
    const env = await emitUserCreated(publisher as never, {
      accountId: 'acc-2',
      tenantId: 'org-B',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.topic).toBe('user.created');
    expect(sent[0]?.env.event_id).toBe(env.event_id);
  });
});
