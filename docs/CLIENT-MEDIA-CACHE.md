# VelChat — Client Media Cache & Storage Management (mobile + web)

> **Scope:** this is a **client-side** architecture spec (React Native mobile + React web, which live in
> a separate repo). It exists here so the frontend has **zero missing pieces** when it's built. The
> **backend pieces these features need are already implemented** in `content-service` (see §8). Everything
> below runs on-device; the server only stores blobs + metadata and answers usage/availability queries.

Covers: **cache size limit · LRU eviction · Manage Storage · filesystem folder strategy · background
cleanup worker · re-download strategy · per-chat usage** — the WhatsApp/Telegram-grade storage story.

---

## 1. Local cache index (the source of truth on device)

A tiny SQLite table the client owns (alongside the message store). Every cached blob has one row:

```ts
interface CachedMedia {
  mediaId: string;
  conversationId: string | null;
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'thumbnail';
  localPath: string;         // absolute path in the app cache dir (§4)
  bytes: number;
  createdAt: number;         // when cached
  lastAccessedAt: number;    // updated on every open → drives LRU (§3)
  pinned: boolean;           // starred/kept/notes-to-self → never auto-evicted
  encrypted: boolean;        // personal E2EE media stored as ciphertext-at-rest
  ephemeralExpiresAt?: number; // disappearing/view-once → hard-delete on expiry
}
```
Indexes: `(lastAccessedAt)` for LRU, `(conversationId)` for per-chat usage, `(ephemeralExpiresAt)` for the cleanup worker.

---

## 2. Cache size limit

- **Default 1 GB**, user-configurable in Settings → Storage: presets **512 MB / 1 GB / 2 GB / 4 GB / No limit**. Synced across the user's devices (a client setting).
- Two watermarks so eviction is smooth, not a cliff:
  - **Soft limit** (= configured limit): once total cached bytes exceed it, the background worker + post-download hook evict down to a **target ≈ 90 %** of the limit.
  - **Hard limit** (= 100 % + a small margin): a new download must first evict enough to fit; if it still can't fit (single file > limit), stream-to-view without persisting.
- Thumbnails + tiny audio waveforms are **excluded** from the limit (kept always — they're small and make the UI instant).
- Track `SUM(bytes)` incrementally (add on cache, subtract on evict) so the check is O(1), not a scan.

---

## 3. LRU eviction policy

When over the soft limit, evict **least-recently-accessed first** until back to target:

```
candidates = cachedMedia
  .where(!pinned && type != 'thumbnail' && !isOpenNow && !inOutbox)
  .orderBy(lastAccessedAt ASC)          // oldest untouched first
evict candidates until totalBytes <= target
```
**Never evict:** pinned (starred/kept/notes-to-self), thumbnails, the file currently on screen, or unsent
outbox media (the only copy). Evicting = delete the local file + set `localPath=null` (keep the row so we
know it *was* cached and can re-download). Decrement the running total.

---

## 4. Local filesystem folder strategy

Under the app's **cache directory** (OS may reclaim it under pressure — that's fine, we re-download):

```
<appCacheDir>/media/
  images/        videos/        audio/        voice/
  documents/     stickers/      thumbnails/   (thumbnails live longest)
<appFilesDir>/media/            ← pinned/kept media (survives OS cache purge; counts toward usage)
```
- **iOS:** originals in `Caches/` (evictable by OS + us); pinned in `Application Support/` excluded from iCloud backup. **Android:** `getCacheDir()` for evictable, `getFilesDir()` for pinned.
- **Encryption at rest:** personal E2EE media is stored **as ciphertext** (decrypt into memory / a short-lived protected temp only when viewing) — never write personal plaintext to disk (E2EE boundary). Enterprise media may be stored plain.
- Filenames = `mediaId` (+ rendition suffix). Content-addressed dedupe: the same forwarded file maps to one local blob.

---

## 5. Background cleanup worker

Runs off the UI thread; triggered by **(a)** app-background / idle, **(b)** a periodic schedule (~every 6 h), **(c)** OS low-storage signal, **(d)** after a batch of downloads. Order of work:

1. **Expired** — delete `ephemeralExpiresAt < now` (disappearing/view-once) unconditionally.
2. **Orphaned** — media whose message was deleted / conversation cleared → delete.
3. **Over-limit** — run LRU (§3) down to target.
4. **Reconcile** — drop rows whose `localPath` no longer exists (OS purged the cache dir).

Platform: **Android** `WorkManager` (periodic + constraints: idle/charging optional); **iOS**
`BGTaskScheduler` (`BGAppRefreshTask`/`BGProcessingTask`); **web** `requestIdleCallback` + a Service
Worker periodic sync. Keep each pass bounded (batch N deletes) so it never janks.

---

