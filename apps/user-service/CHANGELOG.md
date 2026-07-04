# @velchat/user-service

## 0.2.0

### Minor Changes

- 37f122c: OPRF-based private contact discovery (§G2): RSA blind-signature OPRF so the server never sees a
  plaintext phone number during contact lookup, closing the offline-enumeration hole a plain salted
  hash left open. Extracted the shared RateLimiter into @velchat/cache.

### Patch Changes

- Updated dependencies [37f122c]
  - @velchat/crypto@0.2.0
  - @velchat/cache@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/database@0.2.0
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
  - @velchat/event-bus@0.1.1
  - @velchat/cache@0.1.1
