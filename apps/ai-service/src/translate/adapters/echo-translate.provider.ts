import type { TranslationProvider, TranslationResult } from '../translate.port';

/**
 * Dev fallback when no self-hosted model server (AI_TRANSLATE_URL) is configured. It does NOT call
 * anything external (no plaintext leaves the box) — it returns the text unchanged with a marker so
 * the pipeline (cache, prefs, API) is fully exercisable without a GPU/model server.
 */
export class EchoTranslateProvider implements TranslationProvider {
  readonly name = 'translate:echo';

  constructor(private readonly defaultLang = 'en') {}

  async translate(text: string, target: string, source?: string): Promise<TranslationResult> {
    return { text: `[${target}] ${text}`, detectedSource: source ?? this.defaultLang };
  }

  async detect(_text: string): Promise<string> {
    return this.defaultLang;
  }
}
