# VelChat — API Test Report (auth-service)

> **Historical record.** Written before the 13 → 6 service consolidation, so the service names and ports below are the ones in use at the time. The current topology is in [PART H of the architecture doc](./VelChat-Architecture.md#part-h--runtime-topology-amendment-v26-13--6-services). Kept unedited on purpose — an audit that is quietly rewritten stops being evidence.

**Date:** 2026-07-03 · **Method:** every endpoint hit live against the running auth-service (`http://localhost:3050`, built dist). **16/22 → 2xx** (rest are negative tests returning the correct 4xx + message). Long tokens/keys truncated for readability.

## Response envelope
Success → `{ success, statusCode, message, data }` · Error → `{ success, statusCode, message, error:{code}, path, timestamp }`. `message` is always present; validation errors carry the field messages; 5xx never leak internals. Raw routes (`/health`, `/metrics`, `/docs*`, `/.well-known/*`) are not wrapped.

## Endpoints

### 1. `POST /auth/register` — Cold-start registration (valid)
**Request**
```json
{
  "phone": "+919876570262",
  "platform": "android",
  "devicePubkeyBase64": "MCowBQYDK2VwAyEAVTFRrSyNbg6P…(+32 chars)"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "sessionId": "019f28f3-f1ce-7529-b700-ff86383a1b80",
    "expiresIn": 299
  }
}
```

### 2. `POST /auth/revotp/webhook` — Reverse-OTP proof (valid missed-call)
**Request**
```json
{
  "sessionId": "019f28f3-f1ce-7529-b700-ff86383a1b80",
  "cli": "+919876570262",
  "path": "missed-call",
  "originationClass": "mobile",
  "attestation": "genuine",
  "riskScore": 0,
  "ts": 1783098503850
}
```
**Response — HTTP 200**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "verified": true
  }
}
```

### 3. `POST /auth/session` — Fetch provisioned tokens
**Request**
```json
{
  "sessionId": "019f28f3-f1ce-7529-b700-ff86383a1b80"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89",
    "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
    "access": "eyJhbGciOiJSUzI1NiIsInR5cCI6…(+637 chars)",
    "refresh": "upB1TG2czLY_JVlJbw9BEBc6U-4_-tN_SeOPj_6YGfI",
    "expiresIn": 900
  }
}
```

### 4. `POST /auth/challenge` — Device-key login step 1: issue nonce
**Request**
```json
{
  "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "nonce": "ql4bch6KsoitvBERMOcbUrjeRzyU0Qo45KwchEXghmQ",
    "expiresIn": 120
  }
}
```

### 5. `POST /auth/login/device-key` — Device-key login step 2: valid signed nonce
**Request**
```json
{
  "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
  "signature": "cGxh0pHJph2wtQXtOZrnotru+wyT…(+60 chars)"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89",
    "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
    "access": "eyJhbGciOiJSUzI1NiIsInR5cCI6…(+637 chars)",
    "refresh": "rQN5wFCc9UzEdfDF0AYRFLCxXltl7XF9412mfH90PqM",
    "expiresIn": 900
  }
}
```

### 6. `POST /auth/token/refresh` — Rotate refresh token
**Request**
```json
{
  "refreshToken": "upB1TG2czLY_JVlJbw9BEBc6U-4_-tN_SeOPj_6YGfI"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89",
    "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
    "access": "eyJhbGciOiJSUzI1NiIsInR5cCI6…(+637 chars)",
    "refresh": "NsWTRpuD8cSqx-sz92RjtoFOtXMMfVlCTul2lOV5dTs",
    "expiresIn": 900
  }
}
```

### 7. `GET /auth/devices` — List account devices
Query: `accountId=019f28f3-f426-70ba-9a3b-c804bb8c4e89`
**Request**
```json
(no body)
```
**Response — HTTP 200**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "device_id": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
      "account_id": "019f28f3-f426-70ba-9a3b-c804bb8c4e89",
      "display_name": null,
      "trusted": true,
      "created_at": "2026-07-03T17:08:25.620Z"
    }
  ]
}
```

### 8. `GET /.well-known/jwks.json` — Public JWKS (raw, not enveloped)
**Request**
```json
(no body)
```
**Response — HTTP 200**
```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "r2ZaHt5iPxhz1bshfgtp6u2NkKPZ…(+314 chars)",
      "e": "AQAB",
      "kid": "12ace664762cd224",
      "use": "sig",
      "alg": "RS256"
    }
  ]
}
```

### 9. `POST /auth/magic/begin` — Email magic-link begin
**Request**
```json
{
  "email": "user@example.com",
  "platform": "web",
  "devicePubkeyBase64": "MCowBQYDK2VwAyEAVTFRrSyNbg6P…(+32 chars)"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "sent": true
  }
}
```

### 10. `POST /auth/link/request` — Link new device: request QR
**Request**
```json
{
  "devicePubkeyBase64": "MCowBQYDK2VwAyEAVTFRrSyNbg6P…(+32 chars)",
  "platform": "desktop"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "linkId": "8r9IU-xbGqn648J_fSMimQ",
    "challenge": "vkKuvAN-EqSxWVr_nZXGhvf-pYZXmahiVfixU1XOjVQ"
  }
}
```

