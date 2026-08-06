

Scope: only `auth-service` and `group-channel-service`, compared against the source-of-truth architecture in [docs/VelChat-Architecture.md](docs/VelChat-Architecture.md).

## Verdict

The slice is functionally strong for a prototype/pilot, but it is not safe for enterprise or WhatsApp-scale use yet. The two biggest blockers are missing request-level authorization in both services and weak principal binding in several auth endpoints. Validation exists globally, but the services still rely on caller-supplied IDs for sensitive actions.

## What I checked

- Auth service controller, service, repository, token flow, and security tests.
- Group-channel controller, service, repository, DTOs, and security tests.
- Shared bootstrap, tenant context, and validation wiring.
- Architecture sections for auth and group/channel behavior.

## High-Risk Findings

### 1. Auth endpoints trust caller-supplied account and device IDs

The auth controller exposes sensitive operations that take `accountId` or `deviceId` directly from the request body/query, without an explicit auth guard or principal binding in the controller surface.

Affected routes include:
- `GET /auth/devices`
- `POST /auth/device/revoke`
- `POST /auth/number-change/begin`
- `POST /auth/recovery/begin`
- `POST /auth/recovery/backup-code`
- `POST /auth/passkey/register/options`
- `POST /auth/passkey/register/verify`
- `POST /auth/passkey/login/options`
- `POST /auth/passkey/login/verify`
- `POST /auth/backup-codes/issue`

