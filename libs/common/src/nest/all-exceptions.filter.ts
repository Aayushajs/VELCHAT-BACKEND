import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Logger } from 'pino';
import { isAppError } from '../errors/errors';

interface MinimalResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Maps every thrown error to a consistent `{ error: { code, message } }` body.
 * Internal (500) messages are NOT leaked to clients (no secrets/PII); the full error is logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<MinimalResponse>();

    let status = 500;
    let code = 'INTERNAL';
    let message = 'Internal server error';

    if (isAppError(exception)) {
      status = exception.httpStatus;
      code = exception.code;
      message = status >= 500 ? 'Internal server error' : exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      message = status >= 500 ? 'Internal server error' : exception.message;
    }

    this.logger.error(
      { code, status, err: exception instanceof Error ? exception.message : String(exception) },
      'request failed',
    );

    res.status(status).json({ error: { code, message } });
  }
}
