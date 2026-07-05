import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * In-memory fixed-window per-IP rate limiter for the edge (§A12.1 / §B18). Lightweight and
 * dependency-free — good per gateway pod. For a cluster-wide limit, front it with the Valkey
 * token-bucket (@velchat/cache RateLimiter); this stays as the fast local backstop.
 */
export function createRateLimiter(limit = 600, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now >= rec.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    rec.count++;
    if (rec.count > limit) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.statusCode = 429;
      res.setHeader('Retry-After', String(retry));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          statusCode: 429,
          message: 'Too many requests — slow down.',
          error: { code: 'RATE_LIMITED' },
        }),
      );
      return;
    }
    next();
  };
}
