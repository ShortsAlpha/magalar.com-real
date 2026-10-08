import type { Metadata } from 'next';
import { LANGUAGE_COUNT, VOICE_COUNT } from '@/lib/voices';
import './landing.css';
import { Nav } from '@/components/landing/Nav';
import { Hero } from '@/components/landing/Hero';
import { Demo } from '@/components/landing/Demo';
import { Marquee } from '@/components/landing/Marquee';
import { Features } from '@/components/landing/Features';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Voices } from '@/components/landing/Voices';
import { LongForm } from '@/components/landing/LongForm';
import { Docx } from '@/components/landing/Docx';
import { UseCases } from '@/components/landing/UseCases';
import { Faq } from '@/components/landing/Faq';
import { FinalCta } from '@/components/landing/FinalCta';
import { Footer } from '@/components/landing/Footer';
import { Motion } from '@/components/landing/Motion';
import { buildLabels } from '@/components/landing/catalog';

export const metadata: Metadata = {
  title: { absolute: 'Magalar: studio-grade text to speech' },
  description: `${VOICE_COUNT} natural neural voices in ${LANGUAGE_COUNT} languages. Multi-speaker dialogue, 50,000-character renders, word-timed SRT and VTT subtitles, a personal library and batch DOCX automation. Try it free, no sign-up.`,
  openGraph: {
    title: 'Magalar: studio-grade text to speech',
    description: `${VOICE_COUNT} neural voices in ${LANGUAGE_COUNT} languages, dialogue, 50,000-character renders, subtitles and batch DOCX automation.`,
    url: 'https://magalar.com',
    siteName: 'Magalar',
    type: 'website',
  },
};

export default function LandingPage() {
  // Intl-derived names, snapshotted on the server so client hydration matches exactly.
  const labels = buildLabels();
  return (
    <div className="lp">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Demo labels={labels} />
        <Marquee />
        <Features />
        <HowItWorks />
        <Voices labels={labels} />
        <LongForm />
        <Docx />
        <UseCases />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <Motion />
    </div>
  );
}
