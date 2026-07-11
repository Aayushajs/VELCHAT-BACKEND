import type {
  AiGateway,
  ModerationResult,
  SpeechResult,
  TranscriptSegment,
  TranslationResult,
} from './ai.port';

/**
 * Dev/degraded gateway used when AI_BASE_URL is unset — makes NO external calls and never leaks
 * plaintext. Translation echoes the input (visibly tagged), STT/TTS/summary return empty, moderation
 * passes, embeddings are zero. So the app boots + all AI-touching endpoints respond gracefully
 * without a model server; wire the real one by setting AI_BASE_URL (docs/AI-SERVER.md).
 */
export class NoopAiGateway implements AiGateway {
  readonly name = 'ai:noop';

  constructor(private readonly defaultLang = 'en') {}

  async translate(text: string, target: string): Promise<TranslationResult> {
    return { text: `[${target}] ${text}`, detectedSource: this.defaultLang };
  }
  async detect(): Promise<string> {
    return this.defaultLang;
  }
  async transcribe(): Promise<TranscriptSegment> {
    return { text: '', language: this.defaultLang, isFinal: true };
  }
  async synthesize(): Promise<SpeechResult> {
    return { mime: 'audio/opus' };
  }
  async summarize(): Promise<string> {
    return '';
  }
  async moderate(): Promise<ModerationResult> {
    return { flagged: false, categories: [], score: 0 };
  }
  async embed(): Promise<number[]> {
    return [];
  }
}
