import { createHmac } from 'node:crypto';
import type {
  AiGateway,
  ModerationResult,
  SpeechResult,
  TranscriptSegment,
  TranslationResult,
} from './ai.port';

export interface HttpAiOptions {
  baseUrl: string;
  apiKey?: string;
  /** Shared secret — requests are signed so the model server trusts only us (§A14.5). */
  hmacSecret?: string;
  /** Per-request timeout — the realtime budget; a slow model must not stall a call (<1.5s default). */
  timeoutMs: number;
}

/**
 * HTTP adapter to the self-hosted Python AI server (docs/AI-SERVER.md). Every request is HMAC-signed
 * (`x-velchat-signature = HMAC-SHA256(secret, rawBody)`) and hard-bounded by an AbortController so a
 * slow/unreachable model degrades gracefully instead of blocking the realtime path. No paid API.
 */
export class HttpAiGateway implements AiGateway {
  readonly name = 'ai:http';

  constructor(private readonly opts: HttpAiOptions) {}

  translate(text: string, target: string, source?: string): Promise<TranslationResult> {
    return this.post<TranslationResult>('/translate', { text, target, source });
  }
  async detect(text: string): Promise<string> {
    return (await this.post<{ language: string }>('/detect', { text })).language;
  }
  transcribe(
    audioB64: string,
    opts?: { language?: string; partial?: boolean },
  ): Promise<TranscriptSegment> {
    return this.post<TranscriptSegment>('/stt', {
      audio: audioB64,
      language: opts?.language,
      partial: opts?.partial ?? false,
    });
  }
  synthesize(text: string, language: string): Promise<SpeechResult> {
    return this.post<SpeechResult>('/tts', { text, language });
  }
  async summarize(text: string, opts?: { style?: 'brief' | 'actions' | 'notes' }): Promise<string> {
    return (
      await this.post<{ summary: string }>('/summarize', { text, style: opts?.style ?? 'brief' })
    ).summary;
  }
  moderate(text: string): Promise<ModerationResult> {
    return this.post<ModerationResult>('/moderate', { text });
  }
  async embed(text: string): Promise<number[]> {
    return (await this.post<{ vector: number[] }>('/embed', { text })).vector;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers['authorization'] = `Bearer ${this.opts.apiKey}`;
    if (this.opts.hmacSecret) {
      headers['x-velchat-signature'] = createHmac('sha256', this.opts.hmacSecret)
        .update(raw)
        .digest('hex');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: raw,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ai ${path} ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
