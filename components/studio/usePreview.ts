'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

function halt(ref: RefObject<HTMLAudioElement | null>) {
    const audio = ref.current;
    if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
    }
    ref.current = null;
}

export type PreviewState = { id: string; status: 'loading' | 'playing' } | null;

/**
 * One shared, fire-and-forget preview player (voice samples, block previews).
 * Starting a new preview cancels the previous one; stale responses are ignored.
 */
export function usePreview() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ticket = useRef(0);
    const [state, setState] = useState<PreviewState>(null);

    const stop = useCallback(() => {
        ticket.current += 1;
        halt(audioRef);
        setState(null);
    }, []);

    /** Resolves when playback starts; rejects with the loader's error. */
    const play = useCallback(async (id: string, load: () => Promise<string>) => {
        halt(audioRef);
        const mine = ++ticket.current;
        setState({ id, status: 'loading' });
        try {
            const url = await load();
            if (mine !== ticket.current) return;
            const audio = new Audio(url);
            audioRef.current = audio;
            const finish = () => {
                if (mine !== ticket.current) return;
                audioRef.current = null;
                setState(null);
            };
            audio.onended = finish;
            audio.onerror = finish;
            await audio.play();
            if (mine === ticket.current) setState({ id, status: 'playing' });
        } catch (err) {
            if (mine === ticket.current) {
                halt(audioRef);
                setState(null);
                throw err;
            }
        }
    }, []);

    useEffect(() => () => halt(audioRef), []);

    return { state, play, stop };
}

const PREVIEW_TTL_MS = 40 * 60 * 1000;
const previewCache = new Map<string, { url: string; at: number }>();

/**
 * Re-uses a preview render for the same voice + text + prosody while its presigned URL is still fresh,
 * so repeated sample clicks don't re-render (or add duplicate rows to the Library).
 */
export async function cachedPreview(key: string, load: () => Promise<string>): Promise<string> {
    const hit = previewCache.get(key);
    if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return hit.url;
    const url = await load();
    previewCache.set(key, { url, at: Date.now() });
    if (previewCache.size > 64) {
        const oldest = previewCache.keys().next().value;
        if (oldest !== undefined) previewCache.delete(oldest);
    }
    return url;
}
