import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant, type TenantContext } from '../tenant-context';

/**
 * Establishes request-scoped tenant context (§G6-1.2) from request metadata for HTTP routes.
 *
 * Source of truth in production is the JWT `tenant_id` claim (wired in P1/P5); for the
 * gateway/skeleton we read `x-tenant-id` / `x-account-id` headers. When no tenant is present
 * we do NOT throw here — enforcement is fail-closed at the data layer (`requireTenant()`),
 * so unauthenticated/health routes still work while any tenant-scoped access fails closed.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return next.handle();
    }
    const ctx: TenantContext = {
      tenantId,
      accountId: req.headers['x-account-id'],
      traceId: req.headers['x-trace-id'],
      scope: 'tenant',
    };
    return new Observable((subscriber) => {
      runWithTenant(ctx, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
