"""Public ``/demo`` helpers: Cloudflare Turnstile verification, client IP, rate limits.

Kept free of Modal / edge-tts imports so it can be unit-tested locally. The rate-limit
store is injected (``modal.Dict`` in production, an in-memory fake in tests).

Client IP
---------
Modal's web-endpoint docs document ``request.client.host`` as the address of the
client making the request ("can be used for ... rate limits"). We use exactly that
and never read ``X-Forwarded-For`` / ``CF-Connecting-IP`` / ``X-Real-IP``: those are
set by the caller and trivially spoofable, which would let anyone reset their
per-IP quota. The global daily cap bounds abuse even if an attacker rotates IPs.

Rate limits (fixed windows, UTC)
--------------------------------
    per IP   5 / 10 min   and   30 / day
    global   2,000 / day
``modal.Dict`` has no atomic increment, so each request *claims a numbered slot*
with ``put(key, value, skip_if_exists=True)`` (atomic create-if-absent; returns
False when the slot already exists). A plain counter is kept only as a hint of the
next free slot. Concurrent requests can never exceed a limit. IPs are stored only as
a truncated SHA-256 hash. Dict entries expire after 7 days of inactivity.
"""

from __future__ import annotations

import hashlib
import math
import os
import time
from dataclasses import dataclass

import httpx

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_TIMEOUT_S = 5.0
DEMO_DICT_NAME = "magalar-demo-ratelimit"

# Tests replace this with ``httpx.MockTransport``.
_transport: httpx.AsyncBaseTransport | None = None


def turnstile_secret() -> str:
    return os.environ.get("TURNSTILE_SECRET_KEY", "").strip()


async def verify_turnstile(token: str, remote_ip: str | None, secret: str) -> bool:
    """Server-side Turnstile check. Any error (network, timeout, bad JSON) -> False."""
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=TURNSTILE_TIMEOUT_S, transport=_transport) as client:
            resp = await client.post(TURNSTILE_VERIFY_URL, data=data)
        if resp.status_code != 200:
            print(f"Turnstile siteverify HTTP {resp.status_code}")
            return False
        body = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        print(f"Turnstile siteverify failed: {type(e).__name__}")
        return False
    if body.get("success") is True:
        return True
    print(f"Turnstile rejected: {body.get('error-codes')}")
    return False


def client_ip(request) -> str:
    """Peer address as reported by Modal's ingress (see module docstring)."""
    client = getattr(request, "client", None)
    host = getattr(client, "host", None) if client else None
    return host or "unknown"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Limit:
    name: str
    per_ip: bool
    window_s: int
    limit: int


DEMO_LIMITS: tuple[Limit, ...] = (
    Limit("ip10m", True, 600, 5),
    Limit("ipday", True, 86_400, 30),
    Limit("globalday", False, 86_400, 2_000),
)


class ModalDictStore:
    """Async adapter over ``modal.Dict`` (uses the ``.aio`` variants)."""

    def __init__(self, d):
        self._d = d

    async def get(self, key, default=None):
        return await self._d.get.aio(key, default)

    async def put(self, key, value, skip_if_exists: bool = False) -> bool:
        return await self._d.put.aio(key, value, skip_if_exists=skip_if_exists)


class RateLimiter:
    def __init__(self, store, limits: tuple[Limit, ...] = DEMO_LIMITS, clock=time.time):
        self.store = store
        self.limits = limits
        self.clock = clock

    @staticmethod
    def _ip_hash(ip: str) -> str:
        return hashlib.sha256(f"magalar-demo:{ip}".encode("utf-8")).hexdigest()[:24]

    def _window(self, lim: Limit, ip: str, now: float) -> tuple[str, int]:
        bucket = int(now // lim.window_s)
        scope = f"ip:{self._ip_hash(ip)}" if lim.per_ip else "global"
        retry_after = max(1, math.ceil((bucket + 1) * lim.window_s - now))
        return f"demo:{lim.name}:{scope}:{bucket}", retry_after

    async def check(self, ip: str) -> int | None:
        """Read-only pre-check. Returns retry_after (s) if a limit is already used up."""
        now = self.clock()
        blocked = []
        for lim in self.limits:
            key, retry = self._window(lim, ip, now)
            if int(await self.store.get(f"{key}:n", 0) or 0) >= lim.limit:
                blocked.append(retry)
        return max(blocked) if blocked else None

    async def _claim(self, key: str, limit: int, now: float) -> bool:
        n = int(await self.store.get(f"{key}:n", 0) or 0)
        while n < limit:
            if await self.store.put(f"{key}:{n}", int(now), skip_if_exists=True):
                await self.store.put(f"{key}:n", n + 1)
                return True
            n += 1  # slot taken by a concurrent request; try the next one
        return False

    async def acquire(self, ip: str) -> int | None:
        """Claim one slot in every window. Returns retry_after (s) if any is exhausted."""
        now = self.clock()
        blocked = []
        for lim in self.limits:
            key, retry = self._window(lim, ip, now)
            if not await self._claim(key, lim.limit, now):
                blocked.append(retry)
        return max(blocked) if blocked else None
