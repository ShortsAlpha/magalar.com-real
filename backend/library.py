"""Render library: Postgres (Neon) metadata + user-scoped R2 keys.

Kept free of Modal / edge-tts imports so it can be unit-tested locally. ``asyncpg``
is imported lazily, so the module loads even where it is not installed.

Environment (Modal secret ``magalar-db``):
    DATABASE_URL   Neon *pooled* connection string (``...-pooler...``), sslmode=require.
                   Empty / unset -> library disabled (renders still work, render_id null).

Neon's pooled endpoint is PgBouncer in transaction mode, so the pool runs with
``statement_cache_size=0`` (no named prepared statements survive across
transactions). ``channel_binding=require`` (added by Neon's dashboard) is a libpq
option asyncpg does not use; it is stripped defensively so it can never be forwarded
as a server setting. A missing ``sslmode`` defaults to ``require``.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import os
import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

KINDS = ("single", "dialogue", "docx")
MAX_TITLE_CHARS = 120
DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 100
DB_OP_TIMEOUT_S = 15

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS renders (
    id          uuid PRIMARY KEY,
    user_id     text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('single', 'dialogue', 'docx')),
    title       text NOT NULL DEFAULT '',
    voice       text,
    voices      text[] NOT NULL DEFAULT '{}',
    language    text,
    chars       int NOT NULL DEFAULT 0,
    duration_ms int,
    scenes      int,
    audio_key   text,
    srt_key     text,
    vtt_key     text,
    zip_key     text,
    size_bytes  bigint NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renders_user_created_idx ON renders (user_id, created_at DESC);
"""
# Arbitrary constant: serializes concurrent CREATE TABLE IF NOT EXISTS from several containers.
_SCHEMA_LOCK_ID = 7_310_442_118

COLUMNS = (
    "id, user_id, kind, title, voice, voices, language, chars, duration_ms, scenes, "
    "audio_key, srt_key, vtt_key, zip_key, size_bytes, created_at"
)

_LIBPQ_ONLY_PARAMS = {"channel_binding", "gssencmode"}


# ---------------------------------------------------------------------------
# Keys / helpers
# ---------------------------------------------------------------------------
_SAFE_USER_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def user_prefix(user_id: str) -> str:
    """Clerk ids (``user_...``) are used verbatim; anything unexpected is hashed."""
    if _SAFE_USER_RE.match(user_id):
        return user_id
    return "h_" + hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:40]


def render_keys(user_id: str, render_id: str) -> dict[str, str]:
    base = f"users/{user_prefix(user_id)}/{render_id}"
    return {
        "audio_key": f"{base}/audio.mp3",
        "srt_key": f"{base}/subtitles.srt",
        "vtt_key": f"{base}/subtitles.vtt",
        "zip_key": f"{base}/bundle.zip",
    }


def legacy_keys(file_id: str, prefix: str = "") -> dict[str, str]:
    """Keys used when the library is off (``generated/...`` as before)."""
    base = f"generated/{prefix}{file_id}"
    return {"audio_key": f"{base}.mp3", "srt_key": f"{base}.srt", "vtt_key": f"{base}.vtt"}


def parse_cursor(cursor: str | None) -> dt.datetime | None:
    if not cursor:
        return None
    s = cursor.strip().replace(" ", "+")  # '+' in an unencoded query string becomes ' '
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    # Python < 3.11 only accepts 3 or 6 fractional digits; normalize to 6.
    s = re.sub(r"\.(\d{1,6})\d*", lambda m: "." + m.group(1).ljust(6, "0"), s, count=1)
    value = dt.datetime.fromisoformat(s)  # ValueError -> 400 in main.py
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value


