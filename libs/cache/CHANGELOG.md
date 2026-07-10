# @velchat/cache

## 0.2.2

### Patch Changes

- 676071e: Boot no longer hangs on an unreachable datastore: bounded connect timeouts + error listeners on
  Postgres/Mongo/Valkey clients, and parallel boot connect with a hard per-dependency cap.
- Updated dependencies [676071e]
  - @velchat/common@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
  - @velchat/common@0.2.0

## 0.2.0

### Minor Changes

- 37f122c: OPRF-based private contact discovery (§G2): RSA blind-signature OPRF so the server never sees a
  plaintext phone number during contact lookup, closing the offline-enumeration hole a plain salted
  hash left open. Extracted the shared RateLimiter into @velchat/cache.

## 0.1.1

### Patch Changes

- @velchat/common@0.1.1
