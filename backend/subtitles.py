"""Subtitle (SRT / WebVTT) generation from edge-tts WordBoundary events.

No Modal / edge-tts imports, so it can be unit-tested locally.

Pipeline per synthesized chunk:
  1. ``align_words``: each WordBoundary ``{offset, duration, text}`` (100-ns ticks,
     relative to the chunk's own audio) is shifted by the chunk's position in the
     stitched MP3 (``base_ticks``) and located in the chunk's source text. Edge
     reports bare words ("world", not "world."), so the source is used to recover
     punctuation and original spacing (important for CJK / Thai, which have none).
  2. ``build_cues``: words are grouped into readable cues: at most ~42 display
     columns (CJK counts double), at most 5 s, always broken after a sentence end,
     broken after a clause mark once the line is half full, and broken on pauses.
  3. ``finalize_cues``: a short linger after the last word (never overlapping the
     next cue or running past the end of the audio).
Chunks with no boundary events (rare; e.g. text the voice cannot read) fall back to
cues spread proportionally over the chunk's measured duration.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from textproc import CLAUSE_CHARS, SENTENCE_END_CHARS

TICKS_PER_MS = 10_000
MAX_CUE_WIDTH = 42
MAX_CUE_TICKS = 5_000 * TICKS_PER_MS
PAUSE_BREAK_TICKS = 700 * TICKS_PER_MS
LINGER_TICKS = 400 * TICKS_PER_MS
MIN_CUE_TICKS = 700 * TICKS_PER_MS
ALIGN_WINDOW = 400  # chars searched ahead of the cursor when aligning a word


@dataclass
class Word:
    start: int  # absolute ticks in the stitched audio
    end: int
    text: str
    source: str | None = None
    src_start: int | None = None
    src_end: int | None = None
    lead: str = ""  # opening punctuation directly before the word, e.g. “ ¿ «
    trail: str = ""  # punctuation directly after the word, e.g. . , ” 。
    sentence_end: bool = False
    clause_end: bool = False


@dataclass
class Cue:
    start: int  # ticks
    end: int
    text: str


def _is_punct(ch: str) -> bool:
    return unicodedata.category(ch)[0] in ("P", "S") and not ch.isspace()


def _no_space_script(ch: str) -> bool:
    """Scripts written without spaces between words (CJK, kana, Thai, Lao, Khmer, Myanmar)."""
    if not ch:
        return False
    cp = ord(ch)
    return (
        0x2E80 <= cp <= 0x9FFF  # CJK radicals, kana, CJK unified
        or 0xF900 <= cp <= 0xFAFF
        or 0xFF00 <= cp <= 0xFFEF
        or 0x20000 <= cp <= 0x2FFFF
        or 0x0E00 <= cp <= 0x0EFF  # Thai, Lao
        or 0x1780 <= cp <= 0x17FF  # Khmer
        or 0x1000 <= cp <= 0x109F  # Myanmar
    )


def display_width(s: str) -> int:
    w = 0
    for ch in s:
        if unicodedata.combining(ch) or unicodedata.category(ch) in ("Mn", "Me", "Cf"):
            continue
        w += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return w


def align_words(source: str, boundaries: list[dict], base_ticks: int = 0) -> list[Word]:
    """Turn WordBoundary events of one chunk into absolute, source-aligned words."""
    words: list[Word] = []
    cursor = 0
    for b in boundaries:
        text = str(b.get("text", ""))
        if not text.strip():
            continue
        start = base_ticks + int(b.get("offset", 0))
        end = start + max(0, int(b.get("duration", 0)))
        w = Word(start=start, end=end, text=text.strip())
        stop = min(len(source), cursor + ALIGN_WINDOW + len(w.text))
        idx = source.find(w.text, cursor, stop)
        if idx < 0:
            m = re.compile(re.escape(w.text), re.IGNORECASE).search(source, cursor, stop)
            idx = m.start() if m else -1
        if idx >= 0:
            w.source, w.src_start, w.src_end = source, idx, idx + len(w.text)
            cursor = w.src_end
        words.append(w)

    # Second pass: punctuation around each aligned word, sentence / clause ends.
    aligned = [w for w in words if w.src_start is not None]
    prev_end = 0
    for i, w in enumerate(aligned):
        nxt = aligned[i + 1].src_start if i + 1 < len(aligned) else len(source)
        between = source[w.src_end : nxt]
        trail = []
        for ch in between:
            if ch.isspace() or not _is_punct(ch):
                break
            trail.append(ch)
        w.trail = "".join(trail)
        w.sentence_end = any(c in SENTENCE_END_CHARS for c in between) or i + 1 == len(aligned)
        w.clause_end = any(c in CLAUSE_CHARS for c in between)
        j = w.src_start
        while j > prev_end and _is_punct(source[j - 1]) and not source[j - 1].isspace():
            j -= 1
        w.lead = source[j : w.src_start]
        prev_end = w.src_end + len(w.trail)
    return words


def _cue_text(words: list[Word]) -> str:
    first, last = words[0], words[-1]
    if all(w.source is not None and w.source is first.source for w in words):
        raw = first.lead + first.source[first.src_start : last.src_end] + last.trail
        return " ".join(raw.split())
    out = ""
    for w in words:
        piece = w.lead + w.text + w.trail
        if out and not (_no_space_script(out[-1]) and _no_space_script(piece[0])):
            out += " "
        out += piece
    return " ".join(out.split())


def build_cues(
    words: list[Word],
    max_width: int = MAX_CUE_WIDTH,
    max_ticks: int = MAX_CUE_TICKS,
    pause_ticks: int = PAUSE_BREAK_TICKS,
) -> list[Cue]:
    """Group words into readable subtitle cues (not one word per cue)."""
    cues: list[Cue] = []
    cur: list[Word] = []

    def flush():
        if cur:
            text = _cue_text(cur)
            if text:
                cues.append(Cue(cur[0].start, max(cur[-1].end, cur[0].start + 1), text))
            cur.clear()

    for w in words:
        if cur:
            prev = cur[-1]
            cur_width = display_width(_cue_text(cur))
            brk = (
                prev.source is not w.source
                or prev.sentence_end
                or (prev.clause_end and cur_width >= max_width // 2)
                or (w.start - prev.end) > pause_ticks
                or display_width(_cue_text(cur + [w])) > max_width
                or (w.end - cur[0].start) > max_ticks
            )
            if brk:
                flush()
        cur.append(w)
    flush()
    return cues


def _wrap_text(text: str, max_width: int) -> list[str]:
    """Split text into lines of at most ``max_width`` columns (word-wise, else hard)."""
    lines: list[str] = []
    line = ""
    tokens = re.findall(r"\S+\s*", text) if " " in text.strip() else list(text)
    for tok in tokens:
        if line and display_width((line + tok).strip()) > max_width:
            lines.append(line.strip())
            line = ""
        line += tok
    if line.strip():
        lines.append(line.strip())
    # A single token wider than the limit (e.g. a long URL) is split hard.
    out: list[str] = []
    for ln in lines:
        while display_width(ln) > max_width:
            out.append(ln[:max_width])
            ln = ln[max_width:]
        out.append(ln)
    return [ln for ln in out if ln]


def fallback_cues(text: str, start: int, end: int, max_width: int = MAX_CUE_WIDTH) -> list[Cue]:
    """Cues spread over [start, end] proportionally to text length (no boundaries)."""
    lines = _wrap_text(" ".join(text.split()) if " " in text else text.strip(), max_width)
    if not lines or end <= start:
        return []
    total = sum(max(1, len(ln)) for ln in lines)
    cues, t = [], start
    for ln in lines:
        d = (end - start) * max(1, len(ln)) // total
        cues.append(Cue(t, t + d, ln))
        t += d
    cues[-1].end = end
    return cues


def sentence_cues(boundaries: list[dict], base_ticks: int = 0, max_width: int = MAX_CUE_WIDTH) -> list[Cue]:
    """Cues from SentenceBoundary events: each sentence is wrapped into lines that
    share the sentence's time span proportionally."""
    cues: list[Cue] = []
    for b in boundaries:
        text = str(b.get("text", "")).strip()
        if not text:
            continue
        start = base_ticks + int(b.get("offset", 0))
        end = start + max(1, int(b.get("duration", 0)))
        cues.extend(fallback_cues(text, start, end, max_width))
    return cues


