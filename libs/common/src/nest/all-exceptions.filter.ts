import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Logger } from 'pino';
import { isAppError } from '../errors/errors';

interface MinimalResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Maps every thrown error to a consistent, self-describing envelope
 * `{ success: false, statusCode, message, error: { code, details? }, path, timestamp }` — mirroring
 * the success envelope in ResponseInterceptor so clients always read the outcome the same way.
 * `message` is always human-readable: AppError messages, extracted ValidationPipe field errors, or a
 * safe generic for 5xx (internal messages are logged, never leaked — no secrets/PII, CLAUDE.md §7).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<MinimalResponse>();
    const req = http.getRequest<{ url?: string; method?: string }>();
    // In non-production, surface the real 5xx message (+ stack) so developers can see what broke;
    // production stays generic so we never leak internals/secrets to clients (CLAUDE.md §7).
    const isProd = process.env.NODE_ENV === 'production';
    const rawMessage = exception instanceof Error ? exception.message : String(exception);

    let status = 500;
    let code = 'INTERNAL';
    // Default (unmatched/raw error, e.g. a node crypto throw) = 500: generic in prod, real in dev.
    let message = isProd ? 'Internal server error' : rawMessage;
    let details: unknown;

    if (isAppError(exception)) {
      status = exception.httpStatus;
      code = exception.code;
      message = status >= 500 ? (isProd ? 'Internal server error' : rawMessage) : exception.message;
      if (status < 500) details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      if (status >= 500) {
        message = isProd ? 'Internal server error' : rawMessage;
      } else {
        // Surface useful messages — esp. ValidationPipe field errors, which live in
        // getResponse().message (a string[]), not the generic exception.message.
        const resp = exception.getResponse();
        if (typeof resp === 'string') {
          message = resp;
        } else if (resp && typeof resp === 'object') {
          const m = (resp as { message?: unknown }).message;
          if (Array.isArray(m)) {
            message = m.join('; ');
            details = m;
          } else {
            message = typeof m === 'string' ? m : exception.message;
          }
        } else {
          message = exception.message;
        }
      }
    }

    this.logger.error(
      {
        code,
        status,
        method: req?.method,
        path: req?.url,
        err: exception instanceof Error ? exception.message : String(exception),
      },
      'request failed',
    );

    res.status(status).json({
      success: false,
      statusCode: status,
      message,
      error: details === undefined ? { code } : { code, details },
      path: req?.url ?? null,
      timestamp: new Date().toISOString(),
    });
  }
}
