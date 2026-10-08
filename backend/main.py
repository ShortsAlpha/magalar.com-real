import asyncio
import io
import os
import re
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from urllib.parse import quote

import boto3
import modal
from docx import Document
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

# Local modules (shipped into the container via add_local_python_source below).
from auth import AuthError, get_allowed_origins, require_user
from demo import (
    DEMO_DICT_NAME,
    ModalDictStore,
    RateLimiter,
    client_ip,
    turnstile_secret,
    verify_turnstile,
)
from library import KINDS, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, get_library, legacy_keys, parse_cursor, render_keys
from synth import NothingToSpeak, Render, pieces_for_text, render_pieces, synthesize_plain
from textproc import default_title, language_of_voice
from validation import (
    MAX_DOCX_BYTES,
    MAX_DOCX_SCRIPT_CHARS,
    MAX_TITLE_CHARS,
    ApiError,
    BodySizeLimitMiddleware,
    DemoRequest,
    GenerateRequest,
    LibraryPatch,
    MultiSpeakerRequest,
    VoiceSettings,
    format_validation_error,
    parse_json_body,
    validate_docx_upload,
)

LOCAL_MODULES = ("auth", "validation", "textproc", "mp3util", "subtitles", "synth", "library", "demo")

# Define the Modal image with necessary dependencies.
# (No ffmpeg: MP3 chunks are concatenated byte-wise, nothing shells out to ffmpeg.)
image = (
    modal.Image.debian_slim()
    .pip_install(
        "edge-tts==7.2.8",  # pinned: WordBoundary API + CBR offset handling verified against 7.2.8
        "boto3",
        "fastapi",
        "python-docx",
        "python-multipart",
        "pyjwt[crypto]>=2.8,<3",
        "asyncpg>=0.30,<1",
        "httpx==0.28.1",
    )
    .add_local_python_source(*LOCAL_MODULES)
)

# NOTE: app name + function name determine the public URL
# (https://<workspace>--serverless-tts-generate-speech.modal.run). Do not rename.
app = modal.App("serverless-tts")

# Secrets live in Modal, never in this repo. See backend/README.md.
r2_secret = modal.Secret.from_name(
    "magalar-r2",
    required_keys=["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID"],
)
clerk_secret = modal.Secret.from_name("magalar-clerk", required_keys=["CLERK_ISSUER"])
# DATABASE_URL may be empty (library off). TURNSTILE_SECRET_KEY missing -> /demo answers 503.
db_secret = modal.Secret.from_name("magalar-db")
turnstile_modal_secret = modal.Secret.from_name("magalar-turnstile")

PRESIGN_TTL_S = 3600
SRT_CONTENT_TYPE = "application/x-subrip; charset=utf-8"
VTT_CONTENT_TYPE = "text/vtt; charset=utf-8"
DOCX_SCENE_PARALLEL = 5


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Create the library table in the background so cold starts are not slowed down
    # by a Neon wake-up. Requests that need the DB wait on the same pool lock.
    task = None
    lib = get_library()
    if lib is not None:

        async def _init():
            try:
                await asyncio.wait_for(lib.startup(), timeout=30)
                print("Library ready")
            except Exception as e:  # noqa: BLE001 - retried lazily on first use
                print(f"Library startup failed (will retry lazily): {type(e).__name__}")

        task = asyncio.create_task(_init())
    yield
    if task is not None and not task.done():
        task.cancel()


web_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)

# Order matters: the last middleware added is the outermost. CORS must wrap the
# body-size limiter so 413 responses still carry CORS headers.
web_app.add_middleware(BodySizeLimitMiddleware)
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,  # Bearer header auth, no cookies
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition", "X-Render-Id", "Retry-After"],
    max_age=600,
)


def _error(status_code: int, message: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"status": "error", "message": message}, status_code=status_code, headers=headers)


@web_app.exception_handler(AuthError)
async def _auth_error_handler(request: Request, exc: AuthError):
    # Log the reason only; never the token.
    print(f"Auth rejected ({exc.status_code}) {request.method} {request.url.path}: {exc.reason}")
    headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
    return _error(exc.status_code, exc.message, headers)


@web_app.exception_handler(ApiError)
async def _api_error_handler(request: Request, exc: ApiError):
    return _error(exc.status_code, exc.message)


