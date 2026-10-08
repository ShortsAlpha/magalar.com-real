import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://magalar.com'),
  title: {
    default: 'Magalar — Studio-grade text to speech',
    template: '%s · Magalar',
  },
  description:
    'Turn text into natural, studio-grade speech. Single voices, multi-speaker dialogue, 50,000-character long-form and batch DOCX automation.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
        <body className="font-sans bg-black text-white antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
