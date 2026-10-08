'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Play, RotateCcw, Square } from 'lucide-react';
import { MAX_CHARS } from '@/lib/constants';
import { getVoiceById, LANGUAGE_COUNT, localeLabel, previewTextFor, VOICE_COUNT, type Voice } from '@/lib/voices';
import { ApiError, fileStem, NEUTRAL_PROSODY, toApiError, toProsody, useBackend, type Prosody } from '@/lib/api';
import { countChars, estimateSeconds, formatClock, formatMs } from '@/lib/studio-format';
import { invalidateLibrary } from '@/lib/studio-library';
import { useStudioPrefs } from '@/lib/studio-prefs';
import AudioPlayer from './AudioPlayer';
import { cachedPreview, usePreview } from './usePreview';
import { previewKey, VoiceBrowser } from './VoiceBrowser';
import {
    ApiErrorNotice,
    buttonClass,
    cx,
    focusRing,
    formatCount,
    LiveDot,
    MonoLabel,
    PageHeader,
    ProsodySliders,
    SavedToLibrary,
    Spinner,
    VoiceAvatar,
} from './ui';

type Step = 'VOICE' | 'TEXT' | 'RESULT';

const STEPS: { id: Step; label: string }[] = [
    { id: 'VOICE', label: 'Voice' },
    { id: 'TEXT', label: 'Script' },
    { id: 'RESULT', label: 'Render' },
];

interface RenderResult {
    url: string;
    srtUrl: string | null;
    vttUrl: string | null;
    durationMs: number | null;
    renderId: string | null;
    voice: Voice;
    chars: number;
    chunks: number;
    settings: string;
    filename: string;
}

export default function SingleSpeakerMode() {
    const api = useBackend();
    const preview = usePreview();
    const prefs = useStudioPrefs();

    const [step, setStep] = useState<Step>('VOICE');
    const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);

    const [text, setText] = useState('');
    const [speed, setSpeed] = useState(1);
    const [pitch, setPitch] = useState(0);
    const [volume, setVolume] = useState(0);

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<RenderResult | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const lastVoice = prefs.voiceId ? getVoiceById(prefs.voiceId) : undefined;

    const chars = countChars(text);
    const overLimit = chars > MAX_CHARS;
    const canGenerate = !!selectedVoice && text.trim().length > 0 && !overLimit && !loading;
    const settingsLabel = `${speed.toFixed(2)}× · ${pitch >= 0 ? '+' : ''}${pitch} Hz · ${volume >= 0 ? '+' : ''}${volume}%`;
    const settingsDirty = speed !== 1 || pitch !== 0 || volume !== 0;

    /* ---------------------------- handlers ---------------------------- */

    const runPreview = (id: string, voice: Voice, sample: string, prosody: Prosody = NEUTRAL_PROSODY) => {
        if (preview.state?.id === id) {
            preview.stop();
            return;
        }
        setError(null);
        const cacheKey = [voice.id, sample, prosody.rate, prosody.pitch, prosody.volume].join('|');
        preview
            .play(id, () =>
                cachedPreview(cacheKey, async () =>
                    (
                        await api.generateSpeech({
                            text: sample,
                            voice: voice.id,
                            ...prosody,
                            save: false,
                        })
                    ).audioUrl,
                ),
            )
            .catch((err) => setError(toApiError(err)));
    };

    const previewVoice = (voice: Voice) => runPreview(previewKey(voice.id), voice, previewTextFor(voice));

    const previewSettings = () => {
        if (!selectedVoice) return;
        runPreview('settings', selectedVoice, previewTextFor(selectedVoice), toProsody(speed, pitch, volume));
    };

    const selectVoice = (voice: Voice) => {
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
                srtUrl: res.srtUrl,
                vttUrl: res.vttUrl,
                durationMs: res.durationMs,
                renderId: res.renderId,
                voice: selectedVoice,
                chars,
                chunks: res.chunksProcessed,
                settings: settingsLabel,
                filename: `${fileStem('magalar', selectedVoice.name, Date.now())}.mp3`,
            });
            if (res.renderId) invalidateLibrary();
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
                        description={`${formatCount(VOICE_COUNT)} neural voices across ${LANGUAGE_COUNT} languages. Tap an avatar to hear a sample in its own language, then pick the voice that fits your script.`}
                        actions={
                            lastVoice && !selectedVoice ? (
                                <button type="button" onClick={() => selectVoice(lastVoice)} className={buttonClass('secondary', 'md')}>
                                    <VoiceAvatar voice={lastVoice} size="sm" className="-ml-1.5 h-6 w-6 text-[8px]" />
                                    Continue with {lastVoice.name}
                                    <ArrowRight className="h-4 w-4" aria-hidden />
                                </button>
                            ) : undefined
                        }
                    />

                    <ApiErrorNotice error={error} />

                    <div className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
                        <VoiceBrowser
                            value={selectedVoice?.id ?? prefs.voiceId ?? null}
                            initialLanguage={prefs.language}
                            onSelect={selectVoice}
                            onPreview={previewVoice}
                            previewState={preview.state}
                            label="Voices"
                        />
                    </div>
                </section>
            )}

            {step === 'TEXT' && selectedVoice && (
                <section className="animate-fade-up space-y-8">
                    <PageHeader
                        eyebrow="Single voice"
                        title="Write your"
                        accent="script."
                        description="Up to 50,000 characters in any language or script. Long scripts are split into chunks and stitched back together seamlessly — with subtitles."
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
                                        <span className="hidden truncate font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 md:inline">
                                            {localeLabel(selectedVoice.locale)}
                                        </span>
                                        <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 group-hover:text-neutral-300 sm:inline">
                                            · Change
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
                                    dir="auto"
                                    lang={selectedVoice.locale}
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
                                        ≈ {formatClock(estimateSeconds(text, speed))} min
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

                                <ProsodySliders
                                    idPrefix="single"
                                    speed={speed}
                                    pitch={pitch}
                                    volume={volume}
                                    onSpeed={setSpeed}
                                    onPitch={setPitch}
                                    onVolume={setVolume}
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
                        description={result.renderId ? <SavedToLibrary renderId={result.renderId} className="mt-1" /> : undefined}
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
                            srtUrl={result.srtUrl}
                            vttUrl={result.vttUrl}
                            durationMs={result.durationMs}
                            filename={result.filename}
                            caption={result.settings}
                        />

                        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 sm:grid-cols-4">
                            {[
                                ['Voice', result.voice.name],
                                ['Language', localeLabel(result.voice.locale)],
                                ['Duration', result.durationMs !== null ? formatMs(result.durationMs) : `${result.chunks || 1} chunks`],
                                ['Characters', formatCount(result.chars)],
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
                                    <dd className="truncate font-mono text-xs tabular-nums text-white" title={v}>
                                        {v}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </section>
            )}
        </div>
    );
}
