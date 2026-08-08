# VelChat — WhatsApp-Grade Realtime Frontend Architecture & Implementation Guide

This guide is the **definitive, complete technical specification** for building a rock-solid, ultra-fast, production-grade frontend for VelChat (Mobile / Web) matching the reliability, performance, and offline-first guarantees of WhatsApp.

---

## 1. System Architecture: The WhatsApp Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI Layer (React Native)                       │
│  - Inverted FlashList (Zero Jank, 60/120 FPS)                           │
│  - Optimistic State Rendering (Clock → 1 Tick → 2 Ticks → Blue Ticks)  │
│  - Swipe-to-Reply, Voice Waveforms, Media Progress                     │
└────────────────────────────────────▲────────────────────────────────────┘
                                     │ Reactive Observables
┌────────────────────────────────────┴────────────────────────────────────┐
│                    WatermelonDB / SQLite (Source of Truth)             │
│  - Messages (Indexed by conversation_id, seq, client_msg_id)           │
│  - Conversations (Unread counts, last previews, maxSeq cursors)         │
│  - Outbox Table (Durable offline action queue)                          │
└──────────────────▲──────────────────────────────────▲───────────────────┘
                   │                                  │
      Sequential Outbox Drain             Batch Inbound Reconcile
                   │                                  │
┌──────────────────┴──────────────────────────────────┴───────────────────┐
│                              Sync Engine                                │
│  - Single WebSocket Transport (`/ws?token=<jwt>`)                      │
│  - Reconnection Manager (Exponential Backoff + Jitter)                  │
│  - REST Catch-up Worker (`/history?afterSeq=<maxSeq>`)                  │
│  - Ephemeral Relay (Typing, Presence, Voice Recording)                 │
└────────────────────────────────────▲────────────────────────────────────┘
                                     │ WebSocket / HTTPS
┌────────────────────────────────────┴────────────────────────────────────┐
│                         VelChat Backend Gateway                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Architecture Principles:
1. **Local Database is the Single Source of Truth:** The UI *never* renders directly from network responses. It writes to SQLite and observes changes.
2. **Offline-First & Optimistic Writes:** Message sends immediately appear in the chat bubble (`state: 'sending'`) and queue in the `outbox`.
3. **Monotonic Sequence (`seq`) & Idempotency (`client_msg_id`):** Every message has a unique client-generated UUID/ID and an authoritative server-assigned integer sequence number (`seq`).
4. **Cumulative Receipts:** Delivery and read states advance cumulatively up to `upToSeq` without individual message chatter.
5. **Zero-Jank 60/120 FPS Rendering:** Database queries run off-thread via JSI SQLite, list views use recycled nodes (`FlashList`), and expensive renders are memoized.

---

## 2. Local Database Schema (WatermelonDB / SQLite)

### 2.1 `messages` Table
```typescript
interface MessageSchema {
  id: string;                    // Local DB primary key
  client_msg_id: string;         // Unique client message ID (e.g. 'm_17861999_a8f9')
  conversation_id: string;       // Target conversation UUID
  sender_id: string;             // User ID of the sender
  seq: number;                   // Server assigned sequence (0 = pending/sending)
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location';
  content_plain?: string;        // Text content or caption
  media_url?: string;            // Remote storage URL (S3/CDN)
  media_local_path?: string;     // Local cache path on device
  media_size?: number;           // Bytes
  media_mime?: string;           // MIME type
  media_duration?: number;       // Duration in seconds (audio/video)
  reply_to_id?: string;          // Quoted message ID
  state: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deleted: boolean;              // Soft deleted
  view_once: boolean;            // Ephemeral view-once media
  starred: boolean;              // Pinned / starred flag
  server_ts?: number;            // Server timestamp (epoch ms)
  created_at: number;            // Local creation timestamp (epoch ms)
  updated_at: number;
}
```

### 2.2 `conversations` Table
```typescript
interface ConversationSchema {
  id: string;                    // Conversation ID (UUID)
  type: 'dm' | 'group' | 'channel';
  name?: string;                 // Contact or group title
  avatar_url?: string;
  last_message_preview?: string; // Text preview for chat list
  last_message_at?: number;      // Epoch ms of last activity
  last_message_seq: number;      // Highest known server seq
  unread_count: number;          // Unread badge count
  mention_count: number;         // @mentions badge count
  is_pinned: boolean;
  is_archived: boolean;
  is_muted: boolean;
  draft_text?: string;           // Unsent composer draft
  created_at: number;
  updated_at: number;
}
```

### 2.3 `outbox` Table (Offline Queue)
```typescript
interface OutboxSchema {
  id: string;                    // Task UUID
  kind: 'send_message' | 'send_receipt' | 'delete_message';
  conversation_id: string;       // For single-flight per conversation
  payload: string;               // JSON stringified task data
  state: 'queued' | 'sending' | 'failed';
  attempts: number;              // Retry count
  next_attempt_at: number;       // Exponential backoff timestamp
  created_at: number;
  updated_at: number;
}
```

