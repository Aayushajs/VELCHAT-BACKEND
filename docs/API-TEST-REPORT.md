# VelChat — API Test Report (auth-service)

**Date:** 2026-07-03 · **Method:** live HTTP hits against the locally-running **auth-service** (`http://localhost:3050`, built dist) · **Result: 23/23 endpoints behave correctly** (16 happy-path `2xx`, 7 negative cases return the right `4xx` with a clear message).

> Only **auth-service** was running this pass. Re-run the sweep (`/tmp/apireport.mjs`) with the other services up to extend the report to user/chat/group-channel/presence/media.

## Response envelope (every response self-describes)

**Success** — `ResponseInterceptor`:
```json
{ "success": true, "statusCode": 201, "message": "Created", "data": { ... } }
```
**Error** — `AllExceptionsFilter`:
```json
{ "success": false, "statusCode": 401, "message": "Device-key signature invalid",
  "error": { "code": "UNAUTHORIZED" }, "path": "/auth/login/device-key", "timestamp": "..." }
```
- `message` is always present + human-readable. Validation failures surface the actual field errors (e.g. `"a should not be empty; b must be a string"`).
- 5xx never leak internals (`"Internal server error"`); full detail is logged server-side.
- Raw-format routes are intentionally **not** wrapped: `/health`, `/ready`, `/metrics`, `/docs*`, `/.well-known/*` (JWKS must stay standard).

## Results

| # | Method | Endpoint | Scenario | HTTP | success | message |
|---|--------|----------|----------|------|---------|---------|
| 1 | POST | `/auth/register` | valid cold-start | 201 | true | Created |
| 2 | POST | `/auth/revotp/webhook` | valid missed-call proof | 200 | true | OK |
| 3 | POST | `/auth/session` | fetch provisioned tokens | 201 | true | Created |
| 4 | POST | `/auth/challenge` | issue device-key nonce | 201 | true | Created |
| 5 | POST | `/auth/login/device-key` | **valid signed nonce** | 201 | true | Created |
| 6 | POST | `/auth/token/refresh` | rotate refresh | 201 | true | Created |
| 7 | GET | `/auth/devices` | list devices | 200 | true | OK |
| 8 | GET | `/.well-known/jwks.json` | public verify keys | 200 | (raw) | JWKS keys |
| 9 | POST | `/auth/magic/begin` | email magic-link | 201 | true | Created |
| 10 | POST | `/auth/link/request` | new-device QR | 201 | true | Created |
| 11 | POST | `/auth/link/poll` | poll link status | 201 | true | Created |
| 12 | POST | `/auth/passkey/register/options` | webauthn reg options | 201 | true | Created |
| 13 | POST | `/auth/passkey/login/options` | webauthn login options | 201 | true | Created |
| 14 | POST | `/auth/backup-codes/issue` | issue backup codes | 201 | true | Created |
| 15 | POST | `/auth/recovery/begin` | start recovery | 201 | true | Created |
| 16 | POST | `/auth/register` | missing `devicePubkeyBase64` | **400** | false | phone, platform and devicePubkeyBase64 are required |
| 17 | POST | `/auth/login/device-key` | unknown deviceId | **404** | false | Unknown or revoked device |
| 18 | POST | `/auth/challenge` | (re-issue nonce) | 201 | true | Created |
| 19 | POST | `/auth/login/device-key` | wrong signature | **401** | false | Device-key signature invalid |
| 20 | POST | `/auth/session` | bad sessionId | **404** | false | No completed session — verify the number first |
| 21 | POST | `/auth/revotp/webhook` | no session / anti-spoof | **401** | false | No pending verification session |
| 22 | POST | `/auth/token/refresh` | invalid refresh token | **401** | false | Unknown refresh token |
| 23 | POST | `/auth/magic/verify` | bad magic token | **401** | false | Invalid or expired magic link |

## Key finding — `/auth/login/device-key` is **not** broken

It works end-to-end (row 5: 201 + `{accountId, deviceId, access, refresh}`). Earlier "error" was one of:
1. **Reading fields at the top level** — responses are enveloped now; read `.data.nonce`, `.data.deviceId`, etc.
2. **Calling it standalone** — it's step 5 of a flow: `session` → `deviceId`, `challenge` → fresh `nonce` (120s, single-use), sign the **exact nonce string** with the device **Ed25519 private key**, then send `base64(signature)`. Unknown device → 404; no/expired challenge or bad signature → 401 (rows 17/19).

## How to reproduce
```bash
SERVICE_NAME=auth-service HTTP_PORT=3050 node apps/auth-service/dist/main.js   # or pnpm start:all
node /tmp/apireport.mjs
```
