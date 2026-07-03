export interface SearchFilters {
  from?: string; // sender account_id
  in?: string; // conversation/channel id (leading # stripped)
  has?: string; // link | file | ...
  before?: string; // ISO date
  after?: string; // ISO date
}

export interface ParsedQuery {
  text: string;
  filters: SearchFilters;
}

const FILTER_KEYS = ['from', 'in', 'has', 'before', 'after'] as const;

/**
 * Parse a Slack/Teams-style query (§A18.3): `from:alice in:#eng has:file before:2026-01-01 budget`
 * → free-text + structured filters. Pure + side-effect-free (exhaustively unit-testable).
 */
export function parseQuery(raw: string): ParsedQuery {
  const filters: SearchFilters = {};
  const terms: string[] = [];
  for (const tok of (raw ?? '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^(from|in|has|before|after):(.+)$/i.exec(tok);
    const key = m?.[1]?.toLowerCase() as (typeof FILTER_KEYS)[number] | undefined;
    const value = m?.[2];
    if (key && value !== undefined && FILTER_KEYS.includes(key)) {
      filters[key] = value.replace(/^#/, '');
    } else {
      terms.push(tok);
    }
  }
  return { text: terms.join(' '), filters };
}

/**
 * §G6-3 / §A18.3 ACL: a hit is visible only if it belongs to a channel the caller can access. Docs
 * with no channel scope are NOT returned (personal E2EE content is never indexed server-side).
 * The filter is applied server-side and cannot be supplied/bypassed by the client.
 */
export function allowedHit(doc: Record<string, unknown>, accessible: ReadonlySet<string>): boolean {
  const conv = doc.conversationId ?? doc.conversation_id;
  return typeof conv === 'string' && accessible.has(conv);
}

/** Apply the structured filters to a hit doc (from/in/has/before/after). */
export function matchesFilters(doc: Record<string, unknown>, f: SearchFilters): boolean {
  const sender = str(doc.senderId ?? doc.sender_id);
  const conv = str(doc.conversationId ?? doc.conversation_id);
  const at = str(doc.sentAt ?? doc.sent_at ?? doc.createdAt);
  if (f.from && sender !== f.from) return false;
  if (f.in && conv !== f.in) return false;
  if (f.has && str(doc.has) !== f.has && !asArray(doc.has).includes(f.has)) return false;
  if (f.before && !(at && at < f.before)) return false;
  if (f.after && !(at && at > f.after)) return false;
  return true;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}
