import { ForbiddenError, UnauthorizedError } from '../errors/errors';

/**
 * Resolve the acting account id for a request. The answer is ALWAYS the verified JWT subject
 * (§D4 — "never trust client-provided userId/senderId").
 *
 * A body-supplied id is tolerated but never authoritative. It has to be tolerated: the mobile
 * client sends `senderId` in the send-message payload, and the global ValidationPipe runs with
 * `forbidNonWhitelisted`, so removing the DTO field would 400 every send. Tolerated is not the same
 * as trusted — a value that disagrees with the token is a spoof attempt and is refused outright
 * rather than silently rewritten, because a silent rewrite would also hide client bugs.
 *
 * @param verified `request.user.accountId`, set by {@link JwtAuthGuard}.
 * @param claimed  the id the caller put in the body/query, if any.
 */
export function actingAccountId(verified: string, claimed?: string | null): string {
  if (!verified) {
    // Guard skipped or misconfigured. Fail closed — never fall through to the claimed id.
    throw new UnauthorizedError('No verified principal on this request');
  }
  if (claimed && claimed !== verified) {
    // Deliberately says nothing about either id: the message reaches logs and clients, and echoing
    // the target of a spoof attempt would hand an attacker a probe for valid account ids.
    throw new ForbiddenError('Request identity does not match the authenticated principal');
  }
  return verified;
}
