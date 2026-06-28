# VelChat — Production Readiness Report

_System-wide audit against the architecture's Part G hardening criteria. Conducted with full-codebase context; every status is evidence-backed._

> **Scope note (read this first):** VelChat is at **Phase 5 of an 11-phase roadmap** (Part F). The
> §G hardening items (cells, OPRF-PSI, resume tokens, MirrorMaker, key transparency at scale) are
> explicitly **Phase-10** work. Many RED/YELLOW statuses below are *expected at P5* — they are not
> regressions, they are unbuilt future phases. This report states the truth, not a rubber stamp.

---

## 1. Verdict — 🔴 NO-GO for WhatsApp/Slack-scale production

The **P0–P5 vertical is functionally solid and live** on Render (auth/DAPT, 1:1+group chat with
E2EE device-list + sender-key epochs + key-transparency, realtime fan-out + receipts, media +
status + E2EE backup, tenancy + directory + admin). This is a credible **MVP / small-deployment**
backend.

It is **not** ready for hyperscale GA because the Part-G launch-gate items (cells, tenant RLS
enforcement, OPRF discovery, push outbox, schema registry) are not yet implemented. The single
**S1 blocker that is _not_ "just a future phase"** is **multi-tenant isolation relies on app-level
WHERE clauses with no DB-level RLS** on the live tenant tables — that must be closed before any
real enterprise tenant data lands.

**Go for:** continued development, demos, design-partner pilots on non-sensitive data.
**No-go for:** multi-tenant enterprise GA at scale until §G3/§G6 are closed.

---

## 2. §G Hardening Matrix

| Item | Area | Status | Evidence / Gap |
|------|------|--------|----------------|
| **G1** | E2EE multi-device | 🟡 YELLOW | Versioned device list + **key-transparency hash chain** implemented + unit-tested (`apps/auth-service/src/auth/devices/*`, migration `0004`). Sender-key **epoch rotation** + SKDM queue/replay present (P3c). **Gaps:** decryption-failure *resend* protocol and retain-until-ACK ciphertext are not implemented; no integration test proving cross-device convergence. |
| **G2** | Contact discovery (PSI) | 🔴 RED | Plain **salted-hash** discovery only (`apps/user-service/src/directory/*`), explicitly marked "§G2 upgrades to OPRF". No OPRF/PSI, **no rate-limit or risk engine on the discovery endpoint** → enumeration-scrapeable. S1 for privacy at scale. |
| **G3** | Realtime scale / cells | 🔴 RED | No cell routing (`account_id → cell/region`), no resume tokens, no admission control, no multi-region/MirrorMaker. Single-region Valkey pub/sub fan-out only (`apps/realtime-gateway/src/fabric/*`). Not load-tested. Expected-unbuilt (Phase 10). |
| **G4** | Push reliability | 🟡 YELLOW | Event bus has **idempotency dedupe + DLQ** in both adapters (`libs/event-bus/src/adapters/*`, `libs/common/src/eventing/idempotency.ts`); cursor sync is the durability backstop. **Gaps:** notification-service durable **outbox** + retry/backoff worker + per-(message,device) idempotency + reconcile-on-reconnect not implemented; push is not yet wired as "hint-only". |
| **G5** | Recovery | 🟡 YELLOW | Multi-factor recovery state machine + backup codes + session revocation present (`apps/auth-service/src/auth/recovery/*`). **Gaps:** explicit identity-vs-**history** split, enforced 24–72h delay, and notify-all-channels are partial/not verified; no integration test. |
| **G6** | Tenant isolation | 🔴 RED (S1) | **Postgres RLS exists only in `0002_tenant_rls_reference.sql` — a reference, NOT applied to the live tenant tables** (`conversations` 0003, tenancy 0009, `audit_log`/`retention_policies` 0011). Isolation currently depends on app-level `WHERE tenant_id` + service `assertRole`. **No fail-closed ALS tenant context, no tenant-aware repo wrapper, no cross-tenant leakage test suite.** The architecture itself (§G6) says row-scoping alone is insufficient. **S1 before enterprise data.** |
| **G7** | Schema evolution | 🟡 YELLOW | Standard event **envelope** with `event_id` + `tenant_id` + version (`libs/common/src/eventing/event-envelope.ts`); **buf breaking-change check in CI** (`.github/workflows/ci.yml` "proto FULL_TRANSITIVE compat" job). **Gaps:** no runtime **event** schema registry (Apicurio/Confluent), no upcasters, no expand/contract tooling for event payloads. |

