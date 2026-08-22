import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import type { Logger } from '@velchat/common';
import type { MembershipResolver } from '@velchat/feature-contracts';
import { ConnectionRegistry } from './connection-registry';
import { SendQueue, type Frame } from './send-queue';
import type { InboundSink } from '../fanout/receipt-publisher';
import type { SkdmService, SkdmTarget } from '../fanout/skdm.service';
import type { TypingRelay } from '../fanout/typing-relay';

interface SocketCtx {
  connId: string;
  userId: string;
  deviceId: string;
  queue: SendQueue;
  alive: boolean;
  /** Inbound token bucket — refilled per second, spent per frame. */
  tokens: number;
  refilledAt: number;
}

/** What a pod publishes to `pod:{podId}` to deliver a frame. `deviceId` targets one device. */
export interface PodEnvelope {
  userId: string;
  deviceId?: string;
  frame: Frame;
}

export interface WsFabricOptions {
  podId: string;
  /** RS256 public key used to verify access tokens. Without it the fabric accepts NOTHING. */
  jwtPublicKey?: string;
  heartbeatMs?: number;
  /** Sink for inbound delivered/read receipts (§B4.4). */
  sink?: InboundSink;
  /** Sender-key distribution relay (§G1-2). */
  skdm?: SkdmService;
  /** Ephemeral typing fan-out (§C4). */
  typing?: TypingRelay;
  /**
   * Authorizes inbound frames against conversation membership. Without it, frames that name a
   * conversation are REFUSED — a socket must not be able to act on a conversation nobody vouched for.
   */
  membership?: MembershipResolver;
  /** Hard cap on a single inbound frame. `ws` defaults to 100 MB, which is a memory-exhaustion lever. */
  maxPayloadBytes?: number;
  /** If set, the `Origin` header must match one of these. Native apps send none and are unaffected. */
  allowedOrigins?: string[];
  /** Inbound frames allowed per second per connection. */
  inboundPerSecond?: number;
}

const DEFAULT_MAX_PAYLOAD = 64 * 1024;
const DEFAULT_INBOUND_PER_SECOND = 40;

/**
 * WebSocket fabric (§B9). Per connection: verify the JWT → register in the Valkey registry →
 * heartbeat → authorize and route inbound signals → deliver outbound frames from the
 * `pod:{podId}` channel through a bounded send queue. Graceful drain on shutdown.
 *
 * This is the highest-privilege surface in the system: it authenticates every socket, and its
 * inbound frames mutate state other users can see. Four properties are therefore deliberate:
 *
 * 1. **Verification never degrades.** Without a public key the fabric rejects every connection.
 *    It used to fall back to `jwt.decode`, so a missing env var quietly accepted forged tokens.
 * 2. **Inbound frames are authorized, not just authenticated.** `delivered`, `read`, `typing` and
 *    `skdm` all name a conversation, and a valid token says nothing about whether the sender belongs
 *    to it. Without that check, anyone could force blue ticks in a stranger's chat. Membership
 *    failures fail CLOSED.
 * 3. **Delivery is indexed by user.** Scanning every socket per frame is O(sockets) on the hot path.
 * 4. **Inbound is bounded** — payload size, origin, and a per-connection rate limit. Each typing
 *    frame costs a fan-out and each ping a registry write, so an unbounded client is an
 *    amplification lever.
 */
export class WsFabric {
  private wss?: WebSocketServer;
  private subscriber?: Redis;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly sockets = new Map<string, { ws: WebSocket; ctx: SocketCtx }>();
  /** userId → connIds. The index that makes delivery independent of total socket count. */
  private readonly byUser = new Map<string, Set<string>>();

