/**
 * Typed error hierarchy. Every error carries a stable machine `code` and an
 * `httpStatus` so the HTTP/gRPC layers can map consistently. Never put secrets,
 * keys, or message content in an error message (CLAUDE.md §7).
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super('RATE_LIMITED', message, 429);
  }
}

/** §G6: tenant context required but not established → fail closed, never default to "all". */
export class TenantContextMissingError extends AppError {
  constructor(message = 'Tenant context is required but was not established (fail-closed)') {
    super('TENANT_CONTEXT_MISSING', message, 500);
  }
}

/** §G6-1.4: resource.tenant_id != ctx.tenant_id (IDOR defense). */
export class CrossTenantAccessError extends AppError {
  constructor(message = 'Cross-tenant access denied') {
    super('CROSS_TENANT', message, 403);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
