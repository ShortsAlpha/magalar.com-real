'use client';

import { useSearchParams } from 'next/navigation';
import AppSidebar, { parseMode } from './AppSidebar';
import SingleSpeakerMode from './SingleSpeakerMode';
import MultiSpeakerMode from './MultiSpeakerMode';
import DocxAutomator from './DocxAutomator';

/**
 * Studio frame. The active mode lives in the URL (`/studio?mode=dialogue`) so it is linkable;
 * all three modes stay mounted so switching tabs never throws away a script in progress.
 */
export default function StudioShell() {
    const mode = parseMode(useSearchParams().get('mode'));

    return (
        <div className="min-h-dvh bg-black text-white">
            <AppSidebar mode={mode} />
            <main className="md:pl-60">
                <div className="px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 md:px-10 md:pb-20 md:pt-12 lg:px-14">
                    <div hidden={mode !== 'single'}>
                        <SingleSpeakerMode />
                    </div>
                    <div hidden={mode !== 'dialogue'}>
                        <MultiSpeakerMode />
                    </div>
                    <div hidden={mode !== 'docx'}>
                        <DocxAutomator />
                    </div>
                </div>
            </main>
        </div>
    );
}