---

## 3. Security Posture

| Check | Status | Evidence |
|-------|--------|----------|
| Secrets in code/git | 🟢 GREEN | `.env` + `.env.*` gitignored (`.gitignore:16-17`); no hardcoded secrets/keys found in source; all config via env (`libs/config`). |
| Global input validation | 🟢 GREEN | Global `ValidationPipe` (whitelist + transform) in shared `bootstrapService`; all DTOs carry `class-validator` decorators. Inline/native bodies pass through. |
| Response envelope / status code | 🟢 GREEN | Success `{statusCode,data}` (`ResponseInterceptor`) + error `{statusCode,error}` (`AllExceptionsFilter}`), infra/doc routes skipped. |
| Rate limiting | 🟡 YELLOW | Token-bucket limiter on auth (`apps/auth-service/src/auth/abuse/rate-limiter.ts`). **Gap:** not applied gateway-wide / to discovery + other write paths; no PoW before server-SMS. |
| Dependency vulnerabilities | 🟡 YELLOW | `pnpm audit --prod`: **30 vulns — 11 high, 18 moderate, 1 low**, all **transitive** (nodemailer TLS, multer DoS, otel memory). No criticals. Needs dep bumps. |
| Container/IaC scanning | 🟢 GREEN | CI runs **Trivy** filesystem scan + **CycloneDX SBOM** (`.github/workflows/ci.yml`). Dockerfiles are multi-stage + non-root. |
| CI gates | 🟢 GREEN (basics) | lint → typecheck → test → build + buf compat + Trivy + SBOM on every push. **Gap:** no staging→e2e→prod canary stage; no image signing wired end-to-end. |
| Auth hardening (§D4) | 🟢 GREEN | DAPT device-key + passkey + Reverse-OTP anti-spoof; rotating refresh + reuse-detection + DPoP; device-bound tokens. |
| Observability | 🟡 YELLOW | Pino structured logs (no PII), Prometheus RED metrics, OTel traces wired (`libs/common`). **Gap:** end-to-end trace/correlation-id propagation across Kafka→consumers not verified; no dashboards/alerts shipped. |

---

## 4. Prioritized Risks & Remediation

### S1 — must close before multi-tenant enterprise GA
1. **Enforce Postgres RLS on every tenant-scoped table** (G6). Add `ENABLE ROW LEVEL SECURITY` +
   `current_setting('app.tenant')` policies to `conversations`, `conversation_members`, channel
   tables, `audit_log`, `retention_policies`, `compliance_exports`. Add **fail-closed ALS tenant
   context** + a tenant-aware repository wrapper, and a **CI cross-tenant leakage test suite**
   (seed two tenants, exercise every list/search/job, assert zero cross-tenant rows).
2. **Discovery abuse protection** (G2). Until OPRF lands, put **rate-limiting + a per-account/IP
   velocity cap + attestation** on `POST /contacts/discover` to stop enumeration scraping.

### S2 — required before scale, not blocking a pilot
3. **Push as durable outbox** (G4): notification-service outbox + retry/backoff + DLQ + per-device
   idempotency + reconcile-on-reconnect; treat push as a hint, cursor sync as truth.
4. **E2EE resend protocol + retain-until-ACK** (G1): close the permanent-undecryptability paths.
5. **Bump vulnerable transitive deps** (11 high): `nodemailer`, `multer`, `@opentelemetry/*`.
6. **Rate-limit beyond auth**: apply the limiter at the gateway + to all write/discovery paths.
7. **Event schema registry + upcasters** (G7): add Apicurio/Confluent FULL_TRANSITIVE for Kafka
   event payloads (proto is already buf-gated).

### Phase-10 (expected unbuilt; design exists)
8. Cell architecture + multi-region + resume tokens + admission control (G3); OPRF-PSI (G2);
   key-transparency public log + history-recovery split (G1/G5). Load + chaos testing.

---

## 5. Definition-of-Done check

- ❌ **Outstanding S1 risks exist** (RLS enforcement, discovery abuse) → **launch gate NOT met** for
  enterprise GA. These are concrete, scoped, and listed above.
- ✅ The P0–P5 feature vertical builds, types, lints, and tests green (29/29 test tasks), is
  deployed, and is safe for non-sensitive pilots.

_Generated from a manual, evidence-based audit of the monorepo at branch `dev`._
