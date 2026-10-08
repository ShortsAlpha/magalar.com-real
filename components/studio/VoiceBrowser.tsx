'use client';

import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Globe, Play, Search, X } from 'lucide-react';
import { LANGUAGE_COUNT, VOICE_COUNT, languageOf, localeLabel, type Voice } from '@/lib/voices';
import {
    ALL_LANGUAGES,
    FEATURED_RANK,
    fold,
    genderLabel,
    getLanguage,
    isKnownLanguage,
    LANGUAGE_ENTRIES,
    POPULAR_LANGUAGE_CODES,
    resolveVoice,
    VOICE_ENTRIES,
    voiceMetaLine,
    type LanguageEntry,
    type VoiceEntry,
} from '@/lib/studio-voices';
import { writePrefs } from '@/lib/studio-prefs';
import type { PreviewState } from './usePreview';
import { cx, EqBars, focusRing, formatCount, MonoLabel, Segmented, Spinner, voiceInitials, VoiceAvatar } from './ui';

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

type Gender = 'all' | 'F' | 'M';

const GENDER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'F', label: 'Female' },
    { value: 'M', label: 'Male' },
] as const;

const HEADER_H = 34;
const OVERSCAN_PX = 240;
const PAGE_STEP = 8;

export const previewKey = (voiceId: string) => `voice:${voiceId}`;

type Row =
    | { kind: 'header'; key: string; label: string; count: number }
    | { kind: 'voice'; key: string; entry: VoiceEntry; voiceIndex: number };

const terms = (q: string) => fold(q).split(/\s+/).filter(Boolean);

function rowHeight(row: Row, voiceH: number) {
    return row.kind === 'header' ? HEADER_H : voiceH;
}

function languageLabel(code: string) {
    if (code === ALL_LANGUAGES) return 'All languages';
    return getLanguage(code)?.name ?? code;
}

/* ------------------------------------------------------------------ */
/* VoiceBrowser                                                        */
/* ------------------------------------------------------------------ */

export interface VoiceBrowserProps {
    /** Currently selected voice id (highlighted + scrolled into view on mount). */
    value: string | null;
    onSelect: (voice: Voice) => void;
    /** Play / stop a sample (parent owns the preview player). */
    onPreview?: (voice: Voice) => void;
    previewState?: PreviewState;
    /** "all" or a language code; used until the user picks a language here. */
    initialLanguage?: string | null;
    compact?: boolean;
    autoFocus?: boolean;
    /** Escape with an empty search (e.g. close the surrounding popover). */
    onEscape?: () => void;
    /** Accessible name of the list. */
    label?: string;
    className?: string;
}

/**
 * Premium browser for the full 322-voice catalog: language switcher with search (endonyms, so
 * "türk" finds Turkish), gender + multilingual filters, Featured first, windowed list and a
 * combobox-style keyboard model (↑↓ / PageUp/Down browse, ↵ select, ⇧↵ preview, Esc clear/close).
 */
