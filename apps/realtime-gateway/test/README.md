# realtime-gateway — tests

| Folder         | What                                                               | Runs in         |
| -------------- | ------------------------------------------------------------------ | --------------- |
| `unit/`        | pure logic, no I/O (fast)                                          | `pnpm test`     |
| `security/`    | §D4 threat-model + §G6 isolation regression — one per relevant row | `pnpm test`     |
| `integration/` | testcontainers (real Postgres/Valkey/Mongo)                        | `pnpm test:int` |

Write a test for **every API and every feature**: happy path + edge cases + the security cases.
Service-internal unit specs may also live next to the code in `src/**/*.spec.ts`.
