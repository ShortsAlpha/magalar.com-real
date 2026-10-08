'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';

/**
 * Client for the Magalar voice engine (FastAPI on Modal, see backend/main.py).
 *
 * Every request carries `Authorization: Bearer <Clerk session token>`; the backend verifies it.
 */

/** Base URL of the voice engine, without a trailing slash. */
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').replace(/\/+$/, '');

export const SESSION_EXPIRED_MESSAGE = 'Your session expired — please sign in again.';
const NETWORK_MESSAGE = "Couldn't reach the voice engine. Check your connection and try again.";
const CONFIG_MESSAGE = 'The voice engine is not configured (NEXT_PUBLIC_BACKEND_URL is missing).';

export type ApiErrorKind = 'auth' | 'network' | 'server' | 'config' | 'aborted';

export class ApiError extends Error {
    readonly kind: ApiErrorKind;
    readonly status?: number;

    constructor(kind: ApiErrorKind, message: string, status?: number) {
        super(message);
        this.name = 'ApiError';
        this.kind = kind;
        this.status = status;
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
}

export type DialogueSegment = SpeechRequest;

export interface SpeechResult {
    audioUrl: string;
    chunksProcessed: number;
}

export interface DialogueResult {
    audioUrl: string;
    segmentsProcessed: number;
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

async function readJson(res: Response): Promise<BackendJson> {
    let data: BackendJson | null = null;
    try {
        data = (await res.json()) as BackendJson;
    } catch {
        data = null;
    }
    if (!res.ok || !data || data.status === 'error') {
        const message =
            (data && typeof data.message === 'string' && data.message) ||
            (data && typeof data.detail === 'string' && data.detail) ||
            `The voice engine returned an error (${res.status}).`;
        throw new ApiError('server', message, res.status);
    }
    return data;
}

function requireAudioUrl(data: BackendJson): string {
    if (data.status !== 'success' || typeof data.audio_url !== 'string' || !data.audio_url) {
        throw new ApiError('server', 'The voice engine returned no audio.');
    }
    return data.audio_url;
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
        audioUrl: requireAudioUrl(data),
        chunksProcessed: typeof data.chunks_processed === 'number' ? data.chunks_processed : 0,
    };
}

/** POST /generate_multi — several voices stitched into one track. */
export async function generateDialogue(
    getToken: TokenGetter,
    segments: DialogueSegment[],
    opts: RequestOptions = {},
): Promise<DialogueResult> {
    const res = await send(
        '/generate_multi',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments }),
            signal: opts.signal,
        },
        getToken,
    );
    const data = await readJson(res);
    return {
        audioUrl: requireAudioUrl(data),
        segmentsProcessed: typeof data.segments_processed === 'number' ? data.segments_processed : segments.length,
    };
}

/** POST /process_docx — multipart `file`, returns the zip archive. */
export async function processDocx(getToken: TokenGetter, file: File, opts: RequestOptions = {}): Promise<Blob> {
    const body = new FormData();
    body.append('file', file);
    const res = await send('/process_docx', { method: 'POST', body, signal: opts.signal }, getToken);

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || contentType.includes('application/json')) {
        // Errors come back as JSON {status:"error", message}.
        await readJson(res);
        throw new ApiError('server', `The voice engine returned an error (${res.status}).`, res.status);
    }
    try {
        return await res.blob();
    } catch {
        throw new ApiError('network', NETWORK_MESSAGE);
    }
}

/** Same-origin, auth-protected download proxy for presigned R2 audio URLs. */
export function downloadHref(audioUrl: string, filename: string): string {
    return `/api/download?url=${encodeURIComponent(audioUrl)}&filename=${encodeURIComponent(filename)}`;
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
export function fileStem(...parts: (string | number | undefined)[]): string {
    return parts
        .filter((p) => p !== undefined && p !== '')
        .map((p) =>
            String(p)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, ''),
        )
        .filter(Boolean)
        .join('_')
        .slice(0, 80) || 'magalar';
}

/** React hook: backend helpers bound to the current Clerk session. */
export function useBackend() {
    const { getToken } = useAuth();
    return useMemo(() => {
        const tokenGetter: TokenGetter = () => getToken();
        return {
            generateSpeech: (req: SpeechRequest, opts?: RequestOptions) => generateSpeech(tokenGetter, req, opts),
            generateDialogue: (segments: DialogueSegment[], opts?: RequestOptions) =>
                generateDialogue(tokenGetter, segments, opts),
            processDocx: (file: File, opts?: RequestOptions) => processDocx(tokenGetter, file, opts),
        };
    }, [getToken]);
}
