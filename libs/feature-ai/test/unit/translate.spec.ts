import { TranslationCache } from '../../src/translate/translation-cache';
import { EchoTranslateProvider } from '../../src/translate/adapters/echo-translate.provider';
import { TranslateService } from '../../src/translate/translate.service';
import type { TranslationProvider } from '../../src/translate/translate.port';

// Minimal in-memory Redis stub (get/set with EX ignored) for the cache.
function fakeRedis() {
  const m = new Map<string, string>();
  return {
    store: m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
  } as unknown as import('ioredis').Redis;
}

const noopLogger = {
  info() {},
  warn() {},
  debug() {},
  error() {},
} as unknown as import('@velchat/common').Logger;
const noRepo = {} as unknown as import('../../src/translate/lang.repository').LangRepository;

describe('TranslationCache', () => {
  it('key is stable for same text+src+tgt, differs otherwise', () => {
    const a = TranslationCache.key('hello', 'en', 'hi');
    expect(a).toBe(TranslationCache.key('hello', 'en', 'hi'));
    expect(a).not.toBe(TranslationCache.key('hello', 'en', 'fr'));
    expect(a).not.toBe(TranslationCache.key('hi', 'en', 'hi'));
    expect(a.startsWith('xlate:')).toBe(true);
  });
});

describe('EchoTranslateProvider', () => {
  it('returns text with a target marker + no external call', async () => {
    const p = new EchoTranslateProvider('en');
    const r = await p.translate('hello', 'hi');
    expect(r.text).toBe('[hi] hello');
    expect(await p.detect('x')).toBe('en');
  });
});

describe('TranslateService', () => {
  it('caches: second identical translate is a cache hit (provider called once)', async () => {
    let calls = 0;
    const provider: TranslationProvider = {
      name: 'test',
      translate: async (text, _target) => {
        calls++;
        return { text: `T(${text})`, detectedSource: 'en' };
      },
      detect: async () => 'en',
    };
    const svc = new TranslateService(
      provider,
      new TranslationCache(fakeRedis()),
      noRepo,
      noopLogger,
    );

    const first = await svc.translate('hello', 'hi');
    expect(first.cached).toBe(false);
    expect(first.text).toBe('T(hello)');

    const second = await svc.translate('hello', 'hi');
    expect(second.cached).toBe(true);
    expect(second.text).toBe('T(hello)');
    expect(calls).toBe(1); // provider only hit once
  });

  it('no-op when source === target (unchanged)', async () => {
    const provider = new EchoTranslateProvider('en');
    const svc = new TranslateService(
      provider,
      new TranslationCache(fakeRedis()),
      noRepo,
      noopLogger,
    );
    const r = await svc.translate('hello', 'en', 'en');
    expect(r.unchanged).toBe(true);
    expect(r.text).toBe('hello');
  });

  it('rejects empty text / missing target', async () => {
    const svc = new TranslateService(
      new EchoTranslateProvider(),
      new TranslationCache(fakeRedis()),
      noRepo,
      noopLogger,
    );
    await expect(svc.translate('', 'hi')).rejects.toThrow(/text is required/);
    await expect(svc.translate('hi', '')).rejects.toThrow(/target/);
  });
});
