"""Minimal OpenAI-compatible speech-to-text server (POST /v1/audio/transcriptions).

CloudCLI's mic button sends recorded audio here (VOICE_API_BASE_URL). Runs
faster-whisper on CPU so audio never leaves the machine.

Binds 127.0.0.1 only, and every request must carry `Authorization: Bearer $STT_API_KEY`,
because other users on a shared host can reach 127.0.0.1 ports.

Env:
  STT_API_KEY   required shared secret (start.sh generates one into local.env)
  STT_PORT      default 8765
  STT_MODEL     faster-whisper model name, default "large-v3-turbo"
  STT_THREADS   CPU threads, default 16
"""
import hmac
import os
import tempfile

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

API_KEY = os.environ["STT_API_KEY"]
MODEL_NAME = os.environ.get("STT_MODEL", "large-v3-turbo")
THREADS = int(os.environ.get("STT_THREADS", "16"))

model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS)
app = FastAPI()


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form("whisper-1", alias="model"),  # accepted and ignored
    authorization: str = Header(""),
):
    if not hmac.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(status_code=401, detail="bad api key")
    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(await file.read())
        f.flush()
        segments, _ = model.transcribe(f.name, beam_size=1, vad_filter=True)
        text = "".join(s.text for s in segments).strip()
    return {"text": text}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("STT_PORT", "8765")), log_level="warning")
