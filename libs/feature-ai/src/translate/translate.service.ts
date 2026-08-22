import type { Logger } from '@velchat/common';
import { ValidationError } from '@velchat/common';
import type { UserLanguageRow, ChatTranslatePrefRow } from '@velchat/database';
import type { TranslationProvider } from './translate.port';
import { TranslationCache } from './translation-cache';
import { LangRepository, type UserLangPatch } from './lang.repository';

export interface TranslateOutput {
  text: string;
  source: string;
  target: string;
  cached: boolean;
  unchanged: boolean;
}

/**
 * Server-side translation for ENTERPRISE (server-readable) content (§A26 / §B20). Detects the source
 * language, serves from the Valkey cache when possible, else calls the self-hosted model provider and
 * caches the result. Personal E2EE content is NEVER translated here — that runs on-device (§A26.1);
 * clients must not send E2EE plaintext to this endpoint.
 */
export class TranslateService {
  constructor(
    private readonly provider: TranslationProvider,
    private readonly cache: TranslationCache,
    private readonly repo: LangRepository,
    private readonly logger: Logger,
  ) {}

  async translate(text: string, target: string, source?: string): Promise<TranslateOutput> {
    if (!text || !text.trim()) throw new ValidationError('text is required');
    if (!target) throw new ValidationError('target language is required');

    const src = source ?? (await this.provider.detect(text));
    if (src === target) {
      return { text, source: src, target, cached: false, unchanged: true };
    }
    const hit = await this.cache.get(text, src, target);
    if (hit !== null) {
      return { text: hit, source: src, target, cached: true, unchanged: false };
    }
    this.logger.debug({ src, target, provider: this.provider.name }, 'translate cache miss');
    const r = await this.provider.translate(text, target, src);
    await this.cache.set(text, src, target, r.text);
    return {
      text: r.text,
      source: r.detectedSource || src,
      target,
      cached: false,
      unchanged: false,
    };
  }

  async detect(text: string): Promise<{ language: string }> {
    if (!text || !text.trim()) throw new ValidationError('text is required');
    return { language: await this.provider.detect(text) };
  }

  getUserLang(accountId: string): Promise<UserLanguageRow | null> {
    return this.repo.getUserLang(accountId);
  }

  setUserLang(accountId: string, patch: UserLangPatch): Promise<UserLanguageRow> {
    return this.repo.upsertUserLang(accountId, patch);
  }

  getChatPref(accountId: string, conversationId: string): Promise<ChatTranslatePrefRow | null> {
    return this.repo.getChatPref(accountId, conversationId);
  }

  setChatPref(
    accountId: string,
    conversationId: string,
    mode: string,
    targetLang: string | null,
  ): Promise<ChatTranslatePrefRow> {
    return this.repo.setChatPref(accountId, conversationId, mode, targetLang);
  }
}
