import { Module, type DynamicModule } from '@nestjs/common';
import type { EventBus } from '@velchat/event-bus';
import type { AiGateway } from '../ai-gateway/ai.port';
import { CaptionController } from './caption.controller';
import { CaptionService } from './caption.service';
import { CaptionEvents } from './caption.events';

export interface CaptionModuleDeps {
  ai: AiGateway;
  eventBus: EventBus;
}

/** Real-time call translation (§A26.3) — STT → per-listener translate → call.caption fan-out. */
@Module({})
export class CaptionModule {
  static forRoot(deps: CaptionModuleDeps): DynamicModule {
    const events = new CaptionEvents(deps.eventBus);
    const service = new CaptionService(deps.ai, events);
    return {
      module: CaptionModule,
      controllers: [CaptionController],
      providers: [{ provide: CaptionService, useValue: service }],
    };
  }
}
