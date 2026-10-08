import os
import io
import uuid
import boto3
import modal
import asyncio
import edge_tts
import zipfile
from docx import Document
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

# Local modules (shipped into the container via add_local_python_source below).
from auth import AuthError, get_allowed_origins, require_user
from validation import (
    MAX_DOCX_BYTES,
    MAX_DOCX_SCRIPT_CHARS,
    ApiError,
    BodySizeLimitMiddleware,
    GenerateRequest,
    MultiSpeakerRequest,
    parse_json_body,
    validate_docx_upload,
)

# Define the Modal image with necessary dependencies.
# (No ffmpeg: MP3 chunks are concatenated byte-wise, nothing shells out to ffmpeg.)
image = (
    modal.Image.debian_slim()
    .pip_install(
        "edge-tts",
        "boto3",
        "fastapi",
        "python-docx",
        "python-multipart",
        "pyjwt[crypto]>=2.8,<3",
    )
    .add_local_python_source("auth", "validation")
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

web_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Order matters: the last middleware added is the outermost. CORS must wrap the
# body-size limiter so 413 responses still carry CORS headers.
web_app.add_middleware(BodySizeLimitMiddleware)
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,  # Bearer header auth, no cookies
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
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


def split_text_into_chunks(text: str, max_chars: int = 2000) -> list[str]:
    """
    Splits text into chunks respecting sentence boundaries.
    """
    if len(text) <= max_chars:
        return [text]

    chunks = []
    current_chunk = ""

    # Simple splitting by sentence endings
    # replacing newlines with spaces to avoid weird breaks unless double newline
    paragraphs = text.replace("\r\n", "\n").split("\n")

    for para in paragraphs:
        if not para.strip():
            continue

        sentences = para.replace(". ", ".|").replace("? ", "?|").replace("! ", "!|").split("|")

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # If a single sentence is huge (unlikely but possible), split it blindly
            if len(sentence) > max_chars:
                # Should handle this edge case, but for now let's hope sentences aren't 2000 chars
                # If they are, just force add them and let Edge TTS try or error
                pass

            if len(current_chunk) + len(sentence) + 1 <= max_chars:
                current_chunk += sentence + " "
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence + " "

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks

@web_app.post("/generate_multi")
async def generate_multi_speech_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Generates audio for multiple segments and stitches them together.
    Body: {"segments": [{"text", "voice", "rate", "pitch", "volume"}, ...]}
    """
    # Body is read only after authentication succeeded.
    item = await parse_json_body(request, MultiSpeakerRequest)
    segments = item.segments

    total_chars = sum(len(s.text) for s in segments)
    print(f"[user={user_id}] /generate_multi: {len(segments)} segments, {total_chars} chars")

    try:
        file_id = str(uuid.uuid4())
        final_mp3_path = f"/tmp/{file_id}.mp3"

        # We process segments sequentially to maintain order and simplicity in filenames,
        # but we can parallelize the GENERATION of each segment.

        # 1. Prepare tasks
        segment_files = [f"/tmp/{file_id}_seg_{i}.mp3" for i in range(len(segments))]

        async def generate_segment(segment, index):
            try:
                # Empty segments are rejected by validation; keep the guard anyway.
                if not segment.text.strip():
                    return

                communicate = edge_tts.Communicate(
                    segment.text,
                    segment.voice,
                    rate=segment.rate,
                    pitch=segment.pitch,
                    volume=segment.volume
                )
                await communicate.save(segment_files[index])
            except Exception as e:
                print(f"Error generating segment {index}: {e}")
                raise e

        # 2. Run in parallel
        await asyncio.gather(*(generate_segment(seg, i) for i, seg in enumerate(segments)))

        # 3. Merge files
        # Only merge files that actually exist (in case of skips/errors)
        valid_files = [f for f in segment_files if os.path.exists(f)]

        if not valid_files:
             return {"status": "error", "message": "No audio generated from segments"}

        with open(final_mp3_path, "wb") as outfile:
            for seg_path in valid_files:
                with open(seg_path, "rb") as infile:
                    outfile.write(infile.read())
                os.remove(seg_path)

        # 4. Upload to R2
        from botocore.config import Config
        s3 = boto3.client('s3',
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            config=Config(signature_version='s3v4')
        )

        r2_key = f"generated/multi_{file_id}.mp3"

        with open(final_mp3_path, "rb") as f:
            s3.upload_fileobj(
                f,
                os.environ['R2_BUCKET_NAME'],
                r2_key,
                ExtraArgs={'ContentType': 'audio/mpeg'}
            )

        os.remove(final_mp3_path)

        # 5. Get URL
        audio_url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': os.environ['R2_BUCKET_NAME'], 'Key': r2_key},
            ExpiresIn=3600
        )

        return {
            "status": "success",
            "audio_url": audio_url,
            "segments_processed": len(valid_files)
        }

    except Exception as e:
        # Details go to the server log only; clients get a generic message.
        print(f"[user={user_id}] Error in multi-gen: {type(e).__name__}: {e}")
        return {"status": "error", "message": "Audio generation failed"}

@web_app.post("/")
async def generate_speech_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Receives JSON: {"text": "...", "voice": "...", ...}
    Returns JSON: {"status": "success", "audio_url": "..."}
    """
    # Body is read only after authentication succeeded.
    item = await parse_json_body(request, GenerateRequest)
    text = item.text
    voice = item.voice
    rate = item.rate
    pitch = item.pitch
    volume = item.volume

    print(f"[user={user_id}] /: {len(text)} chars | Voice: {voice} | Rate: {rate}")

    try:
        chunks = split_text_into_chunks(text)
        print(f"Split into {len(chunks)} chunks.")

        # Determine unique ID for the final file
        file_id = str(uuid.uuid4())
        final_mp3_path = f"/tmp/{file_id}.mp3"

        # temporary list of chunk files
        chunk_files = [f"/tmp/{file_id}_part_{i}.mp3" for i in range(len(chunks))]

        async def generate_chunk(chunk_text, index):
            try:
                c = edge_tts.Communicate(chunk_text, voice, rate=rate, pitch=pitch, volume=volume)
                await c.save(chunk_files[index])
            except Exception as e:
                print(f"Error generating chunk {index}: {e}")
                raise e

        # Run all chunks in parallel
        await asyncio.gather(*(generate_chunk(chunk, i) for i, chunk in enumerate(chunks)))

        # Merge chunks safely
        # We can just concatenate MP3 bytes for a simple merge
        with open(final_mp3_path, "wb") as outfile:
            for chunk_path in chunk_files:
                with open(chunk_path, "rb") as infile:
                    outfile.write(infile.read())
                # cleanup chunk
                os.remove(chunk_path)

        # Upload to R2
        from botocore.config import Config
        s3 = boto3.client('s3',
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
            config=Config(signature_version='s3v4')
        )

        r2_key = f"generated/{file_id}.mp3"

        with open(final_mp3_path, "rb") as f:
            s3.upload_fileobj(
                f,
                os.environ['R2_BUCKET_NAME'],
                r2_key,
                ExtraArgs={'ContentType': 'audio/mpeg'}
            )

        # Cleanup final file
        os.remove(final_mp3_path)

        # Generate Presigned URL
        audio_url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': os.environ['R2_BUCKET_NAME'], 'Key': r2_key},
            ExpiresIn=3600
        )

        return {
            "status": "success",
            "audio_url": audio_url,
            "chunks_processed": len(chunks)
        }

    except Exception as e:
        # Details go to the server log only; clients get a generic message.
        print(f"[user={user_id}] Error: {type(e).__name__}: {e}")
        return {"status": "error", "message": "Audio generation failed"}

