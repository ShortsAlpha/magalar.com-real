'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ArrowDownToLine, ArrowRight, FileText, RotateCcw, Upload, X } from 'lucide-react';
import { ApiError, toApiError, triggerDownload, useBackend } from '@/lib/api';
import {
    ApiErrorNotice,
    buttonClass,
    cx,
    focusRing,
    LiveDot,
    MonoLabel,
    Notice,
    PageHeader,
} from './ui';

type FileStatus = 'pending' | 'processing' | 'done' | 'error';

interface QueueItem {
    id: string;
    file: File;
    status: FileStatus;
    error?: string;
    url?: string;
}

const zipName = (file: File) => `${file.name.replace(/\.docx$/i, '') || 'magalar'}.zip`;

function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `file-${Date.now()}-${Math.random()}`;

export default function DocxAutomator() {
    const api = useBackend();
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [skipped, setSkipped] = useState(0);
    const [authError, setAuthError] = useState<ApiError | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const queueRef = useRef<QueueItem[]>([]);
    const cancelRef = useRef(false);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    // Release blob URLs when the component goes away.
    useEffect(
        () => () => {
            queueRef.current.forEach((q) => q.url && URL.revokeObjectURL(q.url));
        },
        [],
    );

    const patch = (id: string, update: Partial<QueueItem>) =>
        setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...update } : q)));

    const addFiles = (files: FileList | File[]) => {
        const all = Array.from(files);
        const valid = all.filter((f) => /\.docx$/i.test(f.name));
        setSkipped(all.length - valid.length);
        if (valid.length) {
            setQueue((prev) => [...prev, ...valid.map((file) => ({ id: newId(), file, status: 'pending' as const }))]);
        }
    };

    const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    };
    const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) addFiles(e.target.files);
        e.target.value = '';
    };

    const processAll = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        setAuthError(null);
        cancelRef.current = false;

        const todo = queueRef.current.filter((q) => q.status === 'pending' || q.status === 'error');
        for (const item of todo) {
            if (cancelRef.current) break;
            // Skip items removed while the batch was running.
            if (!queueRef.current.some((q) => q.id === item.id)) continue;
            patch(item.id, { status: 'processing', error: undefined });
            try {
                const blob = await api.processDocx(item.file);
                const url = URL.createObjectURL(blob);
                patch(item.id, { status: 'done', url });
                triggerDownload(url, zipName(item.file));
            } catch (err) {
                const apiErr = toApiError(err);
                patch(item.id, { status: 'error', error: apiErr.message });
                if (apiErr.kind === 'auth') {
                    setAuthError(apiErr);
                    break;
                }
            }
        }
        setIsProcessing(false);
    };

    const removeItem = (id: string) =>
        setQueue((prev) => {
            const item = prev.find((q) => q.id === id);
            if (item?.url) URL.revokeObjectURL(item.url);
            return prev.filter((q) => q.id !== id);
        });

    const clearDone = () =>
        setQueue((prev) => {
            prev.forEach((q) => q.status === 'done' && q.url && URL.revokeObjectURL(q.url));
            return prev.filter((q) => q.status !== 'done');
        });

    const clearAll = () =>
        setQueue((prev) => {
            prev.forEach((q) => q.url && URL.revokeObjectURL(q.url));
            return [];
        });

    const runnable = queue.filter((q) => q.status === 'pending' || q.status === 'error').length;
    const doneCount = queue.filter((q) => q.status === 'done').length;

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8">
            <PageHeader
                eyebrow="DOCX Automator"
                title="Batch your"
                accent="documents."
                description="Drop course DOCX files. Each one is narrated scene by scene and returned as a ZIP of MP3s, processed one after another."
            />

            <div
                role="button"
                tabIndex={0}
                aria-label="Upload DOCX files"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                    }
                }}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={cx(
                    'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors duration-150 sm:py-16',
                    focusRing,
                    isDragging ? 'border-white bg-white/[0.04]' : 'border-white/15 hover:border-white/30 hover:bg-white/[0.02]',
                )}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    onChange={onFileChange}
                    className="hidden"
                />
                <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 text-neutral-300">
                    <Upload className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-[15px] font-medium text-white">{isDragging ? 'Release to add files' : 'Drop DOCX files here'}</p>
                <p className="mt-1.5 text-sm text-neutral-500">or click to browse</p>
                <MonoLabel className="mt-6">.docx → .zip · MP3 per scene</MonoLabel>
            </div>

            {skipped > 0 && (
                <Notice>
                    Skipped {skipped} {skipped === 1 ? 'file' : 'files'} — only .docx is supported.
                </Notice>
            )}
            <ApiErrorNotice error={authError} />

            {queue.length > 0 && (
                <section aria-label="Queue" className="animate-fade-up space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <MonoLabel className="text-neutral-300">
                            Queue · {String(queue.length).padStart(2, '0')}
                            {doneCount > 0 && <span className="text-neutral-500"> · {doneCount} done</span>}
                        </MonoLabel>
                        <div className="flex gap-1">
                            <button type="button" onClick={clearDone} disabled={doneCount === 0} className={buttonClass('ghost', 'sm')}>
                                Clear done
                            </button>
                            <button type="button" onClick={clearAll} disabled={isProcessing} className={buttonClass('ghost', 'sm')}>
                                Clear all
                            </button>
                        </div>
                    </div>

                    <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-neutral-950">
                        {queue.map((item) => (
                            <li key={item.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-400">
                                    <FileText className="h-4 w-4" aria-hidden />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-white" title={item.file.name}>
                                        {item.file.name}
                                    </p>
                                    <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-neutral-500">
                                        {formatSize(item.file.size)}
                                        {item.status === 'error' && item.error && (
                                            <span className="text-red-400" title={item.error}>
                                                {' '}
                                                · {item.error}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <StatusPill status={item.status} />
                                <div className="flex shrink-0 items-center">
                                    {item.status === 'done' && item.url ? (
                                        <a
                                            href={item.url}
                                            download={zipName(item.file)}
                                            aria-label={`Download ${zipName(item.file)}`}
                                            title="Download ZIP"
                                            className={cx(
                                                'flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-white',
                                                focusRing,
                                            )}
                                        >
                                            <ArrowDownToLine className="h-4 w-4" />
                                        </a>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => removeItem(item.id)}
                                            disabled={item.status === 'processing'}
                                            aria-label={`Remove ${item.file.name}`}
                                            title="Remove"
                                            className={cx(
                                                'flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25',
                                                focusRing,
                                            )}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                    {queue.length === 0 ? 'No files queued' : `${runnable} ready · ZIPs download automatically`}
                </span>
                <div className="flex flex-col gap-2 sm:flex-row">
                    {isProcessing && (
                        <button
                            type="button"
                            onClick={() => {
                                cancelRef.current = true;
                            }}
                            className={buttonClass('secondary', 'md', 'w-full sm:w-auto')}
                        >
                            Stop after current
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={processAll}
                        disabled={runnable === 0 || isProcessing}
                        className={buttonClass('primary', 'md', 'w-full sm:w-auto')}
                    >
                        {isProcessing ? (
                            <>
                                <LiveDot />
                                Processing…
                            </>
                        ) : queue.some((q) => q.status === 'error') ? (
                            <>
                                <RotateCcw className="h-4 w-4" aria-hidden />
                                Process {runnable} {runnable === 1 ? 'file' : 'files'}
                            </>
                        ) : (
                            <>
                                Process {runnable > 0 ? `${runnable} ${runnable === 1 ? 'file' : 'files'}` : 'batch'}
                                <ArrowRight className="h-4 w-4" aria-hidden />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function StatusPill({ status }: { status: FileStatus }) {
    const map: Record<FileStatus, { label: string; className: string }> = {
        pending: { label: 'Queued', className: 'border-white/10 text-neutral-500' },
        processing: { label: 'Rendering', className: 'border-white/20 text-white' },
        done: { label: 'Done', className: 'border-emerald-500/25 text-emerald-400' },
        error: { label: 'Failed', className: 'border-red-500/25 text-red-400' },
    };
    const { label, className } = map[status];
    return (
        <span
            className={cx(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[10px] uppercase leading-none tracking-[0.12em]',
                className,
            )}
        >
            {status === 'processing' && <LiveDot />}
            {label}
        </span>
    );
}
