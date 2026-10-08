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
