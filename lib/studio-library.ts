'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tiny invalidation bus for the Library mode. Every successful render that produced a `renderId`
 * bumps the version; the Library refetches the next time it is shown.
 */

let version = 0;
const listeners = new Set<() => void>();

export function invalidateLibrary() {
    version += 1;
    listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const getVersion = () => version;

export function useLibraryVersion(): number {
    return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export const LIBRARY_HREF = '/studio?mode=library';
