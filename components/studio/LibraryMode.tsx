'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
    Archive,
    ArrowDownToLine,
    AudioLines,
    FileArchive,
    FileText,
    MessagesSquare,
    Pencil,
    Play,
    RotateCw,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { LIBRARY_PAGE_SIZE, PRESIGNED_STALE_MS, TITLE_MAX } from '@/lib/constants';
import { getVoiceById, languageName, localeLabel } from '@/lib/voices';
import {
    downloadHref,
    fileStem,
    toApiError,
    triggerDownload,
    useBackend,
    type ApiError,
    type LibraryItem,
    type RenderKind,
} from '@/lib/api';
import { formatBytes, formatMs, fullDate, relativeTime } from '@/lib/studio-format';
import { useLibraryVersion } from '@/lib/studio-library';
import AudioPlayer from './AudioPlayer';
import { ApiErrorNotice, buttonClass, cx, EqBars, focusRing, formatCount, MonoLabel, Notice, PageHeader, Spinner } from './ui';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type KindFilter = 'all' | RenderKind;
type FileKind = 'mp3' | 'srt' | 'vtt' | 'zip';

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'single', label: 'Single' },
    { value: 'dialogue', label: 'Dialogue' },
    { value: 'docx', label: 'DOCX' },
];

const KIND_LABEL: Record<RenderKind, string> = { single: 'Single', dialogue: 'Dialogue', docx: 'DOCX' };

const urlFor = (item: LibraryItem, kind: FileKind) =>
    ({ mp3: item.audioUrl, srt: item.srtUrl, vtt: item.vttUrl, zip: item.zipUrl })[kind];

function voiceSummary(item: LibraryItem): { voice: string | null; language: string | null } {
    const ids = item.voices.length ? item.voices : item.voice ? [item.voice] : [];
    const first = ids[0] ? getVoiceById(ids[0]) : undefined;
    const others = new Set(ids).size - 1;
    const voice = first ? `${first.name}${others > 0 ? ` +${others}` : ''}` : (ids[0] ?? null);
    const language = first ? localeLabel(first.locale) : item.language ? languageName(item.language) : null;
    return { voice, language };
}

/** Minute-resolution clock shared by every relative date (hydration-safe: 0 on the server). */
let nowValue = 0;
let nowTimer: ReturnType<typeof setInterval> | undefined;
const nowListeners = new Set<() => void>();
function subscribeNow(listener: () => void) {
    nowListeners.add(listener);
    if (!nowTimer) {
        nowValue = Date.now();
        nowTimer = setInterval(() => {
            nowValue = Date.now();
            nowListeners.forEach((l) => l());
        }, 30_000);
    }
    return () => {
        nowListeners.delete(listener);
        if (!nowListeners.size && nowTimer) {
            clearInterval(nowTimer);
            nowTimer = undefined;
        }
    };
}
const useNow = () =>
    useSyncExternalStore(
        subscribeNow,
        () => nowValue,
        () => 0,
    );

interface LoadedPage {
    key: string;
    kind: KindFilter;
    q: string;
    items: LibraryItem[];
    nextCursor: string | null;
    fetchedAt: number;
}

interface Playing {
    id: string;
    audioUrl: string;
    srtUrl: string | null;
    vttUrl: string | null;
    durationMs: number | null;
    filename: string;
}

/* ------------------------------------------------------------------ */
/* Library mode                                                        */
/* ------------------------------------------------------------------ */