@web_app.exception_handler(StarletteHTTPException)
async def _http_error_handler(request: Request, exc: StarletteHTTPException):
    return _error(exc.status_code, str(exc.detail))


@web_app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    return _error(400, "Invalid request")


# ---------------------------------------------------------------------------
# R2 helpers
# ---------------------------------------------------------------------------
_s3_client = None


def get_s3():
    global _s3_client
    if _s3_client is None:
        from botocore.config import Config

        _s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
        )
    return _s3_client


def _bucket() -> str:
    return os.environ["R2_BUCKET_NAME"]


def _put_bytes(key: str, body: bytes, content_type: str) -> None:
    get_s3().upload_fileobj(io.BytesIO(body), _bucket(), key, ExtraArgs={"ContentType": content_type})


def _put_file(path: str, key: str, content_type: str) -> None:
    with open(path, "rb") as f:
        get_s3().upload_fileobj(f, _bucket(), key, ExtraArgs={"ContentType": content_type})


def _delete_keys(keys: list[str]) -> None:
    if not keys:
        return
    resp = get_s3().delete_objects(
        Bucket=_bucket(), Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True}
    )
    errors = (resp or {}).get("Errors") or []
    if errors:
        raise RuntimeError(f"R2 delete failed for {len(errors)} object(s)")


def presign(key: str | None) -> str | None:
    if not key:
        return None
    return get_s3().generate_presigned_url(
        "get_object", Params={"Bucket": _bucket(), "Key": key}, ExpiresIn=PRESIGN_TTL_S
    )


# ---------------------------------------------------------------------------
# Render storage + library rows
# ---------------------------------------------------------------------------
async def _library_insert(lib, row: dict) -> str | None:
    """Insert a library row. Never raises: a library failure must not fail a render."""
    try:
        await asyncio.wait_for(lib.insert(row), timeout=20)
        return row["id"]
    except Exception as e:  # noqa: BLE001
        print(f"[user={row['user_id']}] Library insert failed: {type(e).__name__}")
        return None


async def _store_render(
    user_id: str,
    kind: str,
    render: Render,
    *,
    title: str,
    voices: list[str],
    chars: int,
    legacy_prefix: str = "",
) -> dict:
    """Upload mp3/srt/vtt, record the render in the library, return the URL payload."""
    srt = render.srt.encode("utf-8")
    vtt = render.vtt.encode("utf-8")
    lib = get_library()
    render_id = str(uuid.uuid4())
    keys = render_keys(user_id, render_id) if lib else legacy_keys(render_id, legacy_prefix)

    await asyncio.gather(
        asyncio.to_thread(_put_bytes, keys["audio_key"], render.audio, "audio/mpeg"),
        asyncio.to_thread(_put_bytes, keys["srt_key"], srt, SRT_CONTENT_TYPE),
        asyncio.to_thread(_put_bytes, keys["vtt_key"], vtt, VTT_CONTENT_TYPE),
    )

    stored_id = None
    if lib is not None:
        stored_id = await _library_insert(
            lib,
            {
                "id": render_id,
                "user_id": user_id,
                "kind": kind,
                "title": title,
                "voice": voices[0] if voices else None,
                "voices": voices,
                "language": language_of_voice(voices[0]) if voices else None,
                "chars": chars,
                "duration_ms": render.duration_ms,
                "scenes": None,
                "audio_key": keys["audio_key"],
                "srt_key": keys["srt_key"],
                "vtt_key": keys["vtt_key"],
                "zip_key": None,
                "size_bytes": len(render.audio) + len(srt) + len(vtt),
            },
        )

    return {
        "render_id": stored_id,
        "audio_url": presign(keys["audio_key"]),
        "srt_url": presign(keys["srt_key"]),
        "vtt_url": presign(keys["vtt_key"]),
        "duration_ms": render.duration_ms,
    }


async def _store_preview(render: Render) -> dict:
    """``save: false``: MP3 only, under previews/ (no library row, no subtitles)."""
    key = f"previews/{uuid.uuid4()}.mp3"
    await asyncio.to_thread(_put_bytes, key, render.audio, "audio/mpeg")
    return {
        "render_id": None,
        "audio_url": presign(key),
        "srt_url": None,
        "vtt_url": None,
        "duration_ms": render.duration_ms,
    }


