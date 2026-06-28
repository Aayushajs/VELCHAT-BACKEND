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
 * Wraps every successful JSON response in a consistent envelope `{ statusCode, data }` so the HTTP
 * status is always present in the body (the error path does the same via AllExceptionsFilter).
 * Skips infra/doc routes and non-JSON payloads (strings/buffers), and passes through anything that
 * already carries its own `statusCode` (idempotent).
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
      map((data: unknown) => {
        if (skip) return data;
        if (typeof data === 'string' || Buffer.isBuffer(data)) return data; // text/binary endpoints
        if (data && typeof data === 'object' && 'statusCode' in data) return data; // already enveloped
        return { statusCode: res.statusCode ?? 200, data: data ?? null };
      }),
    );
  }
}
