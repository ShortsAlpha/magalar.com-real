# Magalar TTS backend

Serverless text-to-speech API for magalar.com. It is a FastAPI app on [Modal](https://modal.com) that uses
[edge-tts](https://github.com/rany2/edge-tts) for synthesis (322 voices, 75 languages), Cloudflare R2 for audio and
subtitle storage, and Postgres (Neon) for the per-user render library. Every endpoint except the public `/demo` requires
a Clerk session token.

## Architecture

```
Browser (Next.js, Clerk)            Modal: app "serverless-tts", function "generate_speech"
  useAuth().getToken()  ──Bearer──▶  CORS (ALLOWED_ORIGINS)
                                     └─ body-size limit (1 MiB JSON / 26 MiB multipart / 16 KiB /demo)
                                        ├─ require_user: verify Clerk JWT (RS256 via JWKS)
                                        │  └─ validate ─▶ chunk text ─▶ edge-tts (parallel, WordBoundary)
                                        │             ─▶ stitch MP3 + build SRT/VTT ─▶ R2 ─▶ library row (Neon)
                                        └─ /demo (no Clerk): Turnstile ─▶ rate limit (modal.Dict) ─▶ raw MP3
```

| File | Purpose |
|---|---|
| `main.py` | Modal app + image, FastAPI routes, R2 helpers |
| `auth.py` | Clerk session-token verification (`require_user` dependency) |
| `validation.py` | Request models, limits, voice/rate/pitch/volume formats, body-size middleware, .docx checks |
| `textproc.py` | Unicode-aware sentence chunking, default titles, language from voice id |
| `synth.py` | edge-tts orchestration: parallel chunks, retries, stitching, WordBoundary → subtitles |
| `subtitles.py` | Word alignment, cue grouping, SRT / WebVTT formatting |
| `mp3util.py` | MPEG frame parser used for exact durations |
| `library.py` | Postgres (asyncpg) library + user-scoped R2 keys |
| `demo.py` | Turnstile verification, client IP, `/demo` rate limiter |
| `test_backend.py` | Smoke test against a deployed URL (`BACKEND_URL`, `CLERK_TOKEN` from env) |

None of the local modules import Modal, so they can be unit-tested locally. They are copied into the container with
`Image.add_local_python_source(...)` (see `LOCAL_MODULES` in `main.py`).

The public URL is `https://<workspace>--serverless-tts-generate-speech.modal.run`. It comes from the app name
(`serverless-tts`) and the function name (`generate_speech`). Don't rename either one.

## Endpoints

Defaults: `voice=en-US-AriaNeural`, `rate=+0%`, `pitch=+0Hz`, `volume=+0%`. Every `*_url` is a presigned R2 GET URL
that expires after 3600 s.

### Renders (Clerk required)

| Method + path | Request | Success response |
|---|---|---|
| `POST /` | JSON `{text, voice?, rate?, pitch?, volume?, title?, save?}` | `{"status":"success","render_id","audio_url","srt_url","vtt_url","duration_ms","chunks_processed"}` |
| `POST /generate_multi` | JSON `{segments:[{text, voice, rate?, pitch?, volume?}], title?, save?}` | same, with `segments_processed` instead of `chunks_processed` |
| `POST /process_docx` | multipart: `file` (.docx), optional `voice`, `rate`, `pitch`, `volume` | `application/zip` stream (see below) |

- `title` is optional, at most 120 chars. The default is the first ~60 chars of the text, cut at a word boundary (DOCX: the
  document file name without `.docx`).
- `render_id` is the library id, or `null` when the library is off, when the library write failed, or for previews.
- **`save`** (strict boolean, default `true`; strings such as `"false"` are rejected with 400):
  - `true`: normal render (MP3 + SRT + VTT, library row).
  - `false`: **preview**. Text is capped at 500 chars (400 above that; for `/generate_multi` the sum over segments). Only
    the MP3 is stored, under `previews/{uuid}.mp3`. No library row is written. `render_id`, `srt_url` and `vtt_url` are
    `null`. Use this for the studio's voice and block previews.
- `/process_docx` returns a zip with `NN.mp3`, `NN.srt` and `NN.vtt` per scene, plus images `NN_k.ext`. Headers:
  `Content-Disposition: attachment; filename="<docname>.zip"; filename*=UTF-8''<docname>.zip` and `X-Render-Id: <uuid>`
  (empty when the library is off or the store failed). Both are exposed via CORS. When the library is on, the same zip is
  also stored in R2 (`bundle.zip`). The zip is built in a temp file, not in memory: each scene is added as soon as it
  finishes, the file is uploaded to R2 and streamed back from disk, then deleted.

### Library (Clerk required)

| Method + path | Request | Response |
|---|---|---|
| `GET /library` | query `limit` (default 30, max 100), `cursor` (`created_at` ISO of the last item), `q` (case-insensitive title search), `kind` (`single`, `dialogue`, `docx`) | `{"status":"success","items":[...],"next_cursor":"<iso>"\|null}` |
| `PATCH /library/{id}` | JSON `{title}` (1–120 chars) | `{"status":"success","item":{...}}` |
| `DELETE /library/{id}` | | `{"status":"success"}`. Deletes the R2 objects first, then the row. If R2 fails, the row is kept (502) so the user can retry |

Each item looks like `{id, kind, title, voice, voices, language, chars, duration_ms, scenes, size_bytes, created_at,
audio_url, srt_url, vtt_url, zip_url}`. The URLs are freshly presigned for 1 h, or `null` when the object doesn't exist.

- An unknown id, a malformed id, or another user's id returns **404**.
- Without `DATABASE_URL`, all three endpoints return **503** `{"status":"error","message":"Library is not configured"}`.
  Auth is still checked first, so a missing token gets 401.

### Public demo (no Clerk)

`POST /demo` with JSON `{text (1–200 chars), voice, turnstile_token}` returns raw `audio/mpeg` with `Cache-Control: no-store`.
Prosody is fixed (`+0%`, `+0Hz`, `+0%`). Nothing is stored in R2 or the library.

Steps, in order:

1. If `TURNSTILE_SECRET_KEY` is missing, return **503**. The endpoint fails closed.
2. Validate the body (**400**).
3. Pre-check the rate limit, read-only. Requests that are already over the limit never hit Cloudflare.
4. Verify Turnstile server-side. The backend POSTs `secret`, `response` and `remoteip` to
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` (async httpx, 5 s timeout). Any failure, timeout or non-200
   returns **403** `{"status":"error","message":"Verification failed"}`.
5. Claim the rate-limit slots (**429**).
6. Synthesize. A failure returns **502**.

**Rate limits** use the `modal.Dict` named `magalar-demo-ratelimit` (created on first use). Windows are fixed and in UTC:

| Scope | Limit |
|---|---|
| per IP | 5 per 10 minutes, and 30 per day |
| global | 2,000 per day |

A 429 looks like `{"status":"error","message":"Too many requests. Please try again later.","retry_after":<s>}` and
carries a `Retry-After: <s>` header (exposed via CORS). `modal.Dict` has no atomic increment, so each request claims a
numbered slot with `put(key, value, skip_if_exists=True)`, which is an atomic create-if-absent. A counter is kept only as
a hint, so concurrent requests can't overshoot a limit. If the Dict is unreachable, the endpoint returns 503 (fail
closed). IPs are stored only as truncated SHA-256 hashes, and Dict entries expire after 7 days of inactivity.

**Client IP.** The backend uses `request.client.host`. Modal's web-endpoint guide documents it as the requesting
client's address and suggests it for rate limiting. `X-Forwarded-For`, `CF-Connecting-IP` and `X-Real-IP` are
deliberately ignored, because callers set them freely and could reset their own quota. The global cap bounds abuse even
when IPs rotate. If you ever put a proxy (for example a Next.js route) in front of `/demo`, every request will share the
proxy's IP. In that case, revisit this choice and trust a header only from that proxy.

### Limits and validation

| Rule | Limit |
|---|---|
| `/` text | not empty or whitespace, at most 50,000 chars (500 with `save:false`) |
| `/generate_multi` | 1–200 segments, no empty segment, at most 50,000 chars in total (500 with `save:false`) |
| `/process_docx` | `.docx` only, at most 25 MB, at most 250 MB uncompressed (zip-bomb guard), at most 200,000 spoken-script chars |
| `/demo` text | 1–200 chars. `turnstile_token` at most 2048 chars |
| `title` | at most 120 chars. Control characters are stripped and whitespace is collapsed |
| `voice` | `^[a-z]{2,3}(-[A-Za-z]{2,8}){1,3}-[A-Za-z]+Neural$`, at most 64 chars. Accepts all 322 ids in `lib/voices.json` |
| `rate`, `volume` | `^[+-]\d{1,3}%$` |
| `pitch` | `^[+-]\d{1,3}Hz$` |
| Raw body | 1 MiB for JSON routes, 26 MiB for `/process_docx`, 16 KiB for `/demo`. Enforced while streaming |

For authenticated routes, the body is read only after authentication succeeds.

### Error contract

Every error body has the shape `{"status": "error", "message": "<human readable>"}`.

| HTTP | When |
|---|---|
| 400 | Invalid input (text, voice, rate, pitch, volume, title, `save`, JSON, file type, .docx, library query params, nothing speakable) |
| 401 | Missing, invalid or expired Clerk token. The message is always `"Unauthorized"` (+ `WWW-Authenticate: Bearer`) |
| 403 | `/demo`: Turnstile verification failed |
| 404 | `/library/{id}`: unknown id, or another user's id |
| 413 | Request body or uploaded file too large |
| 422 | `/process_docx`: the document parses but can't be used |
| 429 | `/demo` rate limit, with `retry_after` + `Retry-After` |
| 502 | `/demo` synthesis failed. `DELETE /library/{id}`: R2 delete failed (the row is kept) |
| 503 | Clerk not configured or JWKS unreachable. Library not configured, or the DB is unreachable. Demo not configured, or the Dict is unreachable |
| 200 + `status:"error"` | Runtime TTS or R2 failure in `/` and `/generate_multi` (legacy). The details go only to the Modal logs |

## Multi-language and subtitles

- **Chunking** (`textproc.py`) splits at Unicode-aware sentence ends:
  - Latin `. ! ? …` only when followed by whitespace, so `3.14` is never split.
  - These end a sentence unconditionally: CJK `。！？｡．`, Devanagari/Bengali `। ॥`, Arabic/Urdu `؟ ۔`, Ethiopic `። ፧`,
    Myanmar `။`, Khmer `។ ៕`.
  - An over-long sentence is split at whitespace, then at a clause mark (`, ; : ، 、 ，`), then at a hard length that
    never separates a combining mark. This covers Thai text without spaces.
  - Each chunk is at most 2000 chars **and** at most 3800 UTF-8 bytes after XML escaping. That keeps every chunk under
    edge-tts' internal 4096-byte split, so one chunk is one request. Chunks run 8 in parallel, and each is retried with
    backoff (3 attempts).
- **Voice ids** are sent to edge-tts in Microsoft's long form, `Microsoft Server Speech Text to Speech Voice (iu-Cans-CA,
  SiqiniqNeural)`. edge-tts 7.2.8 can't expand the Inuktitut ids (`iu-Cans-CA-*`, `iu-Latn-CA-*`) by itself.
- **Subtitles** come from edge-tts `WordBoundary` events: `{"type":"WordBoundary","offset","duration","text"}` in 100-ns
  ticks, verified against the edge-tts 7.2.8 source.
  - Edge reports bare words, so each word is located in the chunk's source text. This restores punctuation and the
    original spacing, which matters for CJK and Thai.
  - Words are grouped into cues of at most ~42 columns (CJK counts as two) and at most 5 s. A cue always breaks after a
    sentence end, after a clause mark once the line is half full, and on a pause longer than 0.7 s.
  - SRT uses `HH:MM:SS,mmm`. VTT uses a `WEBVTT` header and `HH:MM:SS.mmm`. Both are UTF-8.
  - **Fallback:** a few voices (`da-DK-ChristelNeural` and `th-TH-PremwadeeNeural` at the time of testing) intermittently
    return no audio when word boundaries are requested. For those the chunk is re-requested with `SentenceBoundary`, and each
    sentence's lines are timed proportionally inside the sentence. The voice is then remembered for 10 minutes per
    container.
- **Timeline and duration.** edge-tts outputs headerless 24 kHz, 48 kbps mono CBR MP3. There is no ID3 or Xing frame,
  and every frame is an MPEG-2 Layer III frame of 576 samples (24 ms).
  - Chunks are stitched byte-wise, so the stitched timeline is exactly the sum of each chunk's frames.
  - `mp3util.duration_ticks` counts frames (with resync, ID3 and Xing skipping, and a 48 kbps byte fallback). Each
    chunk's word offsets are shifted by the running total, using integer tick math.
  - Measured on the stitched output, `duration_ms` matched the ffmpeg-decoded PCM length to the millisecond.
  - On a 27-chunk, 11-minute render, the subtitle error at each chunk boundary was constant (the first-word offset sits
    100–120 ms before the energy-detected onset, from Microsoft's own word offsets). There was **no cumulative drift**:
    the second-half mean minus the first-half mean was −1 ms.
- `duration_ms` is returned by `/` and `/generate_multi`. It is `null` for DOCX library rows, since the zip holds several
  scenes.

## Library (Postgres / Neon)

`library.py` uses asyncpg with a lazily created pool (`min_size=0`, `max_size=5`).

- Neon's **pooled** endpoint is PgBouncer in transaction mode, so the pool uses `statement_cache_size=0`.
- A missing `sslmode` defaults to `require`.
- Neon's `channel_binding=require` parameter is a libpq option that asyncpg doesn't use. It is stripped defensively, and
  Neon's URL connects either way (asyncpg `>=0.30,<1`).
- The table is created idempotently at startup. This runs as a background task, so cold starts are not slowed down; if
  it fails, it is retried on first use. Creation runs under `pg_advisory_xact_lock`, so parallel containers don't race.
- A failed library write never fails a render. It is logged, and the render returns `render_id: null`. The R2 objects
  stay where the returned URLs point.

```sql
CREATE TABLE IF NOT EXISTS renders (
    id          uuid PRIMARY KEY,
    user_id     text NOT NULL,                 -- Clerk sub
    kind        text NOT NULL CHECK (kind IN ('single', 'dialogue', 'docx')),
    title       text NOT NULL DEFAULT '',
    voice       text,                          -- dialogue: first voice
    voices      text[] NOT NULL DEFAULT '{}',
    language    text,                          -- e.g. 'tr'
    chars       int NOT NULL DEFAULT 0,
    duration_ms int,                           -- null for docx
    scenes      int,                           -- docx only
    audio_key   text,
    srt_key     text,
    vtt_key     text,
    zip_key     text,
    size_bytes  bigint NOT NULL DEFAULT 0,     -- sum of stored objects
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renders_user_created_idx ON renders (user_id, created_at DESC);
```

R2 keys:

| Case | Keys |
|---|---|
| Library on | `users/{clerk_user_id}/{render_id}/audio.mp3`, `subtitles.srt`, `subtitles.vtt` and `bundle.zip` (docx) |
| Library off | `generated/{uuid}.mp3/.srt/.vtt` (`generated/multi_{uuid}.*` for dialogue) |
| Previews (`save:false`) | `previews/{uuid}.mp3` |

Consider an R2 lifecycle rule that deletes `previews/` (and `generated/`, if the library is on) after 1 day.

**Getting the Neon pooled connection string:**

1. Open Neon Console, go to your project, then **Dashboard**, then **Connect**.
2. Turn on **Connection pooling**. The host gets a `-pooler` suffix, e.g.
   `ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech`.
3. Copy the `postgresql://user:password@...-pooler.../neondb?sslmode=require&channel_binding=require` URL. It can be
   used as is.

## Secrets and environment

Nothing secret lives in this repo. Everything comes from four Modal secrets, and all four must exist before deploying.

| Modal secret | Key | Required | Description |
|---|---|---|---|
| `magalar-r2` | `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` | yes | R2 bucket and API token (endpoint `https://<account>.r2.cloudflarestorage.com`) |
| `magalar-clerk` | `CLERK_ISSUER` | yes | Clerk Frontend API URL, e.g. `https://clerk.magalar.com`. Must be `https://` |
| `magalar-clerk` | `CLERK_JWKS_URL` | no | Overrides `${CLERK_ISSUER}/.well-known/jwks.json` |
| `magalar-clerk` | `ALLOWED_ORIGINS` | no | Comma-separated origins for CORS and the `azp` check. Default: `https://magalar.com,https://www.magalar.com,http://localhost:3000` |
| `magalar-db` | `DATABASE_URL` | secret yes, value may be empty | Neon **pooled** connection string. Empty means the library is off |
| `magalar-turnstile` | `TURNSTILE_SECRET_KEY` | secret yes | Cloudflare Turnstile secret. Missing or empty makes `/demo` answer 503 |

CORS allows the methods `GET, POST, PATCH, DELETE, OPTIONS` and the headers `Authorization, Content-Type`, and exposes
`Content-Disposition, X-Render-Id, Retry-After`. `/demo` is called from the same origins.

### Token verification (auth.py)

- RS256 only, checked against Clerk's JWKS. The JWKS client is cached for 1 h and refetched when it sees an unknown `kid`.
- Requires `exp`, `iss` and `sub`, with 30 s of leeway. `iss` must equal `CLERK_ISSUER`. If `azp` is present, it must be
  one of `ALLOWED_ORIGINS`.
- Tokens are never logged. Logs contain only the Clerk user id, char counts and the voice, never text or IPs (`/demo`
  stores IP hashes only).

### Finding the Clerk issuer

Go to the Clerk Dashboard, then **Configure → Domains** (or **API keys → Show API URLs**), and copy the **Frontend API URL**.
You can also derive it from the publishable key: base64-decode the part after `pk_test_` or `pk_live_`, drop the trailing
`$`, and prefix `https://`.

## Deploy

Run these from the repo root with the Modal CLI logged in (`pip install modal`, then `modal setup`). **Order matters:**
the secrets must exist before `modal deploy`, and the backend must be deployed before the frontend starts calling
`/library` or `/demo`.

```bash
# 1. R2 credentials (existing; use rotated keys, see "Key rotation")
modal secret create magalar-r2 \
  R2_BUCKET_NAME=<bucket> R2_ACCESS_KEY_ID=<access-key-id> \
  R2_SECRET_ACCESS_KEY=<secret-access-key> R2_ACCOUNT_ID=<cloudflare-account-id>

# 2. Clerk config (existing)
modal secret create magalar-clerk \
  CLERK_ISSUER=https://<your-frontend-api> \
  ALLOWED_ORIGINS=https://magalar.com,https://www.magalar.com,http://localhost:3000

# 3. NEW: library database (Neon pooled URL; quote it because of '&')
modal secret create magalar-db \
  'DATABASE_URL=postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
#    ...or, to deploy with the library switched off for now:
# modal secret create magalar-db DATABASE_URL=

# 4. NEW: Turnstile secret (Cloudflare dashboard → Turnstile → your widget → Secret key)
modal secret create magalar-turnstile TURNSTILE_SECRET_KEY=<turnstile-secret-key>
#    Staging / local dev: Cloudflare's test secret that always passes
#    (pair it with the test site key 1x00000000000000000000AA on the frontend):
# modal secret create magalar-turnstile TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# 5. Deploy (main.py imports its dependencies at load time, so install them locally first)
pip install -r backend/requirements.txt
modal deploy backend/main.py
```

To change a secret later, use `modal secret create --force <name> ...`, then run `modal deploy backend/main.py` again.
The `renders` table is created automatically on the first container start. Nothing needs to be run by hand.

Then set these in the frontend environment:

- `NEXT_PUBLIC_BACKEND_URL=https://<workspace>--serverless-tts-generate-speech.modal.run`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>` (use `1x00000000000000000000AA` with the test secret)

### Runtime settings and cost

- `timeout=600` s per request.
- `@modal.concurrent(max_inputs=10)`. Synthesis is I/O-bound, so one container also serves library calls while a long
  render runs.
- `scaledown_window=300`. A container stays warm 5 minutes after the last request, so library browsing and previews
  don't hit cold starts. The trade-off is up to 5 minutes of idle container time per burst of traffic, billed by Modal.
  The default is 60 s. Lower it if idle cost matters more than latency.
- `edge-tts` is pinned to `7.2.8`, because the WordBoundary API and its CBR offset handling were verified against that
  version. Re-test the subtitles before bumping it.

## Smoke test

```bash
BACKEND_URL=https://<workspace>--serverless-tts-generate-speech.modal.run \
CLERK_TOKEN=<fresh session token> \
python backend/test_backend.py
```

To get a token, run `await window.Clerk.session.getToken()` in the browser console on a signed-in magalar page.
Session tokens live about 60 s.

## Key rotation (action required)

The R2 access key pair used by the old `serverless-tts` repo was **hardcoded and committed to that repo's git history**.
Treat it as compromised:

1. Create a new bucket-scoped R2 API token (Object Read & Write) in Cloudflare.
2. Put it into `magalar-r2` and redeploy.
3. Revoke the old token.

Never put credentials in source. Use `modal.Secret.from_name(...)` only.
