import { Module, type DynamicModule } from '@nestjs/common';
import { composeService, allGroups, type ServiceDeps } from '@velchat/composition';

export type AppDeps = ServiceDeps;
export { INFRA } from '@velchat/composition';

/**
 * velchat-mono — every feature group in a single process.
 *
 * Not a different application: it mounts exactly the same `FeatureGroup` values the six services
 * mount, through the same assembler, so behaviour and wiring order are identical. Only the process
 * count differs.
 *
 * It exists because free-tier compute is not uniform. Oracle Always Free gives 12 GB, where six
 * processes plus a local data tier fit comfortably. A 1 GB box does not fit six Node processes at
 * all, and an "industry-level" answer there is one process, not a broken six. Choose with
 * `SPLIT_PROFILE=mono` and point the edge at `UPSTREAM_MONO` (deploy/PORTABILITY.md).
 *
 * The trade-off is honest and worth stating: one process means one blast radius and one scaling
 * axis. It is the right shape for a small box or a demo, and the wrong shape once traffic justifies
 * the six — which is why moving between them is a configuration change, not a rewrite.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return composeService(AppModule, deps, allGroups(deps.config, deps.logger));
  }
}
