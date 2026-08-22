import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { SearchIndex } from '@velchat/search';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchConsumer } from './search.consumer';

export interface SearchModuleDeps {
  index: SearchIndex;
  eventBus: EventBus;
}

export class SearchWiring {
  readonly service: SearchService;
  readonly consumer: SearchConsumer;
  constructor(deps: SearchModuleDeps) {
    this.service = new SearchService(deps.index);
    this.consumer = new SearchConsumer(deps.eventBus, this.service);
  }
}

@Module({})
export class SearchModule {
  static forRoot(deps: SearchModuleDeps): { module: DynamicModule; wiring: SearchWiring } {
    const wiring = new SearchWiring(deps);
    return {
      module: {
        module: SearchModule,
        controllers: [SearchController],
        providers: [{ provide: SearchService, useValue: wiring.service }],
      },
      wiring,
    };
  }
}
