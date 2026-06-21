import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import type { Logger } from '@velchat/common';
import { ConnectionRegistry } from './connection-registry';
import { SendQueue, type Frame } from './send-queue';

interface SocketCtx {
  connId: string;
  userId: string;
  deviceId: string;
  queue: SendQueue;
  alive: boolean;
}

/** What a pod publishes to `pod:{podId}` to deliver a frame to a specific user's sockets. */
interface PodEnvelope {
  userId: string;
  frame: Frame;
}

export interface WsFabricOptions {
  podId: string;
  /** RS256 public key (JWKS) to verify access tokens; decode-only when absent (dev). */
  jwtPublicKey?: string;
  heartbeatMs?: number;
}

/**
 * WebSocket fabric (§B9). Each connection: verify JWT → register in the Valkey registry →
 * heartbeat (ping/pong, drives online/offline) → inbound signals → cross-pod delivery via the
 * `pod:{podId}` pub/sub channel into the per-connection SendQueue. Graceful drain on shutdown.
 */
export class WsFabric {
  private wss?: WebSocketServer;
  private subscriber?: Redis;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly sockets = new Map<string, { ws: WebSocket; ctx: SocketCtx }>();

  constructor(
    private readonly server: Server,
    private readonly redis: Redis,
    private readonly registry: ConnectionRegistry,
    private readonly logger: Logger,
    private readonly opts: WsFabricOptions,
  ) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      void this.onConnect(ws, req);
    });

    // Dedicated subscriber connection for cross-pod delivery (a subscriber can't run commands).
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(`pod:${this.opts.podId}`);
    this.subscriber.on('message', (_channel, payload) => this.deliverFromPod(payload));

    this.heartbeat = setInterval(() => this.sweep(), this.opts.heartbeatMs ?? 25000);
    this.logger.info({ podId: this.opts.podId }, 'ws fabric started at /ws');
  }

  private async onConnect(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const claims = this.verify(extractToken(req));
    if (!claims) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const ctx: SocketCtx = {
      connId: randomUUID(),
      userId: claims.account_id,
      deviceId: claims.device_id,
      queue: new SendQueue(),
      alive: true,
    };
    this.sockets.set(ctx.connId, { ws, ctx });
    await this.registry.register(ctx.userId, {
      podId: this.opts.podId,
      connId: ctx.connId,
      deviceId: ctx.deviceId,
    });

    ws.on('pong', () => {
      ctx.alive = true;
    });
    ws.on('message', (raw) => {
      void this.onInbound(ctx, raw.toString());
    });
    ws.on('close', () => {
      void this.onClose(ctx);
    });

    this.write(ctx, { kind: 'durable', type: 'connected', data: { connId: ctx.connId } });
  }

  /** §B9.3 inbound: typing / read-ack / sync. (Routed to chat/presence services off this in P2c/P7.) */
  private async onInbound(ctx: SocketCtx, raw: string): Promise<void> {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ping':
        await this.registry.heartbeat(ctx.userId);
        this.write(ctx, { kind: 'ephemeral', type: 'pong', data: {} });
        break;
      case 'sync':
        // Reconnect (C16): client sends last cursor → directs it to backfill missed via chat history.
        this.write(ctx, { kind: 'durable', type: 'sync', data: { cursor: msg.cursor ?? null } });
        break;
      // 'typing' / 'read' produce events to the bus — wired in P2c.
      default:
        break;
    }
  }

  private async onClose(ctx: SocketCtx): Promise<void> {
    this.sockets.delete(ctx.connId);
    await this.registry.unregister(ctx.userId, ctx.connId);
  }

  /** A frame arrived for one of this pod's users — enqueue + flush to every matching socket. */
  private deliverFromPod(payload: string): void {
    let env: PodEnvelope;
    try {
      env = JSON.parse(payload) as PodEnvelope;
    } catch {
      return;
    }
    for (const { ctx } of this.sockets.values()) {
      if (ctx.userId === env.userId) this.write(ctx, env.frame);
    }
  }

  private write(ctx: SocketCtx, frame: Frame): void {
    if (!ctx.queue.enqueue(frame)) return; // ephemeral dropped under backpressure
    const entry = this.sockets.get(ctx.connId);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return;
    for (const f of ctx.queue.drain()) entry.ws.send(JSON.stringify(f));
  }

  /** Heartbeat sweep: drop dead sockets (no pong since last sweep), ping the rest. */
  private sweep(): void {
    for (const [connId, { ws, ctx }] of this.sockets) {
      if (!ctx.alive) {
        ws.terminate();
        this.sockets.delete(connId);
        void this.registry.unregister(ctx.userId, connId);
        continue;
      }
      ctx.alive = false;
      ws.ping();
      void this.registry.heartbeat(ctx.userId);
    }
  }

  private verify(token?: string): { account_id: string; device_id: string } | null {
    if (!token) return null;
    try {
      const payload = this.opts.jwtPublicKey
        ? (jwt.verify(token, this.opts.jwtPublicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload)
        : (jwt.decode(token) as jwt.JwtPayload | null);
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
        /* ignore */
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
