"""Smoke test for a deployed Magalar TTS backend.

Usage (PowerShell):
    $env:BACKEND_URL = "https://<workspace>--serverless-tts-generate-speech.modal.run"
    $env:CLERK_TOKEN = "<Clerk session JWT>"   # e.g. `await window.Clerk.session.getToken()` in the browser console
    python backend/test_backend.py

Usage (bash):
    BACKEND_URL=... CLERK_TOKEN=... python backend/test_backend.py

Checks:
    1. POST / without a token      -> HTTP 401 {"status":"error","message":"Unauthorized"}
    2. POST / with CLERK_TOKEN     -> HTTP 200 {"status":"success","audio_url":...}
Clerk session tokens are short-lived (~60 s), so fetch a fresh one right before running.
Uses only the standard library. Never prints the token.
"""

import json
import os
import sys
import urllib.error
import urllib.request


def post_json(url: str, payload: dict, token: str | None = None, timeout: float = 120):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body)
        except ValueError:
            return e.code, {"raw": body[:500]}


def main() -> int:
    url = os.environ.get("BACKEND_URL", "").strip().rstrip("/")
    token = os.environ.get("CLERK_TOKEN", "").strip()
    if not url:
        print("Set BACKEND_URL to the deployed backend URL.")
        return 2

    payload = {
        "text": "Merhaba! This is a Magalar smoke test.",
        "voice": "en-US-AriaNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
        "volume": "+0%",
    }
    failures = 0
    print(f"Testing {url}/")

    status, body = post_json(url + "/", payload)
    ok = status == 401 and body.get("status") == "error"
    print(f"[{'PASS' if ok else 'FAIL'}] no token -> {status} {body}")
    failures += 0 if ok else 1

    if not token:
        print("CLERK_TOKEN not set; skipping the authenticated request.")
    else:
        status, body = post_json(url + "/", payload, token)
        ok = status == 200 and body.get("status") == "success" and bool(body.get("audio_url"))
        shown = {k: v for k, v in body.items() if k != "audio_url"}
        print(f"[{'PASS' if ok else 'FAIL'}] with token -> {status} {shown}"
              + (" (audio_url present)" if body.get("audio_url") else ""))
        failures += 0 if ok else 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
