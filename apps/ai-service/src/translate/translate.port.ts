/** A translation result: the translated text + the detected/assumed source language. */
export interface TranslationResult {
  text: string;
  detectedSource: string;
}

/**
 * Translation provider port (§A26). Adapters: an HTTP client to a self-hosted model server
 * (LibreTranslate / NLLB / Marian — all free & self-hostable) and a dev echo provider. The server
 * only ever translates ENTERPRISE (server-readable) content; personal E2EE is on-device (§A26.1).
 */
export interface TranslationProvider {
  readonly name: string;
  /** Translate `text` into `target` (BCP-47/ISO code). `source` optional → provider auto-detects. */
  translate(text: string, target: string, source?: string): Promise<TranslationResult>;
  /** Detect the language of `text` → ISO code. */
  detect(text: string): Promise<string>;
}
