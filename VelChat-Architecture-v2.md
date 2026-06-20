# VelChat — Production Architecture (HLD + LLD) v2.5

> **Platform:** A hybrid of **WhatsApp** (consumer 1:1 + groups + E2EE + status + calls), **Microsoft Teams** (org/teams/channels + scheduled meetings + large conferencing) and **Slack** (workspaces + public/private channels + threads + bots/workflows/slash-commands + huddles).
>
> **Authored as:** Senior SDE / Solutions Architect deliverable.
>
> **Hard constraint:** **100% free / open-source / self-hostable.** No paid third-party SaaS in the critical path. Where "truly free" is physically impossible (mobile push transport, SMS OTP), it is called out explicitly in §A3.5 with the free path chosen.
>
> **Goal of v2:** Take the original outline and turn it into a complete, buildable, production-grade design — every feature, every data store, every process flow, capacity numbers, schemas, and failure handling.

---

## Table of Contents

**PART A — High Level Design (HLD)**
- A1. Scope & product vision
- A2. Architecture principles
- A3. Zero-cost open-source stack (full mapping + honest caveats)
- A4. Complete feature catalog (WhatsApp + Teams + Slack)
- A5. Domain model & bounded contexts
- A6. High-level system diagram
- A7. Client architecture
- A8. Microservice catalog
- A9. Communication patterns (gRPC / Kafka / WebSocket)
- A10. Data architecture (polyglot persistence)
- A11. Event catalog (Kafka topics + schemas)
- A12. Edge / API gateway / realtime gateway
- A13. Multi-tenancy model
- A14. Security architecture
- A15. Real-time & presence
- A16. Media pipeline
- A17. Calls & meetings (WebRTC SFU)
- A18. Search
- A19. Notifications
- A20. Observability
- A21. Kubernetes deployment topology
- A22. CI/CD (fully self-hostable)
- A23. Scaling roadmap & capacity planning
- A24. Reliability, backup & disaster recovery
- A25. AI features on free/self-hosted models
- A26. Language & real-time translation

**PART B — Low Level Design (LLD)**
- B1. Conventions (IDs, time, idempotency)
- B2. Auth service
- B3. User / Org / Workspace service
- B4. Chat service (messages, delivery, receipts, ordering)
- B5. Multi-device sync
- B6. End-to-end encryption (Signal protocol)
- B7. Group / Channel / Team service
- B8. Presence service
- B9. Realtime gateway (WebSocket fabric)
- B10. Notification service
- B11. Media service
- B12. Call / Meeting service
- B13. Search service
- B14. Status / Stories
- B15. Threads, reactions, edits, deletes, disappearing messages
- B16. Polls
- B17. Slash commands, bots, workflows
- B18. Rate limiting
- B19. Consolidated database schemas
- B20. Language & translation

**PART C — Process / Sequence Flows** (the "don't miss any flow" section)

**PART D — Appendices** (tech table, NFRs/SLOs, repo layout, threat model)

**PART E — Claude Code Build Roles** (CLAUDE.md + subagents for backend/frontend/mobile/infra/security/AI/QA)

**PART F — Phased Delivery Roadmap** (backend/web/android/infra tracks, 11 phases)

**PART G — Pre-Production Hardening Review** (E2EE multi-device, contact discovery, realtime scale, push, recovery, multi-tenant isolation, Kafka schema evolution)

---

# PART A — HIGH LEVEL DESIGN

## A1. Scope & Product Vision

VelChat is one platform that serves three usage modes on top of **one identity and one messaging core**:

| Mode | Inspired by | Primary unit | Key traits |
|------|-------------|--------------|------------|
| **Personal** | WhatsApp | Phone-number contact | 1:1 + small groups, E2EE by default, status/stories, last-seen, voice notes, calls |
| **Enterprise** | MS Teams | Organization → Team → Channel | SSO, scheduled meetings, large conferencing (250+), recording, transcription, compliance/audit |
| **Workspace collaboration** | Slack | Workspace → Channel | Public/private channels, threads, huddles, bots, slash commands, workflow automation, deep search |

A single user account can belong to the personal graph **and** multiple organizations/workspaces simultaneously, switching context like Slack workspace switching. The messaging substrate (delivery, receipts, presence, media, calls) is **shared**; the policy layer on top (encryption mode, retention, admin controls, discoverability) differs per context.

**Encryption posture (important design fork):**
- **Personal 1:1 + personal groups → E2EE** (Signal protocol). Server cannot read content.
- **Enterprise/Workspace channels → encryption-in-transit + encryption-at-rest, server-readable** by design (so org search, compliance eDiscovery, DLP, bots, and AI summaries can function). This mirrors how Teams/Slack actually work — full E2EE is incompatible with org-side search/compliance.
- Enterprise **1:1 calls/meetings** can optionally be E2EE; **channel messages** are not, because they must be indexable and bot-accessible.

This fork drives most of the architecture below.

---

## A2. Architecture Principles

1. **Event-driven core.** Every state change publishes an immutable event to Kafka. Services react asynchronously. This gives us replay, audit, and loose coupling.
2. **Polyglot persistence by access pattern**, not by team preference. Relational data → Postgres; high-write append-heavy chat → Mongo (sharded); ephemeral/hot → Redis/Valkey; full-text → OpenSearch; blobs → MinIO.
3. **Stateless services, stateful infra.** All 12 app services hold no local durable state → horizontal scale + safe restarts. State lives in the data tier.
4. **Realtime is a first-class tier**, separate from request/response. WebSocket gateway is its own scaling axis.
5. **At-least-once delivery + idempotency everywhere.** Networks fail; we dedupe with client-generated message IDs and consumer idempotency keys.
6. **Single source of truth per datum.** Exactly one service owns each table/collection. Others read via API or via their own materialized projection built from events — never direct cross-service DB access.
7. **Free & self-hostable.** Every component has an OSS license that permits self-hosting at zero license cost (§A3).
8. **Security by default.** E2EE for personal, least-privilege everywhere, secrets never in code/images, mTLS between services.
9. **Design for the failure case.** Offline recipients, dropped sockets, partial fanout, duplicate events, clock skew, hot partitions — each addressed in LLD.
10. **Observable by construction.** Every request carries a trace ID end-to-end; every service exports RED metrics.

---

## A3. Zero-Cost Open-Source Stack

### A3.1 Why we deviate from the original doc
The original listed **Elasticsearch**, **Cloudflare**, **S3**, and **Sentry**. Of these, Elasticsearch (SSPL/Elastic license) and Redis (RSALv2/SSPL since 2024) have license terms that complicate "free for any use," and S3/Cloudflare paid tiers are not self-hostable for free. v2 swaps each for a permissively-licensed, self-hostable equivalent.

### A3.2 Full component mapping

| Concern | Original (may be paid/restricted) | v2 free & self-hostable | License | Why |
|--------|-----------------------------------|--------------------------|---------|-----|
| Object storage | AWS S3 | **MinIO** | AGPL-3.0 | S3-API-compatible, self-hosted |
| Search | Elasticsearch | **OpenSearch** | Apache-2.0 | Fully open fork of ES |
| KV / cache / presence | Redis | **Valkey** | BSD-3 | Open fork of Redis (Linux Foundation) |
| CDN / edge | Cloudflare (paid) | **Nginx/Envoy edge + self-hosted cache; optional free CDN tier** | BSD/Apache | Self-host TLS + cache |
| Error tracking | Sentry (paid cloud) | **GlitchTip** (Sentry-API compatible) | MIT | Drop-in, self-hosted |
| Document DB | MongoDB | **MongoDB Community** (self-host) or **FerretDB on Postgres** | SSPL / Apache | Community edition is free to self-host |
| SFU / media server | LiveKit | **LiveKit OSS** (keep) + mediasoup option | Apache-2.0 | Already free & self-hostable |
| TLS certs | (paid CA) | **Let's Encrypt + cert-manager** | free | Automated free certs |

### A3.3 Core open-source stack (confirmed free)

```text
Clients      : React Native, React, TypeScript, Zustand, TanStack Query, Electron (desktop)
Backend      : NestJS (Node), gRPC, Protocol Buffers
Eventing     : Apache Kafka (or Redpanda OSS / NATS JetStream for lighter footprint)
Datastores   : PostgreSQL, MongoDB Community, Valkey, OpenSearch, MinIO
Realtime SFU : LiveKit (WebRTC) + coturn (STUN/TURN)
E2EE         : libsignal (Signal Protocol)
Gateway/Edge : Envoy or Kong OSS; Traefik/Nginx ingress
Orchestration: Kubernetes (or k3s), Helm, ArgoCD (GitOps)
Service mesh : Linkerd (lighter) or Istio
Secrets      : HashiCorp Vault OSS / Sealed Secrets
Observability: Prometheus, Grafana, Loki (logs), Tempo (traces), OpenTelemetry, GlitchTip
CI/CD        : Gitea + Woodpecker CI (fully self-host) OR GitHub Actions free tier
```

