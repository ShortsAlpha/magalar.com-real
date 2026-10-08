import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Studio',
    description: 'Magalar Studio — single voice, dialogue and DOCX batch text to speech.',
    robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
    return children;
}