---

## 3. Realtime WebSocket Transport & Reconnection State Machine

### 3.1 Connection URL & Authentication
- **Endpoint:** `ws://<GATEWAY_HOST>/ws?token=<ACCESS_TOKEN>`
- React Native WebSocket cannot set headers reliably on all OS versions; the JWT access token is passed in query params.
- If the token is expired, the server closes with code `4001` (`WS_CODE_UNAUTHORIZED`). The client must refresh the auth token and reconnect.

### 3.2 Reconnection State Machine
```
   [ DISCONNECTED ]
          │ (Network online / App foreground)
          ▼
   [ CONNECTING ] ──(Connection Failure / Timeout)──┐
          │                                         │
          │ (onopen + handshake)                    │
          ▼                                         │
   [ CONNECTED ] ──(Network drop / Watchdog)        │
          │                                         │
          ▼                                         ▼
   [ RECONNECTING ] ◄───────────────────────────────┘
          │ (Backoff timer: 1s, 2s, 4s, 8s ... Max 30s + Random Jitter)
          └───────────► (Retry Connect)
```

### 3.3 Heartbeat & Watchdog Timers
- **Ping Interval:** Client sends `{ kind: "ephemeral", type: "ping" }` every **25 seconds**.
- **Server Registry TTL:** Backend maintains `conn:user:<userId>` with **75s TTL**.
- **Client Watchdog:** If no frame is received from server within **60 seconds**, the client forcibly closes the socket and triggers reconnection.

---

## 4. End-to-End Chat Message Lifecycle

### 4.1 Sending a Message (Optimistic Flow)

```
[ User Taps Send ]
       │
       ├─► 1. Generate clientMsgId = `m_${Date.now()}_${random}`
       ├─► 2. DB Transaction:
       │      - INSERT into `messages` with state = 'sending', seq = 0
       │      - UPDATE `conversations` (lastMessagePreview = text, updatedAt = now)
       │      - INSERT into `outbox` with kind = 'send_message', state = 'queued'
       │
       ▼ (UI updates instantly with Clock icon 🕒)
[ Outbox Worker ]
       │
       ├─► Check WebSocket state:
       │      - IF WS is OPEN: Send via REST or WS (`POST /api/v1/chat/messages`)
       │      - IF Offline: Retain in `outbox`, retry when network reconnects
       │
       ▼ (Server Responds with 200 OK & ACK: { id, seq: 42, serverTs: 1786200000 })
[ Apply Send ACK ]
       │
       ├─► DB Transaction:
       │      - UPDATE `messages` (state = 'sent', seq = 42, serverTs = 1786200000)
       │      - UPDATE `conversations` (lastMessageSeq = max(lastMessageSeq, 42))
       │      - DELETE from `outbox`
       │
       ▼ (UI bubble transitions from 🕒 Clock → ✓ Single Grey Tick)
```

### 4.2 Handling Inbound Messages & Live Duplicates
When a live message frame arrives over WebSocket:
1. Query local DB by `client_msg_id` and `(conversation_id, seq)`.
2. **Reconciliation Decision:**
   - If `client_msg_id` matches an existing optimistic send $\implies$ **UPDATE** row with authoritative `seq` and transition state to `sent`.
   - If `seq` already exists in DB $\implies$ **SKIP** (idempotent no-op).
   - If new $\implies$ **INSERT** row with state = `delivered`, and increment conversation `unread_count` (if sender is not self).

### 4.3 Startup Crash Recovery (`recoverStuckSends`)
If the mobile OS kills the app while a message POST was in-flight:
- The row remains stuck in `state: 'sending'` in the `outbox`.
- On app launch, `recoverStuckSends()` scans the outbox and resets all `sending` rows back to `queued` (`nextAttemptAt = now`).
- The worker re-transmits. Because the backend is strictly idempotent on `clientMsgId`, re-sending is completely safe and causes zero duplicate messages.

---

## 5. Offline Catch-up & Synchronization (`afterSeq`)

When returning from offline or waking from background:

```
[ WebSocket Reconnected ]
       │
       ├─► 1. For each active conversation in local DB:
       │      - Query highest local seq: `maxSeq = SELECT MAX(seq) FROM messages WHERE conversation_id = ?`
       │
       ├─► 2. Fetch missing delta from REST API:
       │      `GET /api/v1/chat/conversations/:id/history?afterSeq=${maxSeq}&limit=50`
       │
       ▼
[ Batch Reconcile ]
       │
       ├─► 3. Single DB Write Transaction:
       │      - Sort inbound messages ascending by `seq`
       │      - Execute batch upsert / deduplication
       │      - Update conversation `last_message_seq` and `unread_count`
       │
       ▼ (Chat view seamlessly renders all missed messages in order)
```

---

## 6. Receipts Progression & Visual Checkmarks (WhatsApp Model)

