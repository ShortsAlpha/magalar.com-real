'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Play, RotateCcw, Square } from 'lucide-react';
import { MAX_CHARS, VOICES, type VoiceOption } from '@/lib/constants';
import { ApiError, fileStem, NEUTRAL_PROSODY, toApiError, toProsody, useBackend } from '@/lib/api';
import AudioPlayer from './AudioPlayer';
import { usePreview } from './usePreview';
import {
    ApiErrorNotice,
    buttonClass,
    cx,
    EqBars,
    focusRing,
    formatCount,
    LiveDot,
    MonoLabel,
    PageHeader,
    Slider,
    Spinner,
    VoiceAvatar,
    voiceInitials,
    voiceMeta,
} from './ui';

type Step = 'VOICE' | 'TEXT' | 'RESULT';
type GenderFilter = 'All' | 'Female' | 'Male';

const REGIONS = ['All', ...Array.from(new Set(VOICES.map((v) => v.country)))];
const STEPS: { id: Step; label: string }[] = [
    { id: 'VOICE', label: 'Voice' },
    { id: 'TEXT', label: 'Script' },
    { id: 'RESULT', label: 'Render' },
];
/** Rough speaking rate used for the duration estimate. */
const CHARS_PER_SECOND = 15;

function formatDuration(totalSeconds: number) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

interface RenderResult {
    url: string;
    voice: VoiceOption;
    chars: number;
    chunks: number;
    settings: string;
    filename: string;
}

