import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';

interface MinimalHttpResponse {
  statusCode: number;
}

// Routes that must return their raw body untouched: Prometheus text, Swagger UI/JSON, health probes.
const SKIP_PREFIXES = ['/metrics', '/docs', '/health', '/ready', '/.well-known'];

/**
 * Wraps every successful JSON response in a consistent envelope
 * `{ success: true, statusCode, message, data }` so the outcome is always self-describing (the error
 * path mirrors this via AllExceptionsFilter → `{ success: false, statusCode, message, error }`).
 * A handler may set its own message by returning `{ message, ...rest }` — the message is hoisted to
 * the envelope and the rest becomes `data`. Skips infra/doc routes and non-JSON payloads, and passes
 * through anything already enveloped (idempotent).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ url?: string }>();
    const res = http.getResponse<MinimalHttpResponse>();
    const url = req?.url ?? '';
    const skip = SKIP_PREFIXES.some(
      (p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`),
    );

    return next.handle().pipe(
      map((payload: unknown) => {
        if (skip) return payload;
        if (typeof payload === 'string' || Buffer.isBuffer(payload)) return payload; // text/binary
        if (payload && typeof payload === 'object' && 'success' in payload) return payload; // enveloped

        const statusCode = res.statusCode ?? 200;
        let message = statusCode === 201 ? 'Created' : 'OK';
        let data: unknown = payload ?? null;
        // Let a handler override the message by returning { message, ...rest }.
        if (payload && typeof payload === 'object' && 'message' in payload) {
          const { message: m, ...rest } = payload as Record<string, unknown>;
          if (typeof m === 'string') {
            message = m;
            data = rest;
          }
        }
        return { success: true, statusCode, message, data };
      }),
    );
  }
}
