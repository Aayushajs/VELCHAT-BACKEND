export type StatusKind = 'text' | 'image' | 'video' | 'voice';
export type AudienceMode = 'contacts' | 'except' | 'only';

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
  created_at: string;
  expires_at: string;
}

export interface StatusViewer {
  viewer_id: string;
  viewed_at: string;
}

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Is `viewer` allowed to see a post by `author` given the audience rule + the author's contacts?
 * contacts → any contact; except → contacts minus list; only → exactly the list. Enforced server-side.
 */
export function audienceAllows(
  audience: Audience,
  viewer: string,
  authorContacts: ReadonlySet<string>,
): boolean {
  const list = audience.list ?? [];
  switch (audience.mode) {
    case 'only':
      return list.includes(viewer);
    case 'except':
      return authorContacts.has(viewer) && !list.includes(viewer);
    case 'contacts':
    default:
      return authorContacts.has(viewer);
  }
}
