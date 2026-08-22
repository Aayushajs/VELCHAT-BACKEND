import { dmConversationId } from '../../src/channels/dm-id';

describe('dmConversationId (§B7 DM dedupe)', () => {
  it('is deterministic and order-independent', () => {
    expect(dmConversationId('alice', 'bob')).toBe(dmConversationId('bob', 'alice'));
  });

  it('differs per pair and is prefixed', () => {
    expect(dmConversationId('a', 'b')).not.toBe(dmConversationId('a', 'c'));
    expect(dmConversationId('a', 'b')).toMatch(/^dm-[0-9a-f]{32}$/);
  });
});
