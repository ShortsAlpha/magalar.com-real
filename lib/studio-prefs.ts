'use client';

import { useSyncExternalStore } from 'react';

/**
 * Per-browser studio preferences (last language / voice). Every storage access is wrapped:
 * private windows, blocked site data and quota errors simply mean "no preference".
 */

export interface StudioPrefs {
    /** Language code last browsed/picked, or "all". */
    language?: string;
    /** Last picked voice id. */
    voiceId?: string;
}

const KEY = 'magalar.studio.prefs.v1';
const EVENT = 'magalar:studio-prefs';
const EMPTY: StudioPrefs = Object.freeze({});

let cacheRaw: string | null | undefined;
let cacheValue: StudioPrefs = EMPTY;

function readRaw(): string | null {
    try {
        return window.localStorage.getItem(KEY);
    } catch {
        return null;
    }
}

function parse(raw: string | null): StudioPrefs {
    if (!raw) return EMPTY;
    try {
        const data = JSON.parse(raw) as unknown;
        if (!data || typeof data !== 'object') return EMPTY;
        const d = data as Record<string, unknown>;
        return {
            language: typeof d.language === 'string' ? d.language : undefined,
            voiceId: typeof d.voiceId === 'string' ? d.voiceId : undefined,
        };
    } catch {
        return EMPTY;
    }
}

export function readPrefs(): StudioPrefs {
    if (typeof window === 'undefined') return EMPTY;
    const raw = readRaw();
    if (raw !== cacheRaw) {
        cacheRaw = raw;
        cacheValue = parse(raw);
    }
    return cacheValue;
}

export function writePrefs(patch: StudioPrefs) {
    if (typeof window === 'undefined') return;
    try {
        const next = { ...readPrefs(), ...patch };
        window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable — preferences are a convenience only */
    }
    try {
        window.dispatchEvent(new Event(EVENT));
    } catch {
        /* ignore */
    }
}

function subscribe(onChange: () => void) {
    const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === KEY) onChange();
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener('storage', onStorage);
    };
}

const serverSnapshot = () => EMPTY;

/** Hydration-safe: returns `{}` on the server and on the first client render pass. */
export function useStudioPrefs(): StudioPrefs {
    return useSyncExternalStore(subscribe, readPrefs, serverSnapshot);
}