## 6. Re-download strategy (cache-evicted media)

Opening media that isn't on disk (evicted, or a fresh device):

```
open(mediaId):
  row = cacheIndex.get(mediaId)
  if row?.localPath && exists(row.localPath): return row.localPath      // hit
  # miss → is it still on the server?
  avail = POST /media/availability { mediaIds: [mediaId, ...visibleNeighbors] }   // batch!
  if !avail[mediaId]: showUnavailable()   // view-once/deleted → "no longer available"
  else:
    { url } = GET /media/:id/url          // short-lived signed URL
    bytes = download(url)                 // resumable; WiFi-only honored per settings
    if personalE2EE: bytes = decryptWithMessageKey(bytes)   // key came in the E2EE message
    write to <cacheDir>/<type>/mediaId ; cacheIndex.upsert(...)
    return localPath
```
- **Batch availability** for the whole visible gallery page in one call (not per-item) → fewer round-trips, fast on low internet.
- **Auto-download prefs** (synced, WhatsApp-style): per network (WiFi / cellular / roaming) × per type (photos / audio / video / documents) = download-now vs on-tap. Thumbnails always fetch (tiny).
- **Resumable** downloads; retry with backoff; show a placeholder (blurhash) until ready.

---

## 7. Per-chat storage usage

Two numbers, both cheap:
- **On this device** (what's downloaded) — `SELECT type, SUM(bytes), COUNT(*) FROM cacheIndex WHERE conversationId=? GROUP BY type`. Instant, local.
- **Total ever shared** (authoritative) — `GET /media/usage/conversation/:conversationId` (§8) → `{ totalBytes, totalCount, byType[] }`.

The Manage Storage screen shows both ("Downloaded 240 MB · 1.2 GB total") so the user knows freeing cache
doesn't delete anything from the chat.

---

## 8. Manage Storage feature (UX + which backend it uses)

```
Settings → Storage and Data
 ├─ Overview:  total used (device) + by-type breakdown + "Manage"
 │      device breakdown ← local cacheIndex ;  authoritative totals ← GET /media/usage?ownerId=…
 ├─ Largest chats:  sorted by size ← GET /media/usage (byConversation[])  (or local for downloaded-only)
 │      → drill into a chat → per-item grid (photos/videos/docs/links)
 │            → multi-select → "Free up space" (evict cache)  or  "Delete from chat" (DELETE /media/:id)
 ├─ Cache limit:  512 MB / 1 GB / 2 GB / 4 GB / None   (§2, synced)
 ├─ Auto-download:  WiFi/Cellular/Roaming × photos/audio/video/docs   (§6, synced)
 └─ "Clear cache":  evict all non-pinned  (keeps chats + pinned/kept media)
```
**"Free up space" vs "Delete from chat":** the first only evicts the local cache (re-downloadable, §6); the
second calls the backend `DELETE /media/:id` (owner-only) and removes it for everyone (tombstone). The UI
must make the difference obvious.

### Backend APIs powering this (already implemented in content-service)
| Need | Endpoint |
|------|----------|
| Manage Storage overview (total + by type + by chat) | `GET /media/usage?ownerId=…` → `{ totalBytes, totalCount, byType[], byConversation[] }` |
| Per-chat usage | `GET /media/usage/conversation/:conversationId` → `{ totalBytes, totalCount, byType[] }` |
| Re-download availability (batch) | `POST /media/availability` `{ mediaIds }` → `[{ mediaId, available }]` |
| Signed download URL | `GET /media/:id/url` |
| Gallery (per chat, cursor) | `GET /media?conversationId=…` |
| Delete-from-chat (owner) | `DELETE /media/:id?actorId=…` |

> Downloads never flow through our services (signed URL → client fetches storage directly), so the
> device is the only place media lives at rest — which is exactly why this cache management is a client
> responsibility, with the backend supplying usage + availability truth.

---

## 9. Checklist for the frontend build

- [ ] `cacheIndex` SQLite table + running byte total
- [ ] Cache-limit setting (default 1 GB) + soft/hard watermarks
- [ ] LRU eviction respecting pinned/thumbnail/open/outbox
- [ ] Folder layout (images/videos/audio/voice/documents/stickers/thumbnails) + E2EE-ciphertext-at-rest
- [ ] Background cleanup worker (WorkManager / BGTaskScheduler / SW periodic) — expired→orphaned→over-limit→reconcile
- [ ] Re-download flow using `POST /media/availability` + `GET /media/:id/url` + resumable download + decrypt
- [ ] Per-chat usage (local + `GET /media/usage/conversation/:id`)
- [ ] Manage Storage screens (overview / largest chats / per-item / clear cache) using `GET /media/usage`
- [ ] Auto-download + cache-limit settings synced across devices