def _unique(seq) -> list:
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ---------------------------------------------------------------------------
# Render endpoints (authenticated)
# ---------------------------------------------------------------------------
@web_app.post("/generate_multi")
async def generate_multi_speech_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Generates audio for multiple segments and stitches them together.
    Body: {"segments": [{"text", "voice", "rate", "pitch", "volume"}, ...], "title"?}
    """
    # Body is read only after authentication succeeded.
    item = await parse_json_body(request, MultiSpeakerRequest)
    segments = item.segments

    total_chars = sum(len(s.text) for s in segments)
    print(f"[user={user_id}] /generate_multi: {len(segments)} segments, {total_chars} chars | save={item.save}")

    pieces = []
    segments_with_audio = 0
    for seg in segments:
        seg_pieces = pieces_for_text(seg.text, seg.voice, seg.rate, seg.pitch, seg.volume)
        if seg_pieces:
            segments_with_audio += 1
            pieces.extend(seg_pieces)
    if not pieces:
        raise ApiError(400, "Segments contain nothing to speak")

    try:
        render = await render_pieces(pieces)
        stored = await _store_preview(render) if not item.save else await _store_render(
            user_id,
            "dialogue",
            render,
            title=item.title or default_title(" ".join(s.text for s in segments)),
            voices=_unique(s.voice for s in segments),
            chars=total_chars,
            legacy_prefix="multi_",
        )
    except Exception as e:
        # Details go to the server log only; clients get a generic message.
        print(f"[user={user_id}] Error in multi-gen: {type(e).__name__}: {e}")
        return {"status": "error", "message": "Audio generation failed"}

    print(f"[user={user_id}] /generate_multi done: {len(pieces)} chunks, {stored['duration_ms']} ms")
    return {"status": "success", **stored, "segments_processed": segments_with_audio}


@web_app.post("/")
async def generate_speech_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Receives JSON: {"text": "...", "voice": "...", ..., "title"?, "save"?: bool = true}
    save=false -> preview: MP3 only under previews/, srt_url/vtt_url null, render_id null, max 500 chars.
    Returns JSON: {"status": "success", "render_id", "audio_url", "srt_url", "vtt_url", "duration_ms", "chunks_processed"}
    """
    # Body is read only after authentication succeeded.
    item = await parse_json_body(request, GenerateRequest)
    print(f"[user={user_id}] /: {len(item.text)} chars | Voice: {item.voice} | Rate: {item.rate} | save={item.save}")

    pieces = pieces_for_text(item.text, item.voice, item.rate, item.pitch, item.volume)
    if not pieces:
        raise ApiError(400, "Text contains nothing to speak")

    try:
        render = await render_pieces(pieces)
        stored = await _store_preview(render) if not item.save else await _store_render(
            user_id,
            "single",
            render,
            title=item.title or default_title(item.text),
            voices=[item.voice],
            chars=len(item.text),
        )
    except Exception as e:
        # Details go to the server log only; clients get a generic message.
        print(f"[user={user_id}] Error: {type(e).__name__}: {e}")
        return {"status": "error", "message": "Audio generation failed"}

    print(f"[user={user_id}] / done: {len(pieces)} chunks, {stored['duration_ms']} ms")
    return {"status": "success", **stored, "chunks_processed": len(pieces)}


def _docx_names(filename: str) -> tuple[str, str]:
    """(display/title name, Content-Disposition value) for an uploaded .docx name."""
    base = re.split(r"[\\/]", filename)[-1]
    stem = base[:-5] if base.lower().endswith(".docx") else base
    stem = " ".join("".join(ch if ch.isprintable() else " " for ch in stem).split()) or "course_assets"
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "_", stem).strip(" .") or "course_assets"
    disposition = f"attachment; filename=\"{ascii_name}.zip\"; filename*=UTF-8''{quote(stem + '.zip', safe='')}"
    return stem[:MAX_TITLE_CHARS], disposition


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


