import { Module, type DynamicModule } from '@nestjs/common';
import { composeSingle, contentGroup, type ServiceDeps } from '@velchat/composition';

export type AppDeps = ServiceDeps;
export { INFRA } from '@velchat/composition';

/**
 * content-service — one feature group in one process.
 *
 * The wiring lives in @velchat/composition so that the same group definition also serves the
 * `mono` profile (all groups in one process, for a 1 GB free-tier box). See deploy/PORTABILITY.md.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return composeSingle(AppModule, deps, contentGroup(deps.logger));
  }
}