  constructor(
    private readonly server: Server,
    private readonly redis: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly logger: Logger,
    private readonly opts: WsFabricOptions,
  ) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws',
      maxPayload: this.opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD,
      verifyClient: (info, done) => {
        const allowed = this.opts.allowedOrigins;
        if (!allowed || allowed.length === 0) return done(true);
        const origin = info.origin ?? info.req.headers.origin;
        // A browser always sends Origin; native clients send none and are not CORS-bound.
        if (!origin || allowed.includes(origin)) return done(true);
        this.logger.warn({ origin }, 'ws upgrade rejected: origin not allowed');
        return done(false, 403, 'origin not allowed');
      },
    });
    this.wss.on('connection', (ws, req) => {
      void this.onConnect(ws, req);
    });

    // Dedicated subscriber (a subscriber connection cannot run other commands).
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(`pod:${this.opts.podId}`);
    this.subscriber.on('message', (_channel, payload) => this.deliverFromPod(payload));

    this.heartbeat = setInterval(() => this.sweep(), this.opts.heartbeatMs ?? 25000);
    this.logger.info({ podId: this.opts.podId }, 'ws fabric started at /ws');
  }

  private async onConnect(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const claims = this.verify(extractToken(req));
    if (!claims) {
      // 4001 is the client's "do not retry" signal, so it must be an application close code rather
      // than an HTTP rejection (which the client would see as a retryable 1006).
      ws.close(4001, 'unauthorized');
      return;
    }
    const ctx: SocketCtx = {
      connId: randomUUID(),
      userId: claims.account_id,
      deviceId: claims.device_id,
      queue: new SendQueue(),
      alive: true,
      tokens: this.opts.inboundPerSecond ?? DEFAULT_INBOUND_PER_SECOND,
      refilledAt: Date.now(),
    };
    this.track(ctx, ws);
    await this.registry.register(ctx.userId, {
      podId: this.opts.podId,
      connId: ctx.connId,
      deviceId: ctx.deviceId,
    });

    ws.on('pong', () => {
      ctx.alive = true;
    });
    ws.on('message', (raw) => {
      void this.onInbound(ctx, ws, raw.toString());
    });
    ws.on('close', () => {
      void this.onClose(ctx);
    });
    ws.on('error', (err) => {
      this.logger.debug({ connId: ctx.connId, err: err.message }, 'ws socket error');
    });

    this.write(ctx, { kind: 'durable', type: 'connected', data: { connId: ctx.connId } });
    void this.opts.skdm?.flushOnConnect(ctx.userId, ctx.deviceId);
  }

  /** §B9.3 inbound: ping, sync cursor, receipts, typing, sender-key distribution. */
  private async onInbound(ctx: SocketCtx, ws: WebSocket, raw: string): Promise<void> {
    if (!this.spendToken(ctx)) {
      this.logger.warn({ userId: ctx.userId }, 'inbound rate limit exceeded — frame dropped');
      return;
    }

    let msg: { type?: string; data?: Record<string, unknown>; [k: string]: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return; // malformed frame: ignore it, but keep the connection
    }
    // The mobile client sends durable frames enveloped (`{kind,type,data:{…}}`) and ephemeral
    // frames flat (`{kind,type,…}`). Accept both.
    const d = msg.data && typeof msg.data === 'object' ? msg.data : msg;

    switch (msg.type) {
      case 'ping':
        await this.registry.heartbeat(ctx.userId);
        this.write(ctx, { kind: 'ephemeral', type: 'pong', data: {} });
        break;

      case 'sync': {
        // Reconnect (C16): the cursor is echoed; the REST afterSeq backfill is the real catch-up.
        const cursor = d.cursor ?? msg.cursor ?? null;
        this.write(ctx, { kind: 'durable', type: 'sync', data: { cursor } });
        break;
      }

      case 'delivered':
      case 'read': {
        const conv = str(d.conversationId);
        const seq = num(d.seq);
        if (!conv || seq === null || !this.opts.sink) break;
        if (!(await this.mayAct(ctx, conv, msg.type))) break;
        const op = msg.type === 'read' ? this.opts.sink.read : this.opts.sink.delivered;
        await op.call(this.opts.sink, ctx.userId, conv, seq);
        break;
      }

      case 'skdm': {
        // §G1-2: a member distributes the group's epoch sender key.
        const conv = str(d.conversationId);
        const epoch = num(d.epoch);
        const targets = Array.isArray(d.targets) ? (d.targets as SkdmTarget[]) : null;
        if (!conv || epoch === null || !targets || !this.opts.skdm) break;
        if (!(await this.mayAct(ctx, conv, 'skdm'))) break;
        await this.opts.skdm.distribute(conv, epoch, ctx.userId, targets);
        break;
      }

      case 'skdm-request': {
        const conv = str(d.conversationId);
        const epoch = num(d.epoch);
        if (!conv || epoch === null || !this.opts.skdm) break;
        if (!(await this.mayAct(ctx, conv, 'skdm-request'))) break;
        await this.opts.skdm.request(conv, epoch, ctx.userId, ctx.deviceId);
        break;
      }

      case 'typing': {
        // §C4 ephemeral typing → fan out to the other members; never stored.
        const conv = str(d.conversationId);
        const state = d.state === 'stop' ? 'stop' : 'start';
        if (!conv || !this.opts.typing) break;
        if (!(await this.mayAct(ctx, conv, 'typing'))) break;
        await this.opts.typing.relay(ctx.userId, conv, state);
        break;
      }

      default:
        break; // unknown type: ignore
    }
    void ws; // the socket itself is only needed for teardown paths
  }

  /**
   * May this socket act on this conversation? A valid token proves who the caller is, not what they
   * belong to — so receipts, typing and key distribution all need this. Fails closed: an
   * unavailable membership service denies, and a missing resolver denies too, because silently
   * allowing would reintroduce the spoofing hole.
   */
  private async mayAct(ctx: SocketCtx, conversationId: string, action: string): Promise<boolean> {
    if (!this.opts.membership) {
      this.logger.warn({ action }, 'no membership resolver configured — inbound frame refused');
      return false;
    }
    try {
      const ok = await this.opts.membership.isMember(conversationId, ctx.userId);
      if (!ok) {
        this.logger.warn(
          { userId: ctx.userId, conversationId, action },
          'inbound frame refused: not a conversation member',
        );
      }
      return ok;
    } catch (err) {
      this.logger.warn(
        { conversationId, action, err: String(err) },
        'membership check failed — refusing (fail closed)',
      );
      return false;
    }
  }

  /** Token bucket, refilled once per second. */
  private spendToken(ctx: SocketCtx): boolean {
    const limit = this.opts.inboundPerSecond ?? DEFAULT_INBOUND_PER_SECOND;
    const now = Date.now();
    if (now - ctx.refilledAt >= 1000) {
      ctx.tokens = limit;
      ctx.refilledAt = now;
    }
    if (ctx.tokens <= 0) return false;
    ctx.tokens -= 1;
    return true;
  }

  private track(ctx: SocketCtx, ws: WebSocket): void {
    this.sockets.set(ctx.connId, { ws, ctx });
    const set = this.byUser.get(ctx.userId) ?? new Set<string>();
    set.add(ctx.connId);
    this.byUser.set(ctx.userId, set);
  }

  private untrack(ctx: SocketCtx): void {
    this.sockets.delete(ctx.connId);
    const set = this.byUser.get(ctx.userId);
    set?.delete(ctx.connId);
    if (set && set.size === 0) this.byUser.delete(ctx.userId);
  }

  private async onClose(ctx: SocketCtx): Promise<void> {
    this.untrack(ctx);
    await this.registry.unregister(ctx.userId, ctx.connId);
  }

  /** Sockets this pod holds for a user — used by delivery and by tests. */
  socketCountFor(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /**
   * Deliver a frame to a user's sockets on this pod. Indexed by user, so the cost is proportional
   * to that user's own connections rather than to every socket the pod holds.
   */
  async deliver(env: PodEnvelope): Promise<number> {
    let sent = 0;
    for (const connId of this.byUser.get(env.userId) ?? []) {
      const entry = this.sockets.get(connId);
      if (!entry) continue;
      if (env.deviceId && entry.ctx.deviceId !== env.deviceId) continue; // per-device (§B5.3/§G1-2)
      this.write(entry.ctx, env.frame);
      sent += 1;
    }
    return sent;
  }

  private deliverFromPod(payload: string): void {
    let env: PodEnvelope;
    try {
      env = JSON.parse(payload) as PodEnvelope;
    } catch {
      return;
    }
    void this.deliver(env);
  }

  private write(ctx: SocketCtx, frame: Frame): void {
    if (!ctx.queue.enqueue(frame)) return; // ephemeral dropped under backpressure
    const entry = this.sockets.get(ctx.connId);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return;
    for (const f of ctx.queue.drain()) entry.ws.send(JSON.stringify(f));
  }

  /** Heartbeat sweep: drop dead sockets (no pong since the last sweep), ping the rest. */
  private sweep(): void {
    for (const [, { ws, ctx }] of this.sockets) {
      if (!ctx.alive) {
        ws.terminate();
        this.untrack(ctx);
        void this.registry.unregister(ctx.userId, ctx.connId);
        continue;
      }
      ctx.alive = false;
      ws.ping();
      // The client's own `ping` frame also refreshes the registry; refreshing here as well doubled
      // the write rate per connection for no benefit, so the TTL is refreshed on one path only.
    }
  }

  private verify(token?: string): { account_id: string; device_id: string } | null {
    if (!token) return null;
    if (!this.opts.jwtPublicKey) {
      // Fail closed. The previous `jwt.decode` fallback meant a missing key accepted forged tokens.
      this.logger.error('ws fabric has no JWT public key — refusing every connection');
      return null;
    }
    try {
      const payload = jwt.verify(token, this.opts.jwtPublicKey, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;
      if (!payload?.account_id || !payload?.device_id) return null;
      return { account_id: String(payload.account_id), device_id: String(payload.device_id) };
    } catch {
      return null;
    }
  }

  /** Graceful drain (§B9.4): tell clients to reconnect, then close. */
  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const { ws } of this.sockets.values()) {
      try {
        ws.send(JSON.stringify({ kind: 'durable', type: 'reconnect', data: {} }));
        ws.close(1001, 'server draining');
      } catch {
        /* already closing */
      }
    }
    await this.subscriber?.unsubscribe();
    this.subscriber?.disconnect();
    this.wss?.close();
  }
}

function extractToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(req.url ?? '', 'http://localhost');
  return url.searchParams.get('token') ?? undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