export function VoiceBrowser({
    value,
    onSelect,
    onPreview,
    previewState,
    initialLanguage,
    compact = false,
    autoFocus = false,
    onEscape,
    label = 'Voices',
    className,
}: VoiceBrowserProps) {
    const uid = useId();
    const listId = `${uid}-voices`;
    const optionId = (voiceId: string) => `${uid}-opt-${voiceId}`;

    const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
    const [view, setView] = useState<'voices' | 'languages'>('voices');
    const [query, setQuery] = useState('');
    const [gender, setGender] = useState<Gender>('all');
    const [multiOnly, setMultiOnly] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportH, setViewportH] = useState(compact ? 320 : 560);

    const scrollRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const didInitialScroll = useRef(false);

    const requested = chosenLanguage ?? initialLanguage ?? ALL_LANGUAGES;
    const language = requested === ALL_LANGUAGES || isKnownLanguage(requested) ? requested : ALL_LANGUAGES;
    const voiceH = compact ? 52 : 64;

    /* ------------------------------ rows ------------------------------ */

    const { rows, voices, offsets, total } = useMemo(() => {
        const t = terms(query);
        const filtered = VOICE_ENTRIES.filter(
            (e) =>
                (language === ALL_LANGUAGES || e.language === language) &&
                (gender === 'all' || e.voice.gender === gender) &&
                (!multiOnly || e.voice.multilingual) &&
                t.every((term) => e.search.includes(term)),
        );
        const featured = filtered
            .filter((e) => e.featured)
            .sort((a, b) => (FEATURED_RANK.get(a.voice.id) ?? 0) - (FEATURED_RANK.get(b.voice.id) ?? 0));
        const rest = filtered.filter((e) => !e.featured);

        const out: Row[] = [];
        const ordered: VoiceEntry[] = [];
        const push = (e: VoiceEntry) => {
            out.push({ kind: 'voice', key: e.voice.id, entry: e, voiceIndex: ordered.length });
            ordered.push(e);
        };
        if (featured.length) {
            out.push({ kind: 'header', key: 'h-featured', label: 'Featured', count: featured.length });
            featured.forEach(push);
        }
        if (rest.length) {
            const restLabel =
                language === ALL_LANGUAGES ? (featured.length ? 'All voices' : 'Voices') : featured.length ? 'More voices' : 'Voices';
            out.push({ kind: 'header', key: 'h-rest', label: restLabel, count: rest.length });
            rest.forEach(push);
        }

        const offs: number[] = [];
        let y = 0;
        for (const r of out) {
            offs.push(y);
            y += rowHeight(r, voiceH);
        }
        return { rows: out, voices: ordered, offsets: offs, total: y };
    }, [query, language, gender, multiOnly, voiceH]);

    const rowIndexOf = useMemo(() => {
        const map = new Map<string, number>();
        rows.forEach((r, i) => r.kind === 'voice' && map.set(r.entry.voice.id, i));
        return map;
    }, [rows]);

    const effectiveActiveId =
        (activeId && rowIndexOf.has(activeId) && activeId) ||
        (value && rowIndexOf.has(value) && value) ||
        voices[0]?.voice.id ||
        null;

    /* ---------------------------- viewport ---------------------------- */

    useEffect(() => {
        const el = scrollRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => setViewportH(el.clientHeight || 0));
        ro.observe(el);
        return () => ro.disconnect();
    }, [view]);

    // Bring the selected voice into view once, on mount.
    useLayoutEffect(() => {
        // `value` may arrive a tick late (stored preference), so wait for it.
        if (didInitialScroll.current || !value) return;
        didInitialScroll.current = true;
        const el = scrollRef.current;
        const idx = rowIndexOf.get(value);
        if (!el || idx === undefined) return;
        el.scrollTop = Math.max(0, offsets[idx] - el.clientHeight / 3);
    }, [value, rowIndexOf, offsets]);

    useEffect(() => {
        if (!autoFocus) return;
        try {
            if (!window.matchMedia('(pointer: fine)').matches) return;
        } catch {
            /* ignore */
        }
        searchRef.current?.focus({ preventScroll: true });
    }, [autoFocus]);

    const resetScroll = () => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        setScrollTop(0);
    };

    const ensureVisible = (rowIdx: number) => {
        const el = scrollRef.current;
        if (!el) return;
        // Keep the group header visible when moving to the first voice of a group.
        const prev = rows[rowIdx - 1];
        const top = offsets[rowIdx] - (prev?.kind === 'header' ? HEADER_H : 0);
        const bottom = offsets[rowIdx] + voiceH;
        let next = el.scrollTop;
        if (top < next) next = top;
        else if (bottom > next + el.clientHeight) next = bottom - el.clientHeight;
        if (next !== el.scrollTop) {
            el.scrollTop = next;
            setScrollTop(next);
        }
    };

    /* ---------------------------- handlers ---------------------------- */

    const select = (voice: Voice) => {
        writePrefs({ voiceId: voice.id, language });
        onSelect(voice);
    };

    const chooseLanguage = (code: string) => {
        setChosenLanguage(code);
        writePrefs({ language: code });
        setView('voices');
        setActiveId(null);
        resetScroll();
        requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    };

    const moveActive = (delta: number) => {
        if (!voices.length) return;
        const current = effectiveActiveId ? voices.findIndex((e) => e.voice.id === effectiveActiveId) : -1;
        const nextIdx = Math.max(0, Math.min(voices.length - 1, (current < 0 ? (delta > 0 ? -1 : voices.length) : current) + delta));
        const id = voices[nextIdx].voice.id;
        setActiveId(id);
        const rowIdx = rowIndexOf.get(id);
        if (rowIdx !== undefined) ensureVisible(rowIdx);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        // Navigation keys only drive the list from the search field or the list itself — never
        // from the filter buttons (Enter there must press the button).
        const fromNav = e.target === searchRef.current || e.target === scrollRef.current;
        if (!fromNav && e.key !== 'Escape') return;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                moveActive(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                moveActive(-1);
                break;
            case 'PageDown':
                e.preventDefault();
                moveActive(PAGE_STEP);
                break;
            case 'PageUp':
                e.preventDefault();
                moveActive(-PAGE_STEP);
                break;
            case 'Enter': {
                if (e.nativeEvent.isComposing) return;
                const voice = effectiveActiveId ? resolveVoice(effectiveActiveId) : null;
                if (!voice || !rowIndexOf.has(voice.id)) return;
                e.preventDefault();
                if (e.shiftKey) onPreview?.(voice);
                else select(voice);
                break;
            }
            case 'Escape':
                if (query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery('');
                    resetScroll();
                } else if (onEscape) {
                    e.preventDefault();
                    e.stopPropagation();
                    onEscape();
                }
                break;
        }
    };

    /* ------------------------------ render ----------------------------- */

    const listHeight = compact ? 'h-[min(320px,46dvh)]' : 'h-[min(560px,62dvh)] min-h-[320px]';

    if (view === 'languages') {
        return (
            <div className={cx('flex flex-col overflow-hidden', className)}>
                <LanguageList
                    current={language}
                    compact={compact}
                    heightClass={listHeight}
                    onPick={chooseLanguage}
                    onBack={() => {
                        setView('voices');
                        setScrollTop(0);
                        requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
                    }}
                />
            </div>
        );
    }

    const startY = scrollTop - OVERSCAN_PX;
    const endY = scrollTop + viewportH + OVERSCAN_PX;
    const visible: number[] = [];
    for (let i = 0; i < rows.length; i++) {
        const top = offsets[i];
        if (top > endY) break;
        if (top + rowHeight(rows[i], voiceH) >= startY) visible.push(i);
    }

    const filtersActive = query !== '' || gender !== 'all' || multiOnly;
    const activeOption = effectiveActiveId && rowIndexOf.has(effectiveActiveId) ? optionId(effectiveActiveId) : undefined;
    const langName = languageLabel(language);

    return (
        <div className={cx('flex flex-col overflow-hidden', className)} onKeyDown={onKeyDown}>
            {/* Toolbar */}
            <div className={cx('space-y-3 border-b border-white/10', compact ? 'p-2.5' : 'p-3 sm:p-4')}>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        onClick={() => setView('languages')}
                        aria-haspopup="listbox"
                        aria-label={`Language: ${langName}. Change language`}
                        className={cx(
                            'group flex h-10 min-w-0 shrink-0 items-center gap-2.5 rounded-lg border border-white/10 pl-3 pr-2.5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.03] sm:max-w-[45%]',
                            focusRing,
                        )}
                    >
                        <Globe className="h-3.5 w-3.5 shrink-0 text-neutral-500 group-hover:text-neutral-300" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm text-white">{langName}</span>
                        <span className="font-mono text-[10px] tabular-nums text-neutral-500">
                            {language === ALL_LANGUAGES ? LANGUAGE_COUNT : getLanguage(language)?.voiceCount}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
                    </button>

                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden />
                        <input
                            ref={searchRef}
                            type="text"
                            role="combobox"
                            aria-expanded
                            aria-controls={listId}
                            aria-autocomplete="list"
                            aria-activedescendant={activeOption}
                            aria-label={`Search ${language === ALL_LANGUAGES ? 'all' : langName} voices`}
                            value={query}
                            dir="auto"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setActiveId(null);
                                resetScroll();
                            }}
                            placeholder={
                                language === ALL_LANGUAGES
                                    ? `Search ${formatCount(VOICE_COUNT)} voices, tags, accents…`
                                    : `Search ${langName} voices…`
                            }
                            className="h-10 w-full rounded-lg border border-white/10 bg-transparent pl-9 pr-9 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 hover:border-white/20 focus:border-white/30"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    resetScroll();
                                    searchRef.current?.focus();
                                }}
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
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                        <Segmented
                            label="Gender"
                            hideLabel={compact}
                            size="sm"
                            options={GENDER_OPTIONS}
                            value={gender}
                            onChange={(g) => {
                                setGender(g);
                                setActiveId(null);
                                resetScroll();
                            }}
                        />
                        <button
                            type="button"
                            aria-pressed={multiOnly}
                            onClick={() => {
                                setMultiOnly((m) => !m);
                                setActiveId(null);
                                resetScroll();
                            }}
                            className={cx(
                                'h-7 shrink-0 rounded-lg border px-2 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
                                focusRing,
                                multiOnly
                                    ? 'border-white bg-white text-black'
                                    : 'border-white/10 text-neutral-400 hover:border-white/25 hover:text-white',
                            )}
                        >
                            Multilingual
                        </button>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] uppercase tabular-nums tracking-[0.12em] text-neutral-500" aria-live="polite">
                        {voices.length} {voices.length === 1 ? 'voice' : 'voices'}
                    </span>
                </div>
            </div>

            {/* Windowed list */}
            <div
                ref={scrollRef}
                id={listId}
                role="listbox"
                aria-label={label}
                tabIndex={voices.length ? 0 : -1}
                aria-activedescendant={activeOption}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                className={cx('relative overflow-y-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40', listHeight)}
            >
                {voices.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <p className="font-serif text-xl italic text-neutral-300">No voices found.</p>
                        <p className="max-w-xs text-sm text-neutral-500">
                            {filtersActive
                                ? 'Try a different spelling, or loosen the filters.'
                                : `No voices for ${langName} yet.`}
                        </p>
                        {(filtersActive || language !== ALL_LANGUAGES) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    setGender('all');
                                    setMultiOnly(false);
                                    if (!filtersActive) chooseLanguage(ALL_LANGUAGES);
                                    resetScroll();
                                }}
                                className={cx('font-mono text-[10px] uppercase tracking-[0.14em] text-white underline underline-offset-4', focusRing)}
                            >
                                {filtersActive ? 'Clear filters' : 'Show all languages'}
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ height: total }} className="relative">
                        {visible.map((i) => {
                            const row = rows[i];
                            const style = { top: offsets[i], height: rowHeight(row, voiceH) };
                            if (row.kind === 'header') {
                                return (
                                    <div
                                        key={row.key}
                                        role="presentation"
                                        style={style}
                                        className="absolute inset-x-0 flex items-end justify-between px-4 pb-2"
                                    >
                                        <MonoLabel className="text-[10px]">{row.label}</MonoLabel>
                                        <span className="font-mono text-[10px] tabular-nums text-neutral-600">{row.count}</span>
                                    </div>
                                );
                            }
                            const v = row.entry.voice;
                            return (
                                <VoiceOptionRow
                                    key={row.key}
                                    id={optionId(v.id)}
                                    entry={row.entry}
                                    posinset={row.voiceIndex + 1}
                                    setsize={voices.length}
                                    style={style}
                                    compact={compact}
                                    active={v.id === effectiveActiveId}
                                    selected={v.id === value}
                                    preview={previewState?.id === previewKey(v.id) ? previewState.status : null}
                                    onPreview={onPreview}
                                    onSelect={select}
                                    onHover={() => {
                                        if (activeId !== v.id) setActiveId(v.id);
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {!compact && (
                <div className="hidden items-center justify-between gap-4 border-t border-white/10 px-4 py-2.5 [@media(pointer:fine)]:flex">
                    <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                        <KeyHint k="↑↓">Browse</KeyHint>
                        <KeyHint k="↵">Select</KeyHint>
                        <KeyHint k="⇧ ↵">Preview</KeyHint>
                        <KeyHint k="Esc">Clear</KeyHint>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                        {formatCount(VOICE_COUNT)} voices · {LANGUAGE_COUNT} languages
                    </span>
                </div>
            )}
        </div>
    );
}

function KeyHint({ k, children }: { k: string; children: ReactNode }) {
    return (
        <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-white/10 px-1 py-0.5 font-mono text-[10px] normal-case leading-none text-neutral-400">{k}</kbd>
            {children}
        </span>
    );
}

/* ------------------------------------------------------------------ */
/* Option row                                                          */
/* ------------------------------------------------------------------ */

function VoiceOptionRow({
    id,
    entry,
    posinset,
    setsize,
    style,
    compact,
    active,
    selected,
    preview,
    onPreview,
    onSelect,
    onHover,
}: {
    id: string;
    entry: VoiceEntry;
    posinset: number;
    setsize: number;
    style: { top: number; height: number };
    compact: boolean;
    active: boolean;
    selected: boolean;
    preview: 'loading' | 'playing' | null;
    onPreview?: (voice: Voice) => void;
    onSelect: (voice: Voice) => void;
    onHover: () => void;
}) {
    const v = entry.voice;
    const tags = (v.tags ?? []).slice(0, 3);
    return (
        <div
            id={id}
            role="option"
            aria-selected={selected}
            aria-posinset={posinset}
            aria-setsize={setsize}
            onClick={() => onSelect(v)}
            onMouseMove={onHover}
            style={style}
            className="group absolute inset-x-0 flex cursor-pointer items-center px-1.5 sm:px-2"
        >
            <div
                className={cx(
                    'flex h-[calc(100%-6px)] w-full min-w-0 items-center gap-3 rounded-lg px-2 transition-colors duration-100',
                    active ? 'bg-white/[0.06]' : selected ? 'bg-white/[0.03]' : '',
                    selected && 'ring-1 ring-inset ring-white/25',
                )}
            >
                {onPreview ? (
                    <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPreview(v);
                        }}
                        aria-label={preview === 'playing' ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                        title="Play sample (⇧↵)"
                        className={cx(
                            'group/preview relative flex shrink-0 items-center justify-center rounded-full border font-mono font-medium tracking-[0.06em] transition-colors',
                            compact ? 'h-8 w-8 text-[9px]' : 'h-10 w-10 text-[10px]',
                            preview
                                ? 'border-white bg-white text-black'
                                : selected
                                  ? 'border-white/60 text-white hover:bg-white hover:text-black'
                                  : 'border-white/15 text-neutral-300 hover:border-white hover:bg-white hover:text-black',
                        )}
                    >
                        {preview === 'loading' ? (
                            <Spinner className="h-3 w-3" />
                        ) : preview === 'playing' ? (
                            <EqBars />
                        ) : (
                            <>
                                <span className="transition-opacity group-hover/preview:opacity-0 [@media(hover:none)]:opacity-0">
                                    {voiceInitials(v)}
                                </span>
                                <Play
                                    aria-hidden
                                    className="absolute ml-0.5 h-3 w-3 fill-current opacity-0 transition-opacity group-hover/preview:opacity-100 [@media(hover:none)]:opacity-100"
                                />
                            </>
                        )}
                    </button>
                ) : (
                    <VoiceAvatar voice={v} size={compact ? 'sm' : 'md'} active={selected} />
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className={cx('truncate font-medium tracking-[-0.01em] text-white', compact ? 'text-sm' : 'text-[15px]')}>
                            {v.name}
                        </span>
                        {v.multilingual && (
                            <span
                                title="Speaks many languages from one voice"
                                className="shrink-0 rounded border border-white/15 px-1 py-[3px] font-mono text-[8.5px] uppercase leading-none tracking-[0.12em] text-neutral-300"
                            >
                                Multi
                            </span>
                        )}
                    </div>
                    <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                        {entry.label} · {compact ? v.gender : genderLabel(v.gender)}
                        {compact && tags.length > 0 && <span className="text-neutral-600"> · {tags.slice(0, 2).join(', ')}</span>}
                    </span>
                </div>

                {!compact && tags.length > 0 && (
                    <div className="hidden shrink-0 items-center gap-1 lg:flex">
                        {tags.map((t) => (
                            <span
                                key={t}
                                className="rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] uppercase leading-none tracking-[0.1em] text-neutral-500"
                            >
                                {t}
                            </span>
                        ))}
                    </div>
                )}

                {selected ? (
                    <Check className="h-4 w-4 shrink-0 text-white" aria-hidden />
                ) : (
                    !compact && (
                        <ArrowRight
                            aria-hidden
                            className={cx(
                                'h-4 w-4 shrink-0 transition-all duration-150',
                                active ? 'translate-x-0.5 text-white' : 'text-neutral-700',
                            )}
                        />
                    )
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Language list                                                       */
/* ------------------------------------------------------------------ */

type LangRow = { kind: 'header'; key: string; label: string } | { kind: 'lang'; key: string; code: string; entry: LanguageEntry | null };

function LanguageList({
    current,
    compact,
    heightClass,
    onPick,
    onBack,
}: {
    current: string;
    compact: boolean;
    heightClass: string;
    onPick: (code: string) => void;
    onBack: () => void;
}) {
    const uid = useId();
    const [query, setQuery] = useState('');
    const [activeCode, setActiveCode] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const rows = useMemo<LangRow[]>(() => {
        const t = terms(query);
        if (t.length) {
            const matches = LANGUAGE_ENTRIES.filter((l) => t.every((term) => l.search.includes(term)));
            // Prefix matches on the English or native name first ("tur" → Turkish before Arabic (Türkiye)…).
            const starts = (l: LanguageEntry) =>
                fold(l.name).startsWith(t[0]) || (l.native ? fold(l.native).startsWith(t[0]) : false) || l.code === t[0];
            matches.sort((a, b) => Number(starts(b)) - Number(starts(a)) || a.name.localeCompare(b.name));
            return matches.map((l) => ({ kind: 'lang', key: l.code, code: l.code, entry: l }));
        }
        const out: LangRow[] = [{ kind: 'lang', key: ALL_LANGUAGES, code: ALL_LANGUAGES, entry: null }];
        out.push({ kind: 'header', key: 'h-popular', label: 'Popular' });
        POPULAR_LANGUAGE_CODES.forEach((code) => {
            const entry = LANGUAGE_ENTRIES.find((l) => l.code === code) ?? null;
            if (entry) out.push({ kind: 'lang', key: `p-${code}`, code, entry });
        });
        out.push({ kind: 'header', key: 'h-all', label: `All languages · ${LANGUAGE_COUNT}` });
        LANGUAGE_ENTRIES.forEach((l) => out.push({ kind: 'lang', key: l.code, code: l.code, entry: l }));
        return out;
    }, [query]);

    const langRows = rows.filter((r): r is Extract<LangRow, { kind: 'lang' }> => r.kind === 'lang');
    const effectiveActive =
        (activeCode && langRows.some((r) => r.key === activeCode) && activeCode) ||
        (!query && langRows.some((r) => r.key === current) ? current : null) ||
        langRows[0]?.key ||
        null;

    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    // Keep the active row visible (DOM-only side effect).
    useEffect(() => {
        if (!effectiveActive) return;
        const el = document.getElementById(`${uid}-lang-${effectiveActive}`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [effectiveActive, uid]);

    const move = (delta: number) => {
        if (!langRows.length) return;
        const i = langRows.findIndex((r) => r.key === effectiveActive);
        const next = langRows[Math.max(0, Math.min(langRows.length - 1, (i < 0 ? -1 : i) + delta))];
        setActiveCode(next.key);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
            e.preventDefault();
            const step = e.key === 'PageDown' || e.key === 'PageUp' ? PAGE_STEP : 1;
            move(e.key === 'ArrowDown' || e.key === 'PageDown' ? step : -step);
        } else if (e.key === 'Enter') {
            if (e.nativeEvent.isComposing) return;
            const row = langRows.find((r) => r.key === effectiveActive);
            if (row) {
                e.preventDefault();
                onPick(row.code);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery('');
            else onBack();
        }
    };

    const activeDomId = effectiveActive ? `${uid}-lang-${effectiveActive}` : undefined;

    return (
        <div className="flex flex-col" onKeyDown={onKeyDown}>
            <div className={cx('flex items-center gap-2 border-b border-white/10', compact ? 'p-2.5' : 'p-3 sm:p-4')}>
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back to voices"
                    className={cx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-400 transition-colors hover:border-white/25 hover:text-white',
                        focusRing,
                    )}
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-expanded
                        aria-controls={`${uid}-langs`}
                        aria-autocomplete="list"
                        aria-activedescendant={activeDomId}
                        aria-label="Search languages"
                        value={query}
                        dir="auto"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveCode(null);
                            if (listRef.current) listRef.current.scrollTop = 0;
                        }}
                        placeholder={`Search ${LANGUAGE_COUNT} languages — e.g. Türkçe, 日本語`}
                        className="h-10 w-full rounded-lg border border-white/10 bg-transparent pl-9 pr-3 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 hover:border-white/20 focus:border-white/30"
                    />
                </div>
            </div>

            <div
                ref={listRef}
                id={`${uid}-langs`}
                role="listbox"
                aria-label="Languages"
                className={cx('overflow-y-auto overscroll-contain p-1.5', heightClass)}
            >
                {langRows.length === 0 && (
                    <p className="px-4 py-12 text-center text-sm text-neutral-500">No language matches “{query}”.</p>
                )}
                {rows.map((r) => {
                    if (r.kind === 'header') {
                        return (
                            <div key={r.key} role="presentation" className="px-2.5 pb-2 pt-4">
                                <MonoLabel className="text-[10px]">{r.label}</MonoLabel>
                            </div>
                        );
                    }
                    const isCurrent = r.code === current;
                    const isActive = r.key === effectiveActive;
                    const l = r.entry;
                    return (
                        <div
                            key={r.key}
                            id={`${uid}-lang-${r.key}`}
                            role="option"
                            aria-selected={isCurrent}
                            onClick={() => onPick(r.code)}
                            onMouseMove={() => activeCode !== r.key && setActiveCode(r.key)}
                            className={cx(
                                'flex h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 transition-colors duration-100',
                                isActive ? 'bg-white/[0.06]' : '',
                            )}
                        >
                            <span className="w-8 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                                {l ? l.code : '∗'}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-white">
                                {l ? l.name : 'All languages'}
                                {l?.native && (
                                    <span className="ml-2 font-serif text-[15px] italic text-neutral-400" lang={l.code} dir="auto">
                                        {l.native}
                                    </span>
                                )}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500">
                                {l ? `${l.voiceCount} ${l.voiceCount === 1 ? 'voice' : 'voices'}` : `${VOICE_COUNT} voices`}
                            </span>
                            <span className="flex w-4 shrink-0 justify-end">
                                {isCurrent && <Check className="h-3.5 w-3.5 text-white" aria-hidden />}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* VoicePicker — trigger + popover (dialogue blocks, DOCX settings)    */
/* ------------------------------------------------------------------ */

const PANEL_W = 480;
const PANEL_H = 470;

type PopoverPos = { top: number | null; bottom: number | null; left: number; width: number };

/** Desktop placement next to the trigger (flips above when there's no room below). */
function measurePopover(el: HTMLElement): PopoverPos {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PANEL_W, vw - 32);
    const left = Math.max(16, Math.min(r.left, vw - width - 16));
    const below = vh - r.bottom;
    const above = r.top;
    if (below < PANEL_H + 16 && above > below) return { top: null, bottom: vh - r.top + 8, left, width };
    return { top: r.bottom + 8, bottom: null, left, width };
}

export function VoicePicker({
    value,
    onChange,
    label,
    onPreview,
    previewState,
    disabled,
    variant = 'inline',
}: {
    value: string;
    onChange: (voice: Voice) => void;
    label: string;
    onPreview?: (voice: Voice) => void;
    previewState?: PreviewState;
    disabled?: boolean;
    /** `inline`: compact trigger in a block header. `field`: full-width bordered control. */
    variant?: 'inline' | 'field';
}) {
    const [pos, setPos] = useState<PopoverPos | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const voice = resolveVoice(value);
    const open = pos !== null;

    const close = useCallback((refocus = true) => {
        setPos(null);
        if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
    }, []);

    // Follow the trigger while the page scrolls / resizes (the popover lives in a portal).
    useEffect(() => {
        if (!open) return;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (triggerRef.current) setPos(measurePopover(triggerRef.current));
            });
        };
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    const vars = pos
        ? ({
              '--vp-top': pos.top === null ? 'auto' : `${pos.top}px`,
              '--vp-bottom': pos.bottom === null ? 'auto' : `${pos.bottom}px`,
              '--vp-left': `${pos.left}px`,
              '--vp-width': `${pos.width}px`,
          } as CSSProperties)
        : undefined;

    return (
        <div className={cx('relative min-w-0', variant === 'field' && 'w-full')}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`${label}: ${voice.name}, ${localeLabel(voice.locale)}`}
                onClick={(e) => (open ? close(false) : setPos(measurePopover(e.currentTarget)))}
                className={cx(
                    'flex min-w-0 items-center gap-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    focusRing,
                    variant === 'field'
                        ? 'h-14 w-full rounded-lg border border-white/10 px-3 hover:border-white/25 hover:bg-white/[0.02]'
                        : 'rounded-lg py-1 pl-1 pr-2 hover:bg-white/[0.05]',
                    open && (variant === 'field' ? 'border-white/30' : 'bg-white/[0.05]'),
                )}
            >
                <VoiceAvatar voice={voice} size="sm" />
                <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-white">{voice.name}</span>
                    <span
                        className={cx(
                            'truncate font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500',
                            variant === 'field' ? 'block' : 'hidden sm:block',
                        )}
                    >
                        {voiceMetaLine(voice)}
                    </span>
                </span>
                <ChevronDown
                    aria-hidden
                    className={cx('h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform duration-150', open && 'rotate-180')}
                />
            </button>

            {open &&
                createPortal(
                    <>
                        <div className="fixed inset-0 z-50 bg-black/70 sm:bg-transparent" aria-hidden onClick={() => close(false)} />
                        <div
                            role="dialog"
                            aria-label={label}
                            style={vars}
                            className={cx(
                                'fixed z-50 overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0a] shadow-[0_24px_64px_rgba(0,0,0,0.7)]',
                                'inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] animate-fade-up',
                                'sm:inset-x-auto sm:bottom-[var(--vp-bottom)] sm:left-[var(--vp-left)] sm:top-[var(--vp-top)] sm:w-[var(--vp-width)] sm:animate-scale-in',
                            )}
                        >
                            <VoiceBrowser
                                compact
                                autoFocus
                                value={value}
                                initialLanguage={languageOf(voice.locale)}
                                label={label}
                                onPreview={onPreview}
                                previewState={previewState}
                                onEscape={() => close()}
                                onSelect={(v) => {
                                    onChange(v);
                                    close();
                                }}
                            />
                        </div>
                    </>,
                    document.body,
                )}
        </div>
    );
}
