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
  // `changeOrigin` rewrites the outgoing Host header to the target's host. This is
  // REQUIRED behind host-based routers (Render, nginx vhosts, K8s ingress): without it
  // a proxied request to https://velchat-auth-service.onrender.com keeps
  // Host: velchat-api-gateway.onrender.com, so the router sends it straight back to the
  // gateway → infinite loop → HTTP 508. (Locally it works because upstreams are
  // addressed by localhost:PORT, not by Host.) `proxyTimeout` is generous so a cold
  // free-tier upstream (spins up in ~30-50s) has time to wake instead of 502-ing.
  const proxy = httpProxy.createProxyServer({
    xfwd: true,
    changeOrigin: true,
    proxyTimeout: 90_000,
  });

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
