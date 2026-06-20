import { v7 } from 'uuid';

/** Time-ordered UUIDv7 — the standard id for identities/entities (CLAUDE.md Conventions). */
export function uuidv7(): string {
  return v7();
}