def finalize_cues(cues: list[Cue], total_ticks: int | None = None) -> list[Cue]:
    """Sort, add a short linger, enforce a minimum length, never overlap."""
    cues = sorted((c for c in cues if c.text.strip()), key=lambda c: c.start)
    for i, c in enumerate(cues):
        limit = cues[i + 1].start if i + 1 < len(cues) else (total_ticks or c.end + LINGER_TICKS)
        target = max(c.end + LINGER_TICKS, c.start + MIN_CUE_TICKS)
        c.end = max(min(target, limit), min(c.end, limit))
        if c.end <= c.start:
            c.end = c.start + TICKS_PER_MS
    return cues


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
def _ts(ticks: int, sep: str) -> str:
    ms = max(0, int(round(ticks / TICKS_PER_MS)))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def srt_timestamp(ticks: int) -> str:
    return _ts(ticks, ",")


def vtt_timestamp(ticks: int) -> str:
    return _ts(ticks, ".")


def to_srt(cues: list[Cue]) -> str:
    blocks = []
    for i, c in enumerate(cues, 1):
        text = c.text.replace("-->", "->")
        blocks.append(f"{i}\n{srt_timestamp(c.start)} --> {srt_timestamp(c.end)}\n{text}\n")
    return "\n".join(blocks)


def to_vtt(cues: list[Cue]) -> str:
    out = ["WEBVTT\n"]
    for c in cues:
        text = c.text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        out.append(f"{vtt_timestamp(c.start)} --> {vtt_timestamp(c.end)}\n{text}\n")
    return "\n".join(out)
