# VelChat — API Endpoint Reference

Every REST route across the 13 services, grouped by service. All routes go through the API gateway;
each carries `Authorization: Bearer <access>` (+ `x-tenant-id` for enterprise scopes) unless noted.
Responses use the standard envelope `{ success, statusCode, message, data }` (errors add `error.code`,
`path`, `timestamp`). Raw routes (`/health`, `/metrics`, `/docs*`, `/.well-known/*`) are not wrapped.

- **Try them:** import [`postman/VelChat.postman_collection.json`](../postman/VelChat.postman_collection.json)
  (+ the local/production environment). It now covers every folder below.
- **Detailed auth request/response samples:** [API-TEST-REPORT.md](./API-TEST-REPORT.md).
- **Integration setup (mail/push/calls/OTP):** [INTEGRATIONS.md](./INTEGRATIONS.md).

Last updated: **2026-07-05**.

## identity-service — `/auth` (§B2, DAPT)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Cold-start: enter phone → Reverse-OTP session |
| POST | `/auth/revotp/webhook` | Asterisk/FreeSWITCH proof (anti-spoof) |
| POST | `/auth/session` | Fetch provisioned tokens |
| POST | `/auth/challenge` · `/auth/login/device-key` | Device-key login (no OTP) |
| POST | `/auth/token/refresh` | Rotating refresh (+ DPoP, reuse detection) |
| GET | `/auth/devices` | List account devices |
| POST | `/auth/magic/begin` · `/auth/magic/verify` | Email magic-link fallback |
| POST | `/auth/link/request` · `/link/approve` · `/link/poll` | Approve-on-trusted-device |
| POST | `/auth/passkey/{register,login}/{options,verify}` | WebAuthn/passkey |
| POST | `/auth/number-change/begin` | Safe number change (§B2.6) |
| POST | `/auth/recovery/{begin,factor,backup-code,complete}` | Multi-factor recovery (§B2.7) |
| POST | `/auth/backup-codes/issue` | Issue recovery codes |
| GET | `/.well-known/jwks.json` | Public JWKS (raw) |

