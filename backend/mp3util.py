"""Minimal MPEG audio frame parser used to measure the exact duration of edge-tts output.

No Modal / edge-tts imports, so it can be unit-tested locally.

Why frame counting: edge-tts requests ``audio-24khz-48kbitrate-mono-mp3``. The
service returns a headerless CBR stream (no ID3, no Xing/Info frame; every frame is
an MPEG-2 Layer III frame of 576 samples = 24 ms). Chunks are stitched byte-wise, so
the stitched file's timeline is exactly the sum of each chunk's frames. Counting
frames gives the duration every decoder will play, in whole samples, without
trusting a nominal bitrate. If parsing fails (unexpected data) we fall back to
``bytes * 8 / 48 kbps``, which is what edge-tts itself uses for its own offsets.
"""

from __future__ import annotations

from dataclasses import dataclass

TICKS_PER_SECOND = 10_000_000  # edge-tts / Microsoft offsets are 100-ns ticks
FALLBACK_BITRATE_BPS = 48_000

# bitrate tables (kbps) indexed by bitrate index
_BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
_BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
_BR_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
_BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256]
_BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
_SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


@dataclass
class FrameHeader:
    length: int
    samples: int
    sample_rate: int


def parse_frame_header(b: bytes | memoryview, pos: int) -> FrameHeader | None:
    if pos + 4 > len(b):
        return None
    h0, h1, h2 = b[pos], b[pos + 1], b[pos + 2]
    if h0 != 0xFF or (h1 & 0xE0) != 0xE0:
        return None
    version = (h1 >> 3) & 0x3  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
    layer = (h1 >> 1) & 0x3  # 1 = L3, 2 = L2, 3 = L1, 0 = reserved
    br_idx = (h2 >> 4) & 0xF
    sr_idx = (h2 >> 2) & 0x3
    padding = (h2 >> 1) & 0x1
    if version == 1 or layer == 0 or br_idx in (0, 15) or sr_idx == 3:
        return None
    sample_rate = _SR[version][sr_idx]
    if version == 3:
        table = {1: _BR_V1_L3, 2: _BR_V1_L2, 3: _BR_V1_L1}[layer]
    else:
        table = _BR_V2_L1 if layer == 3 else _BR_V2_L23
    bitrate = table[br_idx] * 1000
    if layer == 3:  # Layer I
        samples = 384
        length = (12 * bitrate // sample_rate + padding) * 4
    elif layer == 2:  # Layer II
        samples = 1152
        length = 144 * bitrate // sample_rate + padding
    else:  # Layer III
        samples = 1152 if version == 3 else 576
        length = (144 if version == 3 else 72) * bitrate // sample_rate + padding
    if length < 4:
        return None
    return FrameHeader(length=length, samples=samples, sample_rate=sample_rate)


def _skip_id3v2(b: bytes) -> int:
    if len(b) >= 10 and b[:3] == b"ID3":
        size = (b[6] & 0x7F) << 21 | (b[7] & 0x7F) << 14 | (b[8] & 0x7F) << 7 | (b[9] & 0x7F)
        footer = 10 if b[5] & 0x10 else 0
        return 10 + size + footer
    return 0


def _is_xing_frame(b: bytes, pos: int, hdr: FrameHeader) -> bool:
    frame = b[pos : pos + min(hdr.length, 64)]
    return b"Xing" in frame or b"Info" in frame or b"VBRI" in frame


def duration_ticks(data: bytes) -> int:
    """Playable duration of an MP3 byte string in 100-ns ticks.

    Counts frames (resyncing over junk). Xing/Info/VBRI header frames are not
    audio and are not counted. Falls back to the 48 kbps CBR byte formula when
    no frames are found.
    """
    if not data:
        return 0
    b = bytes(data)
    pos = _skip_id3v2(b)
    total = 0  # ticks
    frames = 0
    n = len(b)
    while pos + 4 <= n:
        hdr = parse_frame_header(b, pos)
        if hdr is None or pos + hdr.length > n:
            if b[pos : pos + 3] == b"TAG":  # ID3v1 trailer
                break
            nxt = b.find(b"\xff", pos + 1)
            if nxt < 0:
                break
            pos = nxt
            continue
        if not (frames == 0 and _is_xing_frame(b, pos, hdr)):
            total += hdr.samples * TICKS_PER_SECOND // hdr.sample_rate
        frames += 1
        pos += hdr.length
    if frames == 0:
        return len(b) * 8 * TICKS_PER_SECOND // FALLBACK_BITRATE_BPS
    return total


def ticks_to_ms(ticks: int) -> int:
    return int(round(ticks / 10_000))
