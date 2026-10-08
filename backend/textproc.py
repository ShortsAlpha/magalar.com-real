"""Unicode-aware text chunking and small text helpers for the Magalar TTS backend.

No Modal / edge-tts imports, so it can be unit-tested locally.

Chunking rules (``split_text_into_chunks``):
  1. Paragraphs (``\\n``) are split into sentences.
     * Latin-style terminators (``. ! ? …``) end a sentence only when followed by
       whitespace or end of text, so "3.14", "e.g.x" or URLs are not split.
     * Terminators of scripts that do not use spaces, or that never appear inside a
       word, end a sentence unconditionally: CJK ``。！？｡．``, Devanagari/Bengali
       danda ``। ॥``, Arabic/Urdu ``؟ ۔``, Ethiopic ``። ፧``, Myanmar ``။``,
       Khmer ``។ ៕``, Syriac ``܀``.
  2. A sentence longer than the limit is split at the last whitespace, then at the
     last clause mark (``, ; : ، 、 ， ；`` ...), and finally at a hard length that
     never cuts through a combining mark (Thai / Devanagari vowel signs etc.).
  3. Sentences are packed greedily into chunks of at most ``max_chars`` characters
     *and* ``max_bytes`` UTF-8 bytes after XML escaping. The byte cap keeps every
     chunk below edge-tts' internal 4096-byte split, so one chunk == one request.
"""

from __future__ import annotations

import re
import unicodedata

DEFAULT_MAX_CHARS = 2000
# edge-tts splits escaped text at 4096 UTF-8 bytes; stay safely below that.
DEFAULT_MAX_BYTES = 3800

_CLOSERS = "\"'”’»)\\]}」』）】〕›"
# Terminators that need trailing whitespace (or end of text) to count.
_COND_END = ".!?…‼⁇⁈⁉"
# Terminators that always end a sentence.
_UNCOND_END = (
    "。！？｡．︒"  # 。！？｡．︒
    "।॥"  # । ॥
    "؟۔"  # ؟ ۔
    "።፧"  # ። ፧
    "။"  # ။
    "។៕"  # ។ ៕
    "܀"  # ܀
)
SENTENCE_END_CHARS = set(_COND_END + _UNCOND_END)
CLAUSE_CHARS = set(",;:،؛、，；：—–၊")  # , ; : ، ؛ 、 ， ； ： — – ၊

_SENTENCE_RE = re.compile(
    rf"(?:[{re.escape(_UNCOND_END)}]+[{re.escape(_CLOSERS)}]*"
    rf"|[{re.escape(_COND_END)}]+[{re.escape(_CLOSERS)}]*(?=\s|$))\s*"
)


def escaped_byte_len(s: str) -> int:
    """UTF-8 length after the XML escaping edge-tts applies (& < >)."""
    return len(s.encode("utf-8")) + 4 * s.count("&") + 3 * (s.count("<") + s.count(">"))


def split_sentences(paragraph: str) -> list[str]:
    """Split one paragraph into sentences, keeping trailing whitespace/punctuation."""
    out: list[str] = []
    start = 0
    for m in _SENTENCE_RE.finditer(paragraph):
        end = m.end()
        if end > start:
            out.append(paragraph[start:end])
            start = end
    if start < len(paragraph):
        out.append(paragraph[start:])
    return [s for s in out if s.strip()]


def _is_combining(ch: str) -> bool:
    return unicodedata.combining(ch) != 0 or unicodedata.category(ch) in ("Mn", "Mc", "Me")


def _fits(s: str, max_chars: int, max_bytes: int) -> bool:
    return len(s) <= max_chars and escaped_byte_len(s) <= max_bytes


def _max_prefix(s: str, max_chars: int, max_bytes: int) -> int:
    """Largest n such that s[:n] fits both limits (at least 1)."""
    n = min(len(s), max_chars)
    while n > 1 and escaped_byte_len(s[:n]) > max_bytes:
        # Shrink proportionally first, then fine-tune.
        over = escaped_byte_len(s[:n]) - max_bytes
        n -= max(1, over // 4)
    return max(1, n)


def _split_long(sentence: str, max_chars: int, max_bytes: int) -> list[str]:
    """Split an over-long sentence: whitespace -> clause mark -> hard cut."""
    parts: list[str] = []
    rest = sentence
    while not _fits(rest, max_chars, max_bytes):
        limit = _max_prefix(rest, max_chars, max_bytes)
        window = rest[:limit]
        cut = -1
        # 1) last whitespace in the second half of the window
        for i in range(len(window) - 1, limit // 2, -1):
            if window[i].isspace():
                cut = i + 1
                break
        # 2) last clause mark
        if cut < 0:
            for i in range(len(window) - 1, limit // 2, -1):
                if window[i] in CLAUSE_CHARS:
                    cut = i + 1
                    break
        # 3) hard cut that does not separate a base char from its combining marks
        if cut < 0:
            cut = limit
            while cut > 1 and cut < len(rest) and _is_combining(rest[cut]):
                cut -= 1
        piece, rest = rest[:cut], rest[cut:]
        if piece.strip():
            parts.append(piece)
    if rest.strip():
        parts.append(rest)
    return parts


def split_text_into_chunks(
    text: str, max_chars: int = DEFAULT_MAX_CHARS, max_bytes: int = DEFAULT_MAX_BYTES
) -> list[str]:
    """Split text into chunks at sentence boundaries (Unicode-aware)."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return []
    if _fits(text, max_chars, max_bytes):
        return [text.strip()]

    pieces: list[str] = []
    for para in text.split("\n"):
        if not para.strip():
            continue
        sentences = split_sentences(para)
        for s in sentences:
            if _fits(s, max_chars, max_bytes):
                pieces.append(s)
            else:
                pieces.extend(_split_long(s, max_chars, max_bytes))
        # Paragraph break: make sure the last piece ends in whitespace.
        if pieces and not pieces[-1][-1:].isspace():
            pieces[-1] = pieces[-1] + "\n"

    chunks: list[str] = []
    current = ""
    for p in pieces:
        candidate = current + p
        if current and not _fits(candidate.strip(), max_chars, max_bytes):
            chunks.append(current.strip())
            current = p
        else:
            current = candidate
    if current.strip():
        chunks.append(current.strip())
    return chunks


def has_speakable(text: str) -> bool:
    """True when the text contains at least one letter or digit."""
    return any(unicodedata.category(ch)[0] in ("L", "N") for ch in text)


def language_of_voice(voice: str) -> str:
    """``tr-TR-EmelNeural`` -> ``tr``; ``fil-PH-AngeloNeural`` -> ``fil``."""
    return voice.split("-", 1)[0].lower()


def default_title(text: str, limit: int = 60) -> str:
    """First ~``limit`` chars of the text, trimmed at a word boundary."""
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat[:limit]
    space = cut.rfind(" ")
    if space >= limit // 2:
        cut = cut[:space]
    cut = cut.rstrip(" ,.;:-–—、，")
    return cut + "…"