### 11. `POST /auth/link/poll` — Link new device: poll status
**Request**
```json
{
  "linkId": "8r9IU-xbGqn648J_fSMimQ"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "status": "pending"
  }
}
```

### 12. `POST /auth/passkey/register/options` — Passkey register options
**Request**
```json
{
  "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89",
  "userName": "alice"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "challenge": "icw4yzhmPspx4pbPe9B7wtAtWdc3Doz0faHvwEsEdMU",
    "rp": {
      "name": "VelChat",
      "id": "localhost"
    },
    "user": {
      "id": "MDE5ZjI4ZjMtZjQyNi03MGJhLTlhM2ItYzgwNGJiOGM0ZTg5",
      "name": "alice",
      "displayName": ""
    },
    "pubKeyCredParams": [
      {
        "alg": -8,
        "type": "public-key"
      },
      {
        "alg": -7,
        "type": "public-key"
      },
      {
        "alg": -257,
        "type": "public-key"
      }
    ],
    "timeout": 60000,
    "attestation": "none",
    "excludeCredentials": [],
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "preferred",
      "requireResidentKey": false
    },
    "extensions": {
      "credProps": true
    }
  }
}
```

### 13. `POST /auth/passkey/login/options` — Passkey login options
**Request**
```json
{
  "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "rpId": "localhost",
    "challenge": "6anJAwOiQgOgvxjPa9PG9Td7OTU6j0X1eTSMB9VIU4g",
    "allowCredentials": [],
    "timeout": 60000,
    "userVerification": "preferred"
  }
}
```

### 14. `POST /auth/backup-codes/issue` — Issue recovery backup codes
**Request**
```json
{
  "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "codes": [
      "f373a25667",
      "19c31e4ae4",
      "7201b2f75d",
      "9684a73783",
      "8b8accbc87",
      "4fa1c31140",
      "2997b10f8d",
      "1d6b0b172b",
      "9552957a58",
      "5834c51f2c"
    ]
  }
}
```

### 15. `POST /auth/recovery/begin` — Start account recovery
**Request**
```json
{
  "accountId": "019f28f3-f426-70ba-9a3b-c804bb8c4e89"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "recoveryId": "b956cb18-1c05-4d70-a511-88308ca8d7c5",
    "delaySec": 86400
  }
}
```

### 16. `POST /auth/register` — ERROR: missing devicePubkeyBase64
**Request**
```json
{
  "phone": "+919876570262",
  "platform": "android"
}
```
**Response — HTTP 400**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "phone, platform and devicePu…(+23 chars)",
  "error": {
    "code": "VALIDATION"
  },
  "path": "/auth/register",
  "timestamp": "2026-07-03T17:08:31.175Z"
}
```

### 17. `POST /auth/login/device-key` — ERROR: unknown deviceId
**Request**
```json
{
  "deviceId": "00000000-0000-0000-0000-000000000000",
  "signature": "AA=="
}
```
**Response — HTTP 404**
```json
{
  "success": false,
  "statusCode": 404,
  "message": "Unknown or revoked device",
  "error": {
    "code": "NOT_FOUND"
  },
  "path": "/auth/login/device-key",
  "timestamp": "2026-07-03T17:08:31.328Z"
}
```

### 18. `POST /auth/challenge` — Re-issue nonce (for wrong-sig test)
**Request**
```json
{
  "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2"
}
```
**Response — HTTP 201**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "nonce": "FN7YXnhKv9cCqm2w5bDZeiuDDMmLSBYbAA4VXv4o_Ck",
    "expiresIn": 120
  }
}
```

### 19. `POST /auth/login/device-key` — ERROR: wrong signature
**Request**
```json
{
  "deviceId": "019f28f3-f92c-7500-8c1e-8c0b6a81f9f2",
  "signature": "bm9wZQ=="
}
```
**Response — HTTP 401**
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Device-key signature invalid",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "path": "/auth/login/device-key",
  "timestamp": "2026-07-03T17:08:31.673Z"
}
```

### 20. `POST /auth/session` — ERROR: bad sessionId
**Request**
```json
{
  "sessionId": "does-not-exist"
}
```
**Response — HTTP 404**
```json
{
  "success": false,
  "statusCode": 404,
  "message": "No completed session — verify the number first",
  "error": {
    "code": "NOT_FOUND"
  },
  "path": "/auth/session",
  "timestamp": "2026-07-03T17:08:32.097Z"
}
```

### 21. `POST /auth/token/refresh` — ERROR: invalid refresh token
**Request**
```json
{
  "refreshToken": "garbage"
}
```
**Response — HTTP 401**
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Unknown refresh token",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "path": "/auth/token/refresh",
  "timestamp": "2026-07-03T17:08:32.249Z"
}
```

### 22. `POST /auth/magic/verify` — ERROR: bad magic token
**Request**
```json
{
  "token": "garbage"
}
```
**Response — HTTP 401**
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid or expired magic link",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "path": "/auth/magic/verify",
  "timestamp": "2026-07-03T17:08:32.332Z"
}
```
