export type StatusKind = 'text' | 'image' | 'video' | 'voice';
export type AudienceMode = 'contacts' | 'except' | 'only';

/** Lifecycle (§3.4). `creating`/`processing`/`failed` are reserved for the Phase 2 media pipeline. */
export type StatusState = 'creating' | 'processing' | 'active' | 'failed' | 'deleted' | 'expired';

export interface Audience {
  mode: AudienceMode;
  /** For except/only modes — the account_ids excluded / exclusively included. */
  list?: string[];
}

export interface NewStatus {
  userId: string;
  kind: StatusKind;
  mediaId?: string | null;
  /** Ciphertext for personal (e2ee) status; the server never sees plaintext. */
  text?: string | null;
  bg?: string | null;
  caption?: string | null;
  audience: Audience;
  e2ee: boolean;
  viewOnce: boolean;
}

export interface StatusPost {
  status_id: string;
  user_id: string;
  kind: StatusKind;
  media_id: string | null;
  text: string | null;
  bg: string | null;
  caption: string | null;
  audience: Audience;
  e2ee: boolean;
  view_once: boolean;
  state: StatusState;
  deleted_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface StatusViewer {
  viewer_id: string;
  viewed_at: string;
}

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/** What a viewer's relationship to the author is — supplied by the SocialGraphResolver port. */
export interface ViewerRelationship {
  isContact: boolean;
  isBlocked: boolean;
}

/**
 * The single authorization decision for reading a status.
 *
 * Evaluated LIVE against the author's current social graph rather than against a snapshot taken at
 * post time, so removing a contact or blocking someone takes effect immediately. A pre-existing
 * `audience.list` under `contacts` mode is a legacy materialised snapshot and is deliberately
 * ignored.
 *
 * A block denies under every mode, including an explicit `only` list.
 */
export function canView(
  post: { audience: Audience; authorId: string },
  viewerId: string,
  rel: ViewerRelationship,
): boolean {
  if (viewerId === post.authorId) return true; // the author always sees their own
  if (rel.isBlocked) return false;

  const list = post.audience.list ?? [];
  switch (post.audience.mode) {
    case 'only':
      return list.includes(viewerId);
    case 'except':
      return rel.isContact && !list.includes(viewerId);
    case 'contacts':
    default:
      return rel.isContact;
  }
}