@web_app.post("/process_docx")
async def process_docx_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Multipart upload with field `file` (.docx) and optional `voice`, `rate`, `pitch`, `volume`.
    Returns a zip with NN.mp3 / NN.srt / NN.vtt per scene plus images NN_k.ext.
    """
    # Multipart body is parsed only after authentication succeeded.
    form = await request.form(max_files=1, max_fields=10)
    try:
        upload = form.get("file")
        if not isinstance(upload, StarletteUploadFile):
            raise ApiError(400, "No file uploaded (multipart field 'file')")
        filename = upload.filename or ""
        if not filename.lower().endswith(".docx"):
            raise ApiError(400, "Only .docx files are supported")
        content = await upload.read(MAX_DOCX_BYTES + 1)
        raw_settings = {}
        for name in ("voice", "rate", "pitch", "volume"):
            value = form.get(name)
            if isinstance(value, str) and value.strip():
                raw_settings[name] = value.strip()
    finally:
        await form.close()

    validate_docx_upload(filename, content)
    try:
        settings = VoiceSettings.model_validate(raw_settings)
    except ValidationError as e:
        raise ApiError(400, format_validation_error(e))
    print(f"[user={user_id}] /process_docx: {len(content)} bytes | Voice: {settings.voice}")

    file_stream = io.BytesIO(content)

    try:
        doc = Document(file_stream)
    except Exception as e:
        print(f"[user={user_id}] Failed to parse document: {type(e).__name__}: {e}")
        raise ApiError(422, "Failed to parse document")

    scenes = []
    current_scene = None
    state = "LOOKING_FOR_SCENE"

    for para in doc.paragraphs:
        text = para.text.strip()

        if text.lower().startswith("scene "):
            if current_scene:
                scenes.append(current_scene)

            scene_idx_str = f"{len(scenes) + 1:02d}"
            current_scene = {
                "id": scene_idx_str,
                "script": "",
                "images": []
            }
            state = "LOOKING_FOR_SCRIPT"
            continue

        if not current_scene:
            continue

        if text.lower() == "spoken script:":
            state = "IN_SCRIPT"
            continue
        elif text.lower().startswith("suggested on-screen text:") or text.lower().startswith("editor note:") or text.lower().startswith("suggested visuals for this scene:"):
            state = "OTHER"

        if state == "IN_SCRIPT" and text:
            if not text.lower().startswith("editor note:") and not text.lower().startswith("suggested"):
                current_scene["script"] += text + " "

        # Extract images from this paragraph's runs
        for run in para.runs:
            for drawing in run._element.xpath('.//a:blip'):
                embed = drawing.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
                if embed:
                    try:
                        image_part = doc.part.related_parts[embed]
                        img_bytes = image_part.blob
                        current_scene["images"].append(img_bytes)
                    except KeyError:
                        pass

    if current_scene:
        scenes.append(current_scene)

    if not scenes:
        raise ApiError(422, "No scenes found in the document")

    total_script_chars = sum(len(s["script"]) for s in scenes)
    if total_script_chars > MAX_DOCX_SCRIPT_CHARS:
        raise ApiError(
            400,
            f"Document script is too long ({total_script_chars} chars, max {MAX_DOCX_SCRIPT_CHARS})",
        )
    print(f"[user={user_id}] /process_docx: {len(scenes)} scenes, {total_script_chars} script chars")
    del doc, file_stream, content

    sem = asyncio.Semaphore(DOCX_SCENE_PARALLEL)

    async def render_scene(scene):
        pieces = pieces_for_text(scene["script"], settings.voice, settings.rate, settings.pitch, settings.volume)
        if not pieces:
            return scene["id"], None
        try:
            return scene["id"], await render_pieces(pieces, sem=sem)
        except Exception as e:  # noqa: BLE001 - a failed scene is skipped, as before
            print(f"[user={user_id}] Error generating TTS for scene {scene['id']}: {type(e).__name__}: {e}")
            return scene["id"], None

    # The zip is written to a temp file (not memory): scene audio is added as soon as
    # each scene finishes and then dropped, the file is uploaded to R2 and streamed
    # back from disk, then deleted.
    fd, zip_path = tempfile.mkstemp(prefix="magalar_", suffix=".zip")
    os.close(fd)
    try:
        with zipfile.ZipFile(zip_path, "w") as zip_file:
            for scene in scenes:
                for img_idx, img_bytes in enumerate(scene["images"]):
                    ext = ".png"
                    if img_bytes.startswith(b'\xff\xd8'):
                        ext = ".jpg"
                    img_name = f"{scene['id']}_{img_idx + 1}{ext}"
                    zip_file.writestr(img_name, img_bytes, compress_type=zipfile.ZIP_STORED)
                scene["images"] = []

            for next_done in asyncio.as_completed([render_scene(s) for s in scenes if s["script"].strip()]):
                scene_id, render = await next_done
                if render is None or not render.audio:
                    continue
                zip_file.writestr(f"{scene_id}.mp3", render.audio, compress_type=zipfile.ZIP_STORED)
                zip_file.writestr(f"{scene_id}.srt", render.srt.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
                zip_file.writestr(f"{scene_id}.vtt", render.vtt.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
    except BaseException:
        _safe_remove(zip_path)
        raise

    title, disposition = _docx_names(filename)
    render_id = None
    lib = get_library()
    if lib is not None:
        new_id = str(uuid.uuid4())
        zip_key = render_keys(user_id, new_id)["zip_key"]
        try:
            await asyncio.to_thread(_put_file, zip_path, zip_key, "application/zip")
            render_id = await _library_insert(
                lib,
                {
                    "id": new_id,
                    "user_id": user_id,
                    "kind": "docx",
                    "title": title,
                    "voice": settings.voice,
                    "voices": [settings.voice],
                    "language": language_of_voice(settings.voice),
                    "chars": total_script_chars,
                    "duration_ms": None,
                    "scenes": len(scenes),
                    "audio_key": None,
                    "srt_key": None,
                    "vtt_key": None,
                    "zip_key": zip_key,
                    "size_bytes": os.path.getsize(zip_path),
                },
            )
        except Exception as e:  # noqa: BLE001 - the user still gets the zip
            print(f"[user={user_id}] Storing docx zip failed: {type(e).__name__}")

    return FileResponse(
        zip_path,
        media_type="application/zip",
        headers={"Content-Disposition": disposition, "X-Render-Id": render_id or ""},
        background=BackgroundTask(_safe_remove, zip_path),
    )


# ---------------------------------------------------------------------------
# Library (authenticated)
# ---------------------------------------------------------------------------
_PUBLIC_FIELDS = (
    "id", "kind", "title", "voice", "voices", "language", "chars",
    "duration_ms", "scenes", "size_bytes", "created_at",
)


def _require_library():
    lib = get_library()
    if lib is None:
        raise ApiError(503, "Library is not configured")
    return lib


def _parse_render_id(render_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(render_id)
    except (ValueError, AttributeError, TypeError):
        raise ApiError(404, "Not found")


def _library_item(row: dict) -> dict:
    item = {k: row.get(k) for k in _PUBLIC_FIELDS}
    item["audio_url"] = presign(row.get("audio_key"))
    item["srt_url"] = presign(row.get("srt_key"))
    item["vtt_url"] = presign(row.get("vtt_key"))
    item["zip_url"] = presign(row.get("zip_key"))
    return item


def _db_unavailable(user_id: str, op: str, e: Exception) -> ApiError:
    print(f"[user={user_id}] Library {op} failed: {type(e).__name__}")
    return ApiError(503, "Library is temporarily unavailable")


@web_app.get("/library")
async def list_library(request: Request, user_id: str = Depends(require_user)):
    lib = _require_library()
    params = request.query_params

    try:
        limit = int(params.get("limit") or DEFAULT_PAGE_SIZE)
    except ValueError:
        raise ApiError(400, "Invalid limit")
    limit = max(1, min(MAX_PAGE_SIZE, limit))

    try:
        cursor = parse_cursor(params.get("cursor"))
    except ValueError:
        raise ApiError(400, "Invalid cursor")

    q = (params.get("q") or "").strip()[:200] or None
    kind = (params.get("kind") or "").strip() or None
    if kind is not None and kind not in KINDS:
        raise ApiError(400, "Invalid kind (expected single, dialogue or docx)")

    try:
        rows, next_cursor = await lib.list(user_id, limit=limit, cursor=cursor, q=q, kind=kind)
    except Exception as e:  # noqa: BLE001
        raise _db_unavailable(user_id, "list", e)
    return {"status": "success", "items": [_library_item(r) for r in rows], "next_cursor": next_cursor}


@web_app.patch("/library/{render_id}")
async def patch_library_item(render_id: str, request: Request, user_id: str = Depends(require_user)):
    lib = _require_library()
    rid = _parse_render_id(render_id)
    body = await parse_json_body(request, LibraryPatch)
    try:
        row = await lib.update_title(user_id, rid, body.title)
    except Exception as e:  # noqa: BLE001
        raise _db_unavailable(user_id, "update", e)
    if row is None:
        raise ApiError(404, "Not found")
    return {"status": "success", "item": _library_item(row)}


@web_app.delete("/library/{render_id}")
async def delete_library_item(render_id: str, user_id: str = Depends(require_user)):
    lib = _require_library()
    rid = _parse_render_id(render_id)
    try:
        row = await lib.get(user_id, rid)
    except Exception as e:  # noqa: BLE001
        raise _db_unavailable(user_id, "get", e)
    if row is None:
        raise ApiError(404, "Not found")

    keys = [row[k] for k in ("audio_key", "srt_key", "vtt_key", "zip_key") if row.get(k)]
    try:
        await asyncio.to_thread(_delete_keys, keys)
    except Exception as e:  # noqa: BLE001 - keep the row so the user can retry
        print(f"[user={user_id}] R2 delete failed: {type(e).__name__}")
        raise ApiError(502, "Failed to delete stored files, please try again")

    try:
        deleted = await lib.delete(user_id, rid)
    except Exception as e:  # noqa: BLE001
        raise _db_unavailable(user_id, "delete", e)
    if not deleted:
        raise ApiError(404, "Not found")
    print(f"[user={user_id}] Library item deleted ({len(keys)} objects)")
    return {"status": "success"}


# ---------------------------------------------------------------------------
# Public demo (no Clerk; Turnstile + rate limits)
# ---------------------------------------------------------------------------
_demo_limiter: RateLimiter | None = None


def get_demo_limiter() -> RateLimiter:
    global _demo_limiter
    if _demo_limiter is None:
        store = ModalDictStore(modal.Dict.from_name(DEMO_DICT_NAME, create_if_missing=True))
        _demo_limiter = RateLimiter(store)
    return _demo_limiter


def _rate_limited(retry_after: int) -> JSONResponse:
    return JSONResponse(
        {"status": "error", "message": "Too many requests. Please try again later.", "retry_after": retry_after},
        status_code=429,
        headers={"Retry-After": str(retry_after)},
    )


@web_app.post("/demo")
async def demo_endpoint(request: Request):
    secret = turnstile_secret()
    if not secret:
        # Fail closed: without Turnstile the demo would be an open TTS proxy.
        raise ApiError(503, "Demo is not configured")

    item = await parse_json_body(request, DemoRequest)
    ip = client_ip(request)

    try:
        limiter = get_demo_limiter()
        retry_after = await limiter.check(ip)
    except Exception as e:  # noqa: BLE001
        print(f"/demo rate-limit store failed: {type(e).__name__}")
        raise ApiError(503, "Demo is temporarily unavailable")
    if retry_after:
        return _rate_limited(retry_after)

    if not await verify_turnstile(item.turnstile_token, None if ip == "unknown" else ip, secret):
        raise ApiError(403, "Verification failed")

    try:
        retry_after = await limiter.acquire(ip)
    except Exception as e:  # noqa: BLE001
        print(f"/demo rate-limit store failed: {type(e).__name__}")
        raise ApiError(503, "Demo is temporarily unavailable")
    if retry_after:
        return _rate_limited(retry_after)

    try:
        audio = await synthesize_plain(item.text, item.voice)
    except Exception as e:  # noqa: BLE001
        print(f"/demo synthesis failed: {type(e).__name__}: {e}")
        raise ApiError(502, "Audio generation failed")

    print(f"/demo: {len(item.text)} chars | Voice: {item.voice} | {len(audio)} bytes")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


# scaledown_window=300: keep a warm container 5 min after the last request so the
# studio/library stays snappy (costs idle container time; see README).
@app.function(
    image=image,
    secrets=[r2_secret, clerk_secret, db_secret, turnstile_modal_secret],
    timeout=600,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def generate_speech():
    return web_app
