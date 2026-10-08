/**
 * Studio-wide limits. The voice catalog itself lives in `lib/voices.ts` (322 voices, 75 languages).
 */

/** Hard limit enforced by the backend for a single render (single voice or the sum of all dialogue blocks). */
export const MAX_CHARS = 50_000;

/** Max length of a render title (library + optional `title` on render requests). */
export const TITLE_MAX = 120;

/** Page size for `GET /library`. */
export const LIBRARY_PAGE_SIZE = 30;

/** Presigned R2 URLs live for 1 h; treat anything older than this as stale and refetch. */
export const PRESIGNED_STALE_MS = 50 * 60 * 1000;
