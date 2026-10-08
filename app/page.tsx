import type { Metadata } from 'next';
import './landing.css';
import { Nav } from '@/components/landing/Nav';
import { Hero } from '@/components/landing/Hero';
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

export const metadata: Metadata = {
  title: { absolute: 'Magalar: studio-grade text to speech' },
  description:
    '23 natural English voices, multi-speaker dialogue, 50,000-character long-form renders and batch DOCX automation. Generate MP3s in your browser.',
  openGraph: {
    title: 'Magalar: studio-grade text to speech',
    description:
      '23 natural English voices, multi-speaker dialogue, 50,000-character renders and batch DOCX automation.',
    url: 'https://magalar.com',
    siteName: 'Magalar',
    type: 'website',
  },
};

export default function LandingPage() {
  return (
    <div className="lp">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Marquee />
        <Features />
        <HowItWorks />
        <Voices />
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
