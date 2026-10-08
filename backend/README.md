# Magalar TTS backend

Serverless text-to-speech API for magalar.com. It is a FastAPI app on [Modal](https://modal.com) that uses
[edge-tts](https://github.com/rany2/edge-tts) for synthesis and Cloudflare R2 for audio storage. Every
endpoint requires a Clerk session token.

## Architecture

```
Browser (Next.js, Clerk)            Modal: app "serverless-tts", function "generate_speech"
  useAuth().getToken()  ──Bearer──▶  CORS (ALLOWED_ORIGINS)
                                     └─ body-size limit (1 MiB JSON / 26 MiB multipart)
                                        └─ require_user: verify Clerk JWT (RS256 via JWKS)
                                           └─ validate input ─▶ edge-tts (parallel chunks)
                                                               ─▶ R2 upload ─▶ presigned GET URL (1 h)
```

| File | Purpose |
|---|---|
| `main.py` | Modal app + image, FastAPI routes, generation logic |
| `auth.py` | Clerk session-token verification (`require_user` dependency). No Modal import, so you can unit-test it |
| `validation.py` | Request models, limits, voice/rate/pitch/volume formats, body-size middleware, .docx checks |
| `test_backend.py` | Smoke test against a deployed URL (`BACKEND_URL`, `CLERK_TOKEN` from env) |

`auth.py` and `validation.py` are copied into the container with `Image.add_local_python_source("auth", "validation")`.

The public URL is `https://<workspace>--serverless-tts-generate-speech.modal.run`. It comes from the app name
(`serverless-tts`) and the function name (`generate_speech`). Don't rename either one.

### Endpoints

Every endpoint is `POST` and requires `Authorization: Bearer <Clerk session JWT>`.

| Path | Request | Success response |
|---|---|---|
| `/` | JSON `{text, voice?, rate?, pitch?, volume?}` | `200 {"status":"success","audio_url","chunks_processed"}` |
| `/generate_multi` | JSON `{segments:[{text, voice, rate?, pitch?, volume?}, ...]}` | `200 {"status":"success","audio_url","segments_processed"}` |
| `/process_docx` | multipart, field `file` (.docx) | `200` `application/zip` (`Content-Disposition: attachment; filename=course_assets.zip`, exposed via CORS) |

Defaults: `voice=en-US-AriaNeural`, `rate=+0%`, `pitch=+0Hz`, `volume=+0%`. The `audio_url` is a presigned R2 URL that expires after 3600 s.

### Limits and validation

| Rule | Limit |
|---|---|
| `/` text | must not be empty or whitespace, at most 50,000 chars |
| `/generate_multi` | 1 to 200 segments, no empty segment, at most 50,000 chars in total |
| `/process_docx` | `.docx` only, 25 MB maximum, at most 250 MB uncompressed (zip-bomb guard), at most 200,000 spoken-script chars |
| `voice` | `^[a-z]{2,3}(-[A-Za-z]{2,8}){1,3}-[A-Za-z]+Neural$` (e.g. `tr-TR-EmelNeural`), at most 64 chars |
| `rate`, `volume` | `^[+-]\d{1,3}%$` |
| `pitch` | `^[+-]\d{1,3}Hz$` |
| Raw body | 1 MiB for JSON routes, 26 MiB for `/process_docx`. Enforced while streaming, so chunked uploads are capped too |

The body is read only after authentication succeeds, so unauthenticated callers can't make the server parse uploads.

### Error contract

Every error body has the shape `{"status": "error", "message": "<human readable>"}`.

| HTTP | When |
|---|---|
| 400 | Invalid input: empty or too-long text, bad voice/rate/pitch/volume, malformed JSON, wrong file type, invalid .docx |
| 401 | Missing, invalid, or expired Clerk token. Message is always `"Unauthorized"` (+ `WWW-Authenticate: Bearer`) |
| 413 | Request body or uploaded file too large |
| 422 | `/process_docx`: the document parses but can't be used (parse failure, no `Scene ...` sections) |
| 503 | Server auth not configured (`CLERK_ISSUER` missing), or Clerk JWKS unreachable |
| 200 + `status:"error"` | Runtime TTS or R2 failure in `/` and `/generate_multi` (legacy behaviour, kept for compatibility). The message is generic and the details go only to the Modal logs |

The frontend should check `response.status === 401` (re-auth or sign in). For every other error it shows `json.message`.

## Secrets and environment

Nothing secret lives in this repo. Everything comes from two Modal secrets:

| Modal secret | Key | Required | Description |
|---|---|---|---|
| `magalar-r2` | `R2_BUCKET_NAME` | yes | R2 bucket for generated audio |
| `magalar-r2` | `R2_ACCESS_KEY_ID` | yes | R2 API token access key id |
| `magalar-r2` | `R2_SECRET_ACCESS_KEY` | yes | R2 API token secret |
| `magalar-r2` | `R2_ACCOUNT_ID` | yes | Cloudflare account id (endpoint `https://<id>.r2.cloudflarestorage.com`) |
| `magalar-clerk` | `CLERK_ISSUER` | yes | Clerk Frontend API URL, e.g. `https://clerk.magalar.com` (prod) or `https://<slug>.clerk.accounts.dev` (dev). Must be `https://` |
| `magalar-clerk` | `CLERK_JWKS_URL` | no | Overrides the JWKS URL. Default: `${CLERK_ISSUER}/.well-known/jwks.json` |
| `magalar-clerk` | `ALLOWED_ORIGINS` | no | Comma-separated origins for CORS and the token `azp` check. Default: `https://magalar.com,https://www.magalar.com,http://localhost:3000` |

The backend fails closed. If `CLERK_ISSUER` is missing, every request gets a 503, and the secret
declares `required_keys=["CLERK_ISSUER"]`, so the deploy fails without it.

### Token verification (auth.py)

- RS256 only, signature checked against Clerk's JWKS. `PyJWKClient` is cached at module level, with the key set cached for 1 h and refetched on an unknown `kid`.
- Requires `exp`, `iss`, and `sub`. `exp`, `nbf`, and `iat` are validated with a 30 s leeway, and `iss` must equal `CLERK_ISSUER`.
- If an `azp` claim is present, it must be one of `ALLOWED_ORIGINS`.
- Tokens are never logged. Each request logs only the Clerk user id (`sub`), plus char counts and the voice, never the text.

### Finding the Clerk issuer

- **Dashboard:** Clerk Dashboard, then **Configure → Domains** (or **API keys → Show API URLs**), then **Frontend API URL**.
- **From the publishable key:** take the part after `pk_test_` or `pk_live_`, base64-decode it, strip the trailing `$`, and prefix `https://`:

  ```bash
  # bash
  echo "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" | sed -E 's/^pk_(test|live)_//' | base64 -d | sed 's/\$$//; s#^#https://#'
  ```
  ```powershell
  # PowerShell
  $k = $env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY -replace '^pk_(test|live)_',''
  $k += '=' * ((4 - $k.Length % 4) % 4)
  'https://' + ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($k))).TrimEnd('$')
  ```

Use the **production** instance's issuer (`https://clerk.magalar.com`) for the production deploy. A development
instance has its own issuer, `https://<slug>.clerk.accounts.dev`.

## Deploy

Run these from the repo root. You need the Modal CLI and must be logged in: `pip install modal`, then `modal setup`.

```bash
# 1. R2 credentials (use NEW, rotated keys; see "Key rotation" below)
modal secret create magalar-r2 \
  R2_BUCKET_NAME=<bucket> \
  R2_ACCESS_KEY_ID=<access-key-id> \
  R2_SECRET_ACCESS_KEY=<secret-access-key> \
  R2_ACCOUNT_ID=<cloudflare-account-id>

# 2. Clerk config
modal secret create magalar-clerk \
  CLERK_ISSUER=https://<your-frontend-api> \
  ALLOWED_ORIGINS=https://magalar.com,https://www.magalar.com,http://localhost:3000

# 3. Deploy (main.py imports edge_tts, boto3, docx and jwt at load time,
#    so install requirements locally first)
pip install -r backend/requirements.txt
modal deploy backend/main.py
```

To change a secret later, add `--force` to overwrite it (`modal secret create --force magalar-clerk ...`), then
run `modal deploy backend/main.py` again.

Then set `NEXT_PUBLIC_BACKEND_URL=https://<workspace>--serverless-tts-generate-speech.modal.run` in the frontend environment.

## Smoke test

```bash
BACKEND_URL=https://<workspace>--serverless-tts-generate-speech.modal.run \
CLERK_TOKEN=<fresh session token> \
python backend/test_backend.py
```

To get a token, run `await window.Clerk.session.getToken()` in the browser console on a signed-in magalar page.
Session tokens live about 60 s. Without `CLERK_TOKEN`, the script only checks that unauthenticated calls get a 401.

## Key rotation (action required)

The R2 access key pair used by the old `serverless-tts` repo was **hardcoded in `main.py` and committed to that
repo's git history**. Treat it as compromised:

1. In Cloudflare, go to **R2 → Manage R2 API Tokens**. Create a new token scoped to the bucket only (Object Read & Write).
2. Put the new values into the `magalar-r2` Modal secret (step 1 above) and redeploy.
3. **Revoke or delete the old token** in Cloudflare.
4. Optionally, purge the old repo's history (`git filter-repo`) or make it private. Rotation is what actually matters.

Never put credentials in source again. Use `modal.Secret.from_name(...)` only.
