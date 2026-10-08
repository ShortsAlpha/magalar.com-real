import { Suspense } from 'react';
import StudioShell from '@/components/studio/StudioShell';

export default function StudioPage() {
    return (
        <Suspense fallback={<div className="min-h-dvh bg-black" aria-busy="true" />}>
            <StudioShell />
        </Suspense>
    );
}