@web_app.post("/process_docx")
async def process_docx_endpoint(request: Request, user_id: str = Depends(require_user)):
    """
    Multipart upload with field `file` (.docx). Returns course_assets.zip.
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
    finally:
        await form.close()

    validate_docx_upload(filename, content)
    print(f"[user={user_id}] /process_docx: {len(content)} bytes")

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

    sem = asyncio.Semaphore(5)

    async def generate_tts_for_scene(scene):
        script = scene["script"].strip()
        filename = f"{scene['id']}.mp3"
        chunks = split_text_into_chunks(script)
        audio_bytes = b""

        for chunk in chunks:
            async with sem:
                communicate = edge_tts.Communicate(chunk, "en-US-AriaNeural")
                async for data in communicate.stream():
                    if data["type"] == "audio":
                        audio_bytes += data["data"]
        return filename, audio_bytes

    tts_tasks = []
    for scene in scenes:
        if scene["script"].strip():
            tts_tasks.append(generate_tts_for_scene(scene))

    tts_results = await asyncio.gather(*tts_tasks, return_exceptions=True)

    # Filter out exceptions from results
    valid_tts_results = []
    for res in tts_results:
        if isinstance(res, Exception):
            print(f"Error generating TTS for scene: {res}")
        else:
            valid_tts_results.append(res)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for scene in scenes:
            for img_idx, img_bytes in enumerate(scene["images"]):
                ext = ".png"
                if img_bytes.startswith(b'\xff\xd8'):
                    ext = ".jpg"
                img_name = f"{scene['id']}_{img_idx + 1}{ext}"
                zip_file.writestr(img_name, img_bytes)

        for filename, audio_bytes in valid_tts_results:
            if audio_bytes:
                zip_file.writestr(filename, audio_bytes)

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=course_assets.zip"}
    )

@app.function(image=image, secrets=[r2_secret, clerk_secret], timeout=600)
@modal.asgi_app()
def generate_speech():
    return web_app
