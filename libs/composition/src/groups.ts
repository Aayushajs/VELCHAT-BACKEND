import type { AppConfig } from '@velchat/config';
import { resolveInternalSecret } from '@velchat/common';
import type { Logger } from 'pino';
import { createPushRouter } from '@velchat/push';
import { createMailer } from '@velchat/mail';
import { AuthModule } from '@velchat/feature-auth';
import { TenancyModule, DirectoryModule, AdminModule, OprfModule } from '@velchat/feature-user';
import { ChannelsModule } from '@velchat/feature-group-channel';
import {
  ChatModule,
  ChatRepository,
  ReceiptsRepository,
  ReceiptsConsumer,
  PollsModule,
  ResendModule,
  ExtrasModule,
} from '@velchat/feature-chat';
import { NotificationModule, CampaignModule } from '@velchat/feature-notification';
import { SearchModule } from '@velchat/feature-search';
import { PresenceModule } from '@velchat/feature-presence';
import { MediaModule, BackupModule } from '@velchat/feature-media';
import { StatusModule } from '@velchat/feature-status';
import { CallsModule, ScreenControlModule } from '@velchat/feature-call';
import {
  AutomationModule,
  ListsModule,
  CollabModule,
  FeatureFlagsModule,
} from '@velchat/feature-automation';
import { TranslateModule, CaptionModule, createAiGateway } from '@velchat/feature-ai';
import { HttpSocialGraphResolver, type SocialGraphResolver } from '@velchat/feature-contracts';
import { emptyMounted, type FeatureGroup, type Mounted } from './mounted';

/**
 * The five feature groups of the axis-6 topology, as data.
 *
 * Each group is "one runtime service worth of features": one scaling axis, one datastore owner, no
 * synchronous dependency on a sibling. Expressing them as values rather than as six hand-written
 * app modules is what lets the same wiring serve one-group-per-process (the six-service topology)
 * and all-groups-in-one-process (`mono`, for a 1 GB free-tier box) without a second copy.
 *
 * A group whose datastores are absent mounts nothing rather than throwing: the service still boots,
 * answers /health, and reports itself not-ready — which is what you want on a box that is still
 * being provisioned, instead of a crash loop.
 */

/** auth + user/tenancy + group-channel — all Postgres, all on one authorization path. */
export const identityGroup = (config: AppConfig, logger: Logger): FeatureGroup => ({
  name: 'identity',
  need: ['postgres', 'valkey', 'eventBus'],
  mount(infra): Mounted {
    const m = emptyMounted();
    const { postgres, valkey, eventBus } = infra;

    if (postgres && valkey && eventBus) {
      m.imports.push(
        AuthModule.forRoot({ config, logger, pg: postgres, redis: valkey.redis, eventBus }),
      );
    }
    if (postgres && eventBus) {
      m.imports.push(
        TenancyModule.forRoot({ logger, pg: postgres, eventBus }),
        DirectoryModule.forRoot({ pg: postgres, eventBus }),
        AdminModule.forRoot({ pg: postgres }),
        // Previously fed process.env.JWT_PUBLIC_KEY, which is not in the config schema — so this
        // always received an empty PEM and rejected every request.
        ChannelsModule.forRoot({
          pg: postgres,
          eventBus,
          jwtPublicKeyPem: config.JWT_PUBLIC_PEM ?? '',
          jwtIssuer: config.JWT_ISSUER ?? 'https://auth.velchat.local',
        }),
      );
    }
    // Privacy-preserving contact discovery (§G2): Postgres for the key/token store, Valkey for
    // per-account rate limiting on evaluate/match.
    if (postgres && valkey) {
      m.imports.push(OprfModule.forRoot({ pg: postgres, redis: valkey.redis, logger }));
    }
    return m;
  },
});

/**
 * chat + notification + search — one pipeline, not three: chat produces `message.sent`, the other
 * two consume it, and all three read the Mongo `messages` collection chat owns. Search in
 * particular must live here, because its index is a `$text` index on that collection and hosting it
 * elsewhere would mean one service querying another's store (§A10.5).
 */
export const messagingGroup = (config: AppConfig, logger: Logger): FeatureGroup => ({
  name: 'messaging',
  need: ['mongo', 'postgres', 'valkey', 'eventBus', 'search'],
  mount(infra): Mounted {
    const m = emptyMounted();
    const { mongo, postgres, valkey, eventBus, search } = infra;

    if (mongo && valkey && eventBus) {
      const receipts = new ReceiptsRepository(mongo);
      const polls = PollsModule.forRoot({ logger, mongo, valkey, eventBus });
      const resend = ResendModule.forRoot({ logger, mongo, eventBus });
      const extras = ExtrasModule.forRoot({ logger, mongo, eventBus });

      m.imports.push(
        ChatModule.forRoot({ logger, mongo, valkey, eventBus }),
        polls.module,
        resend.module,
        extras.module,
      );
      m.ensureIndexes.push(async () => {
        await new ChatRepository(mongo).ensureIndexes();
        await receipts.ensureIndexes();
        await polls.repo.ensureIndexes();
        await resend.repo.ensureIndexes();
        await extras.repo.ensureIndexes();
      });
      m.register.push(() => new ReceiptsConsumer(eventBus, receipts, logger).register());
    }

    if (postgres && valkey && eventBus) {
      const notif = NotificationModule.forRoot({
        logger,
        pg: postgres,
        redis: valkey.redis,
        eventBus,
        push: createPushRouter(config, logger),
      });
      m.imports.push(notif.module);
      m.register.push(() => notif.wiring.consumer.register());
      m.workers.push(notif.wiring.worker);

      const campaigns = CampaignModule.forRoot({
        logger,
        pg: postgres,
        mailer: createMailer(config, logger),
      });
      m.imports.push(campaigns.module);
      m.workers.push(campaigns.wiring.worker);
    }

    if (eventBus && search) {
      const s = SearchModule.forRoot({ index: search, eventBus });
      m.imports.push(s.module);
      m.register.push(() => s.wiring.consumer.register());
    }
    return m;
  },
});

