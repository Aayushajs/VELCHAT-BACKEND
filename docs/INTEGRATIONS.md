# VelChat — Integration Check Scripts & Env Wiring

**What this is:** a set of runnable scripts in [`scripts/`](../scripts/) that verify the env-driven
integrations — **mail, push/FCM, calls/LiveKit, OTP/auth** — actually work with the keys in your
`.env`. Each script loads the **same `@velchat/config` + `@velchat/common`** the services load at boot,
so what a script sees is exactly what a service sees — no separate `.env` parsing, no drift.

> Last verified: **2026-07-04** (env: development). Results in [§4](#4-last-verified-results).

---

## 1. How to run

The scripts are a workspace package (`@velchat/scripts`). From the repo root:

```bash
pnpm install                                   # once, links workspace deps

pnpm --filter @velchat/scripts check           # readiness report (reads config, sends nothing)
pnpm --filter @velchat/scripts test:mail  aj@you.com   # send a real test email (arg = recipient)
pnpm --filter @velchat/scripts test:push       # build push router + mint a real FCM OAuth token
pnpm --filter @velchat/scripts test:livekit    # mint + verify a LiveKit join token
pnpm --filter @velchat/scripts test:otp        # full Reverse-OTP + device-key flow (needs auth up)
pnpm --filter @velchat/scripts test:all        # check + mail + push + livekit
```

Or directly: `node scripts/check-integrations.mjs`, etc. Set `NO_COLOR=1` for plain output.

**Exit code:** `0` = pass or safe dev-fallback (integration intentionally not configured). `1` = a
**configured** integration failed (e.g. SMTP creds rejected) — so these are CI-gate-able.

---

## 2. What each script verifies

| Script | Verifies | Env keys | "Pass" means |
|---|---|---|---|
| `check-integrations.mjs` | Which integrations are configured vs falling back to a dev stub | (all) | Report printed; no send/connect |
| `test-mail.mjs` | `@velchat/mail` builds the mailer from config and sends | `SMTP_URL`, `MAIL_FROM` | SMTP accepts + delivers (or LogMailer path runs if unset) |
| `test-push.mjs` | `@velchat/push` router builds; **FCM service account can mint a Google OAuth token** | `VAPID_*`, `FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` | Router built + (if FCM set) a real access token is minted |
| `test-livekit.mjs` | Mints an HS256 join token like `call-service` and verifies it with the secret | `LIVEKIT_URL/API_KEY/API_SECRET` | Token round-trips with the `video` grant intact |
| `test-otp.mjs` | End-to-end Reverse-OTP (§B2.2) + device-key login (§B2.5) against a running auth-service | (uses the DID webhook, no real SMS) | `register → webhook → session → challenge → login` all succeed |

The OTP script targets `http://127.0.0.1:3002` by default (override `AUTH_BASE_URL`). It generates a
random test number each run and an ephemeral Ed25519 device key, so it never touches real data. It
uses `127.0.0.1`, not `localhost`, because Node's `fetch` resolves `localhost` to IPv6 `::1` on
Windows while the service binds IPv4.

---

## 3. Which infra lives in `libs/` (the shared-lib rule)

Per CLAUDE.md, cross-cutting infra is a **shared lib**; anything domain-specific stays in its service.

| Concern | Home | Why |
|---|---|---|
| **Mail (SMTP/Postfix)** | `libs/mail` — `createMailer(config)` → `SmtpMailer` \| `LogMailer` | any service may email |
| **Push (Web Push + FCM)** | `libs/push` — `createPushRouter(config)`, `createGoogleAccessToken` | shared transport |
| **Object storage** | `libs/storage` (S3/MinIO/Cloudinary) | media + exports |
| **Cache / Valkey** | `libs/cache` — `ValkeyClient` | presence, sessions, rate-limit |
| **DB clients + schema** | `libs/database` — `PostgresClient`, all 13 services' Drizzle entities | one place for schema |
| **Event bus** | `libs/event-bus` — `createEventBus` (redis-streams \| kafka) | every state change |
| **Config** | `libs/config` — `loadConfig`, `requireX` helpers | one env schema |
| **Search** | `libs/search` (OpenSearch) | index/query |
| **Crypto** | `libs/crypto` (libsignal wrappers) | E2EE |
| **Common** | `libs/common` — logger, tracing, guards, response envelope, tenant context | all services |
| — | — | — |
| **OTP / Reverse-OTP** | `apps/auth-service` (domain logic) | auth-only state machine, not shared |
| **Calls / LiveKit token** | `apps/call-service` | call-only signaling |
| **Notification policy** | `apps/notification-service` | consumes the shared `libs/push` |

So: **mail, push (incl. FCM), storage, cache, db, event-bus, search, crypto = libs**; OTP, LiveKit
token, notification routing = their owning service, but they **use** the libs.

---

## 4. Last-verified results

Run on **2026-07-04**, env `development`, against the current `.env`:

| Integration | Result | Notes |
|---|---|---|
| PostgreSQL / MongoDB / Valkey | ✅ configured | Neon / Atlas / Upstash URLs set |
| Object storage (Cloudinary) | ✅ configured | `CLOUDINARY_URL` set |
| Event bus | ✅ redis-streams | via Valkey |
| **Calls (LiveKit)** | ✅ **works** | token mint + verify round-trip OK (`wss://…livekit.cloud`) |
| **OTP / auth (e2e)** | ✅ **works** | full Reverse-OTP + device-key login passes end to end |
| **Mail (SMTP → Brevo)** | ✅ **works** | sends via Brevo relay once the SMTP **key** (not the account password) is set — see §5 |
| **Push / FCM** | ⚠️ **not configured** | `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` not set → falls back to log; add creds to go live |
| Web Push (VAPID) | ⚠️ not set | web push logged; generate keys to enable |
| OpenSearch | ⚠️ not set | search disabled (optional) |

`✅` = live. `⚠️` = a safe dev fallback OR a credentials issue to fix — not a code defect.

---

## 5. Setup notes per integration

### Mail (Brevo / any SMTP)
- Format: `SMTP_URL=smtp://USER:PASS@host:587`. **URL-encode** `@`/`:` in USER or PASS (`@` → `%40`).
- **Brevo gotcha (this bit us — `535 Authentication failed`):** the SMTP password must be the
  **generated SMTP key** from Brevo → *SMTP & API → SMTP* (looks like `xsmtpsib-…`), **not** your
  account login password. Login is your `xxxxxxxx@smtp-brevo.com` value. With the key set, `test:mail`
  delivers. If mail still doesn't arrive, verify the `MAIL_FROM` sender under Brevo → *Senders*.
- Port `587` = STARTTLS (`smtp://`); port `465` = TLS-on-connect (`smtps://`).

### Push / FCM (mobile)
- Needs all three: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (from the service-account
  JSON). Keep the literal `\n` escapes in the private key on one line; the code un-escapes them.
- 🔴 **Rotate the previously-shared key.** A service-account key was pasted in chat while the repo was
  public — treat it as compromised: Google Cloud Console → *IAM → Service Accounts → Keys* → delete it,
  create a new JSON key, and put the **new** `client_email` + `private_key` in `.env`. `.gitignore`
  now blocks `*firebase*.json` / `*service-account*.json` so the JSON can never be committed.
- `test:push` proves the key by minting a real Google OAuth token — no device needed.

### Web Push (VAPID)
- Generate once: `npx web-push generate-vapid-keys` → set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (a `mailto:` or URL).

### Calls (LiveKit)
- `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from your LiveKit server/cloud.
  Without them, `call-service` returns `503 CALLS_NOT_CONFIGURED` by design.

### Reverse-OTP (₹0 verification, §B2.2)
- `REVOTP_WEBHOOK_SECRET` (HMAC the SIP gateway signs with) + `REVOTP_DID` (owned inbound number).
- No per-user SMS cost — the user missed-calls/SMSes the DID; the Asterisk/FreeSWITCH webhook reports
  the proof. `test:otp` exercises this webhook directly, so no telephony is needed to verify the flow.

**Privacy (§B10):** push payloads for personal/E2EE chats carry **no content** — only a conversation
id + a type. The client fetches and decrypts locally.
