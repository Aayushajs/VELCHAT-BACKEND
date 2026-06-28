# VelChat — Production Readiness Audit

**Date:** 2026-06-28 · **Branch:** `dev` · **Phase:** ~P5 of 11 (P0 infra → P5 tenancy/admin)
**Method:** read-only audit by the `security-e2ee-engineer` + `platform-devops-engineer` subagents, evidence-cited against `docs/VelChat-Architecture.md` Part G.

---

## 1. Verdict — 🔴 NO-GO for production GA

VelChat's **foundation is genuinely production-grade** — observability, the event envelope, the redis-streams DLQ/dedupe/fail-closed-tenant consumer, the hardened Helm chart, DAPT auth (Reverse-OTP anti-spoof, rotating refresh + reuse detection), key-transparency, and SKDM epoch rotation are all real, tested, and well-built.

But the system is **NO-GO for a WhatsApp/Slack-scale production launch.** This is **expected at P5** — the §G/Phase-10 hardening (cells, OPRF-PSI, push outbox, schema registry) is by-design future work. However, the audit also surfaced **several gaps that are fixable now and should not wait for Phase 10** (tenant RLS, gateway JWT verification, the Trivy gate, the Kafka DLQ).

**Closed during this audit:** 🟢 **S1-3 global input validation** — `ValidationPipe` + class-validator DTOs are now live (`libs/common/src/nest/bootstrap.ts`, commit `419f7f4`).

---

## 2. §G Hardening Matrix

| Item | Status | Evidence | Notes |
|------|--------|----------|-------|
| **G1** SKDM epoch rotation + queue/replay | 🟢 GREEN | `realtime-gateway/.../fanout/skdm.service.ts`, `skdm-store.ts` (bounded 500 / 30d TTL / replay); `group-channel .../channels.service.ts:93`; migration `0005` | Built + unit-tested. |
| **G1** Versioned device list + key-transparency chain | 🟢 GREEN | `auth-service/.../devices/key-transparency.ts`, `device-list.repository.ts:70` (atomic epoch-bump + chained append); migration `0004` | CONIKS-lite SHA-256 chain, approval-gated. |
| **G1** 1:1 decryption-failure **resend** protocol | 🔴 RED | no resend path in `chat-service`/`realtime-gateway` | Only the group SKDM analog exists. Phase 2–3 launch gate. |
| **G1** retain-until-ACK ciphertext (1:1) | 🔴 RED | `chat.repository.ts` stores by seq; no per-device ACK retention | Offline ratchet-skip loss not mitigated for 1:1. |
| **G2** OPRF-PSI contact discovery | 🔴 RED | `directory.repository.ts:100` plain salted-hash `= ANY()`; comment self-notes "MVP plain-hash; §G2 upgrades to OPRF" | Enumerable over phone keyspace. Phase 10. |
| **G2** discovery rate-limit + risk engine | 🔴 RED | `directory.controller.ts:91` unauth + only batch-size cap | See S1-4. |
| **G3** Cells / multi-region / resume tokens / admission control | 🔴 RED | flat `conn:{user}` registry + global Valkey `pod:{podId}` pub/sub; 0 hits for cell/region/resume/admission | Pre-cell design. Phase 10. |
| **G3** realtime load-tested (k6/artillery) | 🔴 RED | 0 load-test files | Unit specs only. |
| **G4** Push outbox + retry + idempotency + DLQ + reconcile | 🔴 RED | `notification-service` = 3-file skeleton; `libs/push` defaults to `LogPushSender` | Phase 7 deliverable. |
| **G4** Event-bus DLQ + dedupe | 🟡 YELLOW | redis-streams adapter + `BaseEventConsumer` HAVE DLQ + dedupe + fail-closed tenant; **Kafka adapter has no DLQ** (`kafka.bus.ts:98`) | Free-tier path safe; scale path gap (S2). |
| **G5** Recovery (multi-factor + delay + revoke) | 🟡 YELLOW | `recovery.service.ts:52` (≥2 factors + cooling-off); `auth.service.ts:102` revokes tokens | Gaps: notify-all is a TODO; no key-rotation on complete; no identity-vs-history split; `/recovery/*` unauth + unthrottled. |
| **G6** Tenant isolation (RLS + fail-closed ctx + leakage tests) | 🔴 RED | ALS context is GREEN (`tenant-context.ts:34`); **RLS only on demo table** `0002`; **no repo sets the `app.tenant` GUC**; leakage suite is `it.todo` | See S1-1 — the highest-priority fixable-now gap. |
| **G7** Schema registry FULL_TRANSITIVE + upcasters | 🟡 YELLOW | excellent envelope (`event-envelope.ts`) + CI `buf` breaking check; but `buf.yaml` uses `FILE` not FULL_TRANSITIVE; no registry; no upcasters | Envelope strong; registry/upcasters absent. |

---

## 3. Security Posture

