import pino, { type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '@velchat/config';
import { getTenantContext } from '../tenant/tenant-context';

/**
 * Paths redacted from every log line. CLAUDE.md §7: structured logs carry NO PII and
 * NO message content. We redact credentials, key material, OTPs, and any `content`/
 * `plaintext`/`ciphertext` fields so they can never leak through a stray `logger.info(obj)`.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passphrase',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.otp',
  '*.secret',
  '*.privateKey',
  '*.private_key',
  '*.ciphertext',
  '*.plaintext',
  '*.content',
  '*.body',
  'phone',
  'email',
];

export type LogConfig = Pick<
  AppConfig,
  'SERVICE_NAME' | 'SERVICE_VERSION' | 'LOG_LEVEL' | 'NODE_ENV'
>;

export function createLogger(cfg: LogConfig): Logger {
  const options: LoggerOptions = {
    level: cfg.LOG_LEVEL,
    base: { service: cfg.SERVICE_NAME, version: cfg.SERVICE_VERSION },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Inject tenant + trace correlation into every line when context is present.
    mixin() {
      const ctx = getTenantContext();
      if (!ctx) return {};
      return { tenant_id: ctx.tenantId, trace_id: ctx.traceId };
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (cfg.NODE_ENV === 'development') {
    options.transport = { target: 'pino-pretty', options: { colorize: true, singleLine: false } };
  }

  return pino(options);
}

export type { Logger };
