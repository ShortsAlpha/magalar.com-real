'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';

/**
 * Client for the Magalar voice engine (FastAPI on Modal, see backend/main.py).
 *
 * Every request carries `Authorization: Bearer <Clerk session token>`; the backend verifies it.
 * Shapes follow the shared v2 contract (renders + subtitles + library).
 */

/** Base URL of the voice engine, without a trailing slash. */
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').replace(/\/+$/, '');

export const SESSION_EXPIRED_MESSAGE = 'Your session expired — please sign in again.';
const NETWORK_MESSAGE = "Couldn't reach the voice engine. Check your connection and try again.";
const CONFIG_MESSAGE = 'The voice engine is not configured (NEXT_PUBLIC_BACKEND_URL is missing).';

/**
 * - `auth`        401 / missing token
 * - `network`     fetch failed
 * - `server`      any other backend error
 * - `config`      NEXT_PUBLIC_BACKEND_URL missing
 * - `aborted`     cancelled by the user
 * - `unavailable` 503 (e.g. "Library is not configured")
 * - `not_found`   404 (unknown or foreign library id)
 * - `rate_limited` 429 — see `retryAfter`
 */
export type ApiErrorKind = 'auth' | 'network' | 'server' | 'config' | 'aborted' | 'unavailable' | 'not_found' | 'rate_limited';

export class ApiError extends Error {
    readonly kind: ApiErrorKind;
    readonly status?: number;
    /** Seconds, for `rate_limited`. */
    readonly retryAfter?: number;

    constructor(kind: ApiErrorKind, message: string, status?: number, retryAfter?: number) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

/** Normalises anything thrown into a user-facing message + kind. */
export function toApiError(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof DOMException) {
        if (err.name === 'AbortError') return new ApiError('aborted', 'Cancelled.');
        if (err.name === 'NotAllowedError') return new ApiError('server', 'Your browser blocked playback — press play again.');
        if (err.name === 'NotSupportedError') return new ApiError('server', "This audio couldn't be played. Try again.");
    }
    if (err instanceof Error) return new ApiError('server', err.message || 'Something went wrong.');
    return new ApiError('server', 'Something went wrong.');
}

export type TokenGetter = () => Promise<string | null>;

/** Prosody values in the exact string formats edge-tts expects. */
export interface Prosody {
    /** e.g. "+10%" / "-20%" */
    rate: string;
    /** e.g. "+5Hz" / "-10Hz" */
    pitch: string;
    /** e.g. "+0%" / "-15%" */
    volume: string;
}

export interface SpeechRequest extends Prosody {
    text: string;
    voice: string;
    /** Optional library title (≤ 120 chars). The backend derives one from the text when omitted. */
    title?: string;
    /** `false` for throwaway previews: no Library row, no subtitles, max 500 chars. Defaults to true. */
    save?: boolean;
}

/** Longest text the backend accepts for an unsaved preview (`save: false`). */
export const PREVIEW_MAX_CHARS = 500;

export interface DialogueSegment extends Prosody {
    text: string;
    voice: string;
}

/** Common fields of every stored render (`POST /` and `POST /generate_multi`). */
export interface RenderResult {
    audioUrl: string;
    srtUrl: string | null;
    vttUrl: string | null;
    durationMs: number | null;
    /** Library row id, or null when the library is off. */
    renderId: string | null;
}

export interface SpeechResult extends RenderResult {
    chunksProcessed: number;
}

export interface DialogueResult extends RenderResult {
    segmentsProcessed: number;
}

export interface DocxResult {
    blob: Blob;
    /** From `X-Render-Id`; null when the library is off. */
    renderId: string | null;
    /** From `Content-Disposition`, if present. */
    filename: string | null;
}

export type RenderKind = 'single' | 'dialogue' | 'docx';

export interface LibraryItem {
    id: string;
    kind: RenderKind;
    title: string;
    voice: string | null;
    voices: string[];
    language: string | null;
    chars: number | null;
    durationMs: number | null;
    scenes: number | null;
    sizeBytes: number | null;
    /** ISO timestamp — also the pagination cursor. */
    createdAt: string;
    audioUrl: string | null;
    srtUrl: string | null;
    vttUrl: string | null;
    zipUrl: string | null;
}

export interface LibraryQuery {
    limit?: number;
    cursor?: string | null;
    q?: string;
    kind?: RenderKind | null;
}

export interface LibraryPage {
    items: LibraryItem[];
    nextCursor: string | null;
}

export const NEUTRAL_PROSODY: Prosody = { rate: '+0%', pitch: '+0Hz', volume: '+0%' };

