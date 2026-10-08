'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Play, Plus, Square, Trash2 } from 'lucide-react';
import { MAX_CHARS } from '@/lib/constants';
import { DEFAULT_VOICE_ID, previewTextFor, type Voice } from '@/lib/voices';
import { ApiError, fileStem, NEUTRAL_PROSODY, PREVIEW_MAX_CHARS, toApiError, useBackend } from '@/lib/api';
import { countChars } from '@/lib/studio-format';
import { invalidateLibrary } from '@/lib/studio-library';
import { resolveVoice } from '@/lib/studio-voices';
import AudioPlayer from './AudioPlayer';
import { cachedPreview, usePreview } from './usePreview';
import { previewKey, VoicePicker } from './VoiceBrowser';
import {
    ApiErrorNotice,
    buttonClass,
    cx,
    EqBars,
    focusRing,
    formatCount,
    LiveDot,
    MonoLabel,
    Notice,
    PageHeader,
    SavedToLibrary,
    Spinner,
} from './ui';

interface TextBlock {
    id: string;
    text: string;
    voiceId: string;
}

interface DialogueRender {
    url: string;
    srtUrl: string | null;
    vttUrl: string | null;
    durationMs: number | null;
    renderId: string | null;
    signature: string;
    blocks: number;
    voices: number;
    chars: number;
    filename: string;
}

const INITIAL_BLOCKS: TextBlock[] = [
    { id: 'init-1', text: 'Welcome to the dialogue studio.', voiceId: 'en-US-AriaNeural' },
    { id: 'init-2', text: 'Give every line its own voice, then render the whole conversation as a single track.', voiceId: 'en-US-GuyNeural' },
];

const signatureOf = (blocks: TextBlock[]) => JSON.stringify(blocks.map((b) => [b.text.trim(), b.voiceId]));

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `block-${Date.now()}-${Math.random()}`;

