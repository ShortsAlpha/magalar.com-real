/**
 * Script-agnostic text + time helpers for the studio.
 */

/**
 * Characters as the backend counts them (Unicode code points, like Python's `len`), so emoji and
 * astral CJK count once. Linear, allocation-free; fine on every keystroke at 50k.
 */
export function countChars(text: string): number {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        // Skip the low half of a surrogate pair.
        if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
            const prev = text.charCodeAt(i - 1);
            if (prev >= 0xd800 && prev <= 0xdbff) continue;
        }
        n++;
    }
    return n;
}

/** Ideographic / syllabic scripts are read much slower per character than alphabetic ones. */
const DENSE_SCRIPT = /[ᄀ-ᇿ぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g;

/** Rough spoken duration in seconds at `speed` (1 = normal). */
export function estimateSeconds(text: string, speed = 1): number {
    const total = countChars(text);
    const dense = text.match(DENSE_SCRIPT)?.length ?? 0;
    const sparse = Math.max(0, total - dense);
    return (sparse / 15 + dense / 5.5) / Math.max(0.25, speed);
}

/** 83 → "1:23", 3723 → "1:02:03". */
export function formatClock(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
    const s = Math.round(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const formatMs = (ms: number | null | undefined) => (typeof ms === 'number' ? formatClock(ms / 1000) : '—');

export function formatBytes(bytes: number | null | undefined): string {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** "just now", "5 min. ago", "yesterday", "Mar 4, 2026". */
export function relativeTime(iso: string, now: number): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    if (!now) return dateFmt.format(t);
    const diff = (t - now) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
    return dateFmt.format(t);
}

export const fullDate = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : '';
};

/** Trims at a word boundary to ≤ max chars ("…" appended when cut). */
export function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max - 1);
    const at = cut.lastIndexOf(' ');
    return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trim()}…`;
}
