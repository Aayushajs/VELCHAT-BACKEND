import { CaptionService } from '../../src/realtime-translate/caption.service';
import type { AiGateway } from '../../src/ai-gateway/ai.port';
import type { CaptionEvents } from '../../src/realtime-translate/caption.events';
import type { CallCaptionPayload } from '@velchat/shared-types';
import { ValidationError } from '@velchat/common';

function make(transcript = { text: 'hello', language: 'en', isFinal: true }) {
  const ai = {
    transcribe: jest.fn(async () => transcript),
    translate: jest.fn(async (t: string, tgt: string) => ({
      text: `<${tgt}>${t}`,
      detectedSource: 'en',
    })),
    synthesize: jest.fn(async () => ({ audioUrl: 'https://audio', mime: 'audio/opus' })),
  } as unknown as AiGateway;
  const emitted: CallCaptionPayload[] = [];
  const events = {
    caption: jest.fn(async (p: CallCaptionPayload) => void emitted.push(p)),
  } as unknown as CaptionEvents;
  return { svc: new CaptionService(ai, events), ai, events, emitted };
}

describe('CaptionService (§A26.3 real-time call translation)', () => {
  it('translates a text segment per listener and emits a caption to each (speaker excluded)', async () => {
    const { svc, ai, emitted } = make();
    const res = await svc.caption({
      callId: 'c1',
      fromUserId: 'spk',
      srcLang: 'en',
      text: 'hello',
      listeners: [
        { userId: 'spk', lang: 'en' }, // the speaker — no self-caption
        { userId: 'u-hi', lang: 'hi' },
        { userId: 'u-fr', lang: 'fr', tts: true },
      ],
    });
    expect(res.captions).toBe(2);
    expect(emitted.map((e) => e.to_user_id).sort()).toEqual(['u-fr', 'u-hi']);
    expect(emitted.find((e) => e.to_user_id === 'u-hi')!.text).toBe('<hi>hello');
    expect(emitted.find((e) => e.to_user_id === 'u-fr')!.audio_url).toBe('https://audio'); // tts
    expect(ai.transcribe).not.toHaveBeenCalled(); // text provided → no STT
  });

  it('transcribes audio (Whisper) then translates', async () => {
    const { svc, ai } = make({ text: 'namaste', language: 'hi', isFinal: true });
    const res = await svc.caption({
      callId: 'c1',
      fromUserId: 'spk',
      audioB64: 'BASE64',
      listeners: [{ userId: 'u-en', lang: 'en' }],
    });
    expect(ai.transcribe).toHaveBeenCalled();
    expect(res.text).toBe('namaste');
    expect(res.captions).toBe(1);
  });

  it('same language as source → passes text through (no translate call)', async () => {
    const { svc, ai, emitted } = make();
    await svc.caption({
      callId: 'c1',
      fromUserId: 'spk',
      srcLang: 'en',
      text: 'hello',
      listeners: [{ userId: 'u-en', lang: 'en' }],
    });
    expect(ai.translate).not.toHaveBeenCalled();
    expect(emitted[0]!.text).toBe('hello');
  });

  it('empty transcript → no captions', async () => {
    const { svc } = make({ text: '   ', language: 'en', isFinal: false });
    const res = await svc.caption({
      callId: 'c1',
      fromUserId: 'spk',
      audioB64: 'x',
      listeners: [{ userId: 'u', lang: 'fr' }],
    });
    expect(res.captions).toBe(0);
  });

  it('requires callId + fromUserId', async () => {
    const { svc } = make();
    await expect(svc.caption({ callId: '', fromUserId: '', listeners: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
