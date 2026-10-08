'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import type { VoiceOption } from '@/lib/constants';
import type { ApiError } from '@/lib/api';

/* ------------------------------------------------------------------ */
/* Class helpers                                                       */
/* ------------------------------------------------------------------ */

export function cx(...classes: (string | false | null | undefined)[]) {
    return classes.filter(Boolean).join(' ');
}

/** Refined, monochrome keyboard focus ring. */
export const focusRing =
    'outline-none focus-visible:ring-1 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-white text-black hover:bg-neutral-200 active:bg-neutral-300 disabled:bg-neutral-800 disabled:text-neutral-500',
    secondary:
        'border border-white/15 text-neutral-200 hover:border-white/30 hover:bg-white/[0.04] hover:text-white disabled:text-neutral-600 disabled:border-white/10 disabled:hover:bg-transparent',
    ghost: 'text-neutral-400 hover:text-white hover:bg-white/[0.05] disabled:text-neutral-700 disabled:hover:bg-transparent',
};

const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
    md: 'h-10 px-4 text-sm gap-2 rounded-lg',
    lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-lg',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
    return cx(
        'inline-flex shrink-0 select-none items-center justify-center font-medium transition-colors duration-150 disabled:cursor-not-allowed',
        focusRing,
        variants[variant],
        sizes[size],
        extra,
    );
}

export function formatCount(n: number) {
    return n.toLocaleString('en-US');
}

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cx('label-mono', className)}>{children}</span>;
}

export function PageHeader({
    eyebrow,
    title,
    accent,
    description,
    actions,
}: {
    eyebrow: string;
    title: string;
    accent: string;
    description?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 space-y-3">
                <MonoLabel>{eyebrow}</MonoLabel>
                <h1 className="text-balance text-3xl font-medium tracking-[-0.03em] text-white sm:text-[40px] sm:leading-[1.05]">
                    {title} <span className="font-serif text-[1.1em] font-normal italic tracking-[-0.01em]">{accent}</span>
                </h1>
                {description && <p className="max-w-xl text-pretty text-sm leading-relaxed text-neutral-400">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
    );
}

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            className={cx(
                'inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent',
                className,
            )}
        />
    );
}

/** The single accent in the product: a small red "on air" dot while rendering. */
export function LiveDot({ className }: { className?: string }) {
    return (
        <span aria-hidden className={cx('relative inline-flex h-1.5 w-1.5', className)}>
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
    );
}

/** Small level-meter used for "now playing". */
export function EqBars({ className }: { className?: string }) {
    return (
        <span aria-hidden className={cx('inline-flex h-3 items-end gap-[2px]', className)}>
            {[0, 180, 90].map((delay) => (
                <span
                    key={delay}
                    className="h-full w-[2px] origin-bottom animate-eq rounded-full bg-current"
                    style={{ animationDelay: `${-delay}ms` }}
                />
            ))}
        </span>
    );
}

/* ------------------------------------------------------------------ */
/* Voice avatar                                                        */
/* ------------------------------------------------------------------ */

export function voiceInitials(voice: VoiceOption) {
    return voice.name.slice(0, 2).toUpperCase();
}

export function VoiceAvatar({
    voice,
    size = 'md',
    active = false,
    className,
}: {
    voice: VoiceOption;
    size?: 'sm' | 'md' | 'lg';
    active?: boolean;
    className?: string;
}) {
    const dims = { sm: 'h-7 w-7 text-[9px]', md: 'h-9 w-9 text-[10px]', lg: 'h-11 w-11 text-[11px]' }[size];
    return (
        <span
            aria-hidden
            className={cx(
                'inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-medium tracking-[0.06em] transition-colors',
                active ? 'border-white bg-white text-black' : 'border-white/15 text-neutral-300',
                dims,
                className,
            )}
        >
            {voiceInitials(voice)}
        </span>
    );
}

export function voiceMeta(voice: VoiceOption) {
    return `${voice.country} · ${voice.gender === 'Female' ? 'F' : 'M'} · ${voice.style}`;
}

/* ------------------------------------------------------------------ */
/* Slider: hairline track + solid fill + invisible native range        */
/* ------------------------------------------------------------------ */

export function Slider({
    id,
    label,
    value,
    min,
    max,
    step,
    origin = min,
    display,
    onChange,
    disabled,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** Where the fill starts (e.g. 0 for bipolar pitch/volume). */
    origin?: number;
    display: string;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    const pct = (v: number) => ((v - min) / (max - min)) * 100;
    const a = pct(Math.min(origin, value));
    const b = pct(Math.max(origin, value));
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label htmlFor={id} className="label-mono">
                    {label}
                </label>
                <span className="font-mono text-xs tabular-nums text-white">{display}</span>
            </div>
            <div
                className={cx(
                    'group relative h-5 rounded-sm',
                    'has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-white/70 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-black',
                    disabled && 'opacity-40',
                )}
            >
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
                {origin !== min && (
                    <div
                        className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/30"
                        style={{ left: `${pct(origin)}%` }}
                    />
                )}
                <div
                    className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-white"
                    style={{ left: `${a}%`, width: `${b - a}%` }}
                />
                <div
                    className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-white transition-transform duration-150 group-hover:scale-110"
                    style={{ left: `${pct(value)}%` }}
                />
                <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    disabled={disabled}
                    aria-valuetext={display}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
                />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

export function Notice({
    tone = 'error',
    children,
    action,
    className,
}: {
    tone?: 'error' | 'success';
    children: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    const Icon = tone === 'error' ? AlertCircle : Check;
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={cx(
                'flex animate-fade-in items-start gap-3 rounded-lg border px-4 py-3 text-sm',
                tone === 'error' ? 'border-red-500/20 bg-red-500/[0.04] text-red-200' : 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-200',
                className,
            )}
        >
            <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', tone === 'error' ? 'text-red-400' : 'text-emerald-400')} aria-hidden />
            <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
            {action}
        </div>
    );
}

export function ApiErrorNotice({ error, className }: { error: ApiError | null; className?: string }) {
    if (!error || error.kind === 'aborted') return null;
    return (
        <Notice
            className={className}
            action={
                error.kind === 'auth' ? (
                    <Link
                        href="/sign-in?redirect_url=%2Fstudio"
                        className={cx('shrink-0 text-sm font-medium text-white underline underline-offset-4', focusRing)}
                    >
                        Sign in
                    </Link>
                ) : undefined
            }
        >
            {error.message}
        </Notice>
    );
}
