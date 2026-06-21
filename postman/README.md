# VelChat — Postman

| File                                          | What                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `VelChat.postman_collection.json`             | All endpoints (Health, Auth §B2, Channels/Groups §B7, Chat §B4, Realtime §B9, Docs). 44 requests. |
| `VelChat.local.postman_environment.json`      | **Local** — every service URL → the dev gateway `http://localhost:8080`.                          |
| `VelChat.production.postman_environment.json` | **Production** — each service URL → its Render host.                                              |

## Use

1. Import the **collection** + one **environment** into Postman.
2. Pick the environment (top-right): **VelChat — Local** or **VelChat — Production (Render)**.
3. Run requests. The collection targets per-service variables (`{{authUrl}}`, `{{chatUrl}}`, `{{groupChannelUrl}}`, …):
   - **Local** maps them all to `:8080` — the gateway routes by path prefix (`pnpm start:all` first).
   - **Production** maps each to its own `*.onrender.com` host (no unified gateway on Render).

## Flow helpers

- **Create / open DM** saves `conversationId` to the environment automatically.
- **Register** saves `sessionId`; **Session** saves `accessToken` (used as `Bearer` on Chat/authed routes).
- Set `{{tenant}}` for tenant-scoped routes (channels).

## Notes

- Free-tier Render services sleep after ~15 min idle → the first request cold-starts (~30–60s).
- Realtime is a WebSocket: connect a Postman **WebSocket** request to `{{realtimeUrl}}/ws?token=<accessToken>` (`wss://` in production).
- Swagger UI per service is under `/docs` (see the Docs folder).
