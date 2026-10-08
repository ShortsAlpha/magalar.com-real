"""edge-tts orchestration: parallel chunk synthesis, byte-wise MP3 stitching, subtitles.

Voices
------
Voice ids are passed to edge-tts in Microsoft's long form
("Microsoft Server Speech Text to Speech Voice (iu-Cans-CA, SiqiniqNeural)").
edge-tts 7.2.8 only expands ids whose region is upper-case, so the Inuktitut ids
``iu-Cans-CA-*`` / ``iu-Latn-CA-*`` would otherwise be rejected with ValueError.

A few voices (measured over the 322-voice catalog: ``da-DK-ChristelNeural``,
``th-TH-PremwadeeNeural``) intermittently return no audio at all when word
boundaries are requested. For those the request is repeated with SentenceBoundary and the
subtitles are built from sentence events (lines timed proportionally inside each
sentence). Voices that needed this are remembered for 10 minutes per container.

Timeline model
--------------
Every chunk is one edge-tts request (``textproc`` keeps chunks below edge-tts' own
4096-byte split). Its WordBoundary offsets are relative to that chunk's audio. The
chunk's real length is measured by counting its MP3 frames (``mp3util``), and the
next chunk's words are shifted by the running total. Because the stitched file is
just those frames back to back, subtitle times match the stitched MP3 exactly,
without accumulating rounding error (all math is in integer 100-ns ticks).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import edge_tts
from edge_tts.exceptions import NoAudioReceived

from mp3util import duration_ticks, ticks_to_ms
from subtitles import Cue, align_words, build_cues, fallback_cues, finalize_cues, sentence_cues, to_srt, to_vtt
from textproc import has_speakable, split_text_into_chunks

MAX_PARALLEL = 8  # concurrent edge-tts websockets per render
ATTEMPTS = 3  # transient websocket failures / throttling are retried twice
RETRY_DELAY_S = 1.0
WORD = "WordBoundary"
SENTENCE = "SentenceBoundary"

# Voices that just failed with WordBoundary but worked with SentenceBoundary, with the
# time they were seen. Expires so a transient service hiccup does not downgrade a
# voice's subtitles for the container's whole lifetime.
_SENTENCE_ONLY_VOICES: dict[str, float] = {}
SENTENCE_ONLY_TTL_S = 600


def edge_voice_name(voice: str) -> str:
    """``tr-TR-EmelNeural`` -> ``Microsoft Server Speech Text to Speech Voice (tr-TR, EmelNeural)``."""
    locale, _, name = voice.rpartition("-")
    if not locale:
        return voice
    return f"Microsoft Server Speech Text to Speech Voice ({locale}, {name})"


@dataclass
class Piece:
    text: str
    voice: str
    rate: str = "+0%"
    pitch: str = "+0Hz"
    volume: str = "+0%"


@dataclass
class ChunkAudio:
    audio: bytes
    boundaries: list[dict]
    boundary_kind: str = WORD


@dataclass
class Render:
    audio: bytes
    cues: list[Cue]
    duration_ticks: int
    chunks: int

    @property
    def duration_ms(self) -> int:
        return ticks_to_ms(self.duration_ticks)

    @property
    def srt(self) -> str:
        return to_srt(self.cues)

    @property
    def vtt(self) -> str:
        return to_vtt(self.cues)


class NothingToSpeak(ValueError):
    pass


def pieces_for_text(text: str, voice: str, rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%") -> list[Piece]:
    return [
        Piece(c, voice, rate, pitch, volume)
        for c in split_text_into_chunks(text)
        if has_speakable(c)
    ]


async def _stream_piece(piece: Piece, boundary: str) -> ChunkAudio:
    comm = edge_tts.Communicate(
        piece.text,
        edge_voice_name(piece.voice),
        rate=piece.rate,
        pitch=piece.pitch,
        volume=piece.volume,
        boundary=boundary,
    )
    audio = bytearray()
    boundaries: list[dict] = []
    async for msg in comm.stream():
        kind = msg.get("type")
        if kind == "audio":
            audio += msg["data"]
        elif kind == boundary:
            boundaries.append(msg)
    if not audio:
        raise NoAudioReceived("edge-tts returned no audio")
    return ChunkAudio(bytes(audio), boundaries, boundary)


def _sentence_only(voice: str) -> bool:
    marked = _SENTENCE_ONLY_VOICES.get(voice)
    return marked is not None and time.monotonic() - marked < SENTENCE_ONLY_TTL_S


async def synthesize_piece(piece: Piece) -> ChunkAudio:
    """One edge-tts request with boundary metadata.

    WordBoundary first; if the service returns no audio for it, SentenceBoundary
    right away. Other failures (and a failure of both modes) are retried with a
    short backoff, starting again from WordBoundary.
    """
    last_error: Exception | None = None
    for attempt in range(ATTEMPTS):
        if attempt:
            await asyncio.sleep(RETRY_DELAY_S * attempt)
        word_first = not _sentence_only(piece.voice)
        try:
            if word_first:
                try:
                    return await _stream_piece(piece, WORD)
                except NoAudioReceived:
                    pass
            result = await _stream_piece(piece, SENTENCE)
            if word_first:
                print(f"Voice {piece.voice}: no audio with WordBoundary, using SentenceBoundary")
                _SENTENCE_ONLY_VOICES[piece.voice] = time.monotonic()
            return result
        except Exception as e:  # noqa: BLE001 - retried, then re-raised
            last_error = e
            print(f"edge-tts chunk failed ({type(e).__name__}), attempt {attempt + 1}/{ATTEMPTS}")
    assert last_error is not None
    raise last_error


async def render_pieces(
    pieces: list[Piece], max_parallel: int = MAX_PARALLEL, sem: asyncio.Semaphore | None = None
) -> Render:
    """Synthesize pieces in parallel and stitch them in order with a shared timeline.

    ``sem`` lets several renders (e.g. DOCX scenes) share one concurrency cap.
    """
    if not pieces:
        raise NothingToSpeak("No speakable text")
    sem = sem or asyncio.Semaphore(max_parallel)

    async def run(p: Piece) -> ChunkAudio:
        async with sem:
            return await synthesize_piece(p)

    results = await asyncio.gather(*(run(p) for p in pieces))

    audio = bytearray()
    cues: list[Cue] = []
    base = 0
    for piece, res in zip(pieces, results):
        length = duration_ticks(res.audio)
        if res.boundaries and res.boundary_kind == SENTENCE:
            cues.extend(sentence_cues(res.boundaries, base))
        elif res.boundaries:
            cues.extend(build_cues(align_words(piece.text, res.boundaries, base)))
        else:
            cues.extend(fallback_cues(piece.text, base, base + length))
        audio += res.audio
        base += length
    return Render(bytes(audio), finalize_cues(cues, base), base, len(pieces))


async def render_text(text: str, voice: str, rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%") -> Render:
    return await render_pieces(pieces_for_text(text, voice, rate, pitch, volume))


async def synthesize_plain(text: str, voice: str) -> bytes:
    """Short, fixed-prosody synthesis without metadata (used by /demo)."""
    comm = edge_tts.Communicate(text, edge_voice_name(voice), rate="+0%", pitch="+0Hz", volume="+0%")
    audio = bytearray()
    async for msg in comm.stream():
        if msg.get("type") == "audio":
            audio += msg["data"]
    if not audio:
        raise RuntimeError("edge-tts returned no audio")
    return bytes(audio)
