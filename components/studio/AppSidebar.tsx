'use client';

import Link from 'next/link';
import { UserButton, useUser } from '@clerk/nextjs';
import { AudioLines, FileText, MessagesSquare, type LucideIcon } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { userButtonAppearance } from '@/components/auth/appearance';
import { cx, focusRing } from './ui';

export type StudioMode = 'single' | 'dialogue' | 'docx';

export const STUDIO_MODES: { id: StudioMode; label: string; short: string; href: string; icon: LucideIcon }[] = [
    { id: 'single', label: 'Single voice', short: 'Single', href: '/studio', icon: AudioLines },
    { id: 'dialogue', label: 'Dialogue studio', short: 'Dialogue', href: '/studio?mode=dialogue', icon: MessagesSquare },
    { id: 'docx', label: 'DOCX Automator', short: 'DOCX', href: '/studio?mode=docx', icon: FileText },
];

export function parseMode(value: string | null): StudioMode {
    return value === 'dialogue' || value === 'docx' ? value : 'single';
}

function UserBlock() {
    const { isLoaded, user } = useUser();
    const name = user?.fullName || user?.username || null;
    const email = user?.primaryEmailAddress?.emailAddress ?? null;

    return (
        <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                {isLoaded ? (
                    <UserButton appearance={userButtonAppearance} />
                ) : (
                    <span className="h-7 w-7 animate-pulse rounded-full bg-white/10" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                {isLoaded ? (
                    <>
                        <p className="truncate text-[13px] font-medium text-white">{name ?? email ?? 'Account'}</p>
                        {name && email && <p className="truncate font-mono text-[10px] text-neutral-500">{email}</p>}
                    </>
                ) : (
                    <div className="space-y-1.5">
                        <span className="block h-2.5 w-24 animate-pulse rounded bg-white/10" />
                        <span className="block h-2 w-32 animate-pulse rounded bg-white/[0.06]" />
                    </div>
                )}
            </div>
        </div>
    );
}

export default function AppSidebar({ mode }: { mode: StudioMode }) {
    return (
        <>
            {/* Desktop sidebar */}
            <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/10 bg-black md:flex">
                <div className="flex h-16 items-center justify-between gap-2 border-b border-white/10 px-5">
                    <Link href="/" aria-label="Magalar home" className={cx('rounded text-white', focusRing)}>
                        <Logo size={20} />
                    </Link>
                    <span className="rounded border border-white/15 px-1.5 py-1 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.16em] text-neutral-400">
                        Studio
                    </span>
                </div>

                <nav aria-label="Studio modes" className="flex-1 px-3 pt-6">
                    <p className="label-mono mb-3 px-2.5">Modes</p>
                    <ul className="space-y-0.5">
                        {STUDIO_MODES.map((m, i) => {
                            const active = m.id === mode;
                            const Icon = m.icon;
                            return (
                                <li key={m.id}>
                                    <Link
                                        href={m.href}
                                        aria-current={active ? 'page' : undefined}
                                        className={cx(
                                            'group flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors duration-150',
                                            focusRing,
                                            active
                                                ? 'bg-white/[0.07] text-white'
                                                : 'text-neutral-400 hover:bg-white/[0.03] hover:text-white',
                                        )}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                                        <span className="flex-1 truncate">{m.label}</span>
                                        <span
                                            className={cx(
                                                'font-mono text-[10px] tabular-nums',
                                                active ? 'text-neutral-400' : 'text-neutral-700 group-hover:text-neutral-500',
                                            )}
                                        >
                                            {String(i + 1).padStart(2, '0')}
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div className="border-t border-white/10 p-4">
                    <UserBlock />
                </div>
            </aside>

            {/* Mobile top bar */}
            <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-white/10 bg-black px-4 md:hidden">
                <div className="flex min-w-0 items-center gap-2.5">
                    <Link href="/" aria-label="Magalar home" className={cx('rounded text-white', focusRing)}>
                        <Logo size={19} />
                    </Link>
                    <span className="rounded border border-white/15 px-1.5 py-1 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.16em] text-neutral-400">
                        Studio
                    </span>
                </div>
                <UserButton appearance={userButtonAppearance} />
            </header>

            {/* Mobile tab bar */}
            <nav
                aria-label="Studio modes"
                className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black pb-[env(safe-area-inset-bottom)] md:hidden"
            >
                <ul className="grid grid-cols-3">
                    {STUDIO_MODES.map((m) => {
                        const active = m.id === mode;
                        const Icon = m.icon;
                        return (
                            <li key={m.id}>
                                <Link
                                    href={m.href}
                                    aria-current={active ? 'page' : undefined}
                                    className={cx(
                                        'relative flex h-16 flex-col items-center justify-center gap-1.5 transition-colors',
                                        focusRing,
                                        'focus-visible:ring-inset focus-visible:ring-offset-0',
                                        active ? 'text-white' : 'text-neutral-500 hover:text-neutral-200',
                                    )}
                                >
                                    {active && <span aria-hidden className="absolute inset-x-6 top-0 h-px bg-white" />}
                                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                                    <span className="font-mono text-[10px] uppercase tracking-[0.12em]">{m.short}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </>
    );
}
