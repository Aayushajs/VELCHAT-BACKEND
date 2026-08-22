/**
 * Unified AI model gateway (§A25/§A26). Every model capability the app needs runs on ONE external,
 * self-hosted Python server (deploy on Hugging Face Spaces — see docs/AI-SERVER.md); this port is
 * the contract the backend calls over HTTP. Free/self-hosted only — never a paid API.
 *
 * Privacy fork (hard rule): only ENTERPRISE (server-readable) content is sent here. Personal E2EE
 * content is translated/transcribed ON-DEVICE and never reaches this gateway (§A26.1).
 */

export interface TranslationResult {
  text: string;
  detectedSource: string;
}

export interface TranscriptSegment {
  /** Recognised text for this audio segment. */
  text: string;
  /** Detected spoken language (ISO code). */
  language: string;
  /** True once the segment is final (vs a fast partial) — enables sub-second incremental captions. */
  isFinal: boolean;
}

export interface SpeechResult {
  /** Base64 audio (e.g. opus/wav) the client can play back, or a short-lived URL. */
  audioB64?: string;
  audioUrl?: string;
  mime: string;
}

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  score: number;
}

export interface AiGateway {
  readonly name: string;
  /** Translate `text` into `target` (source auto-detected when omitted). */
  translate(text: string, target: string, source?: string): Promise<TranslationResult>;
  /** Detect the language of `text` → ISO code. */
  detect(text: string): Promise<string>;
  /** Speech-to-text on one audio segment (Whisper). `partial` requests a fast interim result. */
  transcribe(
    audioB64: string,
    opts?: { language?: string; partial?: boolean },
  ): Promise<TranscriptSegment>;
  /** Text-to-speech (Piper/Coqui) → audio the listener can hear in their language. */
  synthesize(text: string, language: string): Promise<SpeechResult>;
  /** Summarise text (meeting recap / action items) via a self-hosted LLM. */
  summarize(text: string, opts?: { style?: 'brief' | 'actions' | 'notes' }): Promise<string>;
  /** Moderate text (toxicity/PII) for enterprise content. */
  moderate(text: string): Promise<ModerationResult>;
  /** Embed text for semantic search (k-NN). */
  embed(text: string): Promise<number[]>;
}
