import type { AppConfig } from '@velchat/config';
import type { Logger } from '@velchat/common';
import type { AiGateway } from './ai.port';
import { HttpAiGateway } from './http-ai.gateway';
import { NoopAiGateway } from './noop-ai.gateway';

/**
 * Pick the AI gateway from config: the self-hosted Python model server when AI_BASE_URL is set
 * (Hugging Face Spaces / any host — see docs/AI-SERVER.md), else a no-op dev gateway. Never a paid API.
 */
export function createAiGateway(config: AppConfig, logger: Logger): AiGateway {
  if (config.AI_BASE_URL) {
    logger.info({ url: config.AI_BASE_URL }, 'ai: self-hosted model server');
    return new HttpAiGateway({
      baseUrl: config.AI_BASE_URL,
      apiKey: config.AI_API_KEY,
      hmacSecret: config.AI_HMAC_SECRET,
      timeoutMs: config.AI_TIMEOUT_MS,
    });
  }
  logger.warn('AI_BASE_URL not set — using no-op AI gateway (dev; models return empty/echo)');
  return new NoopAiGateway(config.AI_DEFAULT_LANG);
}