export default function SingleSpeakerMode() {
    const api = useBackend();
    const preview = usePreview();

    const [step, setStep] = useState<Step>('VOICE');
    const [selectedVoice, setSelectedVoice] = useState<VoiceOption | null>(null);
    const [gender, setGender] = useState<GenderFilter>('All');
    const [region, setRegion] = useState('All');

    const [text, setText] = useState('');
    const [speed, setSpeed] = useState(1);
    const [pitch, setPitch] = useState(0);
    const [volume, setVolume] = useState(0);

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<RenderResult | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const visibleVoices = useMemo(
        () => VOICES.filter((v) => (gender === 'All' || v.gender === gender) && (region === 'All' || v.country === region)),
        [gender, region],
    );

    const chars = text.length;
    const overLimit = chars > MAX_CHARS;
    const canGenerate = !!selectedVoice && text.trim().length > 0 && !overLimit && !loading;
    const settingsLabel = `${speed.toFixed(2)}× · ${pitch >= 0 ? '+' : ''}${pitch} Hz · ${volume >= 0 ? '+' : ''}${volume}%`;
    const settingsDirty = speed !== 1 || pitch !== 0 || volume !== 0;

    /* ---------------------------- handlers ---------------------------- */

    const runPreview = (id: string, voice: VoiceOption, sample: string, prosody = NEUTRAL_PROSODY) => {
        if (preview.state?.id === id) {
            preview.stop();
            return;
        }
        setError(null);
        preview
            .play(id, async () => (await api.generateSpeech({ text: sample, voice: voice.id, ...prosody })).audioUrl)
            .catch((err) => setError(toApiError(err)));
    };

    const previewVoice = (voice: VoiceOption) =>
        runPreview(`voice:${voice.id}`, voice, `Hello, I'm ${voice.name}. This is how I sound.`);

    const previewSettings = () => {
        if (!selectedVoice) return;
        runPreview(
            'settings',
            selectedVoice,
            'This is a preview of your custom voice settings.',
            toProsody(speed, pitch, volume),
        );
    };

    const selectVoice = (voice: VoiceOption) => {
        preview.stop();
        setSelectedVoice(voice);
        setError(null);
        setStep('TEXT');
    };

    const generate = async () => {
        if (!canGenerate || !selectedVoice) return;
        preview.stop();
        setLoading(true);
        setError(null);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const res = await api.generateSpeech(
                { text, voice: selectedVoice.id, ...toProsody(speed, pitch, volume) },
                { signal: controller.signal },
            );
            setResult({
                url: res.audioUrl,
                voice: selectedVoice,
                chars,
                chunks: res.chunksProcessed,
                settings: settingsLabel,
                filename: `${fileStem('magalar', selectedVoice.name, Date.now())}.mp3`,
            });
            setStep('RESULT');
        } catch (err) {
            setError(toApiError(err));
        } finally {
            abortRef.current = null;
            setLoading(false);
        }
    };

    const cancel = () => abortRef.current?.abort();

    const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void generate();
        }
    };

    const resetSettings = () => {
        setSpeed(1);
        setPitch(0);
        setVolume(0);
    };

    const startOver = () => {
        preview.stop();
        setStep('VOICE');
        setResult(null);
        setText('');
        setError(null);
        setSelectedVoice(null);
        resetSettings();
    };

    const goTo = (target: Step) => {
        if (target === 'VOICE' || (target === 'TEXT' && selectedVoice) || (target === 'RESULT' && result)) {
            preview.stop();
            setError(null);
            setStep(target);
        }
    };

    /* ----------------------------- render ----------------------------- */

    const stepIndex = STEPS.findIndex((s) => s.id === step);

    return (
        <div className="mx-auto w-full max-w-6xl space-y-8">
            <nav aria-label="Progress" className="flex items-center gap-2 overflow-x-auto sm:gap-3">
                {STEPS.map((s, i) => {
                    const reachable = s.id === 'VOICE' || (s.id === 'TEXT' && !!selectedVoice) || (s.id === 'RESULT' && !!result);
                    const state = i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'todo';
                    return (
                        <div key={s.id} className="flex items-center gap-2 sm:gap-3">
                            {i > 0 && <span aria-hidden className="h-px w-4 bg-white/15 sm:w-8" />}
                            <button
                                type="button"
                                onClick={() => goTo(s.id)}
                                disabled={!reachable || loading}
                                aria-current={state === 'current' ? 'step' : undefined}
                                className={cx(
                                    'flex items-center gap-2 rounded px-1 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors disabled:cursor-default',
                                    focusRing,
                                    state === 'current' ? 'text-white' : reachable ? 'text-neutral-400 hover:text-white' : 'text-neutral-600',
                                )}
                            >
                                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                                {s.label}
                            </button>
                        </div>
                    );
                })}
            </nav>

            {step === 'VOICE' && (
                <section className="animate-fade-up space-y-8">
                    <PageHeader
                        eyebrow="Single voice"
                        title="Choose a"
                        accent="voice."
                        description="Tap an avatar to hear a sample, then pick the voice that fits your script."
                    />

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Segmented label="Gender" options={['All', 'Female', 'Male']} value={gender} onChange={(v) => setGender(v as GenderFilter)} />
                        <Segmented label="Region" options={REGIONS} value={region} onChange={setRegion} />
                    </div>

                    <ApiErrorNotice error={error} />

                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {visibleVoices.map((voice) => {
                            const id = `voice:${voice.id}`;
                            const isPlaying = preview.state?.id === id && preview.state.status === 'playing';
                            const isLoading = preview.state?.id === id && preview.state.status === 'loading';
                            const isSelected = selectedVoice?.id === voice.id;
                            return (
                                <li
                                    key={voice.id}
                                    className={cx(
                                        'group relative flex items-center gap-3 rounded-xl border bg-neutral-950 p-3 pr-4 transition-colors duration-150',
                                        isSelected ? 'border-white/40' : 'border-white/10 hover:border-white/25 hover:bg-[#0d0d0d]',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => previewVoice(voice)}
                                        aria-label={isPlaying ? `Stop ${voice.name} sample` : `Play ${voice.name} sample`}
                                        title="Play sample"
                                        className={cx(
                                            'group/preview relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium tracking-[0.06em] transition-colors',
                                            focusRing,
                                            isPlaying || isLoading
                                                ? 'border-white bg-white text-black'
                                                : 'border-white/15 text-neutral-300 hover:border-white hover:bg-white hover:text-black',
                                        )}
                                    >
                                        {isLoading ? (
                                            <Spinner />
                                        ) : isPlaying ? (
                                            <EqBars />
                                        ) : (
                                            <>
                                                <span className="transition-opacity group-hover/preview:opacity-0 [@media(hover:none)]:opacity-0">
                                                    {voiceInitials(voice)}
                                                </span>
                                                <Play
                                                    aria-hidden
                                                    className="absolute ml-0.5 h-3.5 w-3.5 fill-current opacity-0 transition-opacity group-hover/preview:opacity-100 [@media(hover:none)]:opacity-100"
                                                />
                                            </>
                                        )}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => selectVoice(voice)}
                                        className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-1 focus-visible:after:ring-white/70"
                                    >
                                        <span className="block truncate text-[15px] font-medium tracking-[-0.01em] text-white">
                                            {voice.name}
                                        </span>
                                        <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                                            {voiceMeta(voice)}
                                        </span>
                                    </button>

                                    <ArrowRight
                                        aria-hidden
                                        className="h-4 w-4 shrink-0 text-neutral-600 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-white"
                                    />
                                </li>
                            );
                        })}
                    </ul>
                    {visibleVoices.length === 0 && (
                        <p className="py-10 text-center text-sm text-neutral-500">No voices match these filters.</p>
                    )}
                </section>
            )}

            {step === 'TEXT' && selectedVoice && (
                <section className="animate-fade-up space-y-8">
                    <PageHeader
                        eyebrow="Single voice"
                        title="Write your"
                        accent="script."
                        description="Up to 50,000 characters. Long scripts are split into chunks and stitched back together seamlessly."
                    />

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                        <div className="space-y-4 lg:col-span-8 xl:col-span-9">
                            <div
                                className={cx(
                                    'overflow-hidden rounded-xl border bg-neutral-950 transition-colors duration-150',
                                    overLimit ? 'border-red-500/40' : 'border-white/10 focus-within:border-white/30',
                                )}
                            >
                                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
                                    <MonoLabel>Script</MonoLabel>
                                    <button
                                        type="button"
                                        onClick={() => goTo('VOICE')}
                                        disabled={loading}
                                        className={cx(
                                            'group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm text-neutral-300 transition-colors hover:text-white disabled:pointer-events-none',
                                            focusRing,
                                        )}
                                    >
                                        <VoiceAvatar voice={selectedVoice} size="sm" />
                                        <span className="truncate font-medium">{selectedVoice.name}</span>
                                        <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 group-hover:text-neutral-300 sm:inline">
                                            Change
                                        </span>
                                    </button>
                                </div>
                                <label htmlFor="single-script" className="sr-only">
                                    Script
                                </label>
                                <textarea
                                    id="single-script"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={onEditorKey}
                                    placeholder="What should I say today?"
                                    readOnly={loading}
                                    className="block min-h-[280px] w-full resize-y bg-transparent px-4 py-4 text-base leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-600 sm:min-h-[340px] sm:px-5 sm:text-[17px]"
                                    autoFocus
                                />
                                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2.5">
                                    <span
                                        className={cx(
                                            'font-mono text-[11px] uppercase tabular-nums tracking-[0.14em]',
                                            overLimit ? 'text-red-400' : 'text-neutral-500',
                                        )}
                                        aria-live="polite"
                                    >
                                        <span className={overLimit ? 'text-red-400' : 'text-white'}>{formatCount(chars)}</span> /{' '}
                                        {formatCount(MAX_CHARS)}
                                    </span>
                                    <span className="font-mono text-[11px] uppercase tabular-nums tracking-[0.14em] text-neutral-500">
                                        ≈ {formatDuration(chars / CHARS_PER_SECOND / speed)} min
                                    </span>
                                </div>
                            </div>

                            <ApiErrorNotice error={error} />
                            {overLimit && !error && (
                                <p className="text-sm text-red-300">
                                    {formatCount(chars - MAX_CHARS)} characters over the limit. Trim the script to render.
                                </p>
                            )}

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <button
                                    type="button"
                                    onClick={generate}
                                    disabled={!canGenerate}
                                    className={buttonClass('primary', 'lg', 'w-full sm:flex-1')}
                                >
                                    {loading ? (
                                        <>
                                            <LiveDot />
                                            Rendering{chars > 4000 ? ' long-form audio' : ''}…
                                        </>
                                    ) : (
                                        <>
                                            Render voiceover
                                            <ArrowRight className="h-4 w-4" aria-hidden />
                                        </>
                                    )}
                                </button>
                                {loading ? (
                                    <button type="button" onClick={cancel} className={buttonClass('secondary', 'lg', 'w-full sm:w-auto')}>
                                        Cancel
                                    </button>
                                ) : (
                                    <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600 sm:inline">
                                        Ctrl / ⌘ + Enter
                                    </span>
                                )}
                            </div>
                        </div>

                        <aside className="lg:col-span-4 xl:col-span-3">
                            <div className="space-y-7 rounded-xl border border-white/10 bg-neutral-950 p-5 lg:sticky lg:top-8">
                                <div className="flex items-center justify-between">
                                    <MonoLabel className="text-neutral-300">Voice settings</MonoLabel>
                                    <button
                                        type="button"
                                        onClick={resetSettings}
                                        disabled={!settingsDirty}
                                        className={cx(
                                            'flex items-center gap-1 rounded font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 transition-colors hover:text-white disabled:opacity-0',
                                            focusRing,
                                        )}
                                    >
                                        <RotateCcw className="h-3 w-3" aria-hidden />
                                        Reset
                                    </button>
                                </div>

                                <Slider
                                    id="single-speed"
                                    label="Speed"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    origin={1}
                                    value={speed}
                                    display={`${speed.toFixed(2)}×`}
                                    onChange={setSpeed}
                                />
                                <Slider
                                    id="single-pitch"
                                    label="Pitch"
                                    min={-50}
                                    max={50}
                                    step={1}
                                    origin={0}
                                    value={pitch}
                                    display={`${pitch > 0 ? '+' : ''}${pitch} Hz`}
                                    onChange={(v) => setPitch(Math.round(v))}
                                />
                                <Slider
                                    id="single-volume"
                                    label="Volume"
                                    min={-50}
                                    max={50}
                                    step={1}
                                    origin={0}
                                    value={volume}
                                    display={`${volume > 0 ? '+' : ''}${volume}%`}
                                    onChange={(v) => setVolume(Math.round(v))}
                                />

                                <div className="border-t border-white/10 pt-5">
                                    <button
                                        type="button"
                                        onClick={previewSettings}
                                        disabled={loading}
                                        className={buttonClass('secondary', 'md', 'w-full')}
                                    >
                                        {preview.state?.id === 'settings' ? (
                                            preview.state.status === 'loading' ? (
                                                <>
                                                    <Spinner /> Loading
                                                </>
                                            ) : (
                                                <>
                                                    <Square className="h-3 w-3 fill-current" aria-hidden /> Stop preview
                                                </>
                                            )
                                        ) : (
                                            <>
                                                <Play className="h-3 w-3 fill-current" aria-hidden /> Preview settings
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </aside>
                    </div>
                </section>
            )}

            {step === 'RESULT' && result && (
                <section className="animate-fade-up space-y-8">
                    <PageHeader
                        eyebrow="Render complete"
                        title="Your audio is"
                        accent="ready."
                        actions={
                            <>
                                <button type="button" onClick={() => goTo('TEXT')} className={buttonClass('secondary', 'md')}>
                                    <ArrowLeft className="h-4 w-4" aria-hidden />
                                    Edit script
                                </button>
                                <button type="button" onClick={startOver} className={buttonClass('ghost', 'md')}>
                                    <RotateCcw className="h-4 w-4" aria-hidden />
                                    Start over
                                </button>
                            </>
                        }
                    />

                    <div className="mx-auto max-w-3xl space-y-6">
                        <AudioPlayer
                            key={result.url}
                            src={result.url}
                            filename={result.filename}
                            caption={`${result.voice.name} · MP3`}
                        />

                        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 sm:grid-cols-4">
                            {[
                                ['Voice', result.voice.name],
                                ['Characters', formatCount(result.chars)],
                                ['Chunks', String(result.chunks || 1)],
                                ['Settings', result.settings],
                            ].map(([k, v], i) => (
                                <div
                                    key={k}
                                    className={cx(
                                        'min-w-0 space-y-2 border-white/10 p-4',
                                        i % 2 === 1 && 'border-l',
                                        i >= 2 && 'border-t sm:border-t-0',
                                        i === 2 && 'sm:border-l',
                                    )}
                                >
                                    <dt className="label-mono">{k}</dt>
                                    <dd className="truncate font-mono text-xs tabular-nums text-white">{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>
            )}
        </div>
    );
}

function Segmented({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: string[];
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div role="radiogroup" aria-label={label} className="flex max-w-full items-center gap-3 overflow-x-auto">
            <MonoLabel className="shrink-0">{label}</MonoLabel>
            <div className="flex shrink-0 rounded-lg border border-white/10 p-0.5">
                {options.map((opt) => {
                    const active = opt === value;
                    return (
                        <button
                            key={opt}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => onChange(opt)}
                            className={cx(
                                'h-7 rounded-md px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors',
                                focusRing,
                                active ? 'bg-white text-black' : 'text-neutral-400 hover:text-white',
                            )}
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
