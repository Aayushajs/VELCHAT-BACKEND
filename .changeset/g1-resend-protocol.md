---
'@velchat/chat-service': minor
---

E2EE decryption-failure resend protocol (§G1-1): a recipient device that can't decrypt a message can
ask the sender to re-encrypt it in a fresh ratchet, with bounded retries; once exhausted the message
is surfaced as unrecoverable instead of being silently lost. The server only transports the request
and the opaque re-encrypted ciphertext — it never sees plaintext.
