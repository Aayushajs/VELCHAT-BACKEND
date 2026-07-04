---
'@velchat/crypto': minor
'@velchat/user-service': minor
'@velchat/cache': minor
'@velchat/auth-service': patch
---

OPRF-based private contact discovery (§G2): RSA blind-signature OPRF so the server never sees a
plaintext phone number during contact lookup, closing the offline-enumeration hole a plain salted
hash left open. Extracted the shared RateLimiter into @velchat/cache.
