# VelChat — Self-Hosted AI Model Server (Hugging Face Spaces)

> **Why:** Render/small hosts have no GPU. Run all AI **models** on ONE separate Python server
> (deploy free on **Hugging Face Spaces**, GPU tier) and point the VelChat backend at it. The backend
> never bundles models — it calls this server over HTTP. **Free / self-hosted only — never a paid API.**

The backend side is **already built and wired** (`apps/ai-service/src/ai-gateway/*` + the real-time
caption pipeline). You only build + deploy the Python server described here, then set 4 env vars.

---

## 1. How it plugs in

```
Client (call) ──audio chunk──▶ ai-service  POST /ai/call/caption
                                   │  STT → translate(per listener) → [TTS]
                                   ▼
                          HttpAiGateway ──HMAC-signed HTTP──▶  YOUR PYTHON SERVER (HF Spaces)
                                   │                              /stt /translate /tts /summarize /moderate /embed
                                   ▼
                          emits call.caption ──▶ realtime-gateway ──WS──▶ each listener (their language)
```

Enable it by setting these on the backend (nothing else changes):

| Env | Meaning |
|-----|---------|
| `AI_BASE_URL` | Your HF Space URL, e.g. `https://<user>-velchat-ai.hf.space` |
| `AI_API_KEY` | Optional bearer token the server checks |
| `AI_HMAC_SECRET` | Shared secret — the backend signs every request; the server verifies it |
| `AI_TIMEOUT_MS` | Per-request realtime budget (default `1500`) |

Unset → the backend uses a **no-op gateway** (boots fine, AI features return empty/echo, no plaintext leaves). Set them → real models. That's the whole switch.

---

## 2. The contract (implement these endpoints)

All are `POST`, JSON in/out. The backend sends `Content-Type: application/json`, optional
`Authorization: Bearer <AI_API_KEY>`, and `x-velchat-signature: HMAC-SHA256(AI_HMAC_SECRET, rawBody)`.

| Endpoint | Request | Response |
|----------|---------|----------|
| `/translate` | `{ text, target, source? }` | `{ text, detectedSource }` |
| `/detect` | `{ text }` | `{ language }` |
| `/stt` | `{ audio /*base64*/, language?, partial? }` | `{ text, language, isFinal }` |
| `/tts` | `{ text, language }` | `{ audioB64?, audioUrl?, mime }` |
| `/summarize` | `{ text, style: "brief"\|"actions"\|"notes" }` | `{ summary }` |
| `/moderate` | `{ text }` | `{ flagged, categories, score }` |
| `/embed` | `{ text }` | `{ vector: number[] }` |

(These match `apps/ai-service/src/ai-gateway/ai.port.ts` — keep them in sync if you extend.)

**Recommended free models:** Whisper (STT) · NLLB-200 / Marian / MADLAD (translate) · Piper or
Coqui-TTS (TTS) · `sentence-transformers` (embed) · a small quantized LLM via `llama.cpp`/vLLM or a
DistilBERT toxicity classifier (summarize/moderate).

---

## 3. Security (verify the HMAC — do not skip)

```python
import hmac, hashlib, os
SECRET = os.environ["AI_HMAC_SECRET"].encode()

def verify(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(SECRET, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
```

- Reject any request whose `x-velchat-signature` doesn't match → the server answers **only** VelChat.
- Also check the `Authorization` bearer if you set `AI_API_KEY`.
- Keep the Space **private** or IP-allowlist the backend egress. Never log request text (no PII).
- The backend only ever sends **enterprise/server-readable** content here. Personal E2EE content is
  translated/transcribed **on-device** and never reaches this server (privacy fork §A26.1).

---

## 4. Latency (<1s realtime) — the rules that matter

- **Keep models warm** (load once at startup; never per-request). Cold starts kill realtime.
- **STT streaming/partials:** honour `partial:true` → return a fast interim `isFinal:false` result
  while the speaker talks, then a corrected `isFinal:true` when they pause. The backend fans these to
  listeners incrementally, so captions appear sub-second.
- **Batch + cache:** cache `(text,target)` translations; batch embeds. Use small/distilled models.
- **GPU:** use the HF Spaces GPU tier for Whisper + NLLB; CPU is fine for detect/embed.
- The backend hard-caps each call at `AI_TIMEOUT_MS` (default 1.5s) and **degrades gracefully** if you
  exceed it — a slow model never stalls a call, it just drops that caption segment.

---

## 5. Minimal FastAPI skeleton (deploy on HF Spaces)

```python
# app.py — HF Space (SDK: docker or gradio→fastapi). Load models ONCE at import.
from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, os

app = FastAPI()
SECRET = os.environ.get("AI_HMAC_SECRET", "").encode()

# load models once (pseudo):
# whisper_model = whisper.load_model("small")
# nllb = pipeline("translation", model="facebook/nllb-200-distilled-600M")
# piper = ...

async def guard(req: Request) -> dict:
    raw = await req.body()
    sig = req.headers.get("x-velchat-signature", "")
    if SECRET and not hmac.compare_digest(hmac.new(SECRET, raw, hashlib.sha256).hexdigest(), sig):
        raise HTTPException(401, "bad signature")
    import json; return json.loads(raw or b"{}")

@app.post("/translate")
async def translate(req: Request):
    b = await guard(req)
    # out = nllb(b["text"], tgt_lang=b["target"])[0]["translation_text"]
    return {"text": "<translated>", "detectedSource": b.get("source") or "en"}

@app.post("/stt")
async def stt(req: Request):
    b = await guard(req)
    # decode base64 audio → whisper → text
    return {"text": "", "language": b.get("language") or "en", "isFinal": not b.get("partial")}

# /detect /tts /summarize /moderate /embed — same shape as §2
```

`Dockerfile` (HF Space): install `torch`, `transformers`, `faster-whisper`, `piper-tts`,
`sentence-transformers`, `fastapi`, `uvicorn`; `CMD uvicorn app:app --host 0.0.0.0 --port 7860`.

---

## 6. Real-time call translation — end-to-end flow

1. Client joins a LiveKit call and captures the **local mic track** in short chunks (~300–500ms).
2. Client `POST /ai/call/caption` with `{ callId, fromUserId, audioB64, srcLang?, isFinalHint, listeners:[{userId, lang, tts?}] }`.
3. ai-service: `/stt` → per-listener `/translate` (parallel) → optional `/tts` → emits `call.caption` per listener.
4. realtime-gateway pushes each `call.caption` to that listener's socket → the client renders the
   subtitle (and plays the TTS audio if `tts:true`). Each participant sees/hears the call in **their own language**.

Personal E2EE calls do the same **on-device** (server relays only encrypted media) — this server is for
enterprise/server-readable calls.

---

## 7. What's built vs your to-do

| Piece | Status |
|-------|--------|
| Backend AI gateway (HTTP, HMAC, timeout, no-op default) | ✅ built (`ai-gateway/`) |
| Real-time caption pipeline (STT→translate→TTS→fan-out) | ✅ built (`realtime-translate/`) |
| `call.caption` event + realtime-gateway delivery | ✅ built |
| Env wiring + graceful degrade | ✅ built |
| **The Python model server (this doc)** | ⬜ **you deploy on HF Spaces** |
| Client: capture LiveKit track chunks + render captions/TTS | ⬜ client work |
| Other AI (summaries/moderation/semantic-search) callers | ⬜ wire the same gateway where needed |

Set the 4 env vars, deploy the server, and real-time multilingual calls light up — no backend change.
