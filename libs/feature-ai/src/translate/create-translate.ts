import type { AppConfig } from '@velchat/config';
import type { Logger } from '@velchat/common';
import type { TranslationProvider } from './translate.port';
import { HttpTranslateProvider } from './adapters/http-translate.provider';
import { EchoTranslateProvider } from './adapters/echo-translate.provider';

/**
 * Pick the translation provider from config: a self-hosted model server when AI_TRANSLATE_URL is set
 * (free — LibreTranslate/NLLB/Marian), else a dev echo provider (no external calls). Never a paid API.
 */
export function createTranslateProvider(config: AppConfig, logger: Logger): TranslationProvider {
  if (config.AI_TRANSLATE_URL) {
    logger.info({ url: config.AI_TRANSLATE_URL }, 'translation: self-hosted model server');
    return new HttpTranslateProvider(config.AI_TRANSLATE_URL, config.AI_TRANSLATE_API_KEY);
  }
  logger.warn('AI_TRANSLATE_URL not set — using echo provider (dev; text not really translated)');
  return new EchoTranslateProvider(config.AI_DEFAULT_LANG);
}
