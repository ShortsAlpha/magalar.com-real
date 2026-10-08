'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, Pause, Play } from 'lucide-react';
import { downloadHref } from '@/lib/api';
import { buttonClass, cx, focusRing, MonoLabel } from './ui';

interface AudioPlayerProps {
    src: string;
    /** File name for the download (extension is enforced server-side). */
    filename: string;
    /** Small mono caption shown in the footer, e.g. "ARIA · 3 CHUNKS". */
    caption?: string;
    autoPlay?: boolean;
}

const BAR_COUNT = 72;

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

/**
 * Monochrome audio player. Mount it with `key={src}` so a new render resets its state.
 */
export default function AudioPlayer({ src, filename, caption, autoPlay = true }: AudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [failed, setFailed] = useState(false);
    const bars = useMemo(() => waveform(src, BAR_COUNT), [src]);

    useEffect(() => {
        if (autoPlay) audioRef.current?.play().catch(() => {});
    }, [autoPlay]);

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
        if (Number.isFinite(d)) setDuration(d);
    };

    const progress = duration > 0 ? current / duration : 0;
    const playedBars = Math.round(progress * BAR_COUNT);

    return (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
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

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 sm:px-5">
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
                <a href={downloadHref(src, filename)} download={filename} className={buttonClass('secondary', 'sm')}>
                    <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
                    Download
                </a>
            </div>
        </div>
    );
}