export default function LibraryMode({ active }: { active: boolean }) {
    const api = useBackend();
    const version = useLibraryVersion();
    const now = useNow();

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [kind, setKind] = useState<KindFilter>('all');
    const [reloadNonce, setReloadNonce] = useState(0);

    const [data, setData] = useState<LoadedPage | null>(null);
    const [failure, setFailure] = useState<{ key: string; error: ApiError } | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState<ApiError | null>(null);
    const [notice, setNotice] = useState<ApiError | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [playing, setPlaying] = useState<Playing | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const dataRef = useRef<LoadedPage | null>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<() => void>(() => {});
    const refreshing = useRef<Promise<LibraryItem[] | null> | null>(null);

    const queryKey = `${kind}|${debouncedQuery}|${version}|${reloadNonce}`;

    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    // Debounce the title search.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
        return () => clearTimeout(t);
    }, [query]);

    // First page — whenever the library is shown and the filters / invalidation version changed.
    useEffect(() => {
        if (!active) return;
        if (dataRef.current?.key === queryKey) return;
        const controller = new AbortController();
        api.listLibrary(
            { limit: LIBRARY_PAGE_SIZE, q: debouncedQuery, kind: kind === 'all' ? null : kind },
            { signal: controller.signal },
        ).then(
            (page) => {
                setData({
                    key: queryKey,
                    kind,
                    q: debouncedQuery,
                    items: page.items,
                    nextCursor: page.nextCursor,
                    fetchedAt: Date.now(),
                });
                setFailure(null);
                setMoreError(null);
            },
            (err) => {
                const e = toApiError(err);
                if (e.kind !== 'aborted') setFailure({ key: queryKey, error: e });
            },
        );
        return () => controller.abort();
    }, [active, queryKey, api, debouncedQuery, kind]);

    /** Re-fetches every loaded page so presigned URLs are fresh again (they expire after 1 h). */
    const refreshAll = useCallback((): Promise<LibraryItem[] | null> => {
        if (refreshing.current) return refreshing.current;
        const current = dataRef.current;
        if (!current) return Promise.resolve(null);
        const want = Math.max(current.items.length, LIBRARY_PAGE_SIZE);
        const { kind: k, q } = current;
        const run = (async () => {
            try {
                const items: LibraryItem[] = [];
                let cursor: string | null = null;
                let pages = 0;
                do {
                    const page = await api.listLibrary({
                        limit: LIBRARY_PAGE_SIZE,
                        cursor,
                        q,
                        kind: k === 'all' ? null : k,
                    });
                    items.push(...page.items);
                    cursor = page.nextCursor;
                    pages += 1;
                } while (cursor && items.length < want && pages < 20);
                setData((prev) =>
                    prev && prev.key === current.key ? { ...prev, items, nextCursor: cursor, fetchedAt: Date.now() } : prev,
                );
                return items;
            } catch (err) {
                const e = toApiError(err);
                if (e.kind !== 'aborted') setNotice(e);
                return null;
            } finally {
                refreshing.current = null;
            }
        })();
        refreshing.current = run;
        return run;
    }, [api]);

    // Quietly refresh stale links while the library is open (and when the tab comes back).
    useEffect(() => {
        if (!active) return;
        const check = () => {
            const d = dataRef.current;
            if (d && document.visibilityState === 'visible' && Date.now() - d.fetchedAt > PRESIGNED_STALE_MS) {
                void refreshAll();
            }
        };
        check();
        const timer = setInterval(check, 60_000);
        document.addEventListener('visibilitychange', check);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', check);
        };
    }, [active, refreshAll]);

    /** The item with links that are guaranteed fresh (refetching first when they're old). */
    const ensureFresh = async (item: LibraryItem): Promise<LibraryItem | null> => {
        const d = dataRef.current;
        if (d && Date.now() - d.fetchedAt <= PRESIGNED_STALE_MS) return item;
        const items = await refreshAll();
        // If the refresh itself failed, fall back to the links we have (they may still work).
        return items ? (items.find((i) => i.id === item.id) ?? null) : item;
    };

    const loadMore = async () => {
        const d = dataRef.current;
        if (!d || !d.nextCursor || loadingMore) return;
        setLoadingMore(true);
        setMoreError(null);
        const { kind: k, q } = d;
        try {
            const page = await api.listLibrary({
                limit: LIBRARY_PAGE_SIZE,
                cursor: d.nextCursor,
                q,
                kind: k === 'all' ? null : k,
            });
            setData((prev) => {
                if (!prev || prev.key !== d.key) return prev;
                const seen = new Set(prev.items.map((i) => i.id));
                return { ...prev, items: [...prev.items, ...page.items.filter((i) => !seen.has(i.id))], nextCursor: page.nextCursor };
            });
        } catch (err) {
            const e = toApiError(err);
            if (e.kind !== 'aborted') setMoreError(e);
        } finally {
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        loadMoreRef.current = () => void loadMore();
    });

    // Infinite scroll: load the next page when the sentinel approaches the viewport.
    const hasMore = !!data?.nextCursor;
    useEffect(() => {
        const el = sentinelRef.current;
        if (!active || !hasMore || !el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMoreRef.current(), {
            rootMargin: '400px 0px',
        });
        io.observe(el);
        return () => io.disconnect();
    }, [active, hasMore, moreError, data?.key]);

    /* ----------------------------- actions ---------------------------- */

    const setRowError = (id: string, message: string | null) =>
        setRowErrors((prev) => {
            const next = { ...prev };
            if (message) next[id] = message;
            else delete next[id];
            return next;
        });

    const patchItem = (id: string, patch: Partial<LibraryItem>) =>
        setData((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : prev));

    const removeLocal = (id: string) =>
        setData((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));

    const filenameFor = (item: LibraryItem, ext: FileKind) =>
        `${fileStem('magalar', item.title || KIND_LABEL[item.kind], item.id.slice(0, 8))}.${ext}`;

    const play = async (item: LibraryItem) => {
        if (playing?.id === item.id) {
            setPlaying(null);
            return;
        }
        setRowError(item.id, null);
        setBusyId(item.id);
        try {
            const fresh = await ensureFresh(item);
            if (!fresh?.audioUrl) {
                setRowError(item.id, fresh ? 'No audio stored for this render.' : 'This render is no longer available.');
                return;
            }
            setPlaying({
                id: fresh.id,
                audioUrl: fresh.audioUrl,
                srtUrl: fresh.srtUrl,
                vttUrl: fresh.vttUrl,
                durationMs: fresh.durationMs,
                filename: filenameFor(fresh, 'mp3'),
            });
        } finally {
            setBusyId(null);
        }
    };

    const download = async (item: LibraryItem, ext: FileKind) => {
        setRowError(item.id, null);
        const fresh = await ensureFresh(item);
        const url = fresh ? urlFor(fresh, ext) : null;
        if (!fresh || !url) {
            setRowError(item.id, `The ${ext.toUpperCase()} file isn't available any more.`);
            return;
        }
        const name = filenameFor(fresh, ext);
        triggerDownload(downloadHref(url, name), name);
    };

    const rename = async (item: LibraryItem, raw: string) => {
        const title = raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
        if (!title || title === item.title) return;
        setRowError(item.id, null);
        patchItem(item.id, { title });
        try {
            const updated = await api.renameLibraryItem(item.id, title);
            if (updated) patchItem(item.id, { title: updated.title });
        } catch (err) {
            const e = toApiError(err);
            if (e.kind === 'not_found') {
                removeLocal(item.id);
                setNotice(e);
                return;
            }
            // Roll back only if nobody renamed it again meanwhile.
            setData((prev) =>
                prev
                    ? {
                          ...prev,
                          items: prev.items.map((i) => (i.id === item.id && i.title === title ? { ...i, title: item.title } : i)),
                      }
                    : prev,
            );
            if (e.kind === 'auth' || e.kind === 'unavailable') setNotice(e);
            else setRowError(item.id, `Couldn't rename: ${e.message}`);
        }
    };

    const remove = async (item: LibraryItem) => {
        const before = dataRef.current?.items ?? [];
        const index = before.findIndex((i) => i.id === item.id);
        if (playing?.id === item.id) setPlaying(null);
        setRowError(item.id, null);
        removeLocal(item.id);
        try {
            await api.deleteLibraryItem(item.id);
        } catch (err) {
            const e = toApiError(err);
            if (e.kind === 'not_found') return; // already gone
            setData((prev) => {
                if (!prev || prev.items.some((i) => i.id === item.id)) return prev;
                const items = [...prev.items];
                items.splice(Math.min(Math.max(0, index), items.length), 0, item);
                return { ...prev, items };
            });
            setNotice(e);
        }
    };

    /* ------------------------------ state ------------------------------ */

    const currentFailure = failure && failure.key === queryKey ? failure.error : null;
    const loadingFirst = !currentFailure && (!data || data.key !== queryKey);
    const items = data?.items ?? [];
    const filtersActive = debouncedQuery !== '' || kind !== 'all';

    if (currentFailure?.kind === 'unavailable' || notice?.kind === 'unavailable') {
        return (
            <div className="mx-auto w-full max-w-5xl space-y-8">
                <LibraryHeader />
                <CalmState
                    icon={<Archive className="h-5 w-5" aria-hidden />}
                    title="Library unavailable."
                    body="Your renders still work — they just aren't being saved right now. Download audio and subtitles straight from the result screen."
                    action={
                        <button
                            type="button"
                            onClick={() => {
                                setNotice(null);
                                setFailure(null);
                                setReloadNonce((n) => n + 1);
                            }}
                            className={buttonClass('ghost', 'sm')}
                        >
                            <RotateCw className="h-3.5 w-3.5" aria-hidden />
                            Try again
                        </button>
                    }
                />
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8">
            <LibraryHeader
                actions={
                    <button
                        type="button"
                        onClick={() => {
                            setNotice(null);
                            setFailure(null);
                            setReloadNonce((n) => n + 1);
                        }}
                        disabled={loadingFirst}
                        className={buttonClass('ghost', 'md')}
                        aria-label="Refresh library"
                    >
                        <RotateCw className={cx('h-4 w-4', loadingFirst && data && 'animate-spin')} aria-hidden />
                        Refresh
                    </button>
                }
            />

            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape' && query) {
                                e.preventDefault();
                                setQuery('');
                            }
                        }}
                        dir="auto"
                        placeholder="Search titles…"
                        aria-label="Search renders by title"
                        className="h-10 w-full rounded-lg border border-white/10 bg-transparent pl-9 pr-9 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 hover:border-white/20 focus:border-white/30 [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            aria-label="Clear search"
                            className={cx(
                                'absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-500 hover:text-white',
                                focusRing,
                            )}
                        >
                            <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                    )}
                </div>
                <div role="radiogroup" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
                    {KIND_FILTERS.map((f) => {
                        const on = f.value === kind;
                        return (
                            <button
                                key={f.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setKind(f.value)}
                                className={cx(
                                    'h-8 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors',
                                    focusRing,
                                    on
                                        ? 'border-white bg-white text-black'
                                        : 'border-white/10 text-neutral-400 hover:border-white/25 hover:text-white',
                                )}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {notice && (
                <div className="space-y-2">
                    <ApiErrorNotice error={notice} />
                    {notice.kind !== 'auth' && (
                        <button type="button" onClick={() => setNotice(null)} className={buttonClass('ghost', 'sm')}>
                            Dismiss
                        </button>
                    )}
                </div>
            )}

            {currentFailure ? (
                currentFailure.kind === 'auth' ? (
                    <ApiErrorNotice error={currentFailure} />
                ) : (
                    <Notice
                        action={
                            <button
                                type="button"
                                onClick={() => {
                                    setFailure(null);
                                    setReloadNonce((n) => n + 1);
                                }}
                                className={cx('shrink-0 text-sm font-medium text-white underline underline-offset-4', focusRing)}
                            >
                                Retry
                            </button>
                        }
                    >
                        Couldn&apos;t load your library. {currentFailure.message}
                    </Notice>
                )
            ) : loadingFirst && items.length === 0 ? (
                <SkeletonList />
            ) : items.length === 0 && !loadingFirst ? (
                filtersActive ? (
                    <CalmState
                        icon={<Search className="h-5 w-5" aria-hidden />}
                        title="Nothing matches."
                        body={
                            debouncedQuery
                                ? `No ${kind === 'all' ? '' : `${KIND_LABEL[kind]} `}renders with “${debouncedQuery}” in the title.`
                                : `No ${KIND_LABEL[kind as RenderKind]} renders yet.`
                        }
                        action={
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    setKind('all');
                                }}
                                className={buttonClass('ghost', 'sm')}
                            >
                                Clear filters
                            </button>
                        }
                    />
                ) : (
                    <EmptyLibrary />
                )
            ) : (
                <section aria-label="Renders" aria-busy={loadingFirst} className={cx('transition-opacity', loadingFirst && 'opacity-50')}>
                    <div className="mb-3 flex items-center justify-between">
                        <MonoLabel className="text-neutral-300">
                            {String(items.length).padStart(2, '0')}
                            {hasMore ? '+' : ''} {items.length === 1 ? 'render' : 'renders'}
                        </MonoLabel>
                        {loadingFirst && <Spinner className="h-3 w-3 text-neutral-500" />}
                    </div>
                    <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-neutral-950">
                        {items.map((item) => (
                            <LibraryRow
                                key={item.id}
                                item={item}
                                now={now}
                                isPlaying={playing?.id === item.id}
                                busy={busyId === item.id}
                                error={rowErrors[item.id] ?? null}
                                onPlay={() => void play(item)}
                                onDownload={(ext) => void download(item, ext)}
                                onRename={(title) => void rename(item, title)}
                                onDelete={() => void remove(item)}
                                player={
                                    playing?.id === item.id ? (
                                        <AudioPlayer
                                            key={playing.audioUrl}
                                            src={playing.audioUrl}
                                            srtUrl={playing.srtUrl}
                                            vttUrl={playing.vttUrl}
                                            durationMs={playing.durationMs}
                                            filename={playing.filename}
                                            showDownloads={false}
                                            autoPlay
                                        />
                                    ) : null
                                }
                            />
                        ))}
                    </ul>

                    <div ref={sentinelRef} aria-hidden className="h-px" />
                    {(hasMore || moreError) && (
                        <div className="flex flex-col items-center gap-3 pt-6">
                            {moreError && <p className="text-sm text-red-300">{moreError.message}</p>}
                            <button
                                type="button"
                                onClick={() => void loadMore()}
                                disabled={loadingMore}
                                className={buttonClass('secondary', 'md')}
                            >
                                {loadingMore ? (
                                    <>
                                        <Spinner /> Loading
                                    </>
                                ) : moreError ? (
                                    'Try again'
                                ) : (
                                    'Load more'
                                )}
                            </button>
                        </div>
                    )}
                    {!hasMore && items.length > 8 && (
                        <p className="pt-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
                            End of library
                        </p>
                    )}
                </section>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function LibraryHeader({ actions }: { actions?: ReactNode }) {
    return (
        <PageHeader
            eyebrow="Library"
            title="Every"
            accent="render."
            description="Your voiceovers, dialogues and DOCX bundles — with subtitles — saved automatically. Links refresh themselves."
            actions={actions}
        />
    );
}

function CalmState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex animate-fade-in flex-col items-center rounded-xl border border-white/10 px-6 py-16 text-center sm:py-20">
            <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 text-neutral-400">
                {icon}
            </span>
            <p className="font-serif text-[28px] italic leading-none tracking-[-0.01em] text-white">{title}</p>
            <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-neutral-500">{body}</p>
            {action && <div className="mt-6">{action}</div>}
        </div>
    );
}

function EmptyLibrary() {
    const starts = [
        { href: '/studio', label: 'Single voice', icon: AudioLines },
        { href: '/studio?mode=dialogue', label: 'Dialogue', icon: MessagesSquare },
        { href: '/studio?mode=docx', label: 'DOCX', icon: FileText },
    ];
    return (
        <CalmState
            icon={<Archive className="h-5 w-5" aria-hidden />}
            title="Nothing here yet."
            body="Every render you make — single voice, dialogue or DOCX batch — lands here with its MP3 and subtitles, ready to replay or download."
            action={
                <div className="flex flex-wrap justify-center gap-2">
                    {starts.map(({ href, label, icon: Icon }) => (
                        <Link key={href} href={href} className={buttonClass('secondary', 'sm')}>
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                            {label}
                        </Link>
                    ))}
                </div>
            }
        />
    );
}

function SkeletonList() {
    return (
        <ul aria-busy="true" aria-label="Loading library" className="divide-y divide-white/10 rounded-xl border border-white/10 bg-neutral-950">
            {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-4">
                    <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="min-w-0 flex-1 space-y-2.5">
                        <span className="block h-3 animate-pulse rounded bg-white/[0.08]" style={{ width: `${55 - i * 6}%` }} />
                        <span className="block h-2 w-2/5 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                    <span className="hidden h-3 w-10 animate-pulse rounded bg-white/[0.06] sm:block" />
                </li>
            ))}
        </ul>
    );
}

