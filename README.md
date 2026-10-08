# Magalar — magalar.com

Studio-grade text to speech. The public landing page lives at `/`; after signing in with Clerk, users work in the TTS studio at `/studio`.

| Route | What it is |
|---|---|
| `/` | Landing page (`app/page.tsx`, `components/landing/`, `app/landing.css`) |
| `/sign-in`, `/sign-up` | Clerk auth pages (`components/auth/`) |
| `/studio` | TTS studio — single voice, dialogue, DOCX automator (`components/studio/`). Protected by `proxy.ts` |
| `/api/download` | Authenticated download proxy for R2 audio links |
| `backend/` | FastAPI on Modal (edge-tts + Cloudflare R2), verifies Clerk session tokens — see [backend/README.md](backend/README.md) |

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the Clerk keys and backend URL
npm run dev                  # http://localhost:3000
```

On Windows you can also double-click `start.bat`.

## Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk API keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in`, `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/studio` |
| `NEXT_PUBLIC_BACKEND_URL` | Modal endpoint, e.g. `https://<workspace>--serverless-tts-generate-speech.modal.run` |

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 3 · Clerk (Core 3) · GSAP · Python FastAPI on Modal · edge-tts · Cloudflare R2.

Design: monochrome (black, white, neutral greys), no gradients. Fonts: Geist, Geist Mono, Instrument Serif.