## identity-service — `/users`, `/discovery`, tenancy, `/admin` (§B3/§A13/§G2)
| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/users/:userId/profile` | Profile + privacy |
| POST/GET | `/users/:userId/contacts` | Contacts |
| PUT/DELETE/GET | `/users/:userId/contacts/:contactUserId/block[ed]` | Block / unblock |
| PUT/POST | `/directory/hash` · `/contacts/discover` | Legacy hashed discovery |
| GET | `/discovery/oprf/key` | **OPRF public key (§G2)** |
| POST | `/discovery/oprf/evaluate` · `/match` | **OPRF blind-evaluate / match** |
| PUT/DELETE | `/discovery/oprf/register[/:accountId]` | **OPRF opt-in / out** |
| POST | `/discovery/oprf/rotate` | **Rotate OPRF key (admin)** |
| POST | `/orgs` · `/workspaces` · `/teams` | Create tenants |
| POST/DELETE/GET | `/:scopeType/:scopeId/members` | Membership |
| GET | `/memberships` · `/authorize` | RBAC |
| GET/PUT/POST | `/admin/orgs/:orgId/{audit,retention,exports}` | Compliance |

## messaging-service — `/chat`, `/polls`, `/messages`, `/conversations`, `/users` (§B4/§B15/§B16/§G1)
| Method | Path | Purpose |
|---|---|---|
| POST | `/chat/messages` | Send message (E2EE ciphertext or plaintext) |
| GET | `/chat/conversations/:id/messages` | History (cursor by seq) |
| POST/DELETE/GET | `/conversations/:conversationId/pins[/:messageId]` | **Pin messages (§A4.1)** |
| PUT/DELETE/GET | `/users/:userId/stars[/:messageId]` | **Star/save (§A4.1)** |
| PUT | `/users/:userId/conversations/:conversationId/{archive,pin-chat,mute}` | **Archive / pin-chat / mute** |
| GET | `/users/:userId/conversations/{archived,pinned}` | **Filtered chat lists** |
| POST | `/polls` · `/polls/:messageId/vote` · `/polls/:messageId/close` | **Polls (§B16)** |
| GET | `/polls/:messageId` | Poll results |
| POST | `/messages/:messageId/resend-request` · `/resend-fulfill` | **E2EE resend (§G1-1)** |
| GET | `/messages/resend/pending` | Sender flush-on-connect |

## identity-service (§B7)
| Method | Path | Purpose |
|---|---|---|
| POST | `/conversations/dm` · `/groups` · `/channels` | Create DM / group / channel |
| POST/DELETE/GET | `/conversations/:id/members[/:userId]` | Membership |

## realtime-service — `/presence` (§B8)
| Method | Path | Purpose |
|---|---|---|
| POST | `/presence/{online,offline,heartbeat,subscribe}` | Presence lifecycle + fan-out |
| PUT | `/presence/status` | Rich status (Teams-style availability — NOT stories) |
| GET | `/presence/:userId` | Resolve presence |

## content-service — `/status` (§B8/§C11)
Stories are Postgres-backed and owned by the content group, not realtime. (This table previously
listed them under realtime-service, matching a routing defect that made the whole API 404 under the
default profile.)

| Method | Path | Purpose |
|---|---|---|
| POST | `/status/media/presigned-url` | Generate Cloudinary signed URL for direct upload |
| POST | `/status` | Post a status. 24h server-set expiry |
| POST | `/status/:id/view` | Record a view (idempotent, buffered via Valkey) |
| POST | `/status/:id/reactions` | React with an emoji (buffered via Valkey) |
| GET | `/status/:id/viewers?limit=&after=` | Viewer list — author only, cursor-paginated |
| GET | `/status/:id/reactions?limit=&after=` | Reactions list — author only, cursor-paginated |
| GET | `/status/feed/:authorId` | An author's active statuses visible to the caller |
| POST | `/status/bulk-sync` | Multi-device active feed sync (returns all unexpired status metadata) |
| POST | `/status/:userId/mute` | Mute a user's statuses from appearing in the feed |
| DELETE | `/status/:userId/mute` | Unmute a user's statuses |
| DELETE | `/status/:id` | Soft-delete a status (author only) |

> Every `/status` endpoint derives the acting account from the verified access token. The former
> `userId` / `viewerId` / `requesterId` parameters are gone — they let any caller act as another
> account. Paths are unchanged, and because the global ValidationPipe runs with
> `forbidNonWhitelisted`, a client still sending them now gets a 400 rather than silent acceptance.
> See [status/SECURITY.md](status/SECURITY.md).

## messaging-service — `/notifications`, `/mail/campaigns` (§B10/§A19)
| Method | Path | Purpose |
|---|---|---|
| PUT/GET | `/notifications/prefs` | Per-scope prefs (level, mute, DND) |
| POST | `/notifications/endpoints` | Register push endpoint (FCM/VAPID) |
| POST | `/mail/campaigns` · `/mail/campaigns/bulk` | **Create campaign / bulk send** |
| GET | `/mail/campaigns[/:id]` | List / detail |
| POST | `/mail/campaigns/:id/{pause,resume,send-now}` · DELETE | **Control a campaign** |

## content-service — `/media`, `/backups` (§B11)
| Method | Path | Purpose |
|---|---|---|
| POST/PUT | `/media/uploads[/:id]` | Resumable upload init / complete |
| GET | `/media/:id` · `/media/:id/url` | Metadata / signed URL |
| POST/GET | `/backups/:accountId[/latest]` | E2EE chat backup blob |

## messaging-service — `/search` (§B13)
| Method | Path | Purpose |
|---|---|---|
| GET | `/search?q=…` | ACL-filtered full-text (`from:`,`in:`,`has:`) |

## platform-service — `/calls`, `/meetings`, screen control (§B12/§A17/§A4.4)
| Method | Path | Purpose |
|---|---|---|
| POST | `/calls` · `/calls/:id/{join,admit,leave,end}` | Call lifecycle + LiveKit token |
| GET | `/calls/:id` | Call detail |
| POST | `/meetings` | Schedule a meeting |
| POST | `/calls/:callId/screen-control/request` | **Request screen control (§A4.4)** |
| GET | `/calls/:callId/screen-control` | **Current control session** |
| POST | `/calls/:callId/screen-control/:id/{grant,deny,release,revoke}` | **Grant/deny/release/revoke** |

## platform-service — `/automation`, `/lists` (§B17/§A4.7)
| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/automation/bots` | Register / list bots |
| POST/GET | `/automation/commands` | Register / list slash commands |
| POST | `/automation/slash` | **Dispatch slash → bot (HMAC round-trip)** |
| POST | `/automation/reminders` | Schedule a reminder (durable job) |
| POST/GET | `/automation/workflows` | Create / list workflows |
| POST | `/automation/workflows/:id/{trigger,enable,disable}` | Run / toggle a workflow |
| POST/GET/DELETE | `/lists[/:listId]` | **Lists (§A4.7)** |
| POST/PATCH/DELETE | `/lists/:listId/items` · `/lists/items/:itemId` | **List items** |

## platform-service — `/ai` (§A26/§B20)
| Method | Path | Purpose |
|---|---|---|
| POST | `/ai/translate` · `/ai/detect` | Translate / detect (enterprise; personal is on-device) |
| GET/PUT | `/ai/language` | User language prefs |
| GET/PUT | `/ai/translate/pref` | Per-chat translate mode |

> Realtime (WebSocket) via **realtime-service** (`/rt`) — not REST; see §B9. Events (`message.*`,
> `presence.*`, `call.control.*`, `poll.updated`, `message.resend.*`, …) flow over Kafka/redis-streams.