function LibraryRow({
    item,
    now,
    isPlaying,
    busy,
    error,
    onPlay,
    onDownload,
    onRename,
    onDelete,
    player,
}: {
    item: LibraryItem;
    now: number;
    isPlaying: boolean;
    busy: boolean;
    error: string | null;
    onPlay: () => void;
    onDownload: (ext: FileKind) => void;
    onRename: (title: string) => void;
    onDelete: () => void;
    player: ReactNode;
}) {
    const [editing, setEditing] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const { voice, language } = voiceSummary(item);
    const title = item.title || 'Untitled render';
    const playable = !!item.audioUrl;
    const files: FileKind[] = (['mp3', 'srt', 'vtt', 'zip'] as const).filter((k) => !!urlFor(item, k));
    const meta = [KIND_LABEL[item.kind], voice, language].filter(Boolean).join(' · ');
    const length =
        item.durationMs !== null
            ? formatMs(item.durationMs)
            : item.scenes !== null
              ? `${item.scenes} ${item.scenes === 1 ? 'scene' : 'scenes'}`
              : '—';

    return (
        <li className={cx('transition-colors', isPlaying && 'bg-white/[0.02]')}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3 py-3.5 sm:px-4">
                {playable ? (
                    <button
                        type="button"
                        onClick={onPlay}
                        disabled={busy}
                        aria-label={isPlaying ? `Close player for ${title}` : `Play ${title}`}
                        aria-expanded={isPlaying}
                        className={cx(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors',
                            focusRing,
                            isPlaying
                                ? 'border-white bg-white text-black'
                                : 'border-white/15 text-neutral-300 hover:border-white hover:bg-white hover:text-black',
                        )}
                    >
                        {busy ? (
                            <Spinner className="h-3 w-3" />
                        ) : isPlaying ? (
                            <EqBars />
                        ) : (
                            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden />
                        )}
                    </button>
                ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-neutral-500">
                        <FileArchive className="h-4 w-4" aria-hidden />
                    </span>
                )}

                <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-0">
                    {editing ? (
                        <TitleEditor
                            initial={item.title}
                            onDone={(next) => {
                                setEditing(false);
                                if (next !== null) onRename(next);
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => setEditing(true)}
                            title="Rename"
                            className={cx(
                                'group/title flex max-w-full items-center gap-2 rounded text-left text-[15px] font-medium tracking-[-0.01em] text-white',
                                focusRing,
                            )}
                        >
                            <span dir="auto" className="truncate">
                                {title}
                            </span>
                            <Pencil
                                className="h-3 w-3 shrink-0 text-neutral-600 opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
                                aria-hidden
                            />
                            <span className="sr-only">(rename)</span>
                        </button>
                    )}
                    <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                        <span className="truncate">{meta}</span>
                        {item.chars !== null && (
                            <>
                                <span aria-hidden className="text-neutral-700">
                                    ·
                                </span>
                                <span className="tabular-nums">{formatCount(item.chars)} chars</span>
                            </>
                        )}
                        <span aria-hidden className="text-neutral-700">
                            ·
                        </span>
                        <time dateTime={item.createdAt} title={fullDate(item.createdAt)} className="normal-case tracking-normal">
                            {relativeTime(item.createdAt, now)}
                        </time>
                    </p>
                </div>

                <span
                    className="hidden w-16 shrink-0 text-right font-mono text-xs tabular-nums text-white sm:block"
                    title={item.sizeBytes !== null ? formatBytes(item.sizeBytes) : undefined}
                >
                    {length}
                </span>

                <div className="ml-14 flex shrink-0 items-center gap-0.5 sm:ml-0">
                    <span className="mr-1 font-mono text-xs tabular-nums text-neutral-400 sm:hidden">{length}</span>
                    {files.length > 0 && (
                        <span className="mr-0.5 flex items-center gap-0.5" role="group" aria-label="Downloads">
                            <ArrowDownToLine className="mr-1 h-3.5 w-3.5 text-neutral-600" aria-hidden />
                            {files.map((ext) => (
                                <button
                                    key={ext}
                                    type="button"
                                    onClick={() => onDownload(ext)}
                                    aria-label={`Download ${ext.toUpperCase()}`}
                                    className={cx(
                                        'h-8 rounded-md px-2 font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-white',
                                        focusRing,
                                    )}
                                >
                                    {ext}
                                </button>
                            ))}
                        </span>
                    )}
                    <RowIcon label={`Rename ${title}`} onClick={() => setEditing(true)}>
                        <Pencil className="h-3.5 w-3.5" />
                    </RowIcon>
                    <RowIcon label={`Delete ${title}`} onClick={() => setConfirming(true)} danger>
                        <Trash2 className="h-3.5 w-3.5" />
                    </RowIcon>
                </div>
            </div>

            {confirming && (
                <div
                    role="alertdialog"
                    aria-label="Confirm delete"
                    className="flex animate-fade-in flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3"
                    onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && setConfirming(false)}
                >
                    <p className="text-sm text-neutral-300">
                        Delete <span className="text-white">“{title}”</span> and its files? This can&apos;t be undone.
                    </p>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            autoFocus
                            onClick={() => setConfirming(false)}
                            className={buttonClass('ghost', 'sm')}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setConfirming(false);
                                onDelete();
                            }}
                            className={buttonClass(
                                'secondary',
                                'sm',
                                'border-red-500/30 text-red-300 hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-200',
                            )}
                        >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Delete
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p role="alert" className="border-t border-red-500/20 px-4 py-2 text-[13px] text-red-300">
                    {error}
                </p>
            )}

            {player && <div className="animate-fade-up px-3 pb-4 sm:px-4">{player}</div>}
        </li>
    );
}

function RowIcon({
    label,
    onClick,
    danger,
    children,
}: {
    label: string;
    onClick: () => void;
    danger?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={cx(
                'flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors',
                focusRing,
                danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-white/[0.06] hover:text-white',
            )}
        >
            {children}
        </button>
    );
}

/** Inline title editor: ↵ / blur saves, Esc cancels. */
function TitleEditor({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
    const [draft, setDraft] = useState(initial);
    const done = useRef(false);
    const finish = (value: string | null) => {
        if (done.current) return;
        done.current = true;
        onDone(value);
    };
    return (
        <input
            type="text"
            value={draft}
            autoFocus
            dir="auto"
            maxLength={TITLE_MAX}
            aria-label="Render title"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(draft);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(null);
                }
            }}
            onBlur={() => finish(draft)}
            className="h-8 w-full rounded-md border border-white/25 bg-black px-2 text-[15px] font-medium tracking-[-0.01em] text-white outline-none focus:border-white/50"
        />
    );
}
