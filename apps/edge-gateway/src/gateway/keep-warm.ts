import type { Logger } from '@velchat/common';
import { ROUTES, upstreamFor } from './routes';

/**
 * In-process keep-warm (§ops). Render free-tier services hibernate after ~15 min idle; the first
 * request then eats a 30-50s cold start, which surfaces as client timeouts → retry storms →
 * gateway 429s. While the gateway is awake (it takes app traffic + the external cron ping), it
 * GETs every distinct upstream's `/health` on a fixed interval so no downstream service ever
 * sleeps. Best-effort: failures are swallowed, it never throws, and the timer is `unref`'d so it
 * never keeps the process alive on its own. Complements the GitHub Actions cron (which also keeps
 * the gateway itself warm).
 */
export function startKeepWarm(logger: Logger, intervalMs = 10 * 60_000): () => void {
  // Distinct upstream base URLs (one per service), resolved from UPSTREAM_<SERVICE> in prod.
  const bases = [...new Set(ROUTES.map((r) => upstreamFor(r).replace(/\/+$/, '')))];

  const ping = (): void => {
    for (const base of bases) {
      void fetch(`${base}/health`, { method: 'GET' }).catch(() => undefined);
    }
  };

  const timer = setInterval(ping, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  ping(); // warm immediately on boot
  logger.info({ upstreams: bases.length, intervalMs }, 'gateway keep-warm started');
  return () => clearInterval(timer);
}
