import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { VerifiedPrincipal } from './jwt-auth.guard';

/**
 * Parameter decorator that extracts the verified JWT principal from the request.
 *
 * Usage:
 * ```ts
 * @Get('devices')
 * devices(@CurrentUser() user: VerifiedPrincipal) { ... }
 *
 * @Get('devices')
 * devices(@CurrentUser('accountId') accountId: string) { ... }
 * ```
 *
 * Only works on routes protected by {@link JwtAuthGuard}. On `@Public()` routes
 * the principal is undefined — callers must handle that explicitly.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof VerifiedPrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: VerifiedPrincipal }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