### 6.1 Status Hierarchy
| State | Visual Indicator | Meaning |
| :--- | :--- | :--- |
| `sending` | 🕒 Small Clock | Stored locally in SQLite outbox; in-flight or offline. |
| `sent` | ✓ Single Grey Tick | Acknowledged and persisted by server MongoDB; assigned `seq`. |
| `delivered` | ✓✓ Double Grey Tick | Delivered to recipient's active device / WebSocket. |
| `read` | ✓✓ Double Blue Tick | Recipient opened conversation and viewed message. |
| `failed` | ⚠️ Red Exclamation | Network error / rejected; shows tap-to-retry button. |

### 6.2 Cumulative Receipts (`applyReceipt`)
- Receipts are cumulative: a receipt for `upToSeq = 50` marks all own messages with `seq ≤ 50` as `delivered` or `read`.
- **Monotonic Rank Protection:** A message in `read` state will never be downgraded to `delivered` or `sent` by out-of-order frames.

---

## 7. Ephemeral Features (Typing, Presence, Voice Notes)

### 7.1 Typing Indicators
- **Sender Throttle:** Send `{ kind: "ephemeral", type: "typing", conversationId, state: "start" }` when user types in composer. Throttle emissions to at most once every **3 seconds**.
- When composer is empty or inactive for 3 seconds, emit `state: "stop"`.
- **Receiver Timeout:** On receiving `typing.started`, show "...typing" header animation and set a **5-second local timer**. If no refreshed typing event arrives, automatically revert to subtitle/presence.

### 7.2 Presence & Online Status
- Client subscribes to peer presence when opening a DM conversation.
- Backend delivers `{ type: "presence", userId, isOnline, lastSeenAt }`.
- Header renders "Online" or "Last seen today at 4:15 PM".

### 7.3 Voice Notes & Audio Messages
1. Record audio in AAC/m4a format.
2. Generate 30–50 normalized waveform amplitude samples during recording for visual rendering.
3. Optimistic local bubble renders waveform + play button immediately.
4. Upload audio to media storage, then send message metadata `{ type: 'audio', duration, waveform, mediaUrl }`.

---

## 8. WebSocket Frames & API Payload Reference

### 8.1 Client $\to$ Server Frames
```json
// Heartbeat Ping
{ "kind": "ephemeral", "type": "ping" }

// Typing Indicator (Flat structure)
{ "kind": "ephemeral", "type": "typing", "conversationId": "conv_123", "state": "start" }

// Delivered Receipt
{ "kind": "durable", "type": "delivered", "data": { "conversationId": "conv_123", "upToSeq": 45 } }

// Read Receipt
{ "kind": "durable", "type": "read", "data": { "conversationId": "conv_123", "upToSeq": 45 } }
```

### 8.2 Server $\to$ Client Frames
```json
// Inbound Message
{
  "kind": "durable",
  "type": "message",
  "data": {
    "conversationId": "conv_123",
    "seq": 46,
    "senderId": "user_456",
    "type": "text",
    "content": "Hello world!",
    "clientMsgId": "m_17862000_bc34",
    "serverTs": 1786200050123
  }
}

// Receipt Broadcast
{
  "kind": "durable",
  "type": "receipt",
  "data": {
    "conversationId": "conv_123",
    "upToSeq": 46,
    "status": "read",
    "userId": "user_456"
  }
}
```

---

## 9. Performance & Zero-Jank UI Engineering

1. **Inverted List (`FlashList` / `FlatList`):**
   - Use `inverted={true}` so new messages arrive at the bottom with zero layout jumping.
   - Set `estimatedItemSize={72}` on `FlashList` for recycled view memory pooling.
2. **Observe Only What Changes:**
   - Observe message queries using `.observeWithColumns(['state', 'content_plain'])` so background metadata changes don't cause O(N) full-list re-renders.
3. **Memoized Bubbles (`React.memo`):**
   - Memoize message item components with custom `arePropsEqual` comparing `item.id`, `item.state`, and `item.seq`.
4. **Off-Thread Audio / Media:**
   - Run audio decoding and recording on background native threads (e.g. `react-native-audio-recorder-player` / `react-native-track-player`).

---

## 10. Summary Checklist for Frontend Development

- [x] Use WatermelonDB with SQLite JSI for local offline storage.
- [x] Implement outbox queue with `recoverStuckSends()` crash recovery.
- [x] Client generates `clientMsgId` for optimistic rendering and idempotent deduplication.
- [x] Reconnect logic uses exponential backoff + jitter and heartbeat watchdog.
- [x] Sync delta catch-up using `?afterSeq=<maxSeq>`.
- [x] Cumulative receipt updates with monotonic state progression (`sending` $\to$ `sent` $\to$ `delivered` $\to$ `read`).
- [x] Throttled ephemeral typing and presence handling.
- [x] Inverted `FlashList` rendering with memoized bubbles.
