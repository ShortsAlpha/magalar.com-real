import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';

const SPECS: [string, string][] = [
    ['Voices', '23'],
    ['Characters', '50,000'],
    ['Batch', 'DOCX → ZIP'],
];

/** Deterministic bar heights for the decorative level meter (no randomness at render). */
const METER = [18, 30, 44, 26, 58, 72, 40, 64, 86, 52, 34, 70, 92, 60, 38, 24, 48, 76, 56, 30, 20, 42, 66, 36, 22, 14];

const ring =
    'outline-none focus-visible:ring-1 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

export default function AuthShell({
    headline,
    accent,
    children,
}: {
    headline: string;
    accent: string;
    children: ReactNode;
}) {
    return (
        <div className="grid min-h-dvh bg-black text-white lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            {/* Brand panel (desktop only) */}
            <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 bg-black p-12 lg:flex xl:p-16">
                <Link href="/" aria-label="Magalar home" className={`w-fit rounded text-white ${ring}`}>
                    <LogoMark size={36} />
                </Link>

                <div className="max-w-lg space-y-12">
                    <h1 className="text-balance text-5xl font-medium leading-[1.02] tracking-[-0.04em] xl:text-6xl">
                        {headline}{' '}
                        <span className="font-serif text-[1.12em] font-normal italic tracking-[-0.01em]">{accent}</span>
                    </h1>

                    <dl className="border-b border-white/10">
                        {SPECS.map(([k, v]) => (
                            <div
                                key={k}
                                className="flex items-center justify-between border-t border-white/10 py-3.5 font-mono text-xs uppercase tracking-[0.14em]"
                            >
                                <dt className="text-neutral-500">{k}</dt>
                                <dd className="tabular-nums text-white">{v}</dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <div className="flex items-end justify-between gap-8">
                    <div aria-hidden className="flex h-10 items-end gap-[3px]">
                        {METER.map((h, i) => (
                            <span key={i} className="w-[3px] rounded-full bg-white/20" style={{ height: `${h}%` }} />
                        ))}
                    </div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-600">Magalar Studio</p>
                </div>
            </aside>

            {/* Form panel */}
            <main className="flex min-h-dvh flex-col bg-neutral-950 px-4 py-6 sm:px-8 lg:px-12">
                <div className="flex items-center justify-between">
                    <Link
                        href="/"
                        className={`inline-flex items-center gap-2 rounded text-sm text-neutral-400 transition-colors hover:text-white ${ring}`}
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden />
                        Back to magalar.com
                    </Link>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center py-10">
                    <Link href="/" aria-label="Magalar home" className={`mb-8 rounded text-white lg:hidden ${ring}`}>
                        <LogoMark size={36} />
                    </Link>
                    <div className="flex w-full max-w-[400px] justify-center">{children}</div>
                </div>

                <p className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                    Secured by Clerk
                </p>
            </main>
        </div>
    );
}