const signed = (n: number, unit: string) => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`;

/** speed multiplier (1.0 = normal), pitch in Hz, volume in % → backend prosody strings. */
export function toProsody(speed: number, pitchHz: number, volumePct: number): Prosody {
    return {
        rate: signed((speed - 1) * 100, '%'),
        pitch: signed(pitchHz, 'Hz'),
        volume: signed(volumePct, '%'),
    };
}

interface RequestOptions {
    signal?: AbortSignal;
}

async function send(path: string, init: RequestInit, getToken: TokenGetter): Promise<Response> {
    if (!BACKEND_URL) throw new ApiError('config', CONFIG_MESSAGE);

    let token: string | null = null;
    try {
        token = await getToken();
    } catch {
        token = null;
    }
    if (!token) throw new ApiError('auth', SESSION_EXPIRED_MESSAGE, 401);

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let res: Response;
    try {
        res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('aborted', 'Cancelled.');
        throw new ApiError('network', NETWORK_MESSAGE);
    }

    if (res.status === 401 || res.status === 403) {
        throw new ApiError('auth', SESSION_EXPIRED_MESSAGE, res.status);
    }
    return res;
}

type BackendJson = { status?: string; message?: string; detail?: unknown; [key: string]: unknown };

function errorKindFor(status: number): ApiErrorKind {
    if (status === 503) return 'unavailable';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    return 'server';
}

function retryAfterOf(res: Response, data: BackendJson | null): number | undefined {
    const fromBody = data && typeof data.retry_after === 'number' ? data.retry_after : NaN;
    if (Number.isFinite(fromBody)) return fromBody;
    const header = Number(res.headers.get('retry-after'));
    return Number.isFinite(header) && header > 0 ? header : undefined;
}

async function readJson(res: Response): Promise<BackendJson> {
    let data: BackendJson | null = null;
    try {
        data = (await res.json()) as BackendJson;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('aborted', 'Cancelled.');
        data = null;
    }
    if (!res.ok || !data || data.status === 'error') {
        const message =
            (data && typeof data.message === 'string' && data.message) ||
            (data && typeof data.detail === 'string' && data.detail) ||
            `The voice engine returned an error (${res.status}).`;
        const kind = res.ok ? 'server' : errorKindFor(res.status);
        throw new ApiError(kind, message, res.status, kind === 'rate_limited' ? retryAfterOf(res, data) : undefined);
    }
    return data;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readRender(data: BackendJson): RenderResult {
    const audioUrl = str(data.audio_url);
    if (data.status !== 'success' || !audioUrl) {
        throw new ApiError('server', 'The voice engine returned no audio.');
    }
    return {
        audioUrl,
        srtUrl: str(data.srt_url),
        vttUrl: str(data.vtt_url),
        durationMs: num(data.duration_ms),
        renderId: str(data.render_id),
    };
}

const KINDS: readonly RenderKind[] = ['single', 'dialogue', 'docx'];

function readLibraryItem(raw: unknown): LibraryItem | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id) return null;
    const kind = KINDS.includes(r.kind as RenderKind) ? (r.kind as RenderKind) : 'single';
    return {
        id,
        kind,
        title: typeof r.title === 'string' ? r.title : '',
        voice: str(r.voice),
        voices: Array.isArray(r.voices) ? r.voices.filter((v): v is string => typeof v === 'string') : [],
        language: str(r.language),
        chars: num(r.chars),
        durationMs: num(r.duration_ms),
        scenes: num(r.scenes),
        sizeBytes: num(r.size_bytes),
        createdAt: str(r.created_at) ?? new Date(0).toISOString(),
        audioUrl: str(r.audio_url),
        srtUrl: str(r.srt_url),
        vttUrl: str(r.vtt_url),
        zipUrl: str(r.zip_url),
    };
}

/** POST / — one voice, up to 50,000 characters. */
export async function generateSpeech(
    getToken: TokenGetter,
    req: SpeechRequest,
    opts: RequestOptions = {},
): Promise<SpeechResult> {
    const res = await send(
        '/',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
            signal: opts.signal,
        },
        getToken,
    );
    const data = await readJson(res);
    return {
        ...readRender(data),
        chunksProcessed: num(data.chunks_processed) ?? 0,
    };
}

/** POST /generate_multi — several voices stitched into one track. */
export async function generateDialogue(
    getToken: TokenGetter,
    segments: DialogueSegment[],
    opts: RequestOptions & { title?: string } = {},
): Promise<DialogueResult> {
    const res = await send(
        '/generate_multi',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts.title ? { segments, title: opts.title } : { segments }),
            signal: opts.signal,
        },
        getToken,
    );
    const data = await readJson(res);
    return {
        ...readRender(data),
        segmentsProcessed: num(data.segments_processed) ?? segments.length,
    };
}

export interface DocxOptions extends Partial<Prosody> {
    voice?: string;
}

function filenameFromDisposition(header: string | null): string | null {
    if (!header) return null;
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
    if (star) {
        try {
            return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
        } catch {
            /* fall through */
        }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    return plain ? plain[1].trim() : null;
}

/** POST /process_docx — multipart `file` (+ optional voice/rate/pitch/volume), returns the zip archive. */
export async function processDocx(
    getToken: TokenGetter,
    file: File,
    options: DocxOptions = {},
    opts: RequestOptions = {},
): Promise<DocxResult> {
    const body = new FormData();
    body.append('file', file);
    if (options.voice) body.append('voice', options.voice);
    if (options.rate) body.append('rate', options.rate);
    if (options.pitch) body.append('pitch', options.pitch);
    if (options.volume) body.append('volume', options.volume);
    const res = await send('/process_docx', { method: 'POST', body, signal: opts.signal }, getToken);

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || contentType.includes('application/json')) {
        // Errors come back as JSON {status:"error", message}.
        await readJson(res);
        throw new ApiError(errorKindFor(res.status), `The voice engine returned an error (${res.status}).`, res.status);
    }
    let blob: Blob;
    try {
        blob = await res.blob();
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('aborted', 'Cancelled.');
        throw new ApiError('network', NETWORK_MESSAGE);
    }
    return {
        blob,
        renderId: str(res.headers.get('x-render-id')?.trim()),
        filename: filenameFromDisposition(res.headers.get('content-disposition')),
    };
}

/** GET /library — newest first, cursor-paginated by `created_at`. */
export async function listLibrary(
    getToken: TokenGetter,
    query: LibraryQuery = {},
    opts: RequestOptions = {},
): Promise<LibraryPage> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 30));
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.q && query.q.trim()) params.set('q', query.q.trim());
    if (query.kind) params.set('kind', query.kind);
    const res = await send(`/library?${params.toString()}`, { method: 'GET', signal: opts.signal }, getToken);
    const data = await readJson(res);
    const items = Array.isArray(data.items) ? data.items.map(readLibraryItem).filter((i): i is LibraryItem => !!i) : [];
    return { items, nextCursor: str(data.next_cursor) };
}

/** PATCH /library/{id} — rename. */
export async function renameLibraryItem(
    getToken: TokenGetter,
    id: string,
    title: string,
    opts: RequestOptions = {},
): Promise<LibraryItem | null> {
    const res = await send(
        `/library/${encodeURIComponent(id)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
            signal: opts.signal,
        },
        getToken,
    );
    const data = await readJson(res);
    return readLibraryItem(data.item);
}

