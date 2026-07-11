import { randomUUID } from 'node:crypto';

/** A request carrying the correlation id we stamp on every response + log line. */
export interface RequestWithId {
  requestId?: string;
  headers?: Record<string, unknown>;
}

interface HeaderSettable {
  setHeader?(name: string, value: string): void;
}

/**
 * Correlation-id middleware (industry-level tracing). Reuses an inbound `x-request-id`
 * (or the OTel `traceparent` trace-id) when present, else mints one, stores it on the request, and
 * echoes it in the `x-request-id` response header. The ResponseInterceptor + AllExceptionsFilter
 * read it so EVERY success and error envelope carries `requestId` — a client can quote it in a bug
 * report and we can grep it across logs/traces. No per-handler wiring needed (§A20 observability).
 */
export function requestIdMiddleware(req: unknown, res: unknown, next: () => void): void {
  const r = req as RequestWithId;
  const headers = r.headers ?? {};
  const fromHeader = pickHeader(headers['x-request-id']);
  const fromTrace = traceIdFromTraceparent(pickHeader(headers['traceparent']));
  const id = fromHeader ?? fromTrace ?? randomUUID();
  r.requestId = id;
  (res as HeaderSettable).setHeader?.('x-request-id', id);
  next();
}

/** Read the correlation id previously stamped by the middleware (safe default if absent). */
export function requestIdOf(req: unknown): string | undefined {
  return (req as RequestWithId | undefined)?.requestId;
}

function pickHeader(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim().slice(0, 200);
  return undefined;
}

/** Extract the 32-hex trace-id from a W3C `traceparent` (`00-<trace>-<span>-<flags>`). */
function traceIdFromTraceparent(tp?: string): string | undefined {
  if (!tp) return undefined;
  const parts = tp.split('-');
  const trace = parts[1];
  return trace && /^[0-9a-f]{32}$/i.test(trace) ? trace : undefined;
}