Relevant code:
- [apps/auth-service/src/auth/auth.controller.ts](apps/auth-service/src/auth/auth.controller.ts#L79)
- [apps/auth-service/src/auth/auth.controller.ts](apps/auth-service/src/auth/auth.controller.ts#L92)
- [apps/auth-service/src/auth/auth.controller.ts](apps/auth-service/src/auth/auth.controller.ts#L145)
- [apps/auth-service/src/auth/auth.controller.ts](apps/auth-service/src/auth/auth.controller.ts#L154)
- [apps/auth-service/src/auth/auth.service.ts](apps/auth-service/src/auth/auth.service.ts#L479)
- [apps/auth-service/src/auth/auth.service.ts](apps/auth-service/src/auth/auth.service.ts#L498)

Impact:
- Device enumeration.
- Unauthorized revocation of devices/tokens if an attacker knows UUIDs.
- Recovery / backup-code abuse.
- Passkey workflows can be attempted against arbitrary account IDs.

### 2. Group-channel routes trust caller-supplied actor/user/tenant IDs

The group-channel service exposes membership and channel operations where the request body/query contains the acting user, target user, or tenant. The service then uses those values directly for authorization decisions, bypassing the established session-based principal.

Affected routes include:
- `GET /users/:userId/conversations`
- `POST /groups`
- `POST /channels`
- `POST /conversations/:id/members`
- `DELETE /conversations/:id/members/:userId`
- `PATCH /conversations/:id/members/:userId/role`
- `PUT /conversations/:id/notif`
- `GET /channels`
- `PATCH /channels/:id`
- `POST /channels/:id/join`
- `POST /channels/:id/leave`
- `POST /communities`
- `POST /communities/:id/channels`

Relevant code:
- [apps/group-channel-service/src/channels/channels.controller.ts](apps/group-channel-service/src/channels/channels.controller.ts#L42)
- [apps/group-channel-service/src/channels/channels.controller.ts](apps/group-channel-service/src/channels/channels.controller.ts#L55)
- [apps/group-channel-service/src/channels/channels.controller.ts](apps/group-channel-service/src/channels/channels.controller.ts#L81)
- [apps/group-channel-service/src/channels/channels.controller.ts](apps/group-channel-service/src/channels/channels.controller.ts#L139)
- [apps/group-channel-service/src/channels/channels.controller.ts](apps/group-channel-service/src/channels/channels.controller.ts#L171)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L117)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L138)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L143)

Impact:
- IDOR on inbox and conversation metadata.
- Spoofed group/channel ownership.
- Unauthorized membership changes.
- Tenant channel enumeration without visible tenant binding.

### 3. Ownership and membership edge cases can leave groups in invalid states

The service does not show protection for last-owner removal, owner demotion, or membership consistency checks on leave/remove flows. `removeMember` can delete any member, including an owner, and `setMemberRole` can mutate roles without a final-owner guard.

Relevant code:
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L93)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L190)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L236)

Impact:
- Ownerless groups.
- Adminless channels.
- Hard-to-recover moderation states.

## Validation and Security Quality

What is good:
- Global validation exists in shared bootstrap via `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, and `transform`.
- Tenant context plumbing exists in shared bootstrap and AsyncLocalStorage helpers.
- Audit/security tests exist as placeholders.

What still needs hardening:
- DTOs accept plain strings for IDs, while auth DB columns are UUID. This is a validation-quality gap because malformed IDs can fall through to DB/runtime errors instead of being rejected early.
- Security tests are mostly TODOs, so the critical abuse paths are not regression-protected yet.
- No explicit controller-level auth guard is visible in these two services.

Relevant code:
- [libs/common/src/nest/bootstrap.ts](libs/common/src/nest/bootstrap.ts#L37)
- [libs/common/src/nest/tenant.interceptor.ts](libs/common/src/nest/tenant.interceptor.ts#L11)
- [libs/common/src/tenant/tenant-context.ts](libs/common/src/tenant/tenant-context.ts#L1)
- [apps/auth-service/test/security/auth-service.security.spec.ts](apps/auth-service/test/security/auth-service.security.spec.ts#L1)
- [apps/group-channel-service/test/security/group-channel-service.security.spec.ts](apps/group-channel-service/test/security/group-channel-service.security.spec.ts#L1)
- [migrations/src/sql/0001_auth.sql](migrations/src/sql/0001_auth.sql#L1)

## Performance Observations

### Auth service
- `recoveryComplete` revokes device tokens in a loop, one query per device.
- `storeBackupCodes` issues one insert per code after a delete.
- `repointPhone` is transactional, which is correct, but only after session proof has been established.

Relevant code:
- [apps/auth-service/src/auth/auth.service.ts](apps/auth-service/src/auth/auth.service.ts#L105)
- [apps/auth-service/src/auth/auth.repository.ts](apps/auth-service/src/auth/auth.repository.ts#L260)
- [apps/auth-service/src/auth/auth.repository.ts](apps/auth-service/src/auth/auth.repository.ts#L231)

### Group-channel service
- `createGroup` inserts members serially.
- `addMember` does a member-count query on every add.
- `listUserConversations` joins and aggregates every row for the inbox path.

Relevant code:
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L33)
- [apps/group-channel-service/src/channels/channels.service.ts](apps/group-channel-service/src/channels/channels.service.ts#L78)
- [apps/group-channel-service/src/channels/channels.repository.ts](apps/group-channel-service/src/channels/channels.repository.ts#L78)
- [apps/group-channel-service/src/channels/channels.repository.ts](apps/group-channel-service/src/channels/channels.repository.ts#L110)

## MongoDB Expansion Suggestions

MongoDB is currently underused relative to the product shape. For this slice and the adjacent chat flows, MongoDB should own more document-style, append-heavy, or shape-flexible state instead of forcing everything into relational rows.

Good MongoDB use cases here:
- Conversation snapshots / denormalized inbox documents for fast open and fast search-by-conversation.
- Group/channel membership projections for read-heavy views, while Postgres remains the source of truth for membership authority.
- Message-like activity documents such as edits, reactions, read cursors, moderation events, and delivery receipts.
- Recovery and security event timelines when you want append-only audit view plus flexible metadata.
- Feature flags or settings blobs that change shape often and are read frequently.
- Short-lived workflow state for invites, approvals, link requests, and onboarding sessions.

Better to keep in Postgres:
- Identity, tokens, refresh families, and other security-critical state that needs strict constraints.
- Ownership, RBAC, and tenant membership records.
- Small transactional invariants where uniqueness and foreign keys matter more than document flexibility.

Operationally, the highest-value Mongo use here would be a read-optimized projection layer for inbox/channel views and event timelines. That reduces join pressure on Postgres and fits the WhatsApp-like behavior better.

## WhatsApp-Parity Gaps in These Two Services

Compared with [docs/VelChat-Architecture.md](docs/VelChat-Architecture.md), the auth + group slice still misses or only partially covers several user-visible capabilities:

- Broadcast lists.
- Explicit per-user privacy controls surfaced through auth and profile flows.
- Stronger channel/tenant membership model with verified principal binding.
- Better moderation rules for owner/admin lifecycle.
- More complete recovery/account management flows from the user’s perspective.
- Stronger RBAC enforcement at the API boundary, not just inside service methods.

## Free Packages / Libraries Worth Using

### TypeScript / NestJS
- `jose` for JWT/JWKS/DPoP handling.
- `zod` if you want schema-first request validation alongside DTOs.
- `pino` for structured logs.
- `prom-client` for metrics.
- `p-limit` for bounded concurrency on batch revocation / fan-out tasks.
- `lru-cache` for hot metadata caching.
- `fast-check` for property-based tests.

### Rust, if you carve out a hot path later
- `axum` for HTTP.
- `tokio` for async runtime.
- `sqlx` for typed DB access.
- `tracing` for observability.
- `blake3` for fast hashing.
- `moka` for in-memory caching.

### C++, only for specialized kernels
- `abseil`.
- `fmt`.
- `simdjson`.
- `roaring`.
- `xxhash`.

## Algorithm / Optimization Suggestions

- Use bulk inserts for group creation instead of one row per member.
- Enforce principal binding from verified JWT claims, not request bodies, for auth-sensitive APIs.
- Add last-owner protection and role-rank checks for group/channel membership mutation.
- Prefer cursor-based pagination and indexed lookups for inbox/channel listing.
- Cache membership/role checks only with invalidation tied to member and role change events.
- Keep heavy revocation / discovery maintenance off the request path and batch it.

## Recommended Next Fix Order

1. Bind auth and group-channel actions to verified identity claims, not user-supplied IDs.
2. Add service-level authorization checks and last-owner protection.
3. Tighten DTO validation for UUID-shaped identifiers.
4. Convert serial member writes to batched inserts where safe.
5. Add regression tests for the abuse cases above.
6. Re-run focused security and performance validation.
