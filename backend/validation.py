"""Input validation and size limits for the Magalar TTS backend.

Kept free of Modal / edge-tts imports so it can be unit-tested locally.
It is shipped into the Modal container via ``Image.add_local_python_source``.

Error convention (all responses keep the ``{"status": "error", "message": ...}`` shape):
    400  invalid input (empty / too long text, bad voice/rate/pitch/volume, bad file type)
    401  missing / invalid Clerk session token            (see auth.py)
    413  request body or uploaded file too large
    403  /demo: Turnstile verification failed
    404  /library/{id}: unknown id or another user's render
    422  .docx could be read but contains nothing usable   (/process_docx only)
    429  /demo: rate limit exceeded (+ ``retry_after`` and ``Retry-After``)
    502  /demo: synthesis failed
    503  server auth not configured / JWKS unreachable     (see auth.py)
         library not configured (DATABASE_URL empty), demo not configured
    200  ``status: "error"`` for runtime TTS / storage failures in POST / and
         POST /generate_multi (legacy behaviour, kept for compatibility).
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Optional

from pydantic import BaseModel, ConfigDict, StrictBool, ValidationError, field_validator, model_validator
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------
MAX_TEXT_CHARS = 50_000            # POST /  (long-form)
MAX_SEGMENTS = 200                 # POST /generate_multi
MAX_MULTI_TOTAL_CHARS = 50_000     # POST /generate_multi, sum over all segments
MAX_DOCX_BYTES = 25 * 1024 * 1024  # POST /process_docx upload size
MAX_DOCX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024  # zip-bomb guard
MAX_DOCX_ZIP_ENTRIES = 10_000
MAX_DOCX_SCRIPT_CHARS = 200_000    # total spoken-script chars TTS'd per document
MAX_TITLE_CHARS = 120              # optional render title / PATCH /library/{id}
MAX_DEMO_CHARS = 200               # POST /demo (public)
MAX_PREVIEW_CHARS = 500            # POST / and /generate_multi with "save": false
MAX_TURNSTILE_TOKEN_CHARS = 2048   # Cloudflare documents tokens up to 2048 chars

# Raw request-body caps, enforced while streaming (before any parsing).
MAX_JSON_BODY_BYTES = 1024 * 1024
MAX_MULTIPART_BODY_BYTES = MAX_DOCX_BYTES + 1024 * 1024  # file + multipart overhead
MAX_DEMO_BODY_BYTES = 16 * 1024
BODY_LIMITS_BY_PATH = {"/process_docx": MAX_MULTIPART_BODY_BYTES, "/demo": MAX_DEMO_BODY_BYTES}

# Edge neural voice ids, e.g. en-US-AriaNeural, tr-TR-EmelNeural,
# en-US-AndrewMultilingualNeural, fil-PH-AngeloNeural, zh-CN-liaoning-XiaobeiNeural.
VOICE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,8}){1,3}-[A-Za-z]+Neural$")
MAX_VOICE_LENGTH = 64
PERCENT_RE = re.compile(r"^[+-]\d{1,3}%$")   # rate, volume
HZ_RE = re.compile(r"^[+-]\d{1,3}Hz$")        # pitch


class ApiError(Exception):
    """Client-facing error rendered as ``{"status": "error", "message": ...}``."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
def _check_voice(v: str) -> str:
    if len(v) > MAX_VOICE_LENGTH or not VOICE_RE.match(v):
        raise ValueError("Invalid voice (expected e.g. 'en-US-AriaNeural')")
    return v


def _check_title(v):
    """Optional title: trimmed, control chars removed, empty -> None, max 120 chars."""
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError("Invalid title")
    v = " ".join("".join(ch if ch.isprintable() else " " for ch in v).split())
    if len(v) > MAX_TITLE_CHARS:
        raise ValueError(f"Title is too long (max {MAX_TITLE_CHARS} chars)")
    return v or None


def _check_percent(v: str, name: str) -> str:
    if not PERCENT_RE.match(v):
        raise ValueError(f"Invalid {name} (expected e.g. '+0%' or '-10%')")
    return v


def _check_hz(v: str) -> str:
    if not HZ_RE.match(v):
        raise ValueError("Invalid pitch (expected e.g. '+0Hz' or '-5Hz')")
    return v


class VoiceSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    voice: str = "en-US-AriaNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"
    volume: str = "+0%"

    @field_validator("voice")
    @classmethod
    def _voice(cls, v: str) -> str:
        return _check_voice(v)

    @field_validator("rate")
    @classmethod
    def _rate(cls, v: str) -> str:
        return _check_percent(v, "rate")

    @field_validator("volume")
    @classmethod
    def _volume(cls, v: str) -> str:
        return _check_percent(v, "volume")

    @field_validator("pitch")
    @classmethod
    def _pitch(cls, v: str) -> str:
        return _check_hz(v)


class GenerateRequest(VoiceSettings):
    text: str
    title: Optional[str] = None
    # false = preview: no library row, no subtitles, stored under previews/, max 500 chars.
    save: StrictBool = True

    @model_validator(mode="after")
    def _preview_cap(self):
        if not self.save and len(self.text) > MAX_PREVIEW_CHARS:
            raise ValueError(f"Preview text is too long ({len(self.text)} chars, max {MAX_PREVIEW_CHARS})")
        return self

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        return _check_title(v)

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("No text provided")
        if len(v) > MAX_TEXT_CHARS:
            raise ValueError(f"Text is too long ({len(v)} chars, max {MAX_TEXT_CHARS})")
        return v


