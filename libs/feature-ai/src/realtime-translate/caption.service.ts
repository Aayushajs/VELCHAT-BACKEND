import { ValidationError } from '@velchat/common';
import type { AiGateway } from '../ai-gateway/ai.port';
import { CaptionEvents } from './caption.events';

export interface Listener {
  userId: string;
  /** The listener's language (ISO). */
  lang: string;
  /** Also synthesize spoken audio in their language. */
  tts?: boolean;
}

export interface CaptionInput {
  callId: string;
  fromUserId: string;
  /** Speaker language (optional → auto-detect during STT). */
  srcLang?: string;
  /** One audio segment (base64) to transcribe, OR pre-transcribed `text`. */
  audioB64?: string;
  text?: string;
  /** Client hint: is this a final segment or a fast partial? */
  isFinalHint?: boolean;
  listeners: Listener[];
}

/**
 * Real-time call translation (§A26.3 / C20). One speaker segment → transcribe (Whisper via the AI
 * gateway) → translate PER listener into their language (in parallel for latency) → optional TTS →
 * emit `call.caption` per listener. Each participant sees/hears the call in their own language with
 * near-zero delay. Enterprise/server-readable calls only; personal E2EE runs on-device (§A26.1).
 */
export class CaptionService {
  constructor(
    private readonly ai: AiGateway,
    private readonly events: CaptionEvents,
  ) {}

  async caption(
    input: CaptionInput,
  ): Promise<{ captions: number; text: string; isFinal: boolean }> {
    if (!input.callId || !input.fromUserId) {
      throw new ValidationError('callId and fromUserId are required');
    }
    let text = input.text ?? '';
    let srcLang = input.srcLang ?? 'auto';
    let isFinal = input.isFinalHint ?? true;

    // Speech → text (fast partials while the speaker is mid-sentence, final when they pause).
    if (input.audioB64) {
      const seg = await this.ai.transcribe(input.audioB64, {
        language: input.srcLang,
        partial: input.isFinalHint === false,
      });
      text = seg.text;
      srcLang = seg.language || srcLang;
      isFinal = seg.isFinal;
    }
    if (!text.trim()) return { captions: 0, text: '', isFinal };

    // Fan translation out per listener in parallel — total latency = the slowest single translate.
    const targets = input.listeners.filter((l) => l.userId !== input.fromUserId);
    const ts = new Date().toISOString();
    await Promise.all(
      targets.map(async (l) => {
        const translated =
          l.lang === srcLang
            ? text
            : (await this.ai.translate(text, l.lang, srcLang === 'auto' ? undefined : srcLang))
                .text;
        let audioUrl: string | undefined;
        if (l.tts) audioUrl = (await this.ai.synthesize(translated, l.lang)).audioUrl;
        await this.events.caption({
          call_id: input.callId,
          to_user_id: l.userId,
          from_user_id: input.fromUserId,
          text: translated,
          lang: l.lang,
          is_final: isFinal,
          audio_url: audioUrl,
          ts,
        });
      }),
    );
    return { captions: targets.length, text, isFinal };
  }
}
