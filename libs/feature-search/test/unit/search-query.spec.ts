import { parseQuery, allowedHit, matchesFilters } from '../../src/search/search-query';

describe('parseQuery (§A18.3)', () => {
  it('splits free text from filters and strips #', () => {
    const p = parseQuery('from:alice in:#eng has:file before:2026-01-01 quarterly budget');
    expect(p.text).toBe('quarterly budget');
    expect(p.filters).toEqual({ from: 'alice', in: 'eng', has: 'file', before: '2026-01-01' });
  });
  it('plain text only', () => {
    expect(parseQuery('hello world')).toEqual({ text: 'hello world', filters: {} });
  });
  it('empty/whitespace', () => {
    expect(parseQuery('   ')).toEqual({ text: '', filters: {} });
  });
});

describe('allowedHit (§G6-3 ACL)', () => {
  const accessible = new Set(['eng', 'random']);
  it('allows a hit in an accessible channel', () => {
    expect(allowedHit({ conversationId: 'eng' }, accessible)).toBe(true);
  });
  it('denies a hit in an inaccessible channel', () => {
    expect(allowedHit({ conversationId: 'secret' }, accessible)).toBe(false);
  });
  it('denies a hit with no channel scope (personal is never server-indexed)', () => {
    expect(allowedHit({ text: 'x' }, accessible)).toBe(false);
  });
});

describe('matchesFilters', () => {
  const doc = {
    senderId: 'alice',
    conversationId: 'eng',
    sentAt: '2025-06-01T00:00:00Z',
    has: ['file'],
  };
  it('from + in match', () => {
    expect(matchesFilters(doc, { from: 'alice', in: 'eng' })).toBe(true);
    expect(matchesFilters(doc, { from: 'bob' })).toBe(false);
  });
  it('has (array membership)', () => {
    expect(matchesFilters(doc, { has: 'file' })).toBe(true);
    expect(matchesFilters(doc, { has: 'link' })).toBe(false);
  });
  it('before / after date bounds', () => {
    expect(matchesFilters(doc, { before: '2026-01-01' })).toBe(true);
    expect(matchesFilters(doc, { after: '2026-01-01' })).toBe(false);
  });
});
