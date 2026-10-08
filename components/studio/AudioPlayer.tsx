'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, ChevronDown, Pause, Play } from 'lucide-react';
import { downloadHref } from '@/lib/api';
import { cueStamp, fetchCues, findCueIndex, lastStartedCueIndex, type Cue } from '@/lib/studio-captions';
import { buttonClass, cx, focusRing, MonoLabel, Spinner } from './ui';

interface AudioPlayerProps {
    src: string;
    /** File name for the MP3 download; SRT/VTT reuse its stem. Extensions are enforced server-side. */
    filename: string;
    /** Small mono caption shown in the footer, e.g. "ARIA · 3 CHUNKS". */
    caption?: string;
    autoPlay?: boolean;
    /** Presigned subtitle URLs. When `vttUrl` is set the player shows live captions + a transcript. */
    srtUrl?: string | null;
    vttUrl?: string | null;
    /** Render the MP3/SRT/VTT download buttons (the Library renders its own, with link refresh). */
    showDownloads?: boolean;
    /** Known duration, shown until the audio metadata loads. */
    durationMs?: number | null;
}

const BAR_COUNT = 72;

/** Only one studio player plays at a time. */
let activeAudio: HTMLAudioElement | null = null;

/** Deterministic pseudo-waveform for a URL so the same render always looks the same. */
function waveform(seed: string, count: number) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const rand = () => {
        h += 0x6d2b79f5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const raw = Array.from({ length: count }, () => rand());
    // Smooth neighbouring bars so it reads like speech, not noise.
    return raw.map((v, i) => {
        const prev = raw[i - 1] ?? v;
        const next = raw[i + 1] ?? v;
        const env = 0.55 + 0.45 * Math.sin((i / count) * Math.PI);
        return Math.max(0.12, Math.min(1, ((prev + v * 2 + next) / 4) * env * 1.35));
    });
}

function fmt(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

type CueState = { status: 'none' | 'loading' | 'error'; cues: Cue[] } | { status: 'ready'; cues: Cue[] };

const NO_CUES: Cue[] = [];

/** Loads cues for a VTT URL through the same-origin proxy. */
function useCues(vttUrl: string | null | undefined): CueState {
    const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] | null } | null>(null);

    useEffect(() => {
        if (!vttUrl) return;
        let alive = true;
        fetchCues(vttUrl).then(
            (cues) => alive && setLoaded({ url: vttUrl, cues }),
            () => alive && setLoaded({ url: vttUrl, cues: null }),
        );
        return () => {
            alive = false;
        };
    }, [vttUrl]);

    if (!vttUrl) return { status: 'none', cues: NO_CUES };
    if (!loaded || loaded.url !== vttUrl) return { status: 'loading', cues: NO_CUES };
    if (!loaded.cues) return { status: 'error', cues: NO_CUES };
    return { status: 'ready', cues: loaded.cues };
}

const stemOf = (filename: string) => filename.replace(/\.[a-z0-9]{2,4}$/i, '') || 'magalar';

/**
 * Monochrome audio player with live captions. Mount it with `key={src}` so a new render resets its state.
 */