def iso(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def prepare_dsn(dsn: str) -> str:
    """Normalize a Neon/libpq URL for asyncpg (drop libpq-only params, default sslmode)."""
    parts = urlsplit(dsn.strip())
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must be a postgres:// or postgresql:// URL")
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in _LIBPQ_ONLY_PARAMS]
    host = (parts.hostname or "").lower()
    if not any(k == "sslmode" for k, _ in query) and host not in ("localhost", "127.0.0.1", "::1"):
        query.append(("sslmode", "require"))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def row_to_dict(row) -> dict:
    d = dict(row)
    d["id"] = str(d["id"])
    d["voices"] = list(d.get("voices") or [])
    d["created_at"] = iso(d.get("created_at"))
    return d


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------
class Library:
    def __init__(self, dsn: str):
        self._dsn = prepare_dsn(dsn)
        self._pool = None
        self._lock = asyncio.Lock()
        self._schema_ready = False

    async def _get_pool(self):
        if self._pool is not None:
            return self._pool
        async with self._lock:
            if self._pool is None:
                import asyncpg  # lazy: keeps the module importable without asyncpg

                pool = await asyncpg.create_pool(
                    self._dsn,
                    min_size=0,
                    max_size=5,
                    statement_cache_size=0,  # PgBouncer transaction mode (Neon pooler)
                    max_inactive_connection_lifetime=60,
                    command_timeout=DB_OP_TIMEOUT_S,
                    timeout=10,  # connect timeout (Neon cold start is usually < 5 s)
                )
                try:
                    await self._ensure_schema(pool)
                except Exception:
                    await pool.close()
                    raise
                self._pool = pool
        return self._pool

    async def _ensure_schema(self, pool) -> None:
        if self._schema_ready:
            return
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock($1)", _SCHEMA_LOCK_ID)
                await conn.execute(SCHEMA_SQL)
        self._schema_ready = True

    async def startup(self) -> None:
        await self._get_pool()

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def insert(self, row: dict) -> None:
        pool = await self._get_pool()
        await pool.execute(
            """
            INSERT INTO renders (id, user_id, kind, title, voice, voices, language, chars,
                                 duration_ms, scenes, audio_key, srt_key, vtt_key, zip_key, size_bytes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """,
            uuid.UUID(row["id"]),
            row["user_id"],
            row["kind"],
            row["title"][:MAX_TITLE_CHARS],
            row.get("voice"),
            list(row.get("voices") or []),
            row.get("language"),
            int(row.get("chars") or 0),
            row.get("duration_ms"),
            row.get("scenes"),
            row.get("audio_key"),
            row.get("srt_key"),
            row.get("vtt_key"),
            row.get("zip_key"),
            int(row.get("size_bytes") or 0),
        )

    async def list(
        self,
        user_id: str,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: dt.datetime | None = None,
        q: str | None = None,
        kind: str | None = None,
    ) -> tuple[list[dict], str | None]:
        pool = await self._get_pool()
        args: list = [user_id]
        where = ["user_id = $1"]
        if cursor is not None:
            args.append(cursor)
            where.append(f"created_at < ${len(args)}")
        if q:
            args.append(f"%{escape_like(q)}%")
            where.append(f"title ILIKE ${len(args)} ESCAPE '\\'")
        if kind:
            args.append(kind)
            where.append(f"kind = ${len(args)}")
        args.append(limit + 1)
        rows = await pool.fetch(
            f"SELECT {COLUMNS} FROM renders WHERE {' AND '.join(where)} "
            f"ORDER BY created_at DESC, id DESC LIMIT ${len(args)}",
            *args,
        )
        items = [row_to_dict(r) for r in rows[:limit]]
        next_cursor = items[-1]["created_at"] if len(rows) > limit and items else None
        return items, next_cursor

    async def get(self, user_id: str, render_id: uuid.UUID) -> dict | None:
        pool = await self._get_pool()
        row = await pool.fetchrow(
            f"SELECT {COLUMNS} FROM renders WHERE id = $1 AND user_id = $2", render_id, user_id
        )
        return row_to_dict(row) if row else None

    async def update_title(self, user_id: str, render_id: uuid.UUID, title: str) -> dict | None:
        pool = await self._get_pool()
        row = await pool.fetchrow(
            f"UPDATE renders SET title = $3 WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}",
            render_id,
            user_id,
            title[:MAX_TITLE_CHARS],
        )
        return row_to_dict(row) if row else None

    async def delete(self, user_id: str, render_id: uuid.UUID) -> bool:
        pool = await self._get_pool()
        status = await pool.execute("DELETE FROM renders WHERE id = $1 AND user_id = $2", render_id, user_id)
        return status.endswith(" 1")


_library: Library | None = None
_library_dsn: str | None = None


def get_library() -> Library | None:
    """Process-wide Library for ``DATABASE_URL``; None when the library is off."""
    global _library, _library_dsn
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        return None
    if _library is None or _library_dsn != dsn:
        _library = Library(dsn)
        _library_dsn = dsn
    return _library