class Segment(VoiceSettings):
    text: str
    voice: str  # required for segments (no default)

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Segment text is empty")
        return v


class MultiSpeakerRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    segments: list[Segment]
    title: Optional[str] = None
    save: StrictBool = True

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        return _check_title(v)

    @field_validator("segments", mode="before")
    @classmethod
    def _segment_count(cls, v):
        # Checked before per-item validation so huge lists are rejected cheaply.
        if isinstance(v, list):
            if not v:
                raise ValueError("No segments provided")
            if len(v) > MAX_SEGMENTS:
                raise ValueError(f"Too many segments ({len(v)}, max {MAX_SEGMENTS})")
        return v

    @model_validator(mode="after")
    def _total_chars(self):
        total = sum(len(s.text) for s in self.segments)
        if total > MAX_MULTI_TOTAL_CHARS:
            raise ValueError(f"Total text is too long ({total} chars, max {MAX_MULTI_TOTAL_CHARS})")
        if not self.save and total > MAX_PREVIEW_CHARS:
            raise ValueError(f"Preview text is too long ({total} chars, max {MAX_PREVIEW_CHARS})")
        return self


class LibraryPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        v = _check_title(v)
        if not v:
            raise ValueError("Title must not be empty")
        return v


class DemoRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str
    voice: str
    turnstile_token: str

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("No text provided")
        if len(v) > MAX_DEMO_CHARS:
            raise ValueError(f"Text is too long ({len(v)} chars, max {MAX_DEMO_CHARS})")
        return v

    @field_validator("voice")
    @classmethod
    def _voice(cls, v: str) -> str:
        return _check_voice(v)

    @field_validator("turnstile_token")
    @classmethod
    def _token(cls, v: str) -> str:
        if not v or len(v) > MAX_TURNSTILE_TOKEN_CHARS:
            raise ValueError("Missing or invalid verification token")
        return v


def format_validation_error(e: ValidationError) -> str:
    err = e.errors(include_url=False, include_input=False)[0]
    msg = str(err.get("msg", "Invalid request"))
    if msg.startswith("Value error, "):
        msg = msg[len("Value error, "):]
    loc = ".".join(str(p) for p in err.get("loc", ()) if p != "__root__")
    return f"{loc}: {msg}" if loc else msg


async def parse_json_body(request: Request, model: type[BaseModel]):
    """Read and validate a JSON body *after* authentication has passed."""
    raw = await request.body()
    if not raw.strip():
        raise ApiError(400, "Request body is empty")
    try:
        return model.model_validate_json(raw)
    except ValidationError as e:
        raise ApiError(400, format_validation_error(e))


# ---------------------------------------------------------------------------
# .docx upload checks
# ---------------------------------------------------------------------------
def validate_docx_upload(filename: str | None, data: bytes) -> None:
    if not filename or not filename.lower().endswith(".docx"):
        raise ApiError(400, "Only .docx files are supported")
    if not data:
        raise ApiError(400, "Uploaded file is empty")
    if len(data) > MAX_DOCX_BYTES:
        raise ApiError(413, f"File is too large (max {MAX_DOCX_BYTES // (1024 * 1024)} MB)")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
    except (zipfile.BadZipFile, OSError, ValueError):
        raise ApiError(400, "File is not a valid .docx document")
    if len(infos) > MAX_DOCX_ZIP_ENTRIES:
        raise ApiError(400, "Document has too many parts")
    if sum(i.file_size for i in infos) > MAX_DOCX_UNCOMPRESSED_BYTES:
        raise ApiError(400, "Document is too large when uncompressed")


# ---------------------------------------------------------------------------
# Raw body size limit (pure ASGI middleware)
# ---------------------------------------------------------------------------
class BodySizeLimitMiddleware:
    """Rejects request bodies above a per-path byte limit with HTTP 413.

    Checks Content-Length up front and also counts streamed bytes, so chunked
    uploads without Content-Length are capped too. Add it *before*
    CORSMiddleware so CORS (outer) still decorates the 413 response.
    """

    def __init__(self, app, default_limit: int = MAX_JSON_BODY_BYTES, path_limits: dict | None = None):
        self.app = app
        self.default_limit = default_limit
        self.path_limits = path_limits if path_limits is not None else dict(BODY_LIMITS_BY_PATH)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.path_limits.get(scope.get("path", ""), self.default_limit)
        message = "Request body is too large"

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    too_big = int(value) > limit
                except ValueError:
                    too_big = False
                if too_big:
                    response = JSONResponse({"status": "error", "message": message}, status_code=413)
                    await response(scope, receive, send)
                    return

        received = 0

        async def limited_receive():
            nonlocal received
            msg = await receive()
            if msg["type"] == "http.request":
                received += len(msg.get("body", b""))
                if received > limit:
                    # Raised inside the route's body read -> handled by the app's
                    # HTTPException handler (inside CORS) -> JSON 413.
                    raise StarletteHTTPException(status_code=413, detail=message)
            return msg

        await self.app(scope, limited_receive, send)
