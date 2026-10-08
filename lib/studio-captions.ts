'use client';

import { downloadHref } from './api';

/**
 * WebVTT captions for the studio player. VTT files are fetched through the same-origin
 * `/api/download` proxy (R2 presigned URLs don't send CORS headers), parsed once and cached per URL.
 */

export interface Cue {
    /** Seconds. */
    start: number;
    /** Seconds. */
    end: number;
    text: string;
}

/** "01:02:03.456" | "02:03.456" | "02:03,456" → seconds, or NaN. */
function parseTimestamp(raw: string): number {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(raw.trim());
    if (!m) return NaN;
    const [, h, min, s, ms] = m;
    return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s)) + Number(ms.padEnd(3, '0')) / 1000;
}

const decodeEntities = (s: string) =>
    s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lrm;/g, '‎')
        .replace(/&rlm;/g, '‏')
        .replace(/&amp;/g, '&');

/** Parses WebVTT (and tolerates SRT-style comma timestamps). Cue markup tags are stripped. */
export function parseVtt(input: string): Cue[] {
    const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blocks = text.split(/\n{2,}/);
    const cues: Cue[] = [];
    for (const block of blocks) {
        const lines = block.split('\n').filter((l) => l.length > 0);
        const timingIndex = lines.findIndex((l) => l.includes('-->'));
        if (timingIndex < 0) continue; // WEBVTT header, NOTE, STYLE, REGION
        const [startRaw, rest = ''] = lines[timingIndex].split('-->');
        const endRaw = rest.trim().split(/\s+/)[0] ?? '';
        const start = parseTimestamp(startRaw);
        const end = parseTimestamp(endRaw);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const body = lines
            .slice(timingIndex + 1)
            .map((l) => decodeEntities(l.replace(/<[^>]+>/g, '')).trim())
            .filter(Boolean)
            .join(' ');
        if (!body) continue;
        cues.push({ start, end: Math.max(end, start), text: body });
    }
    return cues.sort((a, b) => a.start - b.start);
}

/** Index of the last cue that started at or before `t` (seconds), or -1. Binary search; cues are sorted by start. */
export function lastStartedCueIndex(cues: Cue[], t: number): number {
    let lo = 0;
    let hi = cues.length - 1;
    let candidate = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cues[mid].start <= t) {
            candidate = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return candidate;
}

/** Index of the cue active at `t` (seconds), or -1 between cues. */
export function findCueIndex(cues: Cue[], t: number): number {
    const i = lastStartedCueIndex(cues, t);
    return i >= 0 && t < cues[i].end ? i : -1;
}

const cache = new Map<string, Promise<Cue[]>>();
const CACHE_LIMIT = 24;

/** Fetches + parses a VTT via the download proxy. Failed fetches are not cached. */
export function fetchCues(vttUrl: string): Promise<Cue[]> {
    const hit = cache.get(vttUrl);
    if (hit) return hit;
    const promise = (async () => {
        const res = await fetch(downloadHref(vttUrl, 'captions.vtt'), { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status === 410 ? 'Captions link expired' : 'Captions unavailable');
        return parseVtt(await res.text());
    })();
    cache.set(vttUrl, promise);
    promise.catch(() => cache.delete(vttUrl));
    if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return promise;
}

/** "00:01:02.300" style label for a transcript row. */
export function cueStamp(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}
