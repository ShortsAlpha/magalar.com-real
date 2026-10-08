"""Clerk session-token verification for the Magalar TTS backend.

Kept free of Modal / edge-tts imports so it can be unit-tested locally.
It is shipped into the Modal container via ``Image.add_local_python_source``.

Contract with the frontend:
    Authorization: Bearer <Clerk session JWT>   (from ``useAuth().getToken()``)
On failure the API answers HTTP 401 with ``{"status": "error", "message": "Unauthorized"}``.

Environment (Modal secret ``magalar-clerk``):
    CLERK_ISSUER     required. Clerk Frontend API URL, e.g. https://clerk.magalar.com
    CLERK_JWKS_URL   optional. Defaults to ``${CLERK_ISSUER}/.well-known/jwks.json``
    ALLOWED_ORIGINS  optional. Comma-separated origins, used for CORS and the ``azp`` check.
"""

from __future__ import annotations

import os
import threading

import jwt
from fastapi import Request
from jwt import PyJWKClient

DEFAULT_ALLOWED_ORIGINS = "https://magalar.com,https://www.magalar.com,http://localhost:3000"

# Clock-skew tolerance for exp / nbf / iat.
LEEWAY_SECONDS = 30
# Clerk session tokens are ~1 KB; anything far larger is not a session token.
MAX_TOKEN_LENGTH = 8192
ALGORITHMS = ["RS256"]

UNAUTHORIZED_MESSAGE = "Unauthorized"
NOT_CONFIGURED_MESSAGE = (
    "Server authentication is not configured (CLERK_ISSUER is missing or invalid)"
)
AUTH_UNAVAILABLE_MESSAGE = "Authentication service temporarily unavailable"

# PyJWT >= 2.7 has PyJWKClientConnectionError; fall back gracefully on older versions.
_JWKS_CONNECTION_ERROR = getattr(jwt, "PyJWKClientConnectionError", ())


class AuthError(Exception):
    """Raised by the auth dependency. main.py turns it into a JSON response."""

    def __init__(self, status_code: int, message: str, reason: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        # Internal reason for logs only. Never contains the token.
        self.reason = reason or message


def _unauthorized(reason: str) -> AuthError:
    return AuthError(401, UNAUTHORIZED_MESSAGE, reason)


def _normalize_origin(origin: str) -> str:
    return origin.strip().rstrip("/")


def get_allowed_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip() or DEFAULT_ALLOWED_ORIGINS
    return [o for o in (_normalize_origin(x) for x in raw.split(",")) if o]


def get_issuer() -> str:
    issuer = _normalize_origin(os.environ.get("CLERK_ISSUER", ""))
    if not issuer.startswith("https://"):
        # Fail closed: without a trusted issuer we cannot verify anything.
        raise AuthError(503, NOT_CONFIGURED_MESSAGE, "CLERK_ISSUER not configured")
    return issuer


def get_jwks_url(issuer: str) -> str:
    explicit = os.environ.get("CLERK_JWKS_URL", "").strip()
    if explicit:
        return explicit
    return f"{issuer}/.well-known/jwks.json"


# Module-level JWKS client cache (one per JWKS URL). PyJWKClient caches the key
# set (lifespan) and refetches automatically when it sees an unknown ``kid``.
_jwk_clients: dict[str, PyJWKClient] = {}
_jwk_clients_lock = threading.Lock()


def get_jwk_client(jwks_url: str) -> PyJWKClient:
    client = _jwk_clients.get(jwks_url)
    if client is None:
        with _jwk_clients_lock:
            client = _jwk_clients.get(jwks_url)
            if client is None:
                client = PyJWKClient(
                    jwks_url,
                    cache_keys=True,
                    cache_jwk_set=True,
                    lifespan=3600,
                    timeout=10,
                )
                _jwk_clients[jwks_url] = client
    return client


def verify_clerk_token(token: str) -> str:
    """Verify a Clerk session JWT and return the user id (``sub``).

    Raises AuthError(401) for any invalid token, AuthError(503) when the server
    is not configured or the JWKS endpoint cannot be reached.
    """
    issuer = get_issuer()

    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise _unauthorized("missing or oversized token")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized("malformed token header")
    if header.get("alg") not in ALGORITHMS:
        raise _unauthorized("unexpected alg")

    try:
        signing_key = get_jwk_client(get_jwks_url(issuer)).get_signing_key_from_jwt(token)
    except _JWKS_CONNECTION_ERROR:  # type: ignore[misc]
        raise AuthError(503, AUTH_UNAVAILABLE_MESSAGE, "JWKS fetch failed")
    except jwt.PyJWTError:
        # Unknown kid, no matching key, bad JWKS, ...
        raise _unauthorized("signing key not found")

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={
                "require": ["exp", "iss", "sub"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_iss": True,
                # Clerk session tokens carry no ``aud``; the origin is bound via ``azp`` below.
                "verify_aud": False,
            },
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token expired")
    except jwt.ImmatureSignatureError:
        raise _unauthorized("token not yet valid")
    except jwt.InvalidIssuerError:
        raise _unauthorized("wrong issuer")
    except jwt.PyJWTError as e:
        raise _unauthorized(f"invalid token ({type(e).__name__})")

    azp = claims.get("azp")
    if azp is not None:
        if not isinstance(azp, str) or _normalize_origin(azp) not in get_allowed_origins():
            raise _unauthorized("azp not in ALLOWED_ORIGINS")

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise _unauthorized("missing sub")
    return sub


def require_user(request: Request) -> str:
    """FastAPI dependency: returns the authenticated Clerk user id.

    Declared as a sync function so FastAPI runs it in a threadpool (the JWKS
    fetch in PyJWKClient is blocking).
    """
    # Check configuration first so a misconfigured deploy is obvious (503).
    get_issuer()

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("missing bearer token")
    return verify_clerk_token(token.strip())