export default function MultiSpeakerMode() {
    const api = useBackend();
    const preview = usePreview();

    const [blocks, setBlocks] = useState<TextBlock[]>(INITIAL_BLOCKS);
    const [attempted, setAttempted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [blockErrors, setBlockErrors] = useState<Record<string, string>>({});
    const [render, setRender] = useState<DialogueRender | null>(null);
    const textareas = useRef<Map<string, HTMLTextAreaElement>>(new Map());

    const totalChars = useMemo(() => blocks.reduce((n, b) => n + countChars(b.text.trim()), 0), [blocks]);
    const voiceCount = useMemo(() => new Set(blocks.map((b) => b.voiceId)).size, [blocks]);
    const emptyIds = useMemo(() => new Set(blocks.filter((b) => !b.text.trim()).map((b) => b.id)), [blocks]);
    const overLimit = totalChars > MAX_CHARS;
    const signature = useMemo(() => signatureOf(blocks), [blocks]);
    const stale = !!render && render.signature !== signature;

    /* ---------------------------- block ops --------------------------- */

    const updateBlock = (id: string, patch: Partial<Omit<TextBlock, 'id'>>) => {
        setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
        if (blockErrors[id]) {
            setBlockErrors((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }
    };

    const addBlock = () => {
        const id = newId();
        setBlocks((prev) => {
            // Alternate speakers by default: reuse the voice from two blocks back.
            const voiceId = prev.length >= 2 ? prev[prev.length - 2].voiceId : prev[prev.length - 1]?.voiceId ?? DEFAULT_VOICE_ID;
            return [...prev, { id, text: '', voiceId }];
        });
        requestAnimationFrame(() => textareas.current.get(id)?.focus());
    };

    const removeBlock = (id: string) => {
        if (preview.state?.id === `block:${id}`) preview.stop();
        setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.id !== id)));
    };

    const moveBlock = (id: string, delta: -1 | 1) => {
        setBlocks((prev) => {
            const i = prev.findIndex((b) => b.id === id);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= prev.length) return prev;
            const next = [...prev];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    /* ----------------------------- actions ---------------------------- */

    const previewBlock = (block: TextBlock) => {
        const id = `block:${block.id}`;
        if (preview.state?.id === id) {
            preview.stop();
            return;
        }
        // Previews are unsaved and capped server-side, so long blocks preview their opening.
        const full = Array.from(block.text.trim());
        const text =
            full.length > PREVIEW_MAX_CHARS
                ? full.slice(0, PREVIEW_MAX_CHARS).join('').replace(/s+S*$/, '')
                : full.join('');
        const voice = resolveVoice(block.voiceId);
        if (!text) {
            setBlockErrors((e) => ({ ...e, [block.id]: 'Add some text to preview this block.' }));
            textareas.current.get(block.id)?.focus();
            return;
        }
        setError(null);
        preview
            .play(id, () =>
                cachedPreview(`${voice.id}|${text}`, async () =>
                    (
                        await api.generateSpeech({
                            text,
                            voice: voice.id,
                            ...NEUTRAL_PROSODY,
                            save: false,
                        })
                    ).audioUrl,
                ),
            )
            .catch((err) => {
                const apiErr = toApiError(err);
                if (apiErr.kind === 'auth') setError(apiErr);
                else setBlockErrors((e) => ({ ...e, [block.id]: apiErr.message }));
            });
    };

    /** Sample from the voice picker, read in the voice's own language. */
    const previewVoice = (voice: Voice) => {
        const id = previewKey(voice.id);
        if (preview.state?.id === id) {
            preview.stop();
            return;
        }
        const sample = previewTextFor(voice);
        setError(null);
        preview
            .play(id, () =>
                cachedPreview(`${voice.id}|${sample}`, async () =>
                    (
                        await api.generateSpeech({
                            text: sample,
                            voice: voice.id,
                            ...NEUTRAL_PROSODY,
                            save: false,
                        })
                    ).audioUrl,
                ),
            )
            .catch((err) => setError(toApiError(err)));
    };

    const generate = async () => {
        setAttempted(true);
        setError(null);
        if (emptyIds.size > 0) {
            const first = blocks.find((b) => emptyIds.has(b.id));
            if (first) textareas.current.get(first.id)?.focus();
            return;
        }
        if (overLimit) return;

        preview.stop();
        setLoading(true);
        const snapshot = blocks;
        try {
            const res = await api.generateDialogue(
                snapshot.map((b) => ({ text: b.text.trim(), voice: b.voiceId, ...NEUTRAL_PROSODY })),
            );
            setRender({
                url: res.audioUrl,
                srtUrl: res.srtUrl,
                vttUrl: res.vttUrl,
                durationMs: res.durationMs,
                renderId: res.renderId,
                signature: signatureOf(snapshot),
                blocks: res.segmentsProcessed || snapshot.length,
                voices: new Set(snapshot.map((b) => b.voiceId)).size,
                chars: snapshot.reduce((n, b) => n + countChars(b.text.trim()), 0),
                filename: `${fileStem('magalar', 'dialogue', Date.now())}.mp3`,
            });
            if (res.renderId) invalidateLibrary();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            setError(toApiError(err));
        } finally {
            setLoading(false);
        }
    };

    const renderButton = (extra?: string) => (
        <button type="button" onClick={generate} disabled={loading || overLimit} className={buttonClass('primary', 'md', extra)}>
            {loading ? (
                <>
                    <LiveDot />
                    Rendering…
                </>
            ) : (
                <>
                    {render && !stale ? 'Render again' : 'Render dialogue'}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                </>
            )}
        </button>
    );

    const showEmptyNotice = attempted && emptyIds.size > 0;

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8">
            <PageHeader
                eyebrow="Dialogue studio"
                title="Cast your"
                accent="dialogue."
                description="Give each line its own voice. Blocks are rendered in order and stitched into a single track."
                actions={renderButton()}
            />

            {/* Spec strip */}
            <dl className="grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10">
                {(
                    [
                        ['Blocks', String(blocks.length).padStart(2, '0')],
                        ['Voices', String(voiceCount).padStart(2, '0')],
                        [
                            'Characters',
                            <>
                                {formatCount(totalChars)}
                                <span className="hidden text-neutral-500 min-[400px]:inline"> / {formatCount(MAX_CHARS)}</span>
                            </>,
                        ],
                    ] as [string, ReactNode][]
                ).map(([k, v]) => (
                    <div key={k} className="min-w-0 space-y-2 px-3 py-3 sm:px-4">
                        <dt className="label-mono truncate">
                            {k === 'Characters' ? (
                                <>
                                    <span className="sm:hidden">Chars</span>
                                    <span className="hidden sm:inline">Characters</span>
                                </>
                            ) : (
                                k
                            )}
                        </dt>
                        <dd
                            className={cx(
                                'truncate font-mono text-[11px] tabular-nums sm:text-xs',
                                k === 'Characters' && overLimit ? 'text-red-400' : 'text-white',
                            )}
                        >
                            {v}
                        </dd>
                    </div>
                ))}
            </dl>

            <ApiErrorNotice error={error} />
            {showEmptyNotice && (
                <Notice>
                    {emptyIds.size === 1 ? 'One block is empty.' : `${emptyIds.size} blocks are empty.`} Add text or remove them
                    before rendering.
                </Notice>
            )}
            {overLimit && (
                <Notice>
                    The dialogue is {formatCount(totalChars - MAX_CHARS)} characters over the {formatCount(MAX_CHARS)} limit.
                </Notice>
            )}

            {render && (
                <section aria-label="Rendered dialogue" className="animate-fade-up space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <MonoLabel className="text-neutral-300">Master</MonoLabel>
                            {stale && <MonoLabel>Edited since render</MonoLabel>}
                        </div>
                        <SavedToLibrary renderId={render.renderId} />
                    </div>
                    <AudioPlayer
                        key={render.url}
                        src={render.url}
                        srtUrl={render.srtUrl}
                        vttUrl={render.vttUrl}
                        durationMs={render.durationMs}
                        filename={render.filename}
                        caption={`${render.blocks} blocks · ${render.voices} voices · ${formatCount(render.chars)} chars`}
                    />
                </section>
            )}

            <ol className="space-y-3">
                {blocks.map((block, index) => {
                    const voice = resolveVoice(block.voiceId);
                    const previewId = `block:${block.id}`;
                    const isPlaying = preview.state?.id === previewId && preview.state.status === 'playing';
                    const isLoading = preview.state?.id === previewId && preview.state.status === 'loading';
                    const invalid = attempted && emptyIds.has(block.id);
                    const blockError = blockErrors[block.id] ?? (invalid ? 'This block is empty.' : null);
                    const n = String(index + 1).padStart(2, '0');

                    return (
                        <li
                            key={block.id}
                            className={cx(
                                'animate-fade-up rounded-xl border bg-neutral-950 transition-colors duration-150',
                                blockError ? 'border-red-500/40' : 'border-white/10 focus-within:border-white/25',
                            )}
                        >
                            <div className="flex items-center justify-between gap-2 border-b border-white/10 py-2 pl-3 pr-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">{n}</span>
                                    <VoicePicker
                                        value={block.voiceId}
                                        onChange={(v) => updateBlock(block.id, { voiceId: v.id })}
                                        label={`Voice for block ${n}`}
                                        onPreview={previewVoice}
                                        previewState={preview.state}
                                    />
                                </div>
                                <div className="flex shrink-0 items-center">
                                    <IconButton label={`Move block ${n} up`} disabled={index === 0} onClick={() => moveBlock(block.id, -1)}>
                                        <ArrowUp className="h-3.5 w-3.5" />
                                    </IconButton>
                                    <IconButton
                                        label={`Move block ${n} down`}
                                        disabled={index === blocks.length - 1}
                                        onClick={() => moveBlock(block.id, 1)}
                                    >
                                        <ArrowDown className="h-3.5 w-3.5" />
                                    </IconButton>
                                    <IconButton
                                        label={`Delete block ${n}`}
                                        disabled={blocks.length <= 1}
                                        onClick={() => removeBlock(block.id)}
                                        danger
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </IconButton>
                                </div>
                            </div>

                            <label htmlFor={`block-${block.id}`} className="sr-only">
                                Text for block {n} ({voice.name})
                            </label>
                            <textarea
                                id={`block-${block.id}`}
                                ref={(el) => {
                                    if (el) textareas.current.set(block.id, el);
                                    else textareas.current.delete(block.id);
                                }}
                                value={block.text}
                                onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                                placeholder={`What does ${voice.name} say?`}
                                rows={3}
                                dir="auto"
                                lang={voice.locale}
                                aria-invalid={!!blockError}
                                className="block min-h-[96px] w-full resize-y bg-transparent px-4 py-3.5 text-[15px] leading-relaxed text-neutral-100 outline-none [field-sizing:content] placeholder:text-neutral-600"
                            />

                            <div className="flex items-center justify-between gap-3 border-t border-white/10 py-1.5 pl-1.5 pr-4">
                                <button
                                    type="button"
                                    onClick={() => previewBlock(block)}
                                    className={buttonClass('ghost', 'sm', isPlaying || isLoading ? 'text-white' : undefined)}
                                >
                                    {isLoading ? (
                                        <Spinner className="h-3 w-3" />
                                    ) : isPlaying ? (
                                        <Square className="h-3 w-3 fill-current" aria-hidden />
                                    ) : (
                                        <Play className="h-3 w-3 fill-current" aria-hidden />
                                    )}
                                    {isLoading ? 'Loading' : isPlaying ? 'Stop' : 'Preview'}
                                    {isPlaying && <EqBars className="ml-1" />}
                                </button>
                                <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                                    {formatCount(countChars(block.text))} chars
                                </span>
                            </div>

                            {blockError && (
                                <p role="alert" className="border-t border-red-500/20 px-4 py-2 text-[13px] text-red-300">
                                    {blockError}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ol>

            <button
                type="button"
                onClick={addBlock}
                className={cx(
                    'flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-neutral-400 transition-colors hover:border-white/30 hover:bg-white/[0.02] hover:text-white',
                    focusRing,
                )}
            >
                <Plus className="h-4 w-4" aria-hidden />
                Add block
            </button>

            <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono text-[11px] uppercase tabular-nums tracking-[0.14em] text-neutral-500">
                    {blocks.length} blocks · {formatCount(totalChars)} / {formatCount(MAX_CHARS)}
                </span>
                {renderButton('w-full sm:w-auto')}
            </div>
        </div>
    );
}

function IconButton({
    label,
    onClick,
    disabled,
    danger,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={cx(
                'flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors disabled:pointer-events-none disabled:opacity-25',
                focusRing,
                danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-white/[0.06] hover:text-white',
            )}
        >
            {children}
        </button>
    );
}
