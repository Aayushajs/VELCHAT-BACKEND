import httpProxy from 'http-proxy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@velchat/common';
import { resolveUpstream } from './routes';

/**
 * Reverse-proxy middleware (§A12.1). Matches the request path against the routing table and forwards
 * it to the owning service, preserving headers (Authorization, x-tenant-id, …) so downstream guards
 * still verify the JWT + tenant. Unmatched paths (`/health`, `/metrics`, `/docs`, `/`) fall through
 * to the gateway's own Nest handlers. On an upstream connection error it returns a clean 502.
 */
export function createProxyMiddleware(logger: Logger) {
  const proxy = httpProxy.createProxyServer({ xfwd: true, proxyTimeout: 30_000 });

  proxy.on('error', (err, _req, res) => {
    const r = res as ServerResponse;
    if (r.headersSent) return;
    r.statusCode = 502;
    r.setHeader('Content-Type', 'application/json');
    r.end(
      JSON.stringify({
        success: false,
        statusCode: 502,
        message: 'Upstream service unavailable.',
        error: { code: 'BAD_GATEWAY' },
      }),
    );
    logger.warn({ err: err.message }, 'gateway upstream error');
  });

  return function gatewayProxy(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const target = resolveUpstream(path);
    if (!target) return next(); // gateway's own route (health/metrics/docs)
    proxy.web(req, res, { target });
  };
}