### A3.4 NATS vs Kafka note
For a smaller team / cheaper ops, **NATS JetStream** can replace Kafka for most topics (it's lighter to run and fully free). Kafka is retained in this document because of stronger ecosystem for log-compacted topics, exactly-once semantics, and Connect. Either is valid; the event catalog (§A11) is broker-agnostic.

### A3.5 Honest "free is hard here" caveats
These are the only places where physics/ecosystem prevents 100% free self-hosting. Each has the cheapest/free-est path chosen:

1. **Mobile push transport (iOS/Android).** Apple **APNs** and Google **FCM** are the *only* ways to wake a backgrounded mobile app. Both are **free of charge** (no license cost) but are operated by Apple/Google — you cannot self-host them. We use them purely as transport; payloads are minimal and (for E2EE chats) contain **no message content** (see §B10). Web push uses the open **Web Push / VAPID** standard (no third party). Self-hosted notifications to desktop use our own WebSocket. Optional OSS self-hosted push for web/desktop: **ntfy**.
2. **Phone-ownership verification — solved at ₹0 per user via "Reverse-OTP".** Server→user SMS costs money per message. We invert the direction: the **user initiates** the verification from their own device — a **missed-call** or a **pre-filled SMS sent by the user to a number we own** — so the user's (typically free/bundled) plan bears the transport and **our server pays nothing per verification**. We receive it on a self-hosted **Asterisk/FreeSWITCH** SIP/SMS gateway and match the caller-ID/sender + token. The only residual cost is a **fixed inbound number (DID) rental** — *not* per user, does not grow with scale. This is combined with the device-key/passkey trust loop (§A14.1) so verification happens **once per user, ever**. Server-sent SMS OTP remains only as a rare last-resort fallback (<1% of users). Email OTP/magic-link (self-hosted Postfix) and TOTP (RFC 6238) are also free. Full design + anti-spoof rules in §A14.1 / §B2.
3. **CDN bandwidth.** You can self-host caching with Nginx/Envoy + MinIO, which is free. A geo-CDN for global media is optional; if needed, several CDNs have free tiers, but the design does not *require* one.
4. **Public TLS.** Free via Let's Encrypt + cert-manager.

Everything else in the system is genuinely zero-license-cost and self-hostable.

---

## A4. Complete Feature Catalog

This is the master list. Every feature below maps to an owning service (§A8) and at least one flow (Part C). Organized by capability area.

### A4.1 Messaging (WhatsApp + Slack + Teams)
- 1:1 direct messages
- Group chats (personal, up to ~1024 members like WhatsApp)
- Channels (workspace/org, public & private)
- Threaded replies (Slack/Teams threads on any message)
- Rich text / markdown formatting, code blocks, block-kit-style rich layouts
- @mentions (user, @channel, @here, @everyone) + mention notifications
- Message reactions (emoji), multiple reactions, reaction counts
- Reply / quote a specific message
- Forward message(s) to other chats (with "forwarded" label, forward limits like WhatsApp)
- Edit message (with edited indicator + edit history for compliance)
- Delete for me / delete for everyone (tombstones)
- Pin / unpin messages (chat or channel scope)
- Star / save / bookmark messages (per-user)
- Disappearing / ephemeral messages (timer: 24h / 7d / 90d)
- Scheduled messages (send later)
- Drafts (synced across devices)
- Read receipts (sent / delivered / read — WhatsApp ticks)
- Typing indicators (per chat, per thread)
- Voice messages / push-to-talk voice notes
- Message search (per chat + global)
- Link previews / unfurling
- Polls (single & multi choice, anonymous option)
- Location sharing (static + live location)
- Contact card sharing
- Broadcast lists (WhatsApp: send to many, replies are 1:1)
- Communities (WhatsApp: group-of-groups with announcement channel)
- Announcement channels (read-only broadcast, Teams/WhatsApp)
- Message formatting toolbar + emoji picker + GIF (via free/open GIF source or self-host) + stickers (custom packs)
- Slash commands (`/giphy`, `/remind`, `/poll`, custom)
- Message effects / mentions of bots
- **View-once media** (photo/video/voice that vanishes after one view; screenshot-blocked UI)
- **Chat lock** (locked/hidden chats behind biometric/PIN, separate from app lock)
- **Pin chat** to top + **archive chat** (auto-unarchive on new message, optional)
- **Message yourself / Notes-to-self** chat
- **Chat backup & restore** (E2EE backup: encrypted blob to MinIO/own cloud, key derived from user passphrase/recovery key — server can't read)
- **Chat export** (text + media, per conversation)
- **Kept messages** (keep a specific message even in a disappearing chat)
- **QR-code contact** add + deep-link invite to chat/channel
- **Per-chat wallpaper / theme** (client cosmetic, synced)

### A4.2 Presence & Status (WhatsApp + Teams)
- Online / offline / last-seen (with privacy controls)
- Typing / recording-audio indicators
- Teams-style rich presence: Available, Busy, Do Not Disturb, Be Right Back, Away, Offline, In a meeting, In a call, Presenting
- Custom status text + emoji + expiry (Slack)
- Auto-presence from calendar / activity / call state
- "Set yourself away after N minutes idle"

### A4.3 Status / Stories (WhatsApp-grade, full)
- Post **text** status (background color/gradient + font), **image**, **video** (≤30s), and **voice** status
- Caption + emoji + links + mentions on status; optional music/audio clip
- 24h auto-expiry (per-item TTL); re-post / re-share to status
- **View-once style** options + screenshot-aware UI hint
- **View counts + viewer list** (who saw, ordered by time) — respects viewer's read-receipt privacy
- **React to a status** (emoji) and **reply to status** → creates a 1:1 message thread referencing the status
- **Privacy audiences:** My contacts / My contacts except… / Only share with… (per-post, remembered)
- **Mute / unmute** someone's status; muted statuses move to the bottom
- **Status archive** (optional, user keeps own expired statuses privately)
- Forward a received message → post as status (with permission)
- Statuses are **E2EE for personal** (audience-encrypted, server stores ciphertext); enterprise "announcements" are server-readable
- Real-time updates: new status ring indicator, live viewer-count, instant removal on expiry/delete
- **Teams/Slack equivalent** (separate from stories): custom status message + emoji + expiry + "Out of Office" with auto-reply (covered under presence §A4.2)

### A4.4 Voice & Video Calling (WhatsApp + Teams)
- 1:1 voice call
- 1:1 video call
- Group voice/video call (small, WhatsApp-style ad-hoc, ~32)
- Large meetings/conferences (Teams-style, 250–1000 with SFU + simulcast)
- Slack-style **Huddles** (lightweight always-on audio room in a channel)
- Scheduled meetings (with calendar invite, join link, lobby/waiting room)
- Meeting recording (server-side composite + per-track)
- Live transcription / captions (self-hosted Whisper)
- Screen sharing (full screen / window / tab)
- Background blur / virtual background (client-side)
- Raise hand, reactions in call, mute/unmute, participant list
- Breakout rooms
- Active speaker detection + grid/spotlight layouts
- Call from lock screen (mobile, via push + CallKit/ConnectionService)
- Missed call notifications + call history log
- **Whiteboard** (collaborative canvas in meetings — self-hosted, e.g. Excalidraw-style, free)
- **Together mode / grid / spotlight / focus** layouts
- **Meeting recap & notes** (auto summary + action items via self-hosted AI, §A26) + shared meeting notes
- **Live events / Town halls** (large one-to-many broadcast meetings, view-only audience + Q&A)
- **Calendar integration** (self-hosted CalDAV/iCal — schedule, RSVP, reminders; free)
- **Voicemail** for missed 1:1 calls (caller leaves a voice note)
- **Polls & reactions live in meeting**; Q&A; live captions in many languages (§A26)
- **In-meeting chat** (persists to a thread)
- PSTN dial-in / phone numbers is **out of scope for free** (requires paid SIP trunk) — noted

### A4.5 Files & Media (all three)
- Image / video / audio / document sharing
- Inline image & video preview, video streaming (HLS)
- Thumbnails + blurhash placeholders
- Voice note recording + waveform
- File versioning (Teams/Slack file history)
- Large file upload (resumable, multipart)
- Media gallery per chat
- Document collaboration link-outs (open in viewer)
- Antivirus scan on upload (ClamAV, free) + content-type validation
- E2EE media (encrypted blob + key shared via E2EE channel) for personal chats

### A4.6 Organization / Workspace (Teams + Slack)
- Organizations / Workspaces (tenants)
- Teams (Teams) → Channels; Workspaces → Channels
- Public, private, shared/connect channels
- Org directory + people search
- Roles: Owner, Admin, Member, Guest, Bot
- Guest / external collaborator access (scoped)
- SSO (OIDC/SAML via Keycloak — free), SCIM provisioning
- Admin console: members, channels, retention, compliance export, audit logs
- Per-org retention & legal hold (eDiscovery export)
- DLP hooks / keyword policies
- Custom emoji per workspace
- Workspace/Org switching in client

### A4.7 Automation & Extensibility (Slack + Teams)
- Bots (incoming/outgoing webhooks + bot users)
- Slash commands (custom, per-workspace)
- Interactive components (buttons, menus, modals — block-kit style)
- Event subscriptions / webhooks for 3rd-party apps
- Workflow builder (trigger → steps → actions, no-code)
- Scheduled reminders (`/remind`)
- App directory (internal)
- **Canvas** (Slack-style collaborative doc attached to a channel/DM — free, self-hosted editor)
- **Clips** (short async audio/video recordings posted to a channel)
- **Lists** (lightweight structured task/tracking lists in a channel)
- **Approvals / forms** (workflow-driven request → approve → notify)

### A4.8 Notifications (all three)
- Push (mobile via APNs/FCM, web via Web Push, desktop via WS/ntfy)
- Per-chat / per-channel notification preferences (all / mentions / nothing)
- Mute durations (8h, 1w, always)
- Do Not Disturb schedules + quiet hours
- Notification keywords (Slack: alert on words)
- Mention & reply prioritization
- Badge counts (unread per chat + global)
- Email digest for missed activity (self-hosted SMTP)

### A4.9 Search (Slack + Teams)
- Global search across messages, files, people, channels
- Filters: from:user, in:channel, before/after date, has:link/file
- Per-chat search
- Search ranking + highlighting
- Respects access control (private channels, E2EE excluded — see §A18)

### A4.10 Security & Privacy (WhatsApp + enterprise)
- E2EE for personal chats & calls (Signal protocol)
- Encryption at rest (DB + object storage)
- 2FA / TOTP, device management, remote logout
- Block / report user, spam controls
- Privacy controls (last-seen, profile photo, read receipts, status audience)
- Per-org compliance, audit log, retention, legal hold
- Session/device list with revoke

### A4.11 Account & Profile
- Phone-number signup (WhatsApp) + email/SSO (enterprise)
- Multi-device (linked devices, WhatsApp multi-device model)
- Profile: name, avatar, about, custom fields
- Contacts sync (hashed, privacy-preserving)
- Account export & delete (GDPR)

### A4.12 Language & Translation (all free, self-hosted models)
- **App localization (i18n):** full UI in many languages; per-user language preference; RTL support (Arabic/Urdu/Hebrew)
- **Automatic language detection** of incoming messages
- **Chat translation — Auto mode:** incoming messages auto-translated into the user's preferred language inline (with "show original" toggle); per-chat on/off
- **Chat translation — Manual mode:** tap any message → "Translate" → shows translation under the original; choose target language
- **Compose translation:** type in your language → send in recipient's language (optional)
- **Real-time call/meeting translation:** live **translated captions** during voice/video calls + meetings (speech → text → translate → caption), multi-participant multi-language; optional **translated voice (TTS)** read-out
- **Meeting transcript translation:** post-call transcript available in multiple languages
- **Status / media caption translation**
- **Privacy rule (no loophole):** for **personal E2EE** content, translation runs **on-device** (server never sees plaintext); for **enterprise** content, translation runs server-side (already server-readable). Detailed in §A26 / §B20.


---

## A5. Domain Model & Bounded Contexts

We split the system into bounded contexts (DDD). Each maps to one or more services and owns its data.

```text
┌────────────────────────────────────────────────────────────────────┐
│ IDENTITY & ACCESS         │  Auth, devices, sessions, tokens, E2EE   │
│                           │  key directory, SSO, 2FA                 │
├────────────────────────────────────────────────────────────────────┤
│ DIRECTORY & TENANCY       │  Users, profiles, contacts, orgs,        │
│                           │  workspaces, teams, roles, membership    │
├────────────────────────────────────────────────────────────────────┤
│ CONVERSATION              │  Conversations (1:1/group/channel),      │
│                           │  messages, threads, receipts, reactions, │
│                           │  edits, pins, drafts, disappearing       │
├────────────────────────────────────────────────────────────────────┤
│ PRESENCE & SIGNALS        │  Online state, typing, last-seen, rich   │
│                           │  presence, status/stories                │
├────────────────────────────────────────────────────────────────────┤
│ MEDIA                     │  Upload, transcode, thumbnails, storage  │
├────────────────────────────────────────────────────────────────────┤
│ REALTIME COMMS            │  WebRTC signaling, SFU rooms, recording, │
│                           │  transcription, huddles                  │
├────────────────────────────────────────────────────────────────────┤
│ DISCOVERY                 │  Search indexing & query                 │
├────────────────────────────────────────────────────────────────────┤
│ ENGAGEMENT                │  Notifications, badges, digests          │
├────────────────────────────────────────────────────────────────────┤
│ AUTOMATION                │  Bots, slash commands, workflows, webhooks│
├────────────────────────────────────────────────────────────────────┤
│ INTELLIGENCE (AI)         │  Summaries, translation, smart search,   │
│                           │  moderation (self-hosted models)         │
└────────────────────────────────────────────────────────────────────┘
```

**Key entities & relationships:**

```text
User 1───* Device
User *───* Organization        (membership w/ role)
User *───* Workspace           (membership w/ role)
Organization 1───* Team 1───* Channel
Workspace    1───* Channel
Conversation (type: dm | group | channel)
Conversation 1───* Member
Conversation 1───* Message 1───* Reaction
Message 1───* Message (thread: parent_id)
Message 1───* Attachment ─── MediaObject
User 1───* StatusPost (24h)
Meeting 1───* Participant
```

---

## A6. High-Level System Diagram

```text
                         ┌─────────────────────────────────────┐
                         │              CLIENTS                 │
                         │  RN Mobile │ React Web │ Electron     │
                         │            │ Admin Portal             │
                         └───────┬───────────────┬──────────────┘
                                 │ HTTPS/gRPC-web │ WSS (WebSocket)
                                 ▼               ▼
                    ┌────────────────────┐  ┌─────────────────────────┐
                    │   EDGE / API GW    │  │   REALTIME GATEWAY       │
                    │ Envoy + Kong OSS   │  │ (WebSocket fabric,       │
                    │ authn, rate-limit, │  │  sticky by connID,       │
                    │ routing, TLS       │  │  fan-out via Redis/Kafka)│
                    └─────────┬──────────┘  └────────────┬────────────┘
                              │ gRPC (mTLS, mesh)         │
        ┌─────────────────────┴───────────────────────────┴───────────────────┐
        │                         SERVICE MESH (Linkerd)                        │
        │                                                                       │
        │  Auth   User/Org   Chat   Group/Channel   Presence   Notification     │
        │  Media  Search     Call/Meeting           Automation  AI              │
        └───────────────────────────────┬───────────────────────────────────────┘
                                         │ produce/consume
                                         ▼
                    ┌───────────────────────────────────────────┐
                    │            KAFKA (event backbone)          │
                    │  message.* user.* call.* presence.* ...    │
                    └───────┬───────────┬──────────┬─────────────┘
                            │           │          │
              ┌─────────────▼──┐ ┌──────▼─────┐ ┌──▼─────────────┐
              │ PostgreSQL     │ │ MongoDB    │ │ Valkey         │
              │ (users, orgs,  │ │ (messages, │ │ (presence,     │
              │  roles, billing│ │  threads,  │ │  cache, OTP,   │
              │  channels meta)│ │  receipts) │ │  typing, rate) │
              └────────────────┘ └─────┬──────┘ └────────────────┘
                                       │ change events / indexer
                                 ┌─────▼──────┐      ┌─────────────┐
                                 │ OpenSearch │      │   MinIO     │
                                 │ (search)   │      │ (media blobs│
                                 └────────────┘      │  S3 API)    │
                                                     └─────────────┘
   Realtime media plane (separate from data plane):
        Clients ──WebRTC──▶ coturn (STUN/TURN) ──▶ LiveKit SFU ──▶ recording/whisper
```

Two physical planes:
- **Data/control plane** — request/response + events (everything above Kafka).
- **Media plane** — WebRTC audio/video, peer→TURN→SFU. Never touches Kafka; only *signaling* (offer/answer/ICE) goes through services.

---

## A7. Client Architecture

### A7.1 Shared client principles
- **Local-first / offline-first.** Each client has a local DB (SQLite via WatermelonDB/op-sqlite on RN; IndexedDB via SQLite-WASM on web). Messages render from local store; network syncs in background. WhatsApp feels instant because of this.
- **Single sync engine.** A `SyncManager` owns the WebSocket, applies a server change-log (cursor-based), resolves conflicts, and emits to the UI store.
- **Outbox pattern.** Outgoing messages are written to a local outbox with `client_msg_id`, shown immediately as "sending", retried until ACKed.
- **E2EE in the client.** libsignal sessions, prekeys, and the message ratchet live on-device. Server never sees plaintext for personal chats.

### A7.2 Mobile (React Native)
```text
src/
 ├── app/              # bootstrap, providers, deep links, push handlers
 ├── features/         # feature-sliced: chat, calls, status, channels, settings
 │    └── chat/        #   ui/ + model/ (zustand) + api/ + sockets/
 ├── screens/          # navigation targets
 ├── navigation/       # react-navigation stacks/tabs
 ├── services/         # api clients (gRPC-web/REST), auth, push, e2ee
 ├── sockets/          # SyncManager, WS lifecycle, reconnect/backoff
 ├── db/               # local SQLite (WatermelonDB), migrations, outbox
 ├── store/            # zustand slices + TanStack Query cache
 ├── crypto/           # libsignal wrapper, keystore (Keychain/Keystore)
 ├── hooks/
 ├── ui/               # design system
 └── utils/
```
Native modules: CallKit (iOS) / ConnectionService (Android) for system call UI; WebRTC native; secure keystore; background message fetch.

### A7.3 Web (React)
```text
src/
 ├── pages/            # route-level
 ├── modules/          # feature modules (chat, channels, calls, admin)
 ├── components/       # design system + block-kit renderer
 ├── layouts/
 ├── api/              # generated gRPC-web + REST clients
 ├── sockets/          # SyncManager (Web Worker), WS, reconnect
 ├── db/               # SQLite-WASM / IndexedDB local store
 ├── crypto/           # libsignal (wasm), keys in IndexedDB (non-extractable where possible)
 ├── store/            # zustand + TanStack Query
 ├── workers/          # service worker (web push), sync worker, crypto worker
 ├── hooks/
 └── utils/
```

### A7.4 Desktop (Electron)
Reuses the web bundle inside Electron for native notifications, screen-share picker, global shortcuts, auto-update (self-hosted update server), and system tray presence. Screen capture for calls uses Electron's `desktopCapturer`.

### A7.5 Admin Portal (React)
Separate app for org/workspace admins: member & role management, channel governance, retention/legal-hold, compliance export, audit log viewer, usage dashboards, bot/app approval. Talks only to admin-scoped gateway routes (RBAC enforced server-side).


---

## A8. Microservice Catalog

Each service: single responsibility, owns its data, stateless, independently deployable & scalable. All inter-service calls are gRPC over the mesh (mTLS); all state changes emit Kafka events.

| # | Service | Responsibility | Primary store | Reads via | Scale driver |
|---|---------|----------------|---------------|-----------|--------------|
| 1 | **api-gateway** | TLS, authN (verify JWT), rate-limit, route, request logging, gRPC-web translation | — (stateless) | Valkey (rate limit) | RPS |
| 2 | **realtime-gateway** | WebSocket connection mgmt, deliver events to online clients, receive client signals (typing, acks) | Valkey (conn registry) | Kafka, Valkey | concurrent connections |
| 3 | **auth-service** | Signup/login, OTP, TOTP/2FA, JWT issue/refresh, device sessions, SSO (OIDC/SAML via Keycloak), E2EE key directory (prekeys) | Postgres + Valkey | — | auth RPS |
| 4 | **user-service** | Profiles, contacts (hashed), privacy settings, blocking, orgs, workspaces, teams, roles, membership, directory | Postgres | — | read RPS |
| 5 | **chat-service** | Conversations, messages, threads, receipts, reactions, edits, deletes, pins, drafts, disappearing, scheduled | MongoDB (sharded) + Valkey | Kafka | message write throughput |
| 6 | **group-channel-service** | Group/channel/community lifecycle, membership, roles, settings, announcement & broadcast semantics | Postgres + Mongo | Kafka | membership ops |
| 7 | **presence-service** | Online/last-seen, typing, rich presence, status/stories | Valkey + Postgres (status meta) | Kafka | presence fan-out |
| 8 | **notification-service** | Build & route push (APNs/FCM/WebPush), badges, prefs, DND, digests, mention routing | Postgres (prefs) + Valkey | Kafka | event volume |
| 9 | **media-service** | Upload (resumable), transcode (ffmpeg), thumbnails, blurhash, HLS, AV scan (ClamAV), signed URLs | MinIO + Postgres (metadata) | — | upload bandwidth |
| 10 | **search-service** | Index messages/files/people/channels, query, ACL filtering | OpenSearch | Kafka | index + query load |
| 11 | **call-service** | WebRTC signaling, SFU room mgmt (LiveKit), meetings, lobby, recording, transcription, huddles | Postgres (meeting meta) + Valkey (room state) | Kafka | concurrent rooms |
| 12 | **automation-service** | Bots, slash commands, interactive components, webhooks, workflow engine, reminders | Postgres + Valkey (jobs) | Kafka | webhook/job volume |
| 13 | **ai-service** | Summaries, translation, smart search re-rank, moderation — all on self-hosted models | Postgres (jobs) + OpenSearch | Kafka | inference load |

> 13 services (original 12 + a dedicated **realtime-gateway** split out from api-gateway, which is essential at scale — WebSocket and HTTP scale on different axes).

**Why these splits (and not more/less):**
- Chat vs Group/Channel split: messaging hot path must scale independently of membership/admin CRUD.
- Presence is split out because its write rate (typing, heartbeats) dwarfs everything and would poison other services' SLOs.
- Realtime-gateway is split from api-gateway because socket count, not RPS, drives its memory/CPU.
- Call-service is isolated because signaling + room orchestration is bursty and tied to the media plane.

---

## A9. Communication Patterns

| Pattern | Transport | When used | Guarantees |
|---------|-----------|-----------|------------|
| Client → backend (commands/queries) | HTTPS / gRPC-web via gateway | login, send message, fetch history, create channel | request/response, retried, idempotent |
| Client ↔ backend (realtime) | WebSocket (WSS) | receive messages, typing, presence, call signaling | at-least-once push, client de-dupes |
| Service → service (sync) | gRPC over mesh (mTLS) | "is user member of channel?", "get profile" | low-latency, circuit-broken, deadline-bounded |
| Service → service (async) | Kafka | every state change (fan-out, indexing, notifications, audit) | at-least-once, ordered per key, replayable |
| Media | WebRTC (SRTP) peer→TURN→SFU | calls/meetings | real-time, not durable |

**Rules:**
- A command's synchronous path does the *minimum* (validate + persist + emit event), then returns. Everything else (notify, index, fan-out projections) happens asynchronously off Kafka. This keeps p99 send-latency low.
- Kafka keys: partition by `conversation_id` (chat) / `user_id` (presence) so per-entity ordering is preserved.
- gRPC calls always carry a deadline + trace context; failures use retry-with-jitter + circuit breaker (mesh-level).

---

## A10. Data Architecture (Polyglot Persistence)

### A10.1 Store selection rationale
| Store | Holds | Why this store |
|-------|-------|----------------|
| **PostgreSQL** | Users, devices, orgs, workspaces, teams, channels (metadata), roles, memberships, billing, notification prefs, meeting metadata, audit log | Strong consistency, relations, transactions, RBAC joins |
| **MongoDB (sharded)** | Messages, threads, reactions, receipts, activity logs | Massive append-heavy write volume, flexible message schema, shard by conversation |
| **Valkey** | Presence, typing, session cache, OTP, rate-limit counters, WS connection registry, room state, unread counters, hot recent-messages cache | Sub-ms, TTL-native, pub/sub |
| **OpenSearch** | Inverted indexes for messages/files/people/channels | Full-text relevance, filters, aggregations |
| **MinIO** | Media blobs (encrypted for personal), transcoded renditions, recordings, exports | S3-compatible object storage, cheap, self-hosted |

### A10.2 MongoDB sharding for messages
- **Shard key:** `conversation_id` (hashed) → even distribution, keeps a conversation's messages co-located for range reads.
- **Collections:** `messages`, `threads`, `receipts`, `reactions`.
- **Indexes:** `{conversation_id:1, seq:1}` (history paging), `{conversation_id:1, _id:-1}` (latest), `{ "mentions.user_id":1 }`.
- **Per-conversation monotonic `seq`** (server-assigned) gives total order without relying on wall-clock.
- **TTL index** on disappearing/ephemeral messages.

### A10.3 PostgreSQL scaling
- Primary + streaming replicas (read replicas for directory/search-adjacent reads).
- Partition large tables (`audit_log`, `memberships`) by org_id / time.
- Connection pooling via PgBouncer.
- Logical replication → OpenSearch/AI projections where needed.

### A10.4 Caching strategy
- Read-through cache in Valkey for hot entities (profile, channel meta, membership checks) with short TTL + event-driven invalidation (consume `user.updated`, `channel.updated`).
- "Recent N messages" per conversation cached for instant open; backfill from Mongo on miss.

### A10.5 Data ownership rule
No service queries another service's database. Cross-context reads go through gRPC or through an **event-sourced local projection** (e.g., search-service builds its index purely from Kafka events; notification-service keeps a projection of membership for routing).


---

## A11. Event Catalog (Kafka)

All events are versioned, schema-registry-managed (Confluent Schema Registry is free/OSS, or use Apicurio — Apache-2.0). Key = entity for ordering. Default retention 7d; compliance/audit topics longer; some compacted.

```text
TOPIC                        KEY               PRODUCER           MAIN CONSUMERS
─────────────────────────────────────────────────────────────────────────────
message.sent                 conversation_id   chat-service       realtime-gw, notification, search, ai
message.delivered            conversation_id   realtime-gw        chat-service
message.read                 conversation_id   chat-service       realtime-gw (receipt fan-out)
message.edited               conversation_id   chat-service       realtime-gw, search
message.deleted              conversation_id   chat-service       realtime-gw, search
message.reaction.added       conversation_id   chat-service       realtime-gw
thread.replied               conversation_id   chat-service       realtime-gw, notification, search
typing.started/stopped       conversation_id   realtime-gw        realtime-gw (fan-out only; not stored)
user.created/updated         user_id           user-service       search, notification, cache-invalidate
user.online/offline          user_id           presence-service   realtime-gw, presence subscribers
presence.changed             user_id           presence-service   realtime-gw
status.posted                user_id           presence-service   realtime-gw, notification
contact.added                user_id           user-service       search
org.created / member.added   org_id            user-service       notification, search, audit
channel.created/updated      channel_id        group-channel-svc  search, notification, cache
channel.member.added/removed channel_id        group-channel-svc  realtime-gw, notification, search
group.created                group_id          group-channel-svc  notification, search
call.started/ended           call_id           call-service       notification, audit, ai (transcribe)
call.participant.joined/left call_id           call-service       realtime-gw
meeting.scheduled            meeting_id         call-service       notification, calendar
file.uploaded                media_id          media-service      search, ai (scan/caption)
file.transcoded              media_id          media-service      chat-service (update msg), realtime-gw
notification.created         user_id           notification-svc   (push workers)
mention.created              user_id           chat-service       notification
audit.event                  org_id            (all)              audit sink (long retention)
moderation.flagged           message_id        ai-service         admin, notification
```

**Ordering & idempotency:** keyed partitioning preserves per-entity order. Consumers persist a processed-offset / dedupe set so re-delivery is harmless. Producers use idempotent producer config + `client_msg_id` for end-to-end dedupe.

**Dead-letter topics:** each consumer group has a `<topic>.dlq` for poison messages, with alerting.

---

## A12. Edge / Gateway / Realtime Gateway

### A12.1 API Gateway (Envoy + Kong OSS)
Responsibilities: TLS termination (Let's Encrypt), JWT verification (rejects unauthenticated early), global + per-user rate limiting (token bucket in Valkey), request routing to gRPC services, gRPC-web ↔ gRPC translation, request/trace logging, WAF rules, CORS.

The gateway does **not** contain business logic — it authenticates and routes.

### A12.2 Realtime Gateway (the WebSocket fabric)
This is the heart of "instant." Design:
```text
Client ──WSS──▶ [Realtime GW pod N]  (holds connection in memory)
                      │  on connect: register {user_id, device_id, conn_id, pod_id} in Valkey
                      │  subscribe pod to relevant Kafka partitions / Valkey pub-sub channels
                      ▼
   Inbound from client: typing, read-acks, presence pings, call signaling  → produce to Kafka
   Outbound to client : consume message.* / presence.* / call.* events, match by user_id,
                        push over the right socket(s)  (a user may have many devices/sockets)
```
- **Connection registry** in Valkey: `conn:{user_id}` → set of `{pod_id, conn_id, device_id}`; TTL refreshed by heartbeat; cleared on disconnect.
- **Routing an event to a user:** look up which pods hold that user's sockets, deliver via Valkey pub/sub channel `pod:{pod_id}` (so any pod can forward to the owning pod), or each pod consumes a per-user-hash Kafka partition. We use **Valkey pub/sub for cross-pod delivery** (low latency) + Kafka as the durable source.
- **Backpressure:** per-connection send queue with high-watermark; slow clients get coalesced presence/typing (drop intermediate typing events) but never dropped messages (messages are durable and re-syncable via cursor).
- **Reconnect:** client reconnects with last `sync_cursor`; gateway/chat-service replays missed changes (see §B5). No message lost on socket drop.
- **Scale:** ~50–100k concurrent sockets per well-tuned pod (Node + tuned ulimits); scale horizontally; sticky not required because registry is shared.

---

## A13. Multi-Tenancy Model

Three tenancy scopes coexist:
- **Personal graph** — global, phone-number identity, no tenant. E2EE.
- **Organization (Teams-style)** — `org_id` tenant; Teams → Channels; SSO; compliance.
- **Workspace (Slack-style)** — `workspace_id` tenant; Channels; bots/workflows.

**Isolation approach:** shared infrastructure, **row-level tenant scoping** (`org_id`/`workspace_id` on every tenant-owned row + enforced in every query and in OpenSearch filters). Large enterprise tenants can be pinned to dedicated Mongo shards / Kafka partitions. RBAC is evaluated per tenant: a user's role in Org A is independent of Org B.

**Tenant context propagation:** every authenticated request carries `tenant_id` + `role` claims in the JWT and in gRPC metadata; services enforce authorization with a shared `@Tenant`/`@Roles` guard (NestJS) backed by the user-service authorization API + cached membership.


---

## A14. Security Architecture

### A14.1 Authentication — Device-Anchored Progressive Trust (DAPT), ₹0 OTP

This is the centerpiece auth model. It is designed so that **per-user OTP/verification cost = ₹0** (only a fixed inbound-number rental remains), while staying **at least as secure as SMS OTP — usually stronger** — and closing every situational loophole (Sybil, SIM-swap, caller-ID spoof, recycled number, recovery back-door). It mirrors how WhatsApp/Signal/Telegram actually behave.

**(1) Identity model — the decision that dissolves most loopholes.**
> Identity = an **immutable `account_id` (UUID)**. **Phone and email are re-verifiable *attributes*, not the primary key.**

Because data hangs off `account_id` (never off the phone number), number-change, email-change, multi-identity, and recycled-number takeover all become clean, safe operations (see §B2). A phone number is a *lookup key + ownership proof + Sybil tax*, not the identity itself.

**(2) The trust waterfall — cheapest first; SMS is the last resort, not the default.**
```text
1. Device-key challenge   (FREE)  known device signs a server nonce (biometric-gated). No OTP.
2. Passkey / WebAuthn     (FREE)  phishing-proof, platform-synced (iCloud/Google Pwd Mgr).
3. Approve-on-old-device  (FREE)  new device shown a QR; a trusted device approves (signed).
4. Email magic-link/OTP   (FREE)  self-hosted Postfix.
5. Reverse-OTP            (₹0/usr) USER-initiated missed-call / user-SMS to our DID → we receive.
6. Server-sent SMS OTP    (PAID)  rare last resort only; <1% of users; can be disabled.
```
Returning users (~95% of all auth events) resolve at step 1 — **zero cost, zero friction**. New devices use steps 2–4 (free). Cold start (a brand-new number, no prior anchor) uses **step 5 (Reverse-OTP)** which costs the server nothing per event.

**(3) Reverse-OTP — how cold-start verification is free.**
The expensive thing is *server→user* SMS. We invert it: the user proves number ownership by sending *to us*.
```text
- User enters phone → server issues a short token + target DID, app guides the user to either
    (a) place a MISSED CALL to our DID  (user's outgoing call, free on their plan), or
    (b) send a PRE-FILLED SMS "<token>" to our DID (user's SMS, free on their plan)
- Our self-hosted Asterisk/FreeSWITCH gateway RECEIVES it and verifies:
    • caller-ID / SMS-sender == the number the user entered
    • token matches (SMS path) and is within the bound time-window of THIS app session
    • origination is a REAL mobile network (reject VoIP/SIP-gateway origination → anti-spoof)
    • device attestation passed (Play Integrity / App Attest → anti-bot/emulator)
- Match → number verified → account_id created → device key + passkey provisioned
- Server cost ≈ ₹0 per verification (we only receive). Residual = fixed DID rental only.
```
After this single event the device key/passkey loop takes over → **the user never verifies a phone again**. (Indian market fit: missed-call verification is well-established and outgoing call/SMS is free on virtually all plans.)

**(4) Sybil / fake-account defense (answers "multiple emails → many accounts").**
- **Account creation requires a verified phone (consumer mode).** Email *alone* can never create a consumer account → infinite free emails cannot spawn accounts.
- **One real number = one account.** Free-for-server does **not** mean free-for-attacker: a Sybil attacker still needs a distinct *real mobile number* per account → scarcity tax intact.
- **Device attestation** (Play Integrity/App Attest, free) blocks emulator/bot farms.
- **VoIP / disposable-number ranges** flagged or blocked at signup.
- **Rate limits + risk scoring** per IP / device / number-prefix; datacenter-IP and velocity anomalies blocked. (Also stops "OTP/SMS pumping" budget-drain on the fallback path.)
- **Enterprise mode** has no open signup at all — members join by **admin invite / SSO**, so Sybil is structurally impossible there.

**(5) Consumer vs Enterprise identity (answers "email login → contact sync?").**
- **Consumer (WhatsApp mode):** identity & login = **phone**; people discovery = **phone-number-hash** (address books hold numbers, not emails). Email is recovery + security alerts only.
- **Enterprise (Teams/Slack mode):** identity = **email/SSO**; people discovery = **org directory**; invite-gated. Phone not required.

**(6) Tokens & session binding.** Access JWT (~15m, RS256/JWKS, claims `account_id, device_id, tenant_id?, role?, scope`). Refresh = opaque, hashed-at-rest, **rotating with reuse-detection** (replay → revoke family). Tokens are **device-key bound (DPoP-style)** so a stolen token is useless on another device. Every device is a revocable session (remote logout, device list).

**(7) User-friendly by design.** Most users never type an OTP (device key/passkey). Where verification is needed: Android can auto-place the missed-call / auto-read its own incoming via SMS-Retriever (no SMS-read permission), iOS autofills, and email uses one-tap magic-links. "Easy *and* highly secure."

**(8) Enterprise SSO** via **Keycloak** (OIDC/SAML, free) + SCIM provisioning + optional TOTP 2FA.

> Full schemas, state machines, number-change, recovery, and the complete anti-spoof rule set are in **§B2**; end-to-end flows in **Part C (C1, C6, C17, C18)**; threat coverage in **§D4**.

### A14.2 Authorization
- RBAC per tenant: Owner > Admin > Member > Guest > Bot, with channel-level overrides (private channel membership).
- Enforced server-side via shared guard; **never** trust client. Membership checks cached in Valkey, invalidated on `channel.member.*` events.

### A14.3 End-to-End Encryption (personal)
- **Signal Protocol** (libsignal): X3DH for session setup, Double Ratchet for forward secrecy + post-compromise security.
- Server hosts a **key directory**: each device publishes an identity key, signed prekey, and a bucket of one-time prekeys. Server hands out prekey bundles but **never sees private keys or plaintext**.
- **Groups:** Sender Keys (each member encrypts once per group epoch; rekey on membership change).
- **Multi-device:** each device is its own Signal identity; a message to a user fans out to *each* of their devices' sessions (sender-side fan-out, like WhatsApp multi-device). See §B6.
- **Media E2EE:** media encrypted client-side with a random key; ciphertext uploaded to MinIO; the key travels inside the E2EE message. Server stores only ciphertext.

### A14.4 Enterprise content (server-readable by design)
Channel messages in orgs/workspaces are **not** E2EE (so search, compliance, bots, AI work) but are encrypted in transit (TLS/mTLS) and at rest (DB + MinIO SSE). Tenants get retention, legal hold, audit, DLP. This is an explicit, documented trade-off (same as Slack/Teams).

### A14.5 Infra security
- **mTLS** between all services (Linkerd auto-mTLS).
- **Secrets** in Vault / Sealed Secrets — never in images or env files in git.
- **Encryption at rest:** Postgres TDE/disk encryption, MinIO SSE, Mongo encrypted storage engine.
- **Network policies** (K8s NetworkPolicy) — default deny, explicit allow.
- **Input validation** (class-validator), output encoding, parameterized queries (no injection).
- **AV scanning** (ClamAV) on every uploaded file before it's downloadable.
- **Rate limiting + abuse controls** at gateway + per-feature (OTP attempts, message floods).
- **Audit log** (append-only, long retention) of admin & security events.

### A14.6 Privacy
Hashed contact discovery (clients upload salted hashes of phone numbers, server matches without storing raw numbers of non-users); per-user privacy controls (last-seen, read receipts, status audience, profile visibility); GDPR account export & delete (cascade + crypto-shredding of keys).

---

## A15. Real-Time & Presence

### A15.1 Presence model
- **Connection presence:** realtime-gateway reports `user.online`/`user.offline` to presence-service as sockets open/close (with a grace window to avoid flapping).
- **Last-seen:** stored in Valkey (`lastseen:{user}` = ts) + periodically flushed to Postgres; respects privacy setting before exposing.
- **Rich presence (Teams):** computed = max-priority of {manual status, call state, calendar busy, idle timer}. e.g. in a call → "In a call" overrides "Available".
- **Typing:** purely ephemeral, never stored; realtime-gw fans out `typing.started` to other conversation members with a 5s auto-expire; coalesced under backpressure.

### A15.2 Presence fan-out (the scaling problem)
A user with 2,000 contacts changing state must not blast 2,000 messages. Solution:
- **Subscription-based:** a client only subscribes to presence of conversations currently on screen + recent contacts. Presence is delivered **on-demand + on-change** to *subscribers only*, not to all contacts.
- presence-service keeps `subscribers:{user}` sets in Valkey; on change, publishes only to active subscribers via realtime-gw.

---

## A16. Media Pipeline

```text
1. Client asks media-service for a resumable upload URL (signed, MinIO multipart)
2. Client uploads (resumable, chunked). For personal chats: client encrypts BEFORE upload.
3. media-service finalizes → emits file.uploaded
4. Async workers:
     - ClamAV scan (reject if infected)
     - ffmpeg transcode: video→H.264/HLS renditions; audio→opus; images→webp + sizes
     - thumbnail + blurhash generation
     - (enterprise only) AI caption / OCR / moderation
5. media-service emits file.transcoded → chat-service updates the message attachment with
   rendition URLs + thumbnail + dims; realtime-gw pushes update to clients
6. Download: signed, time-limited URL from MinIO; HLS for video streaming
```
- **E2EE media** skips server-side transcode of *content* (server can't read it); client does any needed local processing and uploads ciphertext + encrypted thumbnail.
- **Dedup:** content-hash addressing so the same file forwarded many times stores once.
- **CDN-optional:** MinIO can sit behind an Nginx cache; geo-CDN is optional (§A3.5).

---

## A17. Calls & Meetings (WebRTC)

### A17.1 Topology
- **Signaling** via call-service over WebSocket (offer/answer/ICE, room join/leave, mute, hand-raise).
- **STUN/TURN:** **coturn** (free) for NAT traversal; TURN relays when P2P impossible.
- **Media routing:** **LiveKit SFU** (Selective Forwarding Unit) — each participant sends one upstream; SFU forwards to others. Scales to large meetings with **simulcast** (multiple quality layers) + active-speaker selection. 1:1 can be P2P; groups always SFU.

### A17.2 Capabilities
- 1:1 & group voice/video; large meetings (250–1000 via SFU clustering); Slack-style **huddles** (persistent low-friction audio room bound to a channel).
- **Lobby/waiting room**, **lock meeting**, host controls, **breakout rooms** (sub-rooms within a meeting).
- **Screen share** (additional track), **raise hand**, **in-call reactions**, **active-speaker spotlight + grid**.
- **Recording:** LiveKit Egress → composite + per-track recordings to MinIO.
- **Transcription/captions:** per-track audio → **self-hosted Whisper** (free) → live captions + post-meeting transcript stored & indexed.
- **Background blur / virtual bg:** client-side (free WebGL/ML models), no server cost.
- **Mobile system call UI:** push wakes app → CallKit/ConnectionService shows native incoming call.

### A17.3 Scheduled meetings
call-service stores meeting metadata in Postgres, emits `meeting.scheduled` → notification + (self-hosted CalDAV / iCal export, free) calendar invite with a join link. Join link resolves to a room; lobby admits per host policy.

---

## A18. Search

### A18.1 Index pipeline
search-service consumes `message.sent/edited/deleted`, `file.uploaded`, `user.*`, `channel.*` from Kafka and maintains OpenSearch indexes: `messages`, `files`, `users`, `channels`.

### A18.2 What is and isn't searchable
- **Searchable:** enterprise/workspace channel messages & files, people, channels (server-readable).
- **NOT server-searchable:** **personal E2EE messages** — the server only has ciphertext. These are searched **on-device** against the client's local SQLite index. (Same reason WhatsApp search is local-only.)

### A18.3 Query
- Filters (`from:`, `in:`, `before:`, `has:`), relevance ranking (BM25), highlighting.
- **ACL at query time:** every query is filtered by the caller's accessible channels/tenant (private channels excluded unless member). Permission filter injected server-side, never client-supplied.
- Optional **AI re-rank / semantic search** via self-hosted embedding model + OpenSearch k-NN (free).

---

## A19. Notifications

```text
event (message.sent / mention.created / call.started ...) 
   → notification-service
       ├─ resolve recipients (membership projection)
       ├─ apply prefs: per-chat level, mute, DND schedule, keywords, mention-only
       ├─ check presence: if recipient ONLINE on a device → in-app via realtime-gw (no push)
       │                  if OFFLINE/background → push transport
       └─ route by platform:
             iOS      → APNs   (free transport)
             Android  → FCM    (free transport)
             Web      → Web Push / VAPID (open standard, self-hosted keys)
             Desktop  → WebSocket / ntfy (self-hosted)
```
- **E2EE privacy:** push payload for personal chats contains **no content** — just "New message" + conversation id; the app fetches & decrypts locally. (Like WhatsApp/Signal.)
- **Badges & unread:** unread counters maintained in Valkey per (user, conversation) and aggregated; reconciled on read receipts.
- **Email digest:** missed-activity digest via self-hosted Postfix SMTP.
- **Dedup & collapse:** multiple messages from one chat collapse into one notification.


---

## A20. Observability

Full **Grafana stack (free)** + OpenTelemetry:
- **Metrics:** Prometheus scrapes every service (RED: Rate, Errors, Duration) + infra exporters (Kafka, Mongo, Postgres, Valkey, MinIO, OpenSearch). Dashboards in Grafana.
- **Logs:** structured JSON → Loki (queryable, cheap). No PII / no message content in logs.
- **Traces:** OpenTelemetry SDK in every service → Tempo. One `trace_id` from gateway through gRPC through Kafka (propagated in headers) so a single "send message" is traceable across services.
- **Errors:** GlitchTip (Sentry-compatible, free) for client + server exceptions.
- **Alerting:** Alertmanager → on-call (free: e.g. ntfy / email). SLO-burn-rate alerts.
- **Synthetic checks:** blackbox-exporter for critical user journeys (login, send, call-join).

Golden signals tracked per service + business KPIs (messages/sec, delivery latency p50/p99, call join success rate, push delivery rate).

---

## A21. Kubernetes Deployment Topology

```text
namespace: velchat-prod
─────────────────────────────────────────────────────────
ingress         : Traefik/Nginx + cert-manager (Let's Encrypt)
mesh            : Linkerd (auto-mTLS, retries, traces)

Deployments (stateless, HPA on CPU + custom metrics):
  api-gateway        (HPA on RPS)
  realtime-gateway   (HPA on active connections)   ← scales separately
  auth-service
  user-service
  chat-service       (HPA on consumer lag + RPS)
  group-channel-service
  presence-service   (HPA on ops/sec)
  notification-service
  media-service      (+ transcode worker deployment, scales on queue depth)
  search-service     (indexer + query split)
  call-service
  automation-service
  ai-service         (GPU node pool, scale-to-zero when idle)

StatefulSets (with PVCs, anti-affinity, PodDisruptionBudgets):
  postgresql         (Patroni/CloudNativePG operator: primary + replicas)
  mongodb            (sharded cluster: config servers + shards + mongos)
  valkey             (cluster mode, replicas)
  kafka              (KRaft mode, 3+ brokers; or Redpanda)
  opensearch         (master + data + coordinating nodes)
  minio              (distributed, erasure-coded)

DaemonSet / external:
  coturn             (host-network for UDP, public IPs)
  livekit            (SFU; node pool with good egress)

Platform:
  keycloak (SSO), vault (secrets), argo-cd (GitOps), 
  prometheus+grafana+loki+tempo, glitchtip, clamav
─────────────────────────────────────────────────────────
```
- **Node pools:** general (services), memory-optimized (Valkey/OpenSearch), storage (Mongo/Postgres/MinIO), network-optimized (LiveKit/coturn), GPU (ai-service, Whisper).
- **Resilience:** PodDisruptionBudgets, anti-affinity across zones, HPA + Cluster Autoscaler, graceful shutdown (drain WS connections on SIGTERM with client reconnect).
- **Lightweight option:** k3s for small/self-host deployments.

---

## A22. CI/CD (fully self-hostable, free)

```text
Developer ──push──▶ Gitea (self-hosted git)        [or GitHub free tier]
                        │ webhook
                        ▼
                 Woodpecker CI / Drone (self-hosted) [or GitHub Actions]
                        │  steps: lint → typecheck → unit → integration (testcontainers)
                        │         → build OCI image (Buildah/Kaniko) → SBOM + Trivy scan
                        ▼
              Self-hosted container registry (Harbor / Gitea registry)
                        │  image tag = git sha
                        ▼
              ArgoCD (GitOps) watches the config repo
                        │  progressive rollout (canary via Linkerd/Argo Rollouts)
                        ▼
                   Kubernetes (k3s/full)
```
- **Branching:** trunk-based + short-lived feature branches; PR requires green CI + review.
- **Migrations:** versioned DB migrations gated in pipeline, run as pre-deploy jobs; backward-compatible (expand/contract) so rollouts are zero-downtime.
- **Environments:** dev → staging → prod, each its own namespace/cluster; config in git (no secrets — those in Vault).
- **Supply chain:** SBOM generation, image signing (cosign), vuln scan (Trivy) — all free.

---

## A23. Scaling Roadmap & Capacity Planning

| Stage | Users | Architecture changes | Notes |
|-------|-------|----------------------|-------|
| **MVP** | ≤10K | Single region, k3s, single Postgres+replica, single-shard Mongo, Valkey primary+replica, 3 Kafka brokers, 1 LiveKit, 1 coturn | All services 2 replicas |
| **Growth** | 100K | Valkey cluster, Mongo sharding (2–4 shards), Kafka scaled partitions, OpenSearch 3-node, autoscale realtime-gw, multiple LiveKit nodes | Read replicas added |
| **Scale** | 1M+ | Multi-region active-active for stateless + regional realtime-gw; geo-routing; Mongo shards per region; Kafka MirrorMaker cross-region; dedicated media cluster; CDN front for media | E2EE keeps content regionally private |
| **Hyper** | 10M+ | Cell-based architecture (shard users into cells), per-cell data + realtime, global directory layer | Blast-radius isolation |

**Capacity sketch (1M DAU, ~50 msgs/user/day = ~50M msg/day ≈ 580 msg/s avg, ~5–10k/s peak):**
- Mongo: shard so each shard < ~5–8k writes/s; size for ~3–6 month hot window, archive older to MinIO (cold).
- Kafka: partition `message.sent` to keep per-partition < ~10MB/s; replication factor 3.
- Realtime-gw: 1M concurrent sockets ÷ ~75k/pod ≈ 14 pods + headroom.
- Valkey: presence/typing churn is the hot path → cluster + pipelining; size memory for connection registry + unread counters.

**Multi-region + E2EE:** because personal content is E2EE, replicating ciphertext across regions leaks nothing. Enterprise data residency handled by pinning a tenant's shard/region.

---

## A24. Reliability, Backup & Disaster Recovery

- **SLO targets:** message send→delivered p99 < 1s (recipient online); API availability 99.95%; call join success > 99%.
- **Backups:** Postgres WAL archiving + daily base backups to MinIO (different bucket/region); Mongo snapshots + oplog; Kafka topic retention as durable buffer + tiered storage; MinIO erasure coding + cross-site replication; Valkey is cache (rebuildable) except OTP/sessions (short-lived, acceptable loss with re-auth).
- **RPO/RTO:** RPO ≤ 5 min (WAL/oplog), RTO ≤ 30 min (automated failover via operators: Patroni for PG, replica-set election for Mongo).
- **Failure handling baked in:** at-least-once + idempotency (dup events safe), Kafka as replay buffer (rebuild projections/search/notifications), circuit breakers + retries with jitter, graceful WS drain, DLQs + alerts, chaos testing in staging.
- **Zero-downtime deploys:** rolling/canary, expand-contract migrations, connection draining.

---

## A25. AI Features (self-hosted, free models)

All AI runs on **self-hosted open models** (no paid API) on the GPU node pool:
- **Meeting summaries & action items:** Whisper (transcribe) → open LLM (e.g. Llama/Mistral-class, self-hosted via vLLM/Ollama, free) → summary stored & posted to channel.
- **Auto-translation:** open NMT models (e.g. NLLB/Marian) — message & caption translation.
- **Smart / semantic search:** self-hosted embedding model + OpenSearch k-NN.
- **AI moderation:** open text/image classifiers flag content → `moderation.flagged` → admin/notification; for enterprise content only (E2EE personal content can't be server-moderated — on-device optional).
- **AI assistant / bot:** a bot user backed by self-hosted LLM, invoked via slash command or @mention, scoped to channels it's added to.

> AI operates **only on server-readable (enterprise/workspace) content** by design; E2EE personal content stays private (optional on-device AI only).

---

## A26. Language & Real-Time Translation

All translation runs on **free, self-hosted models** (no paid API): **NLLB / Marian / OpusMT** for text translation (200+ languages), **Whisper** for speech-to-text, optional **open TTS** (e.g. Piper/Coqui) for spoken translation, and a fast **language-detection** model.

### A26.1 The privacy fork (this is the key "no loophole" rule)
| Context | Where translation runs | Why |
|---------|------------------------|-----|
| **Personal E2EE chats/calls** | **On-device** (client downloads a compact translation model; speech/text never leaves the device in plaintext) | Server only has ciphertext — it *cannot* translate without breaking E2EE, so it must not. On-device keeps the guarantee intact. |
| **Enterprise / workspace** | **Server-side** (`translation` capability in **ai-service**) | Content is already server-readable; server-side gives better models, caching, and consistency. |

This fork means there is **no path where translating a private message leaks plaintext to the server** — translation respects the same boundary as search and AI.

### A26.2 Chat translation
- **Auto mode:** user sets a preferred language + enables auto-translate (global or per-chat). Incoming messages are language-detected; if different, translated and shown inline with a "show original" toggle. Personal → on-device; enterprise → ai-service translates on `message.sent`, caches `(message_id, target_lang)` in Valkey/OpenSearch so repeated views are instant and cost-free.
- **Manual mode:** user taps a message → "Translate" → choose/confirm target language → translation shown beneath original. Personal → on-device; enterprise → cached server call.
- **Compose translation (optional):** user writes in their language; client/ai-service translates to the recipient's/channel's language before sending (original kept as metadata).

### A26.3 Real-time call & meeting translation
```text
Speaker audio (per track in LiveKit) 
   → Whisper streaming STT (partial + final segments)
   → translate (target language per listener)
   → push translated CAPTION over realtime-gw to each listener in THEIR language
   → (optional) TTS → translated audio track mixed for listeners who want voice
```
- Each participant independently chooses their caption/voice language → one meeting, many languages simultaneously.
- Enterprise meetings: runs in **call-service + ai-service** on the GPU pool (Whisper + NLLB + Piper).
- Personal E2EE calls: STT + translation run **on-device** (server forwards only encrypted media); captions stay local. (Heavier on device, so offered as an opt-in for capable devices.)
- Post-meeting **transcript** stored (enterprise) and translatable into any language on demand.

### A26.4 Cost & scaling
Models are self-hosted (zero license cost). Translation is GPU/CPU-bound, not per-message-billed. Heavy use → autoscale ai-service on the GPU pool; cache translations aggressively (same text+lang served from cache). On-device models are small distilled variants to fit mobile.

---

# PART B — LOW LEVEL DESIGN

## B1. Conventions

- **IDs:** **ULID/UUIDv7** (time-sortable, no central counter, shard-friendly). Message also has a per-conversation `seq` (server monotonic) for total ordering.
- **client_msg_id:** UUID generated on device for every outbound message → enables optimistic UI + server-side dedupe (idempotency).
- **Time:** server-authoritative UTC; clients never trusted for ordering. Wall-clock only for display.
- **Idempotency:** mutating endpoints accept an idempotency key; consumers track processed keys/offsets.
- **Pagination:** cursor-based (`seq`/`_id`), never offset.
- **API:** gRPC (proto) internal + gRPC-web/REST at edge. Errors use canonical codes + machine-readable reason.

---

## B2. Auth Service (LLD)

Implements the DAPT model from §A14.1. Identity = immutable `account_id`; phone/email are attributes; verification is ₹0 per user via Reverse-OTP; the device-key/passkey loop makes verification a once-per-user event.

### B2.1 Schema (PostgreSQL)
```sql
accounts(                                 -- THE identity. Never deleted on number change.
  account_id     UUID PK,
  status         TEXT,                    -- active|limited|locked|dormant|deleted
  tier           TEXT,                    -- full(phone-verified) | limited(email/passkey-only)
  created_at     TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ              -- drives dormancy/reclaim policy
)
identifiers(                              -- phone & email are ATTRIBUTES, re-verifiable
  id             UUID PK,
  account_id     UUID FK,
  kind           TEXT,                    -- phone | email
  value_norm     TEXT,                    -- E.164 phone / normalized email
  value_hash     TEXT,                    -- for contact discovery (phone) / lookup
  verified_at    TIMESTAMPTZ,
  is_primary     BOOL,
  UNIQUE(kind, value_norm) WHERE verified_at IS NOT NULL   -- 1 verified number = 1 account
)
devices(
  device_id      UUID PK,
  account_id     UUID FK,
  platform       TEXT,                    -- ios|android|web|desktop
  device_pubkey  BYTEA,                   -- DAPT device key (private key in enclave/keystore)
  attestation    JSONB,                   -- Play Integrity / App Attest verdict at enroll
  display_name   TEXT,
  push_token     TEXT,
  signal_identity_key BYTEA,              -- Signal/E2EE identity
  trusted        BOOL,                    -- can approve new devices
  created_at, last_seen_at, revoked_at TIMESTAMPTZ
)
passkeys(                                 -- WebAuthn/FIDO2 credentials
  cred_id        BYTEA PK, account_id UUID FK, public_key BYTEA,
  sign_count     BIGINT, aaguid BYTEA, created_at TIMESTAMPTZ
)
refresh_tokens(
  id UUID PK, device_id UUID FK, token_hash TEXT,
  family_id UUID,                         -- rotation family (reuse detection)
  cnf_jkt TEXT,                           -- DPoP key thumbprint → token bound to device key
  expires_at TIMESTAMPTZ, revoked BOOL
)
signal_prekeys(device_id UUID FK, signed_prekey BYTEA, signed_prekey_sig BYTEA,
               one_time_prekeys JSONB, updated_at TIMESTAMPTZ)
totp_secrets(account_id UUID PK, secret_enc BYTEA, enabled BOOL)
recovery_backup_codes(account_id UUID FK, code_hash TEXT, used BOOL)
auth_audit(account_id, event, ip, device_id, risk_score, ts)   -- append-only
```
Ephemeral verification state lives in **Valkey**: `revotp:{session_id}` = `{phone, token, expires}` (short TTL), `otp_attempts:*` (lockout counters), `authz` cache.

### B2.2 Reverse-OTP mechanism (₹0 per verification) + anti-spoof rules
```text
Gateway: self-hosted Asterisk / FreeSWITCH bound to one or more owned DIDs (fixed cost).
Path A (missed-call): user calls DID → gateway reads CLI → publishes {cli, ts} to auth-service.
Path B (user-SMS):    user sends pre-filled "<token>" to DID → gateway reads {sender, body}.
auth-service verifies ALL of:
  1. CLI/sender == the phone the user typed in this session
  2. (SMS) token matches revotp:{session_id} AND within bound time-window
  3. origination class == REAL MOBILE  → reject VoIP/SIP-gateway/known-spoof ranges
  4. device attestation verdict == genuine (Play Integrity / App Attest)
  5. risk score below threshold (IP reputation, velocity, geo/number mismatch)
Pass → mark identifier verified, provision device key + passkey. Fail → fall to email or SMS-OTP.
```
**Anti-spoof rationale:** caller-ID spoofing comes almost entirely via VoIP/SIP gateways → rule 3 blocks it; rule 4 ensures a genuine handset+app is the one registering; rule 2 binds the proof to the live session. Net assurance ≥ server-sent SMS OTP (which is itself vulnerable to SIM-swap/SS7), at ₹0.

### B2.3 Token design & device binding
- Access JWT `{account_id, device_id, tenant_id?, role?, scope, exp~15m}`, RS256/JWKS (rotated).
- Refresh = opaque, hashed-at-rest, **rotating + reuse-detection** (replay → revoke whole family).
- **DPoP binding:** refresh/access bound to the device key (`cnf_jkt`) → a stolen token can't be replayed from another device.

### B2.4 Cold-start registration (consumer) — state machine
```text
ENTER_NUMBER → REVERSE_OTP_PENDING → [verify per B2.2] → 
   PROVISION (create account_id + identifier + device key + passkey) → ACTIVE(full tier)
fallbacks: REVERSE_OTP fails → EMAIL_VERIFY (free) → limited tier
                                or → SMS_OTP (rare, paid) → full tier
```

### B2.5 Login / new device
- **Same device:** device-key challenge (nonce signed, biometric-gated) → tokens. No OTP.
- **New device:** passkey → or approve-on-trusted-device (QR + signed approval) → or email magic-link. Reverse-OTP only if the account has no other anchor.

### B2.6 Phone-number change (safe migration — no recycled-number takeover)
```text
Precondition: logged-in on a TRUSTED device (proves control of the OLD account).
1. Enter NEW number → Reverse-OTP verify NEW number (₹0)
2. Require BOTH: active trusted session  AND  new-number proof
3. If NEW number already maps to another active account → block / offer merge
4. Atomically: re-point identifiers(phone) to NEW value_norm/value_hash on SAME account_id
   (all chats/keys/data stay — they hang off account_id, not the number)
5. Notify contacts ("X changed number"); release OLD number after cooldown
Recycled number: a later registrant of the OLD number gets a FRESH account_id — never the
old data, because data is keyed on account_id. Dormant accounts go through reclaim + notify + delay.
```

### B2.7 Account recovery (no weak back door)
Recovery is the most-attacked path, so it is **multi-factor + delayed + notified**, never a single free channel:
```text
Need ANY two of: {passkey, trusted-device approval, email link, backup code, Reverse-OTP}
 + a time-delay (e.g. 24–72h) for high-risk recovery
 + notification to ALL channels (email + push + trusted devices)
 + cooling-off before sensitive actions; SMS/Reverse-OTP is only ONE factor, never alone.
```

### B2.8 Sybil & abuse controls (enforced at signup + fallback OTP)
One-account-per-verified-number; device attestation; VoIP/disposable-number block; proof-of-work / invisible CAPTCHA before any server-sent SMS (pumping defense); per-IP/device/prefix rate limits; risk scoring; enterprise = invite/SSO only (no open signup).

### B2.9 Prekey handout (E2EE)
On "start chat with X", sender fetches X's per-device prekey bundles; auth-service hands out one one-time prekey per device (consumed), refills when low.

---

## B3. User / Org / Workspace Service (LLD)

```sql
profiles(user_id PK, display_name, avatar_media_id, about, presence_privacy,
         lastseen_privacy, readreceipts_enabled, created_at)
contacts(user_id, contact_user_id, contact_hash, display_name, blocked BOOL,
         PRIMARY KEY(user_id, contact_user_id))
organizations(org_id PK, name, plan, sso_config JSONB, retention_days, created_at)
workspaces(workspace_id PK, name, org_id NULL, settings JSONB)
teams(team_id PK, org_id FK, name)                       -- Teams-style
memberships(id PK, user_id, scope_type, scope_id,         -- scope=org|workspace|team
            role, joined_at, UNIQUE(user_id, scope_type, scope_id))
roles_permissions(role, permission)                       -- static policy
```
- **Authorization API:** `Authorize(user, action, resource)` → cached in Valkey, invalidated by `member.*` / `role.*` events.
- **Contact discovery:** client uploads salted phone hashes → server matches against `contacts.contact_hash` of registered users; non-matches never stored raw.

---

## B4. Chat Service (LLD)

### B4.1 Message document (MongoDB)
```json
{
  "_id": "ULID",
  "conversation_id": "ULID",
  "seq": 84213,                  // server monotonic per conversation
  "sender_id": "ULID",
  "client_msg_id": "uuid",       // dedupe / optimistic UI
  "type": "text|image|video|audio|file|location|contact|poll|system",
  "content": { ... } | "ciphertext_b64",  // plaintext(enterprise) | E2EE blob(personal)
  "reply_to": "msgId|null",
  "thread_root": "msgId|null",
  "mentions": [{ "user_id": "...", "type": "user|channel|here|everyone" }],
  "attachments": [{ "media_id": "...", "renditions": {...}, "thumb": "...", "blurhash": "..." }],
  "reactions": { "👍": ["u1","u2"], "🎉": ["u3"] },
  "edited_at": null, "edit_history": [],
  "deleted": false, "deleted_scope": null,   // me|everyone
  "ephemeral_ttl": null,         // disappearing
  "created_at": "ISO", "server_ts": "ISO"
}
receipts: { conversation_id, message_seq, user_id, state: delivered|read, ts }
```

### B4.2 Send-message hot path (server-minimal)
```text
1. validate (membership, size, rate-limit)
2. dedupe by client_msg_id (idempotent: return existing if seen)
3. assign seq (atomic per-conversation counter in Valkey, periodically checkpointed)
4. persist message (Mongo) — ONLY required sync work
5. emit message.sent (Kafka, key=conversation_id)
6. return {message_id, seq, server_ts}  ← fast ACK to sender
   --- async ---
7. realtime-gw fans out to online members; notification handles offline; search indexes
```

### B4.3 Ordering & consistency
- Total order per conversation = `seq`. Clients sort by `seq`, not timestamp.
- "Recent N" cached in Valkey list per conversation for instant open; backfilled from Mongo.

### B4.4 Receipts
- delivered: recipient's device ACKs receipt → `message.delivered` → chat-service updates + fans receipt to sender (respecting sender's read-receipt privacy).
- read: client sends read up-to `seq` → single receipt covers all ≤ seq (compact).

### B4.5 Edit / delete / pin / star / disappearing → see §B15.


---

## B5. Multi-Device Sync (LLD)

WhatsApp-style: a user has multiple independent devices, each fully functional, kept in sync.

### B5.1 Change-log / cursor model
- Each user has a per-device **sync cursor**. The server exposes a **change-log** per conversation (the ordered `seq` stream) and a per-user "conversation list change-log".
- On connect/reconnect, device sends its last cursors; server streams everything newer (messages, edits, deletes, receipts, reactions, membership changes) → device applies idempotently to local SQLite.
- No message is lost on socket drop: reconnect → replay missed `seq` ranges.

### B5.2 New device linking (E2EE-aware)
```text
1. New device shows QR; existing logged-in device scans (proves possession, like WhatsApp)
2. Existing device authorizes → auth-service registers new device + its Signal identity
3. New device publishes prekeys to key directory
4. History transfer: encrypted history bundle sent device→device (E2EE), OR server replays
   server-stored ciphertext that was already fanned-out to this device's sessions.
5. New device begins receiving: senders now include this device in per-device fan-out.
```

### B5.3 Sender-side fan-out (personal E2EE)
A message to user X is encrypted **once per recipient device** (each device = own Signal session) + once per the sender's *other* devices (so all sender devices show sent messages). Server routes each ciphertext to the right device socket.

---

## B6. End-to-End Encryption (LLD)

### B6.1 Building blocks (libsignal)
- **Identity key** per device (long-term).
- **Signed prekey** (rotated) + **one-time prekeys** (consumed) in server directory.
- **X3DH** establishes a shared secret from prekey bundle without both parties online.
- **Double Ratchet** → per-message keys, forward secrecy + post-compromise security.

### B6.2 1:1 message
```text
Sender: fetch recipient device bundles → X3DH (if no session) → ratchet encrypt →
        upload ciphertext per device → server routes → recipient ratchet-decrypts.
Server sees: sender, recipient, size, timestamp (metadata) — never plaintext.
```

### B6.3 Group (Sender Keys)
- Each member generates a **sender key** for the group epoch; distributes it to other members over pairwise E2EE sessions.
- To send: encrypt once with own sender key, broadcast ciphertext; members decrypt with the sender's distributed key.
- **Membership change → new epoch:** rotate sender keys so removed members can't read new messages (and new members can't read old ones).

### B6.4 Media E2EE
Random per-file key → AES-GCM encrypt blob client-side → upload ciphertext to MinIO → key + hash sent inside the E2EE message → recipient downloads ciphertext + decrypts.

### B6.5 Verification
Safety numbers / key fingerprints per contact; warn on key change (MITM protection).

---

## B7. Group / Channel / Team Service (LLD)

```sql
conversations(conversation_id PK, type,            -- dm|group|channel|broadcast|community
  tenant_type, tenant_id NULL,                     -- org/workspace for channels
  name, topic, avatar_media_id, visibility,        -- public|private (channels)
  is_announcement BOOL, parent_community_id NULL,  -- communities
  created_by, created_at, settings JSONB)
conversation_members(conversation_id, user_id, role,  -- owner|admin|member
  notif_level, muted_until, joined_at, last_read_seq,
  PRIMARY KEY(conversation_id, user_id))
communities(community_id PK, name, announcement_channel_id, org_id NULL)
```
- **DM:** deterministic conversation id from sorted member pair (dedupe).
- **Group:** up to ~1024 members; admin controls (who can send/add).
- **Channel:** tenant-scoped; public (discoverable) vs private (invite/member-only); announcement = only admins post.
- **Broadcast list:** sender→many, recipients reply 1:1 (no shared convo).
- **Community:** group-of-groups + an announcement channel.
- Membership changes emit `channel.member.*` / `group.*` → realtime, notification, search, cache invalidation.

---

## B8. Presence Service (LLD)

```text
Valkey keys:
  online:{user}      -> set of device_ids (TTL via heartbeat)   EX 30s, refreshed
  lastseen:{user}    -> epoch ms
  presence:{user}    -> computed rich state {available|busy|dnd|away|incall|...}
  status:{user}      -> manual status {emoji, text, expires_at}
  subscribers:{user} -> set of user_ids currently watching this user's presence
  typing:{conv}      -> set of {user, expires} (5s TTL)
```
- Heartbeat every ~25s refreshes `online`; expiry → `user.offline` (with grace).
- Rich presence = priority resolve(manual, call-state, calendar, idle).
- Fan-out only to `subscribers:{user}` (on-screen + recent) — avoids N×contacts blast.
- Typing/last-seen respect privacy flags before exposure.

### Status / Stories (full LLD)
```sql
status_posts(status_id PK, user_id, kind,        -- text|image|video|voice
  media_id NULL, text NULL, bg NULL, caption NULL, music_media_id NULL,
  audience JSONB,                                 -- {mode: contacts|except|only, list:[...]}
  e2ee BOOL, view_once BOOL,
  created_at, expires_at)                         -- TTL index → auto-expire 24h
status_views(status_id, viewer_id, viewed_at)     -- ordered viewer list
status_reactions(status_id, viewer_id, emoji, ts)
status_archive(user_id, status_id, archived_at)   -- optional self-archive
status_mutes(user_id, muted_user_id)
```
- **Personal status is E2EE:** encrypted per-audience-member (sender-key style); server stores ciphertext + audience set; `status.posted` ⇒ realtime-gw rings only audience members.
- **Audience filter** enforced server-side at fetch (mode contacts/except/only); muted authors sorted last and silenced.
- **Viewer list + counts** returned to author (respect viewer's read-receipt privacy); **reactions** and **reply** (→ 1:1 message referencing the status).
- **View-once** status removed from feed after the viewer opens it; screenshot-aware UI hint.
- **TTL index** auto-expires at 24h; delete is immediate (⇒ realtime removal); archive keeps a private copy for the author only.

---

## B9. Realtime Gateway (LLD)

### B9.1 Connection lifecycle
```text
connect (WSS, JWT in header) → verify → register conn in Valkey:
   conn:{user} (set) += {pod_id, conn_id, device_id};  pod:{pod_id} pubsub channel
heartbeat (ping/pong ~25s) keeps conn + online presence alive
disconnect/timeout → remove from registry → maybe user.offline
```

### B9.2 Delivering an event to a user
```text
consumer (Kafka message.*/presence.*/call.*) → for each recipient:
   lookup conn:{user} → for each {pod_id}: publish to Valkey channel pod:{pod_id}
   owning pod receives → writes frame to that device's socket send-queue
```

### B9.3 Inbound client signals
typing, read-acks, presence pings, call signaling → validated → produced to Kafka (or direct gRPC to presence/call service).

### B9.4 Backpressure & reliability
- Per-conn bounded send queue + high-watermark; coalesce/drop *ephemeral* (typing/presence) under pressure, **never** drop durable messages (re-syncable by cursor).
- Graceful shutdown: stop accepting, tell clients to reconnect, drain.

---

## B10. Notification Service (LLD)

```sql
notification_prefs(user_id, scope_type, scope_id, level,      -- all|mentions|none
                   muted_until, keywords TEXT[], 
                   dnd_schedule JSONB, PRIMARY KEY(user_id,scope_type,scope_id))
push_endpoints(device_id PK, user_id, platform, token, voip_token)
```
```text
consume message.sent / mention.created / call.started / thread.replied:
  resolve recipients (membership projection)
  for each: apply level + mute + DND + keyword + mention-only
            if online (presence) → in-app via realtime-gw, skip push
            else route: APNs | FCM | WebPush(VAPID) | ntfy/WS(desktop)
  E2EE chats: payload has NO content (just conv id + "New message")
  collapse multiple per conversation; maintain unread counter in Valkey
```
VoIP push (CallKit/ConnectionService) for incoming calls so the device rings even when killed.

---

## B11. Media Service (LLD)

```sql
media_objects(media_id PK, owner_id, conversation_id NULL, content_hash,
  mime, size, status,            -- pending|scanning|ready|infected
  encrypted BOOL,                -- true for personal E2EE
  renditions JSONB,              -- {hls, 720p, 480p, webp_sizes...}
  thumb_key, blurhash, width, height, duration, created_at)
upload_sessions(upload_id PK, media_id, parts JSONB, multipart_id)
```
```text
init upload → signed MinIO multipart URLs (resumable) →
client uploads (encrypts first if personal) → complete →
status=scanning → ClamAV → if clean: ffmpeg transcode (HLS/webp/opus) +
thumbnail + blurhash → status=ready → file.transcoded → chat updates message.
Download: short-lived signed URL; video via HLS. Content-hash dedupe stores once.
```

---

## B12. Call / Meeting Service (LLD)

```sql
calls(call_id PK, type,                 -- 1:1|group|meeting|huddle
  conversation_id NULL, scheduled_at NULL, started_at, ended_at,
  host_id, lobby_enabled, locked, recording_enabled, room_name)
call_participants(call_id, user_id, joined_at, left_at, role,  -- host|cohost|attendee
  audio BOOL, video BOOL, screenshare BOOL, hand_raised BOOL)
meetings(meeting_id PK, call_id, title, organizer_id, invitees JSONB, ical_uid)
```
```text
Signaling (WebSocket via call-service):
  create/join room → LiveKit access token (scoped) → client connects to SFU
  offer/answer/ICE relayed; coturn for NAT; LiveKit forwards media (simulcast)
  events: participant.joined/left, mute, hand-raise, screenshare → realtime-gw fan-out
Recording: LiveKit Egress → MinIO (composite + per-track)
Transcription: track audio → Whisper (self-hosted) → live captions + stored transcript → indexed
Lobby: joiners wait; host admits. Breakout: sub-rooms; reassign participants.
```

---

## B13. Search Service (LLD)
- Consumes Kafka → upserts into OpenSearch indexes (`messages`, `files`, `users`, `channels`); deletes on `message.deleted`.
- Each doc carries `tenant_id` + `channel_id` + `acl` (member set or visibility) for **query-time permission filtering**.
- Query: parse `from:/in:/has:/before:` → BM25 + filters + highlight; inject caller's accessible-channel filter server-side.
- Personal E2EE excluded (indexed only on-device).

---

## B14. Status / Stories — see §B8 (co-located with presence).

## B15. Threads, Reactions, Edits, Deletes, Disappearing (LLD)
- **Thread:** message with `thread_root` set; thread reply count + participants tracked; `thread.replied` notifies followers.
- **Reaction:** `reactions` map on message; add/remove emits `message.reaction.*`; idempotent per (user,emoji).
- **Edit:** set `content`, append to `edit_history`, set `edited_at`; emit `message.edited`; search reindex; clients show "edited".
- **Delete:** *for me* = client-local hide; *for everyone* = tombstone (content cleared, `deleted=true`), emit `message.deleted`, all devices + search purge.
- **Disappearing:** `ephemeral_ttl` set per conversation; Mongo **TTL index** auto-expires; clients also enforce locally; new joiners don't get pre-join history.
- **Scheduled:** stored with `send_at`; automation/cron worker releases at time → normal send path.
- **Pin/Star:** pin = conversation-scoped (`pins` per conv, admin-gated in channels); star/save = per-user list.

## B16. Polls (LLD)
```sql poll(message_id, options JSONB, multi BOOL, anonymous BOOL, closes_at)
     poll_votes(message_id, option_id, user_id) ```
Vote emits realtime update; tallies cached in Valkey; anonymous hides voter ids from non-admins.

## B17. Slash Commands, Bots, Workflows (LLD)
```sql bots(bot_id PK, workspace_id, name, token_hash, scopes, webhook_url)
     slash_commands(command, workspace_id, bot_id, description)
     workflows(workflow_id, workspace_id, trigger JSONB, steps JSONB, enabled)
     webhooks_outbound(id, bot_id, event_filter, url, secret) ```
- Slash command → automation-service validates → dispatches to bot webhook (HMAC-signed) → bot replies (ephemeral or channel) / opens modal (block-kit).
- Workflow engine: trigger (message/keyword/schedule/form) → ordered steps (post message, call webhook, branch) → durable job runner (Valkey/Postgres queue, retries).
- Reminders (`/remind`) → scheduled job → notification.

## B18. Rate Limiting (LLD)
- Token-bucket in Valkey at gateway (per-user, per-IP) + per-feature (OTP attempts, message burst, media upload, login). Returns `429` + `Retry-After`. Abuse → temp lockout + alert.


---

## B19. Consolidated Data Store Map

```text
PostgreSQL : users_auth, devices, refresh_tokens, signal_prekeys, totp_secrets,
             profiles, contacts, organizations, workspaces, teams, memberships,
             roles_permissions, conversations(meta), conversation_members,
             communities, status_posts/status_views(meta), notification_prefs,
             push_endpoints, calls, call_participants, meetings, bots,
             slash_commands, workflows, webhooks, media_objects(meta), audit_log
MongoDB    : messages, threads, receipts, reactions, activity_logs
Valkey     : online:{u}, lastseen:{u}, presence:{u}, status:{u}, subscribers:{u},
             typing:{conv}, conn:{u}, pod:{pod} (pubsub), seq:{conv}, unread:{u}:{conv},
             otp:{phone}, ratelimit:*, recent:{conv} (msg cache), authz cache, jobs
OpenSearch : messages, files, users, channels (with acl/tenant fields)
MinIO      : media-original, media-renditions, recordings, exports, backups
```

---

## B20. Language & Translation (LLD)

```sql
user_language(account_id PK, ui_lang, preferred_msg_lang, auto_translate BOOL,
              caption_lang NULL, voice_lang NULL)
chat_translate_pref(account_id, conversation_id, mode,   -- off|auto|manual
                    target_lang, PRIMARY KEY(account_id, conversation_id))
```
- **Models (self-hosted, free):** NLLB/Marian/OpusMT (text), Whisper (STT), Piper/Coqui (TTS), fastText/CLD3 (language detect). Served via ai-service on GPU pool (enterprise) and as compact distilled models on-device (personal E2EE).
- **Translation cache (Valkey/OpenSearch):** key `xlate:{sha(text)}:{src}:{tgt}` → reuse; makes repeat views free.
- **Chat — enterprise:** on `message.sent`, ai-service detects language; if a viewer's pref differs, translate lazily on first view (or eagerly for active channels) and cache; client shows translated + "show original".
- **Chat — personal (E2EE):** client decrypts → on-device model translates → renders. Server never involved. Auto/manual toggle is purely client-side over decrypted text.
- **Real-time call (enterprise):** LiveKit per-track audio → Whisper streaming (partial/final) → NLLB translate per listener language → caption pushed via realtime-gw; optional Piper TTS track. Per-listener language selection.
- **Real-time call (personal E2EE):** STT + translate run on-device on the local decrypted stream; captions stay local; opt-in for capable devices.
- **Transcript translation:** stored transcript (enterprise) re-translated on demand, cached.
- **No-loophole guarantee:** translation never reads plaintext it isn't already allowed to read — personal stays on-device, enterprise stays server-side. Same boundary as search (§A18) and AI (§A25).

Every major user action, end to end. (Notation: `→` sync call, `⇒` Kafka event, `↯` WebSocket push.)

### C1. Registration + first device (cold start, ₹0 via Reverse-OTP)
```text
Client → auth: enter phone → auth issues {session_id, token, target DID} [Valkey revotp:{sid}]
Client (user action): MISSED CALL to DID  OR  send pre-filled SMS "<token>" to DID
   → user's own plan pays; our server only RECEIVES (cost ≈ ₹0)
Asterisk/FreeSWITCH gateway → auth: {caller_id|sender, token}
auth verifies: CLI==entered number  +  token+time-window  +  real-mobile origination
               +  device attestation (Play Integrity/App Attest)  +  risk score OK
auth: create account_id + verified phone identifier + device key + passkey
auth → client: access + refresh (DPoP device-bound)
Client → auth: publish Signal prekey bundle
Client → user: create profile ⇒ user.created
Client → contacts upload (hashed phone numbers) → matches returned
Fallback if Reverse-OTP fails: email magic-link (limited tier) OR rare server-SMS OTP (full).
[After this one event, future logins use the device key/passkey — never verify phone again.]
```

### C2. Send 1:1 message (E2EE), recipient OFFLINE
```text
Sender app: write to local outbox (client_msg_id), show "sending"
Sender: fetch recipient device prekey bundles (if no session) → X3DH
Sender: Double-Ratchet encrypt per recipient device + per own other devices
Sender → chat: SendMessage(ciphertext[], client_msg_id)
chat: dedupe → assign seq → store (Mongo, content=ciphertext) ⇒ message.sent
chat → sender: ACK {message_id, seq} → outbox marks "sent" (single tick)
realtime-gw consumes message.sent → recipient offline (no conn) → nothing to push
notification consumes → recipient offline → push (APNs/FCM) "New message" (NO content)
--- later: recipient opens app ---
recipient device connects (WSS) with sync cursor → chat replays missed seq →
recipient ratchet-decrypts → renders → sends delivered receipt
⇒ message.delivered → chat updates → ↯ sender shows double tick
recipient views → read up-to seq → ⇒ message.read → ↯ sender shows blue ticks
```

### C3. Send channel message (enterprise, server-readable) + @mention
```text
Sender → chat: SendMessage(plaintext, mentions=[@bob,@here])
chat: membership check → seq → store (plaintext) ⇒ message.sent ⇒ mention.created(bob)
realtime-gw → push ↯ to all ONLINE channel members
search indexes the message (tenant+acl)
notification: for @bob (offline) → push; others per their notif level (all/mentions/none)
```

### C4. Typing indicator
```text
Sender app (debounced) → realtime-gw: typing.start(conv)
realtime-gw: set typing:{conv} (TTL 5s) ⇒ fan-out ↯ to online members "X is typing"
auto-expire after 5s or on message send/stop
```

### C5. Presence online → offline + last-seen
```text
Device connects → realtime-gw registers conn ⇒ user.online
presence: online:{u} += device; ↯ to subscribers:{u}
heartbeat refreshes TTL; all devices disconnect → grace timer → ⇒ user.offline
presence: set lastseen:{u}=now; ↯ to subscribers (if privacy allows)
```

### C6. Multi-device: link a new device (free — no OTP)
```text
Preferred: passkey (platform-synced) → instant, free, phishing-proof
Or: new device shows QR → existing TRUSTED device scans → signs an approval token
auth: verify approval signature → register new device + its Signal identity (free, no OTP)
new device publishes prekeys
History: existing device sends E2EE history bundle device-to-device
Going forward: senders include new device in per-device fan-out → full sync via cursor
Reverse-OTP only if the account has NO other anchor (no trusted device, no passkey, no email).
```

### C7. Group message (Sender Keys)
```text
First time: each member distributes sender key to others over pairwise E2EE
Send: encrypt once with sender key → chat stores ciphertext ⇒ message.sent
realtime-gw fans to online members; offline → push; members decrypt with sender's key
Member removed → new epoch → sender keys rotated (removed member can't read new msgs)
```

### C8. 1:1 / group call (WebRTC SFU)
```text
Caller → call: CreateRoom(callee) → call ⇒ call.started → notification → VoIP push ↯ callee rings
Both → call: get LiveKit token → connect to SFU; ICE via coturn (STUN/TURN)
Media flows peer→SFU→peers (simulcast). Signaling (mute, hand-raise) via realtime-gw
Hang up → ⇒ call.ended → call log written; (enterprise) recording→MinIO, audio→Whisper transcript
```

### C9. Scheduled meeting join + lobby
```text
Organizer → call: schedule ⇒ meeting.scheduled → notification + iCal invite (join link)
Attendee opens link → call: join → if lobby_enabled → wait → host admits → SFU token → connected
Breakout: host creates sub-rooms → reassign participants → recombine
```

### C10. Media upload + send (E2EE personal)
```text
Client → media: init resumable upload → signed MinIO multipart URLs
Client: encrypt file (random key) → upload ciphertext (chunked, resumable) → complete
media: ClamAV scan → (E2EE: no transcode) → ready ⇒ file.uploaded
Client → chat: send message with media_id + decrypt key (inside E2EE payload)
Recipient: download ciphertext (signed URL) → decrypt with key from message
```

### C11. Status/story post + view
```text
Author → presence: post status(media, audience, 24h) ⇒ status.posted → ↯ contacts in audience
Viewer → fetch statuses (audience-filtered) → view → record status_views
Author → sees viewer list; reply → creates 1:1 message
TTL 24h → auto-expire
```

### C12. Push notification when offline (privacy-preserving)
```text
message.sent → notification: recipient offline → build payload:
   E2EE personal: {type:"message", conv_id} ONLY — no content
   enterprise: may include sender + preview per org policy
→ APNs/FCM/WebPush → device wakes → fetches & (personal) decrypts locally → shows notif
```

### C13. Global search (enterprise) with ACL
```text
User → search: query "in:#eng has:file budget"
search: parse filters → OpenSearch query + INJECT caller's accessible-channel filter
→ ranked, highlighted results (only channels user can access) → return
(personal E2EE msgs: searched on-device against local SQLite index instead)
```

### C14. Slash command / bot interaction
```text
User types /poll → automation: validate command → POST signed webhook to bot
bot → automation: respond with block-kit modal → ↯ user sees modal
user submits → automation → bot → posts poll message to channel (normal send path)
```

### C15. Message edit & delete propagation
```text
Edit: chat updates content + edit_history ⇒ message.edited → ↯ all devices + search reindex → "edited"
Delete-for-everyone: chat tombstones ⇒ message.deleted → ↯ all devices clear it + search purge
```

### C16. Reconnect after network drop (no message loss)
```text
Socket drops → client buffers outbox locally, retries
Reconnect (WSS) with last sync cursors → chat replays all missed seq/edits/deletes/receipts
Client applies idempotently to local SQLite → UI consistent; outbox flushes pending sends
```

### C17. Phone-number change (safe migrate, ₹0, no recycled-number takeover)
```text
Precondition: logged in on a TRUSTED device (proves control of OLD account)
User → auth: change number → enter NEW number
auth: Reverse-OTP verify NEW number (₹0)  [missed-call / user-SMS]
auth: require BOTH active trusted session AND new-number proof
auth: if NEW number already active elsewhere → block/merge
auth: atomically re-point identifiers(phone) to NEW value on SAME account_id
      (chats/keys/data untouched — keyed on account_id, not the number)
⇒ notify contacts "X changed number"; OLD number released after cooldown
Later registrant of OLD number → FRESH account_id, zero access to old data.
```

### C18. Account recovery (multi-factor, delayed, notified — no weak back door)
```text
User → auth: recover (lost device)
auth: require ANY TWO of {passkey, trusted-device approval, email link, backup code, Reverse-OTP}
auth: high-risk → enforce time-delay (24–72h) + notify ALL channels (email+push+devices)
auth: on success → provision new device key + passkey; SMS/Reverse-OTP counts as ONLY ONE factor
auth: cooling-off before sensitive actions (number change, disabling 2FA)
[No single free channel ever grants full access alone — this is the deliberate anti-loophole.]
```

### C19. Chat translation (auto + manual; E2EE stays on-device)
```text
PERSONAL (E2EE):
  message arrives → client decrypts → detect lang
  auto mode ON & lang≠pref → on-device model translates → show translated + "show original"
  manual → user taps "Translate" → on-device translate → show beneath original
  (server NEVER sees plaintext — full E2EE preserved)
ENTERPRISE (server-readable):
  message.sent → ai-service detect lang → on first view in a different pref lang:
     check cache xlate:{hash}:{src}:{tgt} → hit: instant; miss: NLLB translate + cache
  ↯ translated text to client with "show original" toggle
```

### C20. Real-time call/meeting translation (multi-language, live)
```text
ENTERPRISE meeting:
  each speaker's LiveKit track → Whisper streaming STT (partial→final)
  → for each listener's chosen language: NLLB translate
  → ↯ translated CAPTION via realtime-gw to that listener (their language)
  → (optional) Piper TTS → translated audio track mixed for that listener
  one meeting → many listeners → each sees/hears their own language simultaneously
  post-call: transcript stored, re-translatable on demand (cached)
PERSONAL E2EE call:
  STT + translate run ON-DEVICE on locally-decrypted audio → captions stay local
  (server forwards only encrypted media; opt-in for capable devices)
```

### C21. E2EE chat backup & restore (server can't read it)
```text
Backup (periodic / manual):
  client bundles local chats+media keys → encrypts with a backup key derived from a
  user passphrase OR a 64-digit recovery key (Argon2id KDF) → uploads CIPHERTEXT to MinIO
  server stores only ciphertext + metadata; NEVER the passphrase/key
Restore (new device / reinstall):
  user authenticates (DAPT) → downloads encrypted backup → enters passphrase/recovery key
  → client derives key → decrypts locally → rehydrates local SQLite + media
Lost passphrase = unrecoverable backup (by design — true E2EE; warn user, encourage recovery key)
```

### C22. View-once media lifecycle (one view, then gone)
```text
Sender marks media view_once → (personal) E2EE encrypt → upload ciphertext
Recipient opens → client decrypts → renders with screenshot-block UI → on close:
  client deletes local copy → sends "viewed" → chat tombstones the attachment
  ⇒ media-service deletes the blob (content-hash refcount → 0)
Replay-proof: key is single-use; server enforces one successful fetch then 410 Gone
```


---

# PART D — APPENDICES

## D1. Free / Open-Source Tech Stack (final)

| Layer | Technology | License | Cost |
|-------|-----------|---------|------|
| Mobile | React Native, TypeScript | MIT | free |
| Web | React, TypeScript, Vite | MIT | free |
| Desktop | Electron | MIT | free |
| State | Zustand, TanStack Query | MIT | free |
| Local DB | SQLite (WatermelonDB / op-sqlite / wa-sqlite) | MIT/Public | free |
| Backend | NestJS, Node.js | MIT | free |
| RPC | gRPC, Protocol Buffers | Apache-2.0/BSD | free |
| Events | Apache Kafka (or Redpanda OSS / NATS JetStream) | Apache-2.0 | free |
| Schema registry | Apicurio (or Confluent OSS) | Apache-2.0 | free |
| Relational | PostgreSQL (+ Patroni/CloudNativePG, PgBouncer) | PostgreSQL/MIT | free |
| Document | MongoDB Community (or FerretDB) | SSPL/Apache | free self-host |
| Cache/KV | Valkey | BSD-3 | free |
| Search | OpenSearch | Apache-2.0 | free |
| Object store | MinIO | AGPL-3.0 | free |
| SFU | LiveKit (or mediasoup) | Apache-2.0 | free |
| STUN/TURN | coturn | BSD | free |
| E2EE | libsignal | AGPL/GPL | free |
| Transcode | ffmpeg | LGPL/GPL | free |
| AV scan | ClamAV | GPL | free |
| Transcription | Whisper (self-hosted) | MIT | free |
| LLM/translate | Llama/Mistral-class via vLLM/Ollama, NLLB/Marian | open | free |
| SSO | Keycloak | Apache-2.0 | free |
| Gateway | Envoy + Kong OSS | Apache-2.0 | free |
| Ingress/TLS | Traefik/Nginx + cert-manager + Let's Encrypt | various OSS | free |
| Mesh | Linkerd (or Istio) | Apache-2.0 | free |
| Orchestration | Kubernetes / k3s, Helm, ArgoCD | Apache-2.0 | free |
| Secrets | Vault OSS / Sealed Secrets | MPL/Apache | free |
| Metrics | Prometheus + Grafana | Apache/AGPL | free |
| Logs | Loki | AGPL | free |
| Traces | Tempo + OpenTelemetry | Apache-2.0 | free |
| Errors | GlitchTip | MIT | free |
| CI | Woodpecker/Drone (or GitHub Actions free) | Apache-2.0 | free |
| Registry | Harbor / Gitea registry | Apache-2.0 | free |
| Image build/scan | Buildah/Kaniko, Trivy, cosign | Apache-2.0 | free |
| Email | Postfix (SMTP) | IBM-PL | free |
| Web push | Web Push / VAPID standard, ntfy | open/Apache | free |
| Mobile push transport | APNs / FCM | — | free of charge (not self-hostable — §A3.5) |

## D2. Non-Functional Requirements / SLOs

| Concern | Target |
|---------|--------|
| Message send→delivered (recipient online) | p99 < 1s |
| API availability | 99.95% |
| Realtime gateway uptime | 99.95%, graceful drain |
| Call join success | > 99% |
| Push delivery (offline) | p95 < 5s |
| Search query | p95 < 300ms |
| RPO / RTO | ≤ 5 min / ≤ 30 min |
| Message durability | replicated, no loss on broker/socket failure |
| Concurrent sockets | millions (horizontal realtime-gw) |

## D3. Monorepo Layout

```text
apps/
  api-gateway/  realtime-gateway/  auth-service/  user-service/
  chat-service/  group-channel-service/  presence-service/
  notification-service/  media-service/  search-service/
  call-service/  automation-service/  ai-service/
clients/
  mobile/ (React Native)   web/ (React)   desktop/ (Electron)   admin/ (React)
packages/
  proto/         # .proto contracts (source of truth)
  shared-types/  # generated TS types
  shared-utils/  # logging, tracing, auth guards, kafka client, idempotency
  crypto/        # libsignal wrappers (shared client)
  ui/            # design system + block-kit renderer
  config/        # env schema, feature flags
deploy/
  helm/  argocd/  k8s/   # GitOps config (no secrets)
infra/
  terraform/ (cluster), migrations/, observability/
```
Tooling: pnpm workspaces + Turborepo (both free); buf for proto generation.

## D4. Threat Model (every situational case covered)

| Threat | Mitigation |
|--------|-----------|
| Eavesdropping on personal chats | E2EE (Signal), server only sees ciphertext |
| Server breach reading content | E2EE personal; enterprise encrypted at rest; key separation |
| Account takeover (general) | account_id identity, DAPT, rotating refresh + reuse detection, device-bound (DPoP) tokens, device list + revoke |
| **SIM-swap** | SMS never a sole factor; device-key + passkey + email required; SIM-change risk flag → step-up |
| **SS7 / SMS interception** | Non-SMS channels primary; OTP short-TTL + session-bound; Reverse-OTP needs genuine handset+attestation |
| **Caller-ID / SMS-sender spoofing (Reverse-OTP)** | Reject VoIP/SIP-gateway origination; require device attestation; token+time-window bound to the live session |
| **OTP phishing / real-time relay** | Passkey origin-bound (phish-proof); OTP bound to requesting session; show login context |
| **OTP brute force** | 5-attempt limit, exponential backoff, lockout, short-TTL token |
| **OTP / SMS pumping (budget drain)** | Proof-of-work/invisible CAPTCHA before any server-SMS; per-IP/device/prefix rate limits; high-risk range block; anomaly alerts |
| **Sybil / multiple-email mass accounts** | Consumer signup needs verified phone (1 number = 1 account); device attestation; VoIP/disposable block; enterprise invite/SSO only |
| **Recycled phone number takeover** | Identity = account_id (not number); recycled number → fresh account; dormant reclaim with delay + notify |
| **Stolen / lost device** | Device key in secure enclave (non-exportable), biometric/PIN gate, remote revoke, re-auth for sensitive actions |
| **Email-account compromise** | Email alone never grants full takeover of phone-anchored account; step-up + cooling-off + notify-all-channels |
| **Refresh-token theft** | Rotating refresh + reuse detection + DPoP device binding → stolen token useless elsewhere |
| **Recovery back-door abuse** | Recovery = 2+ factors + time-delay + notify-all; no single free channel grants access |
| **Concurrent device-link race** | Server-side state machine + atomic ops + idempotency keys |
| MITM key swap (E2EE) | safety-number verification, key-change warnings |
| Spam / flooding | rate limits, abuse detection, block/report |
| Malware upload | ClamAV scan before download, content-type validation |
| Unauthorized data access | RBAC per tenant, query-time ACL, NetworkPolicy, mTLS |
| Replay / dup events | idempotency keys + consumer dedupe |
| DoS | gateway rate limit, autoscale, circuit breakers |
| Privacy leakage in push | no content in E2EE push payloads |
| Insider/compliance | append-only audit log, legal hold, scoped admin access |

## D5. Feature → Service → Flow Traceability (nothing missed)

| Feature area | Owning service(s) | Flow |
|--------------|-------------------|------|
| 1:1 / group / channel messaging | chat, group-channel | C2, C3, C7 |
| Threads | chat | §B15 |
| Reactions / edit / delete / pin / star | chat | C15, §B15 |
| Disappearing / scheduled / drafts | chat | §B15 |
| Read receipts / typing | chat, realtime-gw | C2, C4 |
| Mentions | chat, notification | C3 |
| Presence / last-seen / rich status | presence | C5, §B8 |
| Status / stories | presence | C11 |
| Voice / video / group calls | call | C8 |
| Meetings / lobby / breakout / recording / transcription | call, ai | C9 |
| Huddles | call | §A17 |
| Screen share / hand-raise / reactions in call | call, realtime-gw | C8, §A17 |
| Media share / voice notes / HLS / thumbnails | media | C10, §B11 |
| Files versioning / gallery | media, chat | §A16 |
| Orgs / workspaces / teams / channels / roles | user, group-channel | §B3, §B7 |
| SSO / SCIM / guest access | auth, user | §A14, §B2 |
| Admin / retention / legal hold / audit / DLP | user, ai, all | §A14 |
| Bots / slash commands / workflows / webhooks | automation | C14, §B17 |
| Polls | chat | §B16 |
| Communities / broadcast / announcement | group-channel | §B7 |
| Notifications / DND / digest / badges | notification | C12, §B10 |
| Search (global + per-chat, ACL) | search (+ on-device) | C13, §B13 |
| Multi-device sync / linking | auth, chat | C6, §B5 |
| **Auth: ₹0 OTP (Reverse-OTP) / cold start** | auth | C1, §A14.1, §B2.2 |
| **Phone-number change (safe migrate)** | auth, user | C17, §B2.6 |
| **Account recovery (no back-door)** | auth | C18, §B2.7 |
| **Sybil / fake-account defense** | auth | §A14.1(4), §B2.8 |
| E2EE (1:1, group, media) | auth(keys), chat, clients | C2, C7, C10, §B6 |
| 2FA / device mgmt / privacy controls | auth, user | §B2, §A14 |
| Contacts (hashed discovery) / block | user | §B3 |
| AI: summary / translate / smart search / moderation | ai | §A25 |
| **Status / Stories (text/image/video/voice, E2EE, reactions, view-once, archive)** | presence | C11, §B8 |
| **Language & chat translation (auto + manual)** | ai / on-device | C19, §A26, §B20 |
| **Real-time call/meeting translation (multi-language captions + TTS)** | call, ai / on-device | C20, §A26.3 |
| **View-once media / chat lock / pin-archive chat / notes-to-self** | chat | C22, §A4.1 |
| **E2EE chat backup & restore / chat export** | chat, media | C21, §A4.1 |
| **Whiteboard / canvas / clips / lists / live events / meeting recap** | call, automation, ai | §A4.4, §A4.7 |
| **Calendar integration / voicemail / out-of-office** | call, presence | §A4.4, §A4.2 |
| Offline / reconnect / no-loss delivery | chat, realtime-gw | C16 |

---

## D6. What Changed vs the Original Document (v1 → v2)

1. **Swapped non-free components** → MinIO, OpenSearch, Valkey, GlitchTip, coturn, self-hosted CI; documented the few unavoidable free-of-charge externals (APNs/FCM, SMS) honestly.
2. **Split realtime-gateway** out from api-gateway (sockets scale differently than RPS) and added **automation-service** + **ai-service**.
3. **Made the E2EE-vs-server-readable fork explicit** (personal = Signal E2EE; enterprise = server-readable for search/compliance/bots) — this is the central design decision the original didn't address.
4. **Added every missing feature**: threads, reactions, edits, deletes, pins, stars, disappearing, scheduled, drafts, polls, broadcast lists, communities, announcement channels, huddles, breakout rooms, recording, transcription, lobby, slash commands, bots, workflows, webhooks, custom emoji, status/stories with audiences, rich Teams presence, link previews, location/contact sharing.
5. **Added real engineering depth**: schemas (Postgres DDL, Mongo docs, Valkey keys), token design + refresh rotation/reuse detection, message ordering via per-conversation `seq`, idempotency, multi-device sender-side fan-out, presence subscription fan-out, backpressure, capacity numbers, SLOs, DR/RPO/RTO.
6. **Added 18 end-to-end process flows** (Part C) including the hard ones: offline delivery, multi-device link, group sender-key rotation, reconnect-without-loss, privacy-preserving push.
7. **Added traceability matrix** so every feature provably maps to a service and a flow.

## D7. What Changed in v2.1 (authentication hardening)

1. **₹0-per-user OTP via "Reverse-OTP"** — verification is user-initiated (missed-call / user-SMS to a self-hosted Asterisk/FreeSWITCH DID), so the user's free plan bears transport and the server pays nothing per verification; only a fixed inbound-number rental remains. Server-sent SMS is now a rare last-resort fallback. (§A3.5, §A14.1, §B2.2, C1)
2. **Identity = immutable `account_id`; phone & email are re-verifiable attributes** — this single decision makes number-change, email-change and recycled-number handling safe and dissolves most loopholes. (§A14.1, §B2.1)
3. **Device-Anchored Progressive Trust (DAPT)** trust waterfall (device-key → passkey → approve-on-device → email → Reverse-OTP → SMS) so ~95% of auth events are free and frictionless and verification is once-per-user. (§A14.1, §B2.5, C6)
4. **Sybil / fake-account defense** — consumer signup requires a verified phone (1 number = 1 account) + device attestation (Play Integrity/App Attest) + VoIP/disposable-number block + rate/risk limits; enterprise is invite/SSO only. (§A14.1(4), §B2.8)
5. **Safe phone-number change** + **recycled-number protection** + **dormant-account reclaim**. (§B2.6, C17)
6. **Recovery with no weak back-door** — multi-factor + time-delay + notify-all; no single free channel grants access. (§B2.7, C18)
7. **Anti-spoof rule set for Reverse-OTP** (reject VoIP origination, attestation, session/time binding) + **DPoP device-bound tokens**. (§B2.2, §B2.3)
8. **Expanded threat model** to cover every situational auth case (SIM-swap, SS7, caller-ID spoof, phishing/relay, brute force, pumping, recycled number, stolen device, email compromise, token theft, link race). (§D4)

## D8. What Changed in v2.2 (status, translation, completeness pass)

1. **Status / Stories upgraded to full WhatsApp parity** — text/image/video/**voice** status, captions/music/mentions, **reactions**, reply, **view-once**, viewer list + counts, audience modes (contacts/except/only), mute, archive, **E2EE for personal**. (§A4.3, §B8, C11)
2. **Language & Translation added as a first-class capability (§A26, §B20):**
   - UI localization (i18n) + RTL + per-user language + auto language detection.
   - **Chat translation — Auto mode** (inline auto-translate + "show original") and **Manual mode** (tap-to-translate). 
   - **Real-time call/meeting translation** — live translated captions per listener language + optional TTS voice; transcript re-translation.
   - All on **free self-hosted models** (NLLB/Marian, Whisper, Piper, fastText).
   - **No-loophole privacy fork:** personal E2EE translation runs **on-device** (server never sees plaintext); enterprise runs server-side. (C19, C20)
3. **Completeness pass — added remaining WhatsApp/Teams/Slack features:** view-once media, chat lock, pin/archive chat, notes-to-self, E2EE chat backup & restore, chat export, kept messages, QR-contact, wallpapers; whiteboard, together/spotlight layouts, meeting recap & notes, live events/town halls, calendar integration, voicemail, in-meeting chat, out-of-office auto-reply; Slack canvas, clips, lists, approvals.
4. **Traceability matrix + TOC updated** so every new feature maps to a service and a flow.

## D9. What Changed in v2.3 (build harness + final flows)

1. **Added Part E — Claude Code Build Roles:** a ready-to-use `.claude/` setup with a master CLAUDE.md (non-negotiable rules) and **8 subagents** (backend, realtime, frontend-web, mobile, platform/devops, security/E2EE, AI/translation, QA) plus orchestration guardrails — so the project can be built at industry/production level directly with Claude Code.
2. **Added remaining flows with mechanics:** C21 (E2EE chat backup & restore — server can't read), C22 (view-once media lifecycle — one view then deleted, replay-proof). Now **22 end-to-end flows**.
3. **Verified completeness** against WhatsApp + Teams + Slack; every catalog feature maps to a service and a flow (§D5).

---

# PART E — CLAUDE CODE BUILD ROLES (industry/production setup)

This part turns the architecture into an **executable build harness for Claude Code**. Claude Code reads persistent project instructions from **CLAUDE.md** and supports **subagents** — specialized assistants that run in their own context window with their own prompt, tool access and permissions, and that Claude delegates to when a task matches their description. (Refs: https://code.claude.com/docs/en/memory and the Claude Code subagents docs.)

## E0. Repo wiring (`.claude/` layout)

```text
<repo-root>/
├── CLAUDE.md                      # master project context (E1) — keep it short
├── docs/
│   └── VelChat-Architecture.md  # THIS document (source of truth)
├── .claude/
│   ├── rules/                     # path-scoped behaviors (short)
│   │   ├── backend.md  frontend.md  mobile.md  security.md  infra.md
│   ├── agents/                    # subagents (one role each, ~30–60 lines)
│   │   ├── backend-engineer.md
│   │   ├── realtime-engineer.md
│   │   ├── frontend-web-engineer.md
│   │   ├── mobile-engineer.md
│   │   ├── platform-devops-engineer.md
│   │   ├── security-e2ee-engineer.md
│   │   ├── ai-translation-engineer.md
│   │   └── qa-test-engineer.md
│   └── settings.json              # tool/permission/model config + hooks
└── .mcp.json                      # MCP servers if used
```
- Run `/init` once to bootstrap CLAUDE.md, then paste the roles below into `.claude/agents/`.
- In CLAUDE.md you can pull in this doc with `@docs/VelChat-Architecture.md` so every agent shares the same source of truth.
- Keep CLAUDE.md lean; put detail in this architecture doc; keep each subagent focused.

## E1. Master `CLAUDE.md` (project context — non-negotiables)

```md
# VelChat — Engineering Context
Source of truth: @docs/VelChat-Architecture.md  (read it; never contradict it)

## What we are building
A free, 100% open-source, self-hostable hybrid of WhatsApp + Microsoft Teams + Slack.
Production-grade, multi-tenant, real-time, end-to-end encrypted (personal).

## Non-negotiable rules (apply to ALL code)
1. FREE/OSS ONLY. No paid SaaS in the critical path. Approved stack: NestJS, gRPC, Kafka,
   PostgreSQL, MongoDB, Valkey, OpenSearch, MinIO, LiveKit, coturn, libsignal, Keycloak,
   Whisper/NLLB/Piper, K8s, Prometheus/Grafana/Loki/Tempo. (See §D1.)
2. E2EE BOUNDARY IS SACRED. Personal chats/calls/status/media/translation/search/AI run so
   the server NEVER sees plaintext (on-device). Enterprise content is server-readable by design.
   Never add a path that leaks personal plaintext to the server.
3. IDENTITY = immutable account_id (UUID). phone/email are re-verifiable attributes. Never key
   data on phone number.
4. AUTH = DAPT (§A14.1/§B2): device-key + passkey trust loop; Reverse-OTP for ₹0 cold start;
   server-SMS only rare fallback. Tokens device-bound (DPoP), rotating refresh + reuse detection.
5. SECURITY: no secrets in code/images (Vault/Sealed Secrets); validate all input; parameterized
   queries; mTLS service-to-service; rate-limit + attestation on auth.
6. RELIABILITY: at-least-once + idempotency (client_msg_id / consumer dedupe); ordering via
   per-conversation seq; every state change emits a Kafka event (§A11).
7. OBSERVABILITY: structured logs (no PII/no message content), OpenTelemetry trace propagation,
   RED metrics per service.

## Conventions
- TypeScript everywhere; proto is the contract source (buf). pnpm + Turborepo monorepo (§D3).
- IDs = ULID/UUIDv7. Time = server UTC. Cursor pagination only.
- Tests required (unit + integration via testcontainers) before "done". Conventional Commits.
- Definition of Done: builds, lints, types, tests green; migration is expand/contract; docs/proto
  updated; trace+metrics added; security checklist passed.

## How to work
- Match the task to a subagent in .claude/agents/. Stay within the architecture doc.
- Ask before introducing any new dependency or breaking a contract.
```

## E2. Subagent — Backend Engineer (services & data)

```md
---
name: backend-engineer
description: Builds NestJS microservices (auth, user, chat, group-channel, notification,
  media, search, call, automation). Owns gRPC contracts, DB schemas, Kafka producers/consumers,
  business logic. Use for any server-side service work except realtime-gateway and AI.
tools: Read, Edit, Write, Bash, Grep
---
You are a Staff backend engineer (10y) on VelChat. Follow @docs/VelChat-Architecture.md.

Mission: implement production-grade microservices exactly per §A8/§B*. Each service is stateless,
owns its data, talks gRPC (mTLS) sync + Kafka async, and emits an event for every state change.

Rules:
- One service owns each table/collection (§A10). No cross-service DB access — gRPC or event projection.
- Hot paths do the minimum sync work then emit Kafka (e.g. send-message §B4.2). Keep p99 low.
- Idempotency everywhere (client_msg_id, consumer dedupe, DLQs). Ordering via conversation seq.
- Schemas exactly per §B (Postgres DDL, Mongo docs, Valkey keys). Migrations expand/contract.
- NEVER read/store personal plaintext. Enterprise content is server-readable.
Definition of done: proto updated, unit+integration tests (testcontainers) green, metrics+traces
added, error handling + rate limits in place, no secret in code.
```

## E3. Subagent — Realtime & Messaging Engineer

```md
---
name: realtime-engineer
description: Owns the WebSocket realtime-gateway, presence fan-out, typing, delivery/receipts,
  connection registry, backpressure, reconnect/sync-cursor. Use for anything live/socket-based.
tools: Read, Edit, Write, Bash, Grep
---
You are a Staff realtime systems engineer on VelChat. Follow §A12.2/§A15/§B8/§B9.

Mission: deliver "instant" — millions of concurrent WebSocket connections, sub-second delivery,
no message loss on socket drop.
Rules:
- Connection registry in Valkey (conn:{user}, pod pub/sub). Stateless pods, horizontal scale.
- Durable messages never dropped; coalesce/drop only ephemeral (typing/presence) under backpressure.
- Reconnect replays missed seq via sync cursor (§B5). Presence fan-out only to subscribers (§A15.2).
- Graceful SIGTERM drain → clients reconnect. Heartbeats drive online/offline with grace window.
Definition of done: load-tested (k6/artillery), reconnect-without-loss proven, metrics on
concurrent conns + delivery latency p50/p99.
```

## E4. Subagent — Frontend Web Engineer (React)

```md
---
name: frontend-web-engineer
description: Builds the React web app + admin portal — chat UI, channels, calls, status,
  translation UI, block-kit renderer, offline-first local store, WebSocket sync. Use for web UI.
tools: Read, Edit, Write, Bash, Grep
---
You are a Senior frontend engineer (10y) on VelChat. Follow §A7.3 and the frontend-design skill.

Mission: a fast, offline-first, accessible web client at WhatsApp/Slack quality.
Rules:
- Offline-first: local SQLite-WASM/IndexedDB store + outbox; render from local, sync in background.
- State: Zustand + TanStack Query. Sync engine in a Web Worker; crypto (libsignal wasm) in a worker.
- E2EE in the client: decrypt locally; translation auto/manual for personal runs ON-DEVICE.
- i18n + RTL; accessibility (WCAG AA); optimistic UI with client_msg_id; cursor pagination.
- Web push via VAPID service worker. No browser localStorage for sensitive keys (IndexedDB, non-extractable where possible).
Definition of done: responsive, a11y-checked, error/empty/loading states, no key material leaked,
component tests + e2e (Playwright) for core flows.
```

## E5. Subagent — Mobile Engineer (React Native)

```md
---
name: mobile-engineer
description: Builds the React Native iOS/Android app — chat, calls (CallKit/ConnectionService),
  status, push (APNs/FCM), secure keystore, native WebRTC, background sync, Reverse-OTP UX.
tools: Read, Edit, Write, Bash, Grep
---
You are a Senior mobile engineer (10y) on VelChat. Follow §A7.2.

Mission: native-quality RN app matching WhatsApp UX.
Rules:
- Local SQLite (WatermelonDB/op-sqlite) + outbox; offline-first. Keys in Keychain/Keystore (enclave).
- Native: CallKit (iOS)/ConnectionService (Android) for system call UI; native WebRTC; SMS-Retriever
  + auto missed-call placement for friction-free Reverse-OTP (§B2.2); VoIP push for incoming calls.
- E2EE + on-device translation/STT for personal. Background message fetch; battery-aware.
- Device attestation (Play Integrity/App Attest) wired into auth enrollment.
Definition of done: works offline, handles reconnect, no plaintext/keys logged, tested on low-end
devices, store-compliant permissions.
```

## E6. Subagent — Platform / DevOps Engineer

```md
---
name: platform-devops-engineer
description: Owns Kubernetes/Helm/ArgoCD, the data tier (Postgres/Mongo/Valkey/Kafka/OpenSearch/
  MinIO operators), LiveKit/coturn, observability stack, CI/CD, secrets. Use for infra/deploy.
tools: Read, Edit, Write, Bash, Grep
---
You are a Staff platform engineer (10y) on VelChat. Follow §A21/§A22/§A24.

Mission: reproducible, secure, observable, zero-downtime infra — all free/OSS, self-hostable.
Rules:
- GitOps (ArgoCD); Helm charts; node pools per workload (mesh, memory, storage, network, GPU).
- StatefulSets via operators (CloudNativePG, Mongo, Valkey cluster, Kafka KRaft, OpenSearch, MinIO).
- mTLS (Linkerd), NetworkPolicy default-deny, Vault/Sealed Secrets, cert-manager + Let's Encrypt.
- Prometheus/Grafana/Loki/Tempo/GlitchTip; SLO burn alerts. PDBs, HPA, anti-affinity, graceful drain.
- CI: lint/type/test → build (Kaniko) → SBOM + Trivy + cosign → ArgoCD canary. Backups + DR (§A24).
Definition of done: dashboards + alerts exist, backup/restore tested, rollout is zero-downtime,
no secret in git, RPO≤5m/RTO≤30m validated.
```

## E7. Subagent — Security & E2EE Engineer

```md
---
name: security-e2ee-engineer
description: Owns authentication (DAPT, Reverse-OTP, attestation, tokens), Signal E2EE,
  key management, threat-model enforcement, abuse/Sybil defenses, audits every PR for leaks.
tools: Read, Edit, Write, Bash, Grep
---
You are a Staff security engineer (10y) on VelChat. Follow §A14/§B2/§B6/§D4. You have veto power.

Mission: zero loopholes. Enforce the threat model in §D4 on every change.
Rules:
- Identity = account_id; phone/email = re-verifiable attributes (no recycled-number takeover).
- DAPT waterfall; Reverse-OTP anti-spoof (reject VoIP origination + attestation + session/time bind);
  DPoP device-bound tokens; rotating refresh + reuse detection; recovery = multi-factor + delay + notify.
- Sybil: phone-mandatory consumer signup, 1 number = 1 account, attestation, VoIP/disposable block,
  rate-limit + proof-of-work before any server-SMS (anti-pumping).
- E2EE: libsignal X3DH + Double Ratchet; group sender-keys with epoch rotation; media + status + backup
  encrypted client-side. NO server path may ever see personal plaintext (chat/call/translate/search/AI).
Definition of done: each PR mapped against §D4; abuse + rate limits present; no plaintext/secret leak;
audit-log events emitted for security-relevant actions.
```

## E8. Subagent — AI / Translation Engineer

```md
---
name: ai-translation-engineer
description: Owns ai-service + on-device models — chat translation (auto/manual), real-time call
  translation (Whisper→NLLB→Piper), summaries, semantic search, moderation. Use for AI/ML/i18n.
tools: Read, Edit, Write, Bash, Grep
---
You are a Senior ML engineer (10y) on VelChat. Follow §A25/§A26/§B20.

Mission: free self-hosted intelligence + multilingual experience, respecting the E2EE boundary.
Rules:
- Models self-hosted only: NLLB/Marian (translate), Whisper (STT), Piper/Coqui (TTS), fastText (detect),
  open LLM via vLLM/Ollama (summary/assistant), embeddings + OpenSearch k-NN (semantic search).
- PRIVACY FORK (hard rule): personal E2EE → translation/STT/summarize run ON-DEVICE (compact models),
  server never sees plaintext. Enterprise → server-side in ai-service, cache xlate:{hash}:{src}:{tgt}.
- Real-time call: per-track streaming STT → per-listener translate → caption via realtime-gw → optional TTS.
- GPU pool, scale-to-zero when idle; aggressive caching; batch where possible.
Definition of done: latency budgets met (live captions), cache hit-rate tracked, no personal plaintext
server-side, graceful fallback when a model/GPU is unavailable.
```

## E9. Subagent — QA / Test Engineer

```md
---
name: qa-test-engineer
description: Builds the test pyramid — unit, integration (testcontainers), contract (proto),
  e2e (Playwright/Detox), load (k6), chaos, and security regression for the §D4 threat model.
tools: Read, Edit, Write, Bash, Grep
---
You are a Senior QA/SDET (10y) on VelChat.

Mission: prove correctness, performance, and security of every flow in Part C.
Rules:
- Cover the hard cases: offline delivery, reconnect-without-loss, multi-device sync, group sender-key
  rotation, number change, recovery, Reverse-OTP anti-spoof, view-once deletion, E2EE backup/restore,
  translation privacy (assert server never receives personal plaintext).
- Contract tests on every proto; idempotency + duplicate-event tests; ordering tests on seq.
- Load test realtime-gw (concurrent sockets) + chat throughput; chaos (broker/pod kill) in staging.
- Security regression: one test per §D4 row.
Definition of done: CI gates on coverage + green e2e for core flows; perf budgets enforced; flake-free.
```

## E10. Orchestration & guardrails (for the lead/main session)

- **Tech Lead behavior (main session):** decompose features into per-service tasks, delegate each to the
  matching subagent, integrate, and keep contracts (proto/events) consistent. Always reference this doc.
- **Build order:** platform/infra skeleton → auth (DAPT) → user/tenancy → chat + realtime → media →
  group/channel → presence/status → notifications → search → calls → translation/AI → automation → admin.
- **Definition of Done (global):** builds + lint + types + tests green; migration expand/contract;
  proto/docs updated; metrics + traces added; §D4 security checklist passed; no secret in code.
- **Hard guardrails (never cross):** no paid SaaS in critical path; never leak personal plaintext to the
  server; never key data on phone number; never put secrets in code/images; never break a published
  contract without a versioned migration.

---

# PART F — PHASED DELIVERY ROADMAP (backend / web / android / infra)

Built so the four tracks (Backend, Web, Android, Platform/Infra) move in lockstep against shared proto contracts. Each phase has a **vertical slice** that is demoable + tested before moving on. Map each task to the Part E subagent. Nothing is "done" until it passes the global Definition of Done (E1/E10).

> Tracks: **BE** = backend services · **WEB** = React web + admin · **AND** = Android/RN (and iOS shares the RN core) · **INF** = platform/devops/observability/security gates.

## Phase 0 — Foundations (no features, but everything depends on it)
- **INF:** monorepo (pnpm+Turborepo), `buf` proto pipeline, K8s/k3s cluster, ArgoCD GitOps, CI (lint/type/test/build/Trivy/cosign), base data tier (Postgres/Mongo/Valkey/Kafka/OpenSearch/MinIO operators), Linkerd mTLS, Vault, full observability (Prometheus/Grafana/Loki/Tempo/GlitchTip), Let's Encrypt.
- **BE:** shared libs (logging, tracing, kafka client, idempotency, auth guards), service skeleton + health/readiness, gRPC scaffolding.
- **WEB/AND:** app shell, design system, local SQLite store + outbox skeleton, WS client + reconnect/backoff, i18n framework, crypto worker stub (libsignal).
- **Exit:** a "hello" service deploys via GitOps with traces+metrics+logs visible; clients connect a WS and round-trip a ping.

## Phase 1 — Identity & Auth (DAPT)
- **BE:** auth-service — `accounts`/`identifiers`/`devices`/`passkeys`/`refresh_tokens` (§B2); Reverse-OTP gateway (Asterisk/FreeSWITCH) + anti-spoof; device-key challenge; passkey (WebAuthn); DPoP token binding; rotating refresh + reuse-detection; Keycloak SSO (enterprise); device attestation verify; user-service profiles + tenancy + RBAC.
- **WEB:** login/signup (passkey + email), device list, session mgmt, admin login.
- **AND:** Reverse-OTP UX (auto missed-call / SMS-Retriever), Keychain/Keystore key gen, attestation (Play Integrity/App Attest), biometric unlock.
- **INF:** WAF + rate-limit at gateway; secrets for SIP/DID; auth dashboards/alerts.
- **Exit:** new user onboards at ₹0 (Reverse-OTP), logs in on 2nd device free (passkey/approve), tokens device-bound; all §D4 auth rows have a passing security test.

## Phase 2 — Core 1:1 Messaging + E2EE + Realtime
- **BE:** chat-service (messages/receipts/seq/idempotency §B4), realtime-gateway (conn registry, fan-out, backpressure §B9), prekey directory; message.* events.
- **WEB/AND:** E2EE 1:1 (libsignal X3DH+ratchet), offline-first send (outbox + optimistic UI), delivery/read ticks, typing, reconnect-with-cursor (no loss), local search.
- **INF:** realtime-gw HPA on connections; load test (k6) reconnect storms.
- **Exit:** two devices exchange E2EE messages, work offline, reconnect with zero loss; p99 send→delivered < 1s online.

## Phase 3 — Groups + Multi-Device
- **BE:** group-channel-service (groups, membership, roles); sender-key distribution relay + per-device queueing; device-list epoch/versioning; multi-device fan-out routing.
- **WEB/AND:** group E2EE (sender keys + epoch rotation), multi-device link (QR + signed approval), per-device sync, decrypt-failure resend protocol (Part G §1).
- **Exit:** group of N across multiple devices each; member removed → can't read new msgs; offline device rejoins and back-fills; no permanent undecryptable under the resend protocol.

## Phase 4 — Media + Status + Backup
- **BE:** media-service (resumable upload, ffmpeg transcode, HLS, ClamAV, blurhash, content-hash dedupe); status (presence-service) ; E2EE backup blob store.
- **WEB/AND:** image/video/voice notes, view-once (C22), status/stories full (text/image/video/voice, reactions, audiences, viewer list), E2EE chat backup & restore (C21).
- **Exit:** E2EE media send/receive, view-once deletes + replay-proof, status posts expire at 24h, backup restores on a fresh device with recovery key.

## Phase 5 — Tenancy: Channels / Teams / Workspaces + Admin
- **BE:** org/workspace/team model, public/private channels, announcement/broadcast, communities; server-readable enterprise messages; admin APIs (retention, legal hold, audit, DLP); SCIM.
- **WEB:** workspace switching, channel UI, threads, admin portal (members/roles/retention/audit/compliance export).
- **AND:** workspace/channel UX, threads, mentions.
- **Exit:** invite-gated org with SSO; private-channel ACL enforced; admin can export + apply retention; threads work.

## Phase 6 — Calls & Meetings
- **BE/INF:** LiveKit SFU + coturn (TURN/STUN) on network node pool; call-service (signaling, rooms, lobby, recording Egress→MinIO).
- **WEB/AND:** 1:1 → group calls → meetings; screen share, raise-hand, reactions, grid/spotlight; CallKit/ConnectionService + VoIP push (AND); whiteboard; huddles; breakout rooms.
- **Exit:** stable 1:1 and 50-party meeting, recording saved, lock-screen incoming call rings, reconnection mid-call.

## Phase 7 — Search + Notifications + Rich Presence
- **BE:** search-service (OpenSearch indexer from Kafka + ACL query filter); notification-service hardened (outbox, retry/backoff, DLQ, dedup, DND, badges from server truth — Part G §4); rich presence + subscription fan-out.
- **WEB/AND:** global search with filters, on-device search for E2EE, notification prefs/DND, accurate unread/badges via cursor reconciliation.
- **Exit:** push is best-effort (never the source of truth); reconnect reconciles all missed; search respects ACL; presence storms bounded.

## Phase 8 — Translation & AI
- **BE/INF:** ai-service on GPU pool (Whisper, NLLB/Marian, Piper, embeddings, open LLM via vLLM/Ollama); translation cache.
- **WEB/AND:** chat translate auto+manual (on-device for personal, server for enterprise), real-time call captions per listener language (+TTS), meeting summaries/recap, semantic search, moderation (enterprise).
- **Exit:** live multilingual meeting captions; personal translation never leaves device; enterprise translations cached.

## Phase 9 — Automation + Communities + Polls + Collab
- **BE:** automation-service (bots, slash commands, interactive components, workflow engine, webhooks, reminders); polls; canvas/clips/lists.
- **WEB/AND:** slash UX, bot modals (block-kit), workflow builder, polls, canvas, clips.
- **Exit:** custom slash command round-trips to a bot; workflow trigger→action runs durably with retries.

## Phase 10 — Scale & Harden (cells, multi-region, DR) — apply Part G
- **INF/BE:** **cell architecture** (Part G §3), global routing/directory, cross-cell + cross-region, presence aggregation tier, reconnect admission control + load shedding, multi-region data residency, MirrorMaker, DR drills (RPO≤5m/RTO≤30m), key-transparency log (Part G §1), OPRF contact discovery (Part G §2).
- **Exit:** survive a cell/region outage with bounded blast radius; pass a reconnect-storm + partition chaos test; all Part G fixes shipped.

> **Ordering rule:** never start a phase until the prior phase's Exit + security gate is green. P0–P2 are the critical foundation; P10 hardening items can be designed early but are *operationally* required before a WhatsApp/Slack-scale launch.


---

# PART G — PRE-PRODUCTION HARDENING REVIEW

A critical, production-focused review (Principal/Staff+ lens) of the five highest-risk areas, ignoring MVP/scope. Severity scale: **S1** = data loss / permanent breakage / security breach; **S2** = degraded correctness/availability; **S3** = recoverable annoyance. Each issue: Problem · Failure scenario · User impact · Severity · Fix · State machine (where useful) · Edge cases · Scalability · Security · Final architecture.

## G1. End-to-End Encryption + Multi-Device

**Verdict:** the v2 design is correct in spirit but, as written, **messages can become permanently undecryptable** in several offline/rotation/corruption paths. The fixes below close that to near-zero with explicit recovery protocols, a versioned device list, and key transparency.

### G1-1 Permanent undecryptability (ratchet skip / lost session / consumed ciphertext) — **S1**
- **Problem:** Double Ratchet decrypts a ciphertext only with the matching chain key. If the chain advanced past it beyond the skipped-key bound, or the session/prekey is lost, the message is undecryptable forever.
- **Failure scenario:** device offline for weeks; sender's ratchet advanced thousands of steps; on return, old ciphertexts exceed `MAX_SKIP`.
- **User impact:** "Waiting for this message" forever; data loss.
- **Fix:** (a) **skipped-message-key cache** bounded but generous; (b) **server retains per-device ciphertext until that device ACKs** (bounded TTL, e.g. 30d) so it can be re-fetched; (c) a **decryption-failure resend protocol**: on undecryptable, recipient emits a `resend-request{conv, msg_id, ratchet_hint}` → sender re-encrypts the *current* plaintext in a fresh ratchet message → recipient decrypts; bounded retries; (d) **last-resort prekey** (PQXDH/Kyber last-resort) so X3DH never fails on prekey exhaustion.
- **State machine (per inbound message):** `RECEIVED_CT → DECRYPT_OK | DECRYPT_FAIL → RESEND_REQUESTED → (resend) → DECRYPT_OK | EXHAUSTED → UNRECOVERABLE(show "ask sender to resend")`.
- **Edge cases:** sender also lost state (both gone) → truly unrecoverable → explicit UX + offer re-link; resend loop → cap + backoff.
- **Scalability:** ciphertext retention sized per-device hot window; skipped-key cache bounded per session.
- **Security:** resend re-encrypts current state (no ratchet rewind → preserves forward secrecy); resend-request authenticated within the session.
- **Final:** retain-until-ACK + skipped-key cache + resend protocol + last-resort prekey = near-zero permanent loss; residual (mutual total loss) is surfaced, never silent.

### G1-2 Sender-key desync on offline membership change (groups) — **S1**
- **Problem:** group uses sender keys per epoch; membership change rotates the epoch and distributes new Sender-Key Distribution Messages (SKDM) over pairwise sessions. An offline device misses the SKDM → can't decrypt new-epoch messages.
- **Failure scenario:** member removed while device offline → new epoch → device returns, has ciphertext it can't decrypt.
- **User impact:** missing group messages.
- **Fix:** **persist SKDMs per recipient-device** (queued, replayed on reconnect); on decrypt-fail, recipient sends `skdm-request{group, epoch}` → any current member re-sends the epoch SKDM over pairwise E2EE. Bind messages to an **epoch id**; reject/queue ciphertext whose epoch SKDM isn't yet held.
- **State machine (group epoch):** `EPOCH_N → (membership change) → EPOCH_N+1 (distribute SKDM to all member-devices) → device missing SKDM: NEED_SKDM → request → HAVE_SKDM → decrypt`.
- **Edge cases:** rapid successive membership changes (epoch churn) → coalesce; new member must not get prior-epoch keys (no back-read).
- **Scalability:** SKDM queue per device bounded; epoch metadata small.
- **Security:** epoch rotation on every remove guarantees forward secrecy of group; new joiners can't read history.
- **Final:** epoch-tagged messages + persisted/queued SKDM + SKDM-request recovery.

### G1-3 Silent malicious device addition / device divergence — **S1 (security)**
- **Problem:** server hands out device lists; a compromised server could inject an extra device (ghost) into a user's device list → MITM. Also legitimate device-list changes can race (simultaneous linking).
- **Fix:** **versioned device list** (monotonic `device_list_epoch` per account) that senders bind encryption to; **Key Transparency log** (Merkle/CONIKS-style append-only) so clients can *audit* that the device list they were given is globally consistent (defeats targeted ghost devices); **safety-number change warnings**; **serialize device registration** (per-account lock) to resolve simultaneous-linking races; new device must be **approved by a trusted device or strong MFA** (DAPT) — server alone cannot add a usable device.
- **State machine (device):** `PROPOSED → ATTESTED → APPROVED(by trusted device/MFA) → ACTIVE → (revoke) → REVOKED`; device_list_epoch increments on each transition.
- **Edge cases:** clock skew is irrelevant to crypto (ratchet is causal); device-list epoch resolves ordering; offline senders re-fetch list+epoch before encrypting and re-fan-out on change.
- **Security:** key transparency turns a silent server attack into a *detectable* one; approval requirement removes server-only device injection.
- **Final:** versioned, transparency-audited, approval-gated device list.

### G1-4 Ratchet-state corruption / lost device — **S1**
- **Problem:** crash/DB corruption mid-ratchet; lost device leaves orphan sessions.
- **Fix:** **atomic single-writer persistence** of ratchet state (WAL, transactional); on detected corruption → **session reset** (fresh X3DH) + resend protocol (G1-1); **lost/stolen device → immediate revocation** (device_list_epoch++, senders drop its session, refresh family revoked, push token cleared). Identity continuity via `account_id`.
- **Safety invariants (system-wide):** (1) nothing renders unless decrypted + MAC-verified; (2) a device never advances another device's ratchet; (3) device list is versioned + approval-gated + transparency-audited; (4) ciphertext retained until every target device ACKs (bounded); (5) recovery never rewinds a ratchet (forward secrecy preserved).
- **Final:** transactional ratchet store + reset path + immediate revocation.

> **Answers:** Permanently undecryptable? Only on mutual total state loss — surfaced, not silent. Devices diverge? Detected via seq gaps → resend/gap-fill → converge. Ratchet corruption? Contained by atomic store + reset. Replay/dup? Ratchet message-numbers + app-layer (sender,msg_id) dedupe.

## G2. Contact Discovery — Privacy & Abuse Resistance

**Verdict:** plain hashed-number discovery is **brute-forceable** (the phone-number space is small) → enumeration, scraping, graph harvesting. Replace with an OPRF-based private lookup + rate limiting + risk engine.

### G2-1 Hash enumeration / scraping / graph harvest — **S1 (privacy)**
- **Problem:** SHA-of-phone is reversible via the tiny keyspace (≈10^10) + GPUs/rainbow tables; an adversarial client can upload many hashes and learn who is registered, and scrape the social graph.
- **Failure scenario:** attacker scripts millions of lookups → builds a registered-user DB + contact graph.
- **User impact:** mass privacy leak, targeted spam, deanonymization.
- **Severity:** S1.
- **Fix:** **OPRF-based Private Set Intersection.** Server holds secret key `k`; client sends blinded `H(number)^r`; server returns `H(number)^{rk}`; client unblinds to `H(number)^k` and checks membership against a server-published set of `H(user_number)^k` tokens. The server **never sees the number**, and the client **cannot compute `^k` offline** → every lookup *requires* a rate-limitable server interaction. Optionally deploy inside a **secure enclave (SGX via Gramine/Occlum)** for stronger guarantees where hardware allows — but OPRF alone removes offline brute force without enclave dependency (keeps the free/OSS stance).
- **Anti-abuse layers:** per-account/device/IP **rate limits** on lookups + total-contacts cap + full-resync throttle; **risk engine** (velocity, datacenter IP, attestation) blocks scraping patterns; **anonymous rate-limit credential** so the CDS can throttle without linking identity; verified-phone + attestation makes Sybil querying costly.
- **Edge cases:** key rotation (`k` rotates → republish token set, version it); user "discoverable-by-number" privacy off → excluded from set; number recycling → re-tokenize.
- **Scalability:** OPRF eval = one EC scalar-mult (cheap); membership set in a sharded cuckoo filter / in-memory index; CDS is its own service, scales independently; token set rebuilt incrementally from `user.created/deleted` events.
- **Security/privacy guarantee:** server learns nothing about non-matching contacts; client cannot enumerate offline; all lookups rate-limited + attributable to a verified attested account.
- **Final:** **OPRF-PSI + rate limit + risk engine (+ optional enclave)**, with per-user discoverability controls and rotating server key.

## G3. Realtime Infrastructure at 1M–10M Concurrent

**Verdict:** the single-region shared Valkey-pubsub + one Kafka + flat realtime-gw works to ~1M but has SPOFs, presence storms, hot partitions, and reconnect-storm risk at 10M. Move to **cells**.

### G3-1 Shared pub/sub fan-to-all + SPOF — **S2**
- **Problem:** cross-pod delivery via global Valkey pub/sub broadcasts to all pods; one Kafka/Valkey cluster is a SPOF; doesn't scale to 10M.
- **Fix / Final — Cell architecture:** partition users into **cells** by `account_id` hash. Each cell = own realtime-gw fleet + Valkey + Kafka slice + chat shards. A thin **global routing/directory** maps `account_id → home cell + current edge`. Clients connect to their cell's geo-edge. Cross-cell messages route via the recipient's cell. **Blast radius = one cell.**
- **State (routing):** `account_id → {cell_id, region, conn_locator}`; updated on connect/disconnect; cached at edge.
- **Edge cases:** user migrates region → directory update + drain; cross-cell large group → fan-out workers per cell.
- **Scalability:** add cells linearly; no global broadcast.
- **Security:** E2EE means cross-cell/region ciphertext replication leaks nothing.

### G3-2 Presence storms & hot partitions — **S2**
- **Problem:** popular user online → notifies millions; huge announcement channel → one hot Kafka partition.
- **Fix:** presence is **subscription-scoped** (only watchers, on-screen/recent) + **coalesced** + **aggregation tier** for huge fan-in; large/broadcast channels use **sub-partitioning** (fan-out shards) or **fan-out-on-read (pull/long-poll)** instead of push. Active-speaker/large-channel treated like a feed, not N×push.
- **Edge cases:** flash crowds → admission control + degrade to pull.
- **Scalability:** fan-out workers sharded by recipient hash; pull model caps push amplification.

### G3-3 Reconnect storm / thundering herd / partition — **S2**
- **Problem:** regional blip → millions reconnect at once → auth+sync stampede.
- **Fix:** client **backoff + jitter**; **resume tokens** (cheap reattach vs full re-auth); server **admission control + token-bucket accept rate + load shedding**; distinguish cheap **resume** from expensive **full sync**; pre-warmed capacity; partition tolerance — local cell keeps serving, cross-cell queues drain on heal (Kafka buffer), presence shows "last known + staleness".
- **State (connection):** `CONNECTING → ADMITTED(resume|full-sync) → LIVE → DROPPED → BACKOFF(jitter) → CONNECTING`.
- **Edge cases:** repeated flapping → escalating backoff; sync cursor far behind → snapshot + delta.
- **Final:** cells + resume tokens + admission control + jittered backoff + pull for mega-fanout.

## G4. Push Notification Reliability

**Verdict:** safe **iff push is a hint, not the source of truth.** With cursor-based sync as the durable truth, users cannot permanently miss messages even under total push outage.

### G4-1 FCM/APNs outage, delayed/duplicate/missing push — **S2**
- **Problem:** transports can be down/slow/duplicating; gateway/service can crash.
- **Failure scenario:** FCM outage for hours; pushes lost.
- **User impact:** delayed *awareness*, but **no message loss** (pulled on next open).
- **Fix:** **durable outbox + push workers** with retry + exponential backoff + jitter; **idempotency key per (message, device)** → no duplicates; **collapse keys** → coalesce; **DLQ** + alert for permanent failures; foreground → deliver via WebSocket instead; web/desktop fallback (Web Push/ntfy); prolonged miss → email digest. **Badges/unread computed from server truth**, not push counts.
- **Reconnect reconciliation:** on connect, client sends last cursor → server streams all missed changes → unread/badges recomputed → "delivered" receipt only when the device actually receives over WS.
- **State (notification):** `PENDING → SENT(provider) → ACKED(provider) → DELIVERED(app via WS) | RETRY(backoff) | FAILED(DLQ) | SUPPRESSED(online/DND)`.
- **Edge cases:** device token rotated/invalid → prune + re-register; user multi-device → per-device tracking + collapse across devices.
- **Scalability:** workers scale on queue depth; outbox partitioned by user.
- **Security:** E2EE pushes carry **no content** (conv id + "New message"); content fetched + decrypted on device.
- **Final:** push = best-effort hint; **correctness from cursor sync**; outbox+retry+DLQ+dedup; reconcile on reconnect.

> **Answer:** Can users permanently miss messages? No — durable store + cursor sync guarantees eventual delivery regardless of push. Notifications inconsistent? Collapsed + idempotent + server-truth badges.

## G5. Account & Identity Recovery (E2EE-preserving)

**Verdict:** must separate **identity recovery** (regain the account + future messages) from **history recovery** (needs the user's E2EE key). Strong recovery without breaking E2EE = the only correct stance.

### G5-1 Lost phone / lost email / all devices lost — **S1**
- **Problem:** user must regain account without a trusted device, without letting an attacker do the same.
- **Fix:** **risk-based, multi-factor, delayed** recovery. Regain **identity** via DAPT (re-verify phone via Reverse-OTP + email + backup code + any surviving trusted-device approval) → provision a fresh device key + passkey. **History** is restored *only* with the user's **recovery key / E2EE backup passphrase** — the server never holds it, so lost key ⇒ history unrecoverable (true E2EE; warn loudly, push recovery-key setup at onboarding). Optional **social recovery** (Shamir shares among N trusted contacts) for the backup key.
- **State machine (recovery):** `INITIATED → IDENTITY_VERIFY(≥2 factors) → RISK_EVAL → [HIGH_RISK: DELAY 24–72h + NOTIFY_ALL + COOLING_OFF] → IDENTITY_RECOVERED(new keys) → SESSIONS_REVOKED(all prior) → [optional HISTORY_RESTORE(recovery key)] → ACTIVE`.
- **Edge cases:** recovery during active attacker session → completing recovery **revokes all prior sessions + rotates keys** (kicks attacker); partial factor loss → escalate delay.

### G5-2 Device theft / credential compromise — **S1 (security)**
- **Fix:** **immediate remote revocation** (device_list_epoch++, drop sessions, revoke refresh family, clear push token); app-lock (biometric/PIN) limits pre-revocation use; sensitive actions (number change, disable 2FA, add device) require step-up + cooling-off; anomaly detection on new geo/device.

### G5-3 Recovery abuse / social engineering — **S1**
- **Fix:** no single human/channel can fully recover; require cryptographic proof (recovery key) **or** multi-factor + enforced delay + notify-all; rate-limit + lockout recovery attempts; support staff have **zero** ability to bypass crypto (they cannot read or restore content). 
- **Security invariant:** identity recovery ≠ plaintext access; server/staff can never recover E2EE content; every recovery is notified to all channels and reversible within the delay window.
- **Final:** split identity-vs-history recovery; risk-based delays; revoke-and-rotate on completion; recovery key (optionally Shamir social) is the only path to history; E2EE guarantees intact end-to-end.

## G6. Multi-Tenant Isolation

**Verdict: row-level scoping alone is NOT sufficient.** It depends on every query, job, consumer, cache key and index doc remembering the tenant filter — a single omission is a cross-tenant breach (**S1**, compliance-fatal). The fix is **defense-in-depth + fail-closed guardrails** so a developer *cannot* accidentally leak, plus optional physical isolation for large/regulated tenants.

### G6-1 Missing tenant-filter bug (the core footgun) — **S1**
- **Problem:** a query/endpoint written without `WHERE tenant_id = ?` (raw SQL, a new list route, a JOIN that drops the filter) returns other tenants' rows.
- **Failure scenario:** new "list channels" endpoint forgets the scope → returns every org's channels.
- **User impact:** confidential cross-org data exposure; regulatory breach.
- **Fix (layered, fail-closed):**
  1. **Postgres Row-Level Security (RLS)** — policies filter on `current_setting('app.tenant')`; set via `SET LOCAL` inside each transaction. Even if the app forgets the WHERE, the DB enforces it. **Last line of defense.** (With PgBouncer: use transaction-scoped GUC; verify pooling mode.)
  2. **Request-scoped tenant context** via `AsyncLocalStorage` (NestJS) populated from the JWT `tenant_id`; the data layer reads it; **missing context → throw (never default to "all")**.
  3. **Tenant-aware repositories only** — raw cross-tenant DB access banned by lint/CI; the base repo injects the tenant filter *and* sets the RLS GUC.
  4. **Authorize, don't just filter** — on every single-resource read, assert `resource.tenant_id == ctx.tenant_id` (defeats IDOR even with the filter).
- **State machine (tenant context):** `REQUEST/EVENT/JOB → EXTRACT tenant → ESTABLISH (ALS + RLS GUC) → [missing → FAIL_CLOSED] → scoped access → CLEAR`.
- **Edge cases:** cross-tenant admin/platform tasks run under an explicit, audited **system scope** (never the default); multi-tenant user (member of A and B) → context is the *active* tenant per request.
- **Scalability:** RLS adds negligible overhead with proper indexes (`(tenant_id, …)` leading column).
- **Security:** two independent enforcement layers (app + DB) → no single mistake leaks.

### G6-2 Background jobs / batch jobs lose tenant context — **S1**
- **Problem:** jobs run outside a request → no JWT → easy to process all/ wrong tenant.
- **Fix:** every job payload carries an explicit `tenant_id`; the runner establishes tenant context + RLS GUC before executing; jobs with no tenant **fail closed**; legitimately cross-tenant maintenance runs under audited system scope with a narrow allow-list.
- **Edge cases:** a batch over many tenants iterates *per tenant* with context re-established each iteration (no shared connection bleed).

### G6-3 Search indexing & query leakage — **S1**
- **Problem:** indexed docs without `tenant_id`, or queries without a tenant filter → cross-tenant search hits.
- **Fix:** every indexed doc stamps `tenant_id` + ACL; the **shared query builder refuses to run without a tenant filter** and injects it server-side; large/regulated tenants get **index-per-tenant (alias/routing)** for isolation + perf. (Personal E2EE excluded — on-device only.)

### G6-4 Kafka consumer & projection leakage — **S1**
- **Problem:** consumers run without request context; a projection could write tenant A's event into tenant B's store, or process without scope.
- **Fix:** `tenant_id` is a **schema-mandatory field** on every tenant-scoped event; the consumer sets tenant context from the event *before* any data access (so RLS applies); projections are keyed by tenant; missing tenant → DLQ + alert.

### G6-5 Cache pollution — **S1**
- **Problem:** caching a tenant-scoped value (channel meta, membership, **authorization result**) under a key without tenant → served to the wrong tenant; especially dangerous for an authz/role cache when a user belongs to multiple tenants with different roles.
- **Fix:** **tenant in every cache key** for tenant-scoped data (`authz:{tenant}:{user}:{resource}`, `channel:{tenant}:{id}`); a cache wrapper that *cannot construct a key without a tenant*; invalidate on `member.*`/`role.*` events; never cache cross-tenant.

### G6-6 Mandatory guardrails (so a developer cannot accidentally leak)
1. **DB RLS** fail-closed (final backstop).
2. **Fail-closed tenant context** (ALS); missing tenant = exception, never "all".
3. **Tenant-aware data/cache/index/storage wrappers** — keys/paths cannot be built without a tenant; raw access banned by CI lint.
4. **Schema-enforced `tenant_id`** on every tenant event.
5. **Authorize resource.tenant == ctx.tenant** on every read (not just filter).
6. **Jobs carry explicit tenant**; system scope is special + audited.
7. **CI cross-tenant leakage test suite:** seed two tenants, exercise every list/search/job/consumer, assert zero cross-tenant rows; static analysis for unscoped queries.
8. **Audit + anomaly detection:** log tenant context on sensitive paths; alert on any cross-tenant access attempt.

### G6-7 Isolation model selection (pool vs bridge vs silo)
- **Pool (default):** shared infra + RLS + guardrails — best density, lowest cost.
- **Bridge:** shared app, **dedicated data** (schema/DB/shard/index) for medium/sensitive tenants.
- **Silo:** dedicated stack/region for large or regulated tenants (data residency, blast-radius, noisy-neighbor isolation) — ties into the cell architecture (G3).
- **Final:** pool-by-default with RLS + the 8 guardrails; promote big/regulated tenants to bridge/silo. Row-level isolation is necessary but **must be backed by RLS + fail-closed context + wrappers + tests** — never relied on alone.

## G7. Kafka Schema Evolution & Event Versioning

**Verdict:** with long-retention, **replayable** event topics and rolling/canary/blue-green deploys, mixed producer/consumer versions are normal — so the registry must enforce **FULL_TRANSITIVE** compatibility and breaking changes must use **expand/contract**, never a single cut.

### G7-1 Incompatible schema change breaks consumers / poisons replay — **S1**
- **Problem:** removing/renaming/retyping a field, or reusing a field number, breaks consumers and corrupts historical replay.
- **Failure scenario:** a producer ships a renamed field; old consumers crash or silently misread; a later replay of old events misinterprets them.
- **User impact:** dropped/duplicated/incorrect downstream effects (missed notifications, wrong search, broken projections).
- **Severity:** S1/S2.
- **Fix — production versioning strategy:**
  1. **Schema registry (Apicurio/Confluent OSS) with `FULL_TRANSITIVE`** compatibility on all event subjects; CI **blocks** incompatible schemas before merge.
  2. **Protobuf on the wire** (already chosen): only add fields with new numbers; **never** reuse/renumber; **never** change a field's type; mark removed fields `reserved`. Unknown fields are ignored → forward compat for free.
  3. **Standard envelope** on every event: `{event_type, schema_version, event_id, occurred_at, tenant_id, producer, trace_id, payload}` — version + id + tenant always present (`event_id` powers idempotency; see G6-4 for tenant).
  4. **Expand/contract (two-phase) for any breaking change:** (a) *expand* — producers write old **and** new fields; (b) *migrate* — upgrade consumers to read new while tolerating old; (c) *contract* — once all consumers read new, stop writing old and `reserve` the field. **Never break in one deploy.**
  5. **Upcasting on read** for replay — a versioned deserializer transforms `vN → vLatest` so consumers only handle the latest shape; **keep upcasters forever** for replayable topics.
  6. **New topic for semantic changes** — if an event's *meaning* changes (not just shape), create `topic.v2` + dual-write/migrate; never overload v1's meaning.
- **Backward vs forward:** **Backward** (new consumer reads old events) matters for replay + consumers deployed after producers. **Forward** (old consumer reads new events) matters when producers upgrade first (rolling deploy). `FULL_TRANSITIVE` guarantees **both across all versions** — required because canary/blue-green inevitably run mixed versions.

### G7-2 Consumer lag & rebalance storms during deploys — **S2**
- **Problem:** rolling restart triggers stop-the-world rebalances → lag spikes; mixed versions coexist mid-deploy.
- **Fix:** **cooperative-sticky (incremental) rebalancing** (no global stop-the-world); **static group membership** (`group.instance.id`) so a restarting pod rejoins without triggering a rebalance; size partitions ≥ peak consumer count; deploy **consumers before producers** when a new read is required; monitor lag + DLQ as a deploy gate.
- **State machine (schema change rollout):** `PROPOSE → CI compat check (FULL_TRANSITIVE) → [fail → reject] → EXPAND (dual-write) → deploy consumers (read new, tolerate old) → deploy producers (write new) → verify lag+DLQ clean → CONTRACT (remove old, reserve number)`.

### G7-3 Blue-green & canary correctness — **S2**
- **Problem:** running blue and green in the **same** consumer group splits partitions (each processes half) → split-brain side effects; canary consumers see old-producer events and old consumers see canary's new fields.
- **Fix:** treat green as the new version inside the **same group via canary** (a few instances) — safe *because* `FULL_TRANSITIVE` makes mixed versions interoperable; for full blue-green cutover of stateful consumers, use a **distinct consumer group** for green seeded at a chosen offset and rely on **idempotent consumers** (dedupe by `event_id`) so any reprocessing is harmless. Never run two versions in one group expecting each to see all events.
- **Edge cases:** offset management on cutover (start-from-committed vs latest); idempotency makes "start earlier + reprocess" the safe default.

### G7-4 Event replay after schema changes — **S2**
- **Problem:** replaying months-old events (tiered storage) with today's consumer must read every historical version, without re-firing side effects.
- **Fix:** `FULL_TRANSITIVE` + **upcasters** (vN→vLatest) + **idempotency** (event_id dedupe) + run replays on a **separate, rate-limited consumer group** with a **"replay mode" flag that suppresses external side effects** (no duplicate push/email; rebuild projections only). 
- **Scalability:** replay throttled to protect downstream; projections rebuilt offline then swapped (alias).
- **Security:** envelope carries `tenant_id` → replayed projections stay tenant-scoped (ties to G6).
- **Final:** registry-enforced FULL_TRANSITIVE + protobuf additive-only + envelope with version/id/tenant + expand/contract + upcasters + idempotent consumers + cooperative-sticky/static-membership deploys + suppressed-side-effect replay.

## G8. Review Summary & Re-Rating (post-fix)

| Area | Before | After fixes | Key fix |
|------|--------|-------------|---------|
| E2EE multi-device | 8 | **9.5** | resend protocol, epoch SKDM recovery, versioned + transparency device list, retain-until-ACK |
| Contact discovery | n/a | **9** | OPRF-PSI + rate limit + risk engine |
| Realtime scale | 9 | **9.5** | cell architecture, resume tokens, admission control, pull-fanout |
| Push reliability | 9 | **9.5** | push-as-hint + cursor-truth, outbox/retry/DLQ/dedup, reconcile |
| Recovery | 8 | **9** | identity-vs-history split, risk-based delay, revoke+rotate, recovery key |
| **Multi-tenant isolation** | — | **9.5** | RLS + fail-closed context + wrappers + authorize-not-filter + CI leakage tests; pool/bridge/silo |
| **Kafka schema evolution** | — | **9.5** | FULL_TRANSITIVE registry + protobuf additive-only + envelope + expand/contract + upcasters + idempotency |
| Production readiness | 8.5 | **9.5** | all of the above + Phase-10 hardening |

**Launch gate:** these G-fixes are required before WhatsApp/Slack-scale GA. E2EE protocols land in Phases 2–3, push in Phase 7, recovery/backup in Phase 1/4, and tenant-isolation + schema-evolution guardrails are **cross-cutting from Phase 0** (RLS, tenant context, schema registry, and CI leakage/compat tests must exist before any tenant data or event flows). Phase 10 carries cells/multi-region/DR. None changes the free/OSS stance.

---

*End of document — VelChat Architecture v2.5.*
