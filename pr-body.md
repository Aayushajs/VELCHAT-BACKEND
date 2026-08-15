## Summary

Production hardening for realtime message delivery — fixes 5 root causes + 3 addendum gaps.

### Root Cause Fixes

- **Message content in fan-out**: `MessageSentPayload` now carries `client_msg_id`, `type`, `content`, `reply_to`, `mentions`
- **Membership auto-heal**: HTTP fallback + single-flight when Redis projection is empty
- **Frame unwrap**: Support both flat and enveloped inbound frames (receipts, typing, sync)
- **DM membership seeding**: Always emit `conversationCreated` on `createDm` (idempotent via Redis SADD)

### Verification

- Backend build: 24/24 packages, 0 errors
- Backend tests: 38/38 passed
- Frontend TypeScript: 0 errors
- Frontend tests: 116/116 passed
