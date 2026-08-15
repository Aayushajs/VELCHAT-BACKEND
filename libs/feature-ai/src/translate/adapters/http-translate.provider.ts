import type { TranslationProvider, TranslationResult } from '../translate.port';

/**
 * HTTP translation provider for a self-hosted, LibreTranslate-compatible model server (LibreTranslate
 * wraps Argos/OpenNMT; the same shape fits an NLLB/Marian FastAPI). All free & self-hostable — no
 * paid API. Endpoints:
 *   POST {base}/translate  { q, source, target, format }  → { translatedText, detectedLanguage? }
 *   POST {base}/detect     { q }                          → [ { language, confidence } ]
 */
export class HttpTranslateProvider implements TranslationProvider {
  readonly name = 'translate:http';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 8000,
  ) {}

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.apiKey ? { ...body, api_key: this.apiKey } : body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`translate server ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async translate(text: string, target: string, source?: string): Promise<TranslationResult> {
    const out = (await this.post('/translate', {
      q: text,
      source: source ?? 'auto',
      target,
      format: 'text',
    })) as { translatedText?: string; detectedLanguage?: { language?: string } | string };
    const detected =
      typeof out.detectedLanguage === 'string'
        ? out.detectedLanguage
        : (out.detectedLanguage?.language ?? source ?? 'auto');
    return { text: out.translatedText ?? text, detectedSource: detected };
  }

  async detect(text: string): Promise<string> {
    const out = (await this.post('/detect', { q: text })) as Array<{ language?: string }>;
    return out?.[0]?.language ?? 'und';
  }
}