export default function AudioPlayer({
    src,
    filename,
    caption,
    autoPlay = true,
    srtUrl,
    vttUrl,
    showDownloads = true,
    durationMs,
}: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const transcriptRef = useRef<HTMLOListElement>(null);
    const userScrollAt = useRef(0);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [metaDuration, setMetaDuration] = useState(0);
    const [failed, setFailed] = useState(false);
    const [transcriptOpen, setTranscriptOpen] = useState(false);
    const bars = useMemo(() => waveform(src, BAR_COUNT), [src]);
    const captions = useCues(vttUrl);

    const duration = metaDuration || (durationMs ? durationMs / 1000 : 0);

    useEffect(() => {
        if (autoPlay) audioRef.current?.play().catch(() => {});
    }, [autoPlay]);

    // Smooth clock while playing (timeupdate only fires ~4×/s — too coarse for captions).
    useEffect(() => {
        if (!playing) return;
        let id = 0;
        const loop = () => {
            const audio = audioRef.current;
            if (audio) setCurrent(audio.currentTime);
            id = requestAnimationFrame(loop);
        };
        id = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(id);
    }, [playing]);

    useEffect(() => {
        const audio = audioRef.current;
        return () => {
            if (audio && activeAudio === audio) activeAudio = null;
        };
    }, []);

    const cues = captions.cues;
    const activeIdx = useMemo(() => findCueIndex(cues, current), [cues, current]);
    const shownIdx = activeIdx >= 0 ? activeIdx : Math.max(0, lastStartedCueIndex(cues, current));
    const shownCue = cues[shownIdx];
    const between = activeIdx < 0;

    // Keep the active transcript line in view (unless the user is scrolling the transcript).
    useEffect(() => {
        if (!transcriptOpen || activeIdx < 0) return;
        const list = transcriptRef.current;
        if (!list || performance.now() - userScrollAt.current < 4000) return;
        const row = list.querySelector<HTMLElement>(`[data-cue="${activeIdx}"]`);
        if (!row) return;
        const top = row.offsetTop - list.clientHeight / 3;
        list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, [activeIdx, transcriptOpen]);

    const toggle = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) audio.play().catch(() => setFailed(true));
        else audio.pause();
    };

    const seek = (t: number) => {
        const audio = audioRef.current;
        if (!audio || !duration) return;
        const next = Math.max(0, Math.min(duration, t));
        audio.currentTime = next;
        setCurrent(next);
    };

    const onScrubKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ' ' || e.key === 'k') {
            e.preventDefault();
            toggle();
        }
    };

    const syncDuration = () => {
        const d = audioRef.current?.duration ?? 0;
        if (Number.isFinite(d) && d > 0) setMetaDuration(d);
    };

    const onPlay = () => {
        const audio = audioRef.current;
        if (audio && activeAudio && activeAudio !== audio) activeAudio.pause();
        activeAudio = audio;
        setPlaying(true);
    };

    const progress = duration > 0 ? Math.min(1, current / duration) : 0;
    const playedBars = Math.round(progress * BAR_COUNT);
    const stem = stemOf(filename);

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onPlay={onPlay}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => {
                    if (e.currentTarget.paused) setCurrent(e.currentTarget.currentTime);
                }}
                onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
                onLoadedMetadata={syncDuration}
                onDurationChange={syncDuration}
                onError={() => setFailed(true)}
            />

            <div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
                <button
                    type="button"
                    onClick={toggle}
                    aria-label={playing ? 'Pause' : 'Play'}
                    className={cx(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform duration-150 hover:scale-[1.04] active:scale-95',
                        focusRing,
                    )}
                >
                    {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                </button>

                <div
                    className={cx(
                        'relative h-11 min-w-0 flex-1 rounded-sm',
                        'has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-white/70 has-[:focus-visible]:ring-offset-4 has-[:focus-visible]:ring-offset-neutral-950',
                    )}
                >
                    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center gap-px sm:gap-[2px]">
                        {bars.map((v, i) => (
                            <span
                                key={i}
                                className={cx(
                                    'min-w-0 flex-1 rounded-full transition-colors duration-150',
                                    i < playedBars ? 'bg-white' : 'bg-white/20',
                                )}
                                style={{ height: `${Math.round(v * 100)}%` }}
                            />
                        ))}
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        step={0.1}
                        value={Math.min(current, duration || 0)}
                        disabled={!duration}
                        onChange={(e) => seek(parseFloat(e.target.value))}
                        onKeyDown={onScrubKey}
                        aria-label="Seek"
                        aria-valuetext={`${fmt(current)} of ${fmt(duration)}`}
                        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
                    />
                </div>
            </div>

            {captions.status !== 'none' && (
                <div className="border-t border-white/10">
                    <div className="px-4 pb-4 pt-3.5 sm:px-5">
                        <div className="mb-2.5 flex items-center justify-between gap-3">
                            <MonoLabel className="flex items-center gap-2 text-[10px]">
                                Captions
                                {captions.status === 'ready' && shownCue && (
                                    <span className="tabular-nums text-neutral-600">
                                        {String(shownIdx + 1).padStart(2, '0')} / {String(cues.length).padStart(2, '0')}
                                    </span>
                                )}
                            </MonoLabel>
                            {captions.status === 'ready' && cues.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setTranscriptOpen((o) => !o)}
                                    aria-expanded={transcriptOpen}
                                    className={cx(
                                        'flex items-center gap-1 rounded font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 transition-colors hover:text-white',
                                        focusRing,
                                    )}
                                >
                                    Transcript
                                    <ChevronDown
                                        className={cx('h-3 w-3 transition-transform duration-150', transcriptOpen && 'rotate-180')}
                                        aria-hidden
                                    />
                                </button>
                            )}
                        </div>
                        <div className="flex min-h-[3.25rem] items-start">
                            {captions.status === 'loading' ? (
                                <span className="flex items-center gap-2 text-sm text-neutral-600">
                                    <Spinner className="h-3 w-3" /> Loading captions
                                </span>
                            ) : captions.status === 'error' ? (
                                <span className="text-sm text-neutral-600">Captions unavailable for this render.</span>
                            ) : shownCue ? (
                                <p
                                    key={shownIdx}
                                    dir="auto"
                                    className={cx(
                                        'animate-fade-in text-pretty font-serif text-[19px] italic leading-snug transition-colors duration-300 sm:text-[22px]',
                                        between ? 'text-neutral-500' : 'text-white',
                                    )}
                                >
                                    {shownCue.text}
                                </p>
                            ) : (
                                <span className="text-sm text-neutral-600">No captions in this render.</span>
                            )}
                        </div>
                    </div>

                    {transcriptOpen && captions.status === 'ready' && (
                        <ol
                            ref={transcriptRef}
                            aria-label="Transcript"
                            onWheel={() => (userScrollAt.current = performance.now())}
                            onTouchMove={() => (userScrollAt.current = performance.now())}
                            className="relative max-h-64 animate-fade-in overflow-y-auto overscroll-contain border-t border-white/10 py-1.5"
                        >
                            {cues.map((cue, i) => (
                                <li key={i} data-cue={i}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            userScrollAt.current = 0;
                                            seek(cue.start + 0.01);
                                        }}
                                        aria-current={i === activeIdx ? 'true' : undefined}
                                        className={cx(
                                            'flex w-full items-baseline gap-4 px-4 py-1.5 text-left transition-colors sm:px-5',
                                            focusRing,
                                            'focus-visible:ring-inset focus-visible:ring-offset-0',
                                            i === activeIdx ? 'bg-white/[0.04] text-white' : 'text-neutral-500 hover:text-neutral-200',
                                        )}
                                    >
                                        <span
                                            className={cx(
                                                'w-12 shrink-0 font-mono text-[10px] tabular-nums',
                                                i === activeIdx ? 'text-neutral-300' : 'text-neutral-700',
                                            )}
                                        >
                                            {cueStamp(cue.start)}
                                        </span>
                                        <span dir="auto" className="min-w-0 flex-1 text-[14px] leading-relaxed">
                                            {cue.text}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-white/10 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-white">
                        {fmt(current)}
                        <span className="text-neutral-600"> / {fmt(duration)}</span>
                    </span>
                    {(failed || caption) && (
                        <MonoLabel className={cx('hidden truncate sm:inline', failed && 'text-red-400')}>
                            {failed ? 'Playback unavailable' : caption}
                        </MonoLabel>
                    )}
                </div>
                {showDownloads && (
                    <div className="flex items-center gap-1.5">
                        <a href={downloadHref(src, `${stem}.mp3`)} download={`${stem}.mp3`} className={buttonClass('secondary', 'sm')}>
                            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
                            MP3
                        </a>
                        {srtUrl && (
                            <a
                                href={downloadHref(srtUrl, `${stem}.srt`)}
                                download={`${stem}.srt`}
                                aria-label="Download SRT subtitles"
                                className={buttonClass('ghost', 'sm', 'font-mono text-[11px] tracking-[0.08em]')}
                            >
                                SRT
                            </a>
                        )}
                        {vttUrl && (
                            <a
                                href={downloadHref(vttUrl, `${stem}.vtt`)}
                                download={`${stem}.vtt`}
                                aria-label="Download VTT subtitles"
                                className={buttonClass('ghost', 'sm', 'font-mono text-[11px] tracking-[0.08em]')}
                            >
                                VTT
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