/** DELETE /library/{id} — removes the R2 objects, then the row. */
export async function deleteLibraryItem(getToken: TokenGetter, id: string, opts: RequestOptions = {}): Promise<void> {
    const res = await send(`/library/${encodeURIComponent(id)}`, { method: 'DELETE', signal: opts.signal }, getToken);
    await readJson(res);
}

/**
 * Same-origin, auth-protected download proxy for presigned R2 URLs (.mp3 / .srt / .vtt / .zip).
 * The extension of `filename` decides the Content-Type the proxy sends.
 */
export function downloadHref(url: string, filename: string): string {
    return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}

/** Triggers a browser download for a URL (same-origin proxy or blob: URL) without navigating away. */
export function triggerDownload(href: string, filename?: string) {
    const a = document.createElement('a');
    a.href = href;
    if (filename) a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/** Turns arbitrary text into a safe file stem: `voice_aria_1712345678`. */
export function fileStem(...parts: (string | number | undefined | null)[]): string {
    return (
        parts
            .filter((p) => p !== undefined && p !== null && p !== '')
            .map((p) =>
                String(p)
                    .normalize('NFKD')
                    .replace(/[̀-ͯ]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, ''),
            )
            .filter(Boolean)
            .join('_')
            .slice(0, 80) || 'magalar'
    );
}

/** React hook: backend helpers bound to the current Clerk session. */
export function useBackend() {
    const { getToken } = useAuth();
    return useMemo(() => {
        const tokenGetter: TokenGetter = () => getToken();
        return {
            generateSpeech: (req: SpeechRequest, opts?: RequestOptions) => generateSpeech(tokenGetter, req, opts),
            generateDialogue: (segments: DialogueSegment[], opts?: RequestOptions & { title?: string }) =>
                generateDialogue(tokenGetter, segments, opts),
            processDocx: (file: File, options?: DocxOptions, opts?: RequestOptions) =>
                processDocx(tokenGetter, file, options, opts),
            listLibrary: (query?: LibraryQuery, opts?: RequestOptions) => listLibrary(tokenGetter, query, opts),
            renameLibraryItem: (id: string, title: string, opts?: RequestOptions) =>
                renameLibraryItem(tokenGetter, id, title, opts),
            deleteLibraryItem: (id: string, opts?: RequestOptions) => deleteLibraryItem(tokenGetter, id, opts),
        };
    }, [getToken]);
}

export type Backend = ReturnType<typeof useBackend>;