| Area | Status | Evidence |
|------|--------|----------|
| Secrets hygiene | 🟢 GREEN | `.env`/`*.pem`/`*.key` gitignored; `git log --all -- .env` empty; only dev-compose placeholder creds |
| Global input validation | 🟢 GREEN *(fixed this audit)* | `bootstrap.ts` `useGlobalPipes(ValidationPipe{whitelist,forbidNonWhitelisted,transform})` + class-validator on all 7 DTOs |
| HTTP auth / identity | 🔴 RED | no JWT guard on any REST controller; `accountId`/`actorId` taken from request as trusted input; api-gateway is a skeleton — **S1-2** |
| Rate limiting | 🟡 YELLOW | limiter exists (`abuse/rate-limiter.ts`) but applied only to `register`; all other auth + discovery routes unthrottled — **S2-3** |
| DPoP token binding | 🟡 YELLOW | `cnf_jkt` enforced only if present and never set at issuance → device-binding effectively off; JWT key ephemeral if env unset — **S2-4** |
| Dependency scan | 🟡 YELLOW | `pnpm audit --prod`: **0 critical / 11 high / 18 moderate / 1 low**; notable: `nodemailer <=9.0.0` GHSA-p6gq-j5cr-w38f (file-read/SSRF) |
| Container/CI scan | 🟡 YELLOW | Trivy + SBOM + cosign-perms in CI, but **Trivy gates CRITICAL only** (11 highs slip); image build `--frozen-lockfile=false` (non-reproducible) |

---

## 4. Prioritized Risks

### S1 — Critical (block GA)
1. **Tenant isolation has no DB backstop (§G6).** RLS only on a demo table; no repo sets `app.tenant`; isolation rests on hand-written `WHERE org_id=$1`. One missed filter or an IDOR via caller-supplied `orgId` leaks another tenant's audit log / channels / exports. **Fixable now.**
   - *Fix:* `ENABLE/FORCE ROW LEVEL SECURITY` + a `current_setting('app.tenant', true)` policy on `conversations` (0003) and `audit_log`/`retention_policies`/`compliance_exports` (0011); route tenant-scoped repos through `PostgresClient.withTenantTransaction`; write the two-tenant leakage CI suite.
2. **No JWT verification on HTTP services (§A14).** Identity is caller-supplied across all REST services; admin RBAC and recovery trust the supplied `actorId`/`accountId`. **Launch gate** (depends on api-gateway).
   - *Fix:* land api-gateway JWT verification (JWKS) + inject signed `x-account-id`/`x-tenant-id`; default-deny NetworkPolicy so services are reachable only via gateway/mesh; bind `revotp/webhook` to its shared secret.
3. **~~No input validation~~ — ✅ FIXED this audit.**
4. **Contact discovery enumerable (§G2).** Plain salted-hash + unauth + unthrottled → user-base/social-graph scraping. **Phase 10**, but interim gate needed.
   - *Fix:* OPRF-PSI; interim — auth + strict per-account/IP rate limit + risk checks on `/contacts/discover`.
5. **Push pipeline is a stub (§G4).** Offline users get no notifications; no outbox/idempotency/DLQ/reconcile. **Phase 7 launch gate.**

### S2 — High
- **Trivy gate is CRITICAL-only while 11 HIGH vulns exist** — raise to `CRITICAL,HIGH`; upgrade `nodemailer`→≥9.0.1. *(Fixable now.)*
- **Kafka adapter has no DLQ** (`kafka.bus.ts`) — mirror redis-streams `toDlq` or route Kafka consumers through `BaseEventConsumer`. *(Fixable now.)*
- **Non-reproducible image builds** (`--frozen-lockfile=false`) — switch to `--frozen-lockfile`. *(Fixable now.)*
- **§G1-1 1:1 resend + retain-until-ACK absent** — add per-device ciphertext retention + resend protocol (Phase 2–3 gate).
- **Recovery not fully hardened (§G5)** — wire notify-all, rotate keys on complete, rate-limit `/recovery/*`.
- **Rate limiting covers only `register`** — apply to all auth-sensitive routes.
- **DPoP optional + ephemeral JWT key** — require+persist `cnf_jkt` at issuance; mandate `JWT_*_PEM` from secrets in non-dev.
- **realtime-gw HPA is CPU-only** — custom-metric HPA on WS connection count (§A21).
- **Schema registry / upcasters absent (§G7)** — FULL_TRANSITIVE + Apicurio + versioned upcasters before any breaking event change.

---

## 5. Recommended order of remediation

**Now (cheap, high-value, no phase dependency):** tenant RLS on real tables + `withTenantTransaction` + leakage test (S1-1) · Trivy gate→HIGH + nodemailer upgrade · Kafka DLQ · frozen lockfile · rate-limit all auth routes · DPoP enforcement.

**Phase gates before GA:** api-gateway JWT + mesh mTLS (S1-2) · push outbox (S1-5, Phase 7) · 1:1 resend + retain-until-ACK (Phase 2–3) · cells + resume tokens + admission control + load tests (S1/G3, Phase 10) · OPRF-PSI (S1-4, Phase 10) · schema registry + upcasters (G7).

**Definition of Done for GA:** zero open S1; all §G items 🟢 or explicitly risk-accepted; cross-tenant leakage CI suite green; load + chaos tests pass; RPO≤5m/RTO≤30m validated.

---

## Testing posture (note)

Targeted coverage — happy-path + edge + error + authz + idempotency + a security-regression test per §D4 row — is the right goal, not a fixed per-API count. Current state: solid unit specs across services (29 test tasks green); **missing**: integration (testcontainers), e2e, load (k6), mutation, and the §G6 cross-tenant leakage suite.
