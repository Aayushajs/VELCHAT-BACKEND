import type { DynamicModule } from '@nestjs/common';
import type { InfraContext, InfraKind } from '@velchat/infra-context';

/** A background worker owned by a feature — started after the bus, stopped on drain. */
export interface Worker {
  start(): void;
  stop(): void | Promise<void>;
}

/**
 * What mounting a group of features contributes to a runtime service.
 *
 * The four lists exist because ordering matters and a naive merge gets it wrong. As separate
 * services each group created its own event bus and called `start()` on it; inside one process
 * there is a single bus, and `start()` begins consuming — so every consumer has to be registered
 * BEFORE it is called, exactly once, or the events that arrive in between are dropped. Keeping
 * registration separate from startup is what makes that guarantee hold no matter how many groups
 * end up in the same process.
 */
export interface Mounted {
  imports: DynamicModule[];
  /** Consumer registrations. Run before the single `eventBus.start()`. */
  register: Array<() => void>;
  /** Index creation. Runs once the datastores are connected. */
  ensureIndexes: Array<() => Promise<void>>;
  /** Background workers. Started after the bus, stopped on drain. */
  workers: Worker[];
}

/** A group of features: what infrastructure it needs, and how to wire it. */
export interface FeatureGroup {
  name: string;
  need: InfraKind[];
  mount(infra: InfraContext): Mounted;
}

export const emptyMounted = (): Mounted => ({
  imports: [],
  register: [],
  ensureIndexes: [],
  workers: [],
});

/** Merge several mounts into one — how the `mono` profile runs every group in a single process. */
export function mergeMounted(parts: Mounted[]): Mounted {
  return parts.reduce<Mounted>(
    (acc, p) => ({
      imports: [...acc.imports, ...p.imports],
      register: [...acc.register, ...p.register],
      ensureIndexes: [...acc.ensureIndexes, ...p.ensureIndexes],
      workers: [...acc.workers, ...p.workers],
    }),
    emptyMounted(),
  );
}

/** Union of the infra needs of several groups, de-duplicated. */
export function mergeNeeds(groups: FeatureGroup[]): InfraKind[] {
  return [...new Set(groups.flatMap((g) => g.need))];
}