/**
 * presence + typing. Valkey only, by design: status/stories is Postgres-backed and lives in the
 * content group, so the process holding every WebSocket never grows a Postgres pool and a status
 * deploy can never drop live connections.
 */
export const realtimeGroup = (): FeatureGroup => ({
  name: 'realtime',
  need: ['valkey', 'eventBus'],
  mount(infra): Mounted {
    const m = emptyMounted();
    if (infra.valkey && infra.eventBus) {
      m.imports.push(
        PresenceModule.forRoot({ redis: infra.valkey.redis, eventBus: infra.eventBus }),
      );
    }
    return m;
  },
});

/**
 * Status authorization asks the directory whether a viewer is one of an author's contacts, and
 * whether either party blocked the other. Without an internal secret we cannot ask, so we answer
 * DENY rather than guessing — the same fail-closed stance realtime takes for receipts and typing.
 */
const denyAllSocialGraph = (logger: Logger): SocialGraphResolver => {
  logger.warn(
    'INTERNAL_API_SECRET is not set in production: status audience and block checks cannot be ' +
      'verified, so every non-author status read will be DENIED. Posting and deletion still work.',
  );
  return { relationship: async () => ({ isContact: false, isBlocked: true }) };
};

/** media + status/stories + E2EE chat backup. The CPU-heavy group (ffmpeg lives here). */
export const contentGroup = (config: AppConfig, logger: Logger): FeatureGroup => ({
  name: 'content',
  need: ['postgres', 'storage', 'eventBus'],
  mount(infra): Mounted {
    const m = emptyMounted();
    const { postgres, storage, eventBus } = infra;

    if (postgres && storage && eventBus) {
      m.imports.push(MediaModule.forRoot({ logger, pg: postgres, storage, eventBus }));
    }
    // §C21 — the server stores ciphertext only; no event bus needed.
    if (postgres && storage) {
      m.imports.push(BackupModule.forRoot({ pg: postgres, storage }));
    }
    if (postgres && eventBus) {
      const internalSecret = resolveInternalSecret(config);
      const social = internalSecret
        ? new HttpSocialGraphResolver({
            baseUrl: process.env.UPSTREAM_IDENTITY || 'http://localhost:3002',
            secret: internalSecret,
          })
        : denyAllSocialGraph(logger);
      m.imports.push(StatusModule.forRoot({ logger, pg: postgres, eventBus, social }));
    }
    return m;
  },
});

/**
 * calls + automation + AI. Three axes, all near-idle in the MVP, so separate processes were pure
 * overhead. Documented split trigger: extract `ai` FIRST if server-side inference ever takes real
 * load, because CPU-bound inference here would starve the job runner and call signalling.
 */
export const platformGroup = (config: AppConfig, logger: Logger): FeatureGroup => ({
  name: 'platform',
  need: ['postgres', 'valkey', 'mongo', 'eventBus'],
  mount(infra): Mounted {
    const m = emptyMounted();
    const { postgres, valkey, mongo, eventBus } = infra;

    if (postgres && eventBus) {
      m.imports.push(
        CallsModule.forRoot({
          logger,
          pg: postgres,
          eventBus,
          livekit: {
            url: config.LIVEKIT_URL,
            apiKey: config.LIVEKIT_API_KEY,
            apiSecret: config.LIVEKIT_API_SECRET,
            ttlSec: config.LIVEKIT_TOKEN_TTL_SECONDS,
          },
          turn: {
            stunUrls: config.STUN_URLS,
            turnUrls: config.TURN_URLS,
            turnSecret: config.TURN_SECRET,
            ttlSec: config.TURN_TTL_SECONDS,
          },
        }),
        ScreenControlModule.forRoot({ pg: postgres, eventBus }),
      );

      const automation = AutomationModule.forRoot({ logger, pg: postgres, eventBus });
      m.imports.push(
        automation.module,
        ListsModule.forRoot({ pg: postgres }),
        CollabModule.forRoot({ pg: postgres }),
      );
      m.workers.push(automation.wiring.worker);
    }

    if (mongo && valkey && eventBus) {
      const flags = FeatureFlagsModule.forRoot({ logger, mongo, redis: valkey.redis, eventBus });
      m.imports.push(flags.module);
      // Mongo/Valkey are connected by InfraLifecycle; the old app.module connected them by hand
      // inside this block, which opened a second pair of connections per process.
      m.ensureIndexes.push(() => flags.wiring.repo.ensureIndexes());
      m.workers.push(flags.wiring.worker);
    }

    if (postgres && valkey) {
      m.imports.push(
        TranslateModule.forRoot({ config, logger, pg: postgres, redis: valkey.redis }).module,
      );
    }
    if (eventBus) {
      m.imports.push(CaptionModule.forRoot({ ai: createAiGateway(config, logger), eventBus }));
    }
    return m;
  },
});

/** Every group — the `mono` profile, and the source of truth for what "all features" means. */
export const allGroups = (config: AppConfig, logger: Logger): FeatureGroup[] => [
  identityGroup(config, logger),
  messagingGroup(config, logger),
  realtimeGroup(),
  contentGroup(config, logger),
  platformGroup(config, logger),
];
