'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowRight, Check, Download, Play } from 'lucide-react';
import { LANGUAGE_COUNT, VOICE_COUNT } from '@/lib/voices';
import { AuthCta } from './AuthCta';
import { Eyebrow, Split } from './Split';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* Deterministic bar heights for the static waveform vignette. */
const BARS = Array.from({ length: 48 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.45) * 0.4);
  return Math.round((0.18 + v * 0.82) * 100) / 100;
});

function VWrite() {
  return (
    <div className="vg vg-write" aria-hidden="true">
      <div className="vg-bar">
        <span>chapter-one.txt</span>
        <span>1,248 / 50,000</span>
      </div>
      <p className="vg-copy">
        The rain had not stopped for three days. In the harbour, the lights came on one by one, and somewhere below the
        old pier a radio was playing
        <span className="vg-caret" />
      </p>
      <div className="vg-keys">
        <kbd>Ctrl</kbd>
        <kbd>V</kbd>
        <span>Paste</span>
      </div>
    </div>
  );
}

function VVoice() {
  const rows = [
    { n: 'Emel', m: 'tr-TR · Turkish' },
    { n: 'Sonia', m: 'en-GB · English', on: true },
    { n: 'Seraphina', m: 'de-DE · Multilingual' },
    { n: 'Nanami', m: 'ja-JP · Japanese' },
  ];
  return (
    <ul className="vg vg-voice" aria-hidden="true">
      {rows.map((r) => (
        <li key={r.n} className={r.on ? 'is-on' : undefined}>
          <span className="vg-radio" />
          <b>{r.n}</b>
          <small>{r.m}</small>
          <span className="vg-play">
            <Play size={12} strokeWidth={2} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function VTune() {
  const s = [
    { l: 'Speed', v: '1.25×', p: 0.5, min: '0.5×', max: '2×' },
    { l: 'Pitch', v: '−8 Hz', p: 0.42, min: '−50', max: '+50' },
    { l: 'Volume', v: '+20%', p: 0.7, min: '−50%', max: '+50%' },
  ];
  return (
    <div className="vg vg-tune" aria-hidden="true">
      {s.map((x, i) => (
        <div key={x.l} className="vg-s">
          <div className="vg-s-top">
            <span>{x.l}</span>
            <b>{x.v}</b>
          </div>
          <div className="vg-s-track">
            <span className="vg-s-fill" style={{ width: `${x.p * 100}%` }} />
            <span className="vg-s-knob" style={{ left: `${x.p * 100}%`, animationDelay: `${i * 0.4}s` }} />
          </div>
          <div className="vg-s-scale">
            <span>{x.min}</span>
            <span>{x.max}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function VGenerate() {
  return (
    <div className="vg vg-gen" aria-hidden="true">
      <div className="vg-gen-head">
        <span className="vg-btn">
          <Check size={14} strokeWidth={2} /> Generated
        </span>
        <span>MP3 · SRT · VTT</span>
      </div>
      <div className="vg-wave">
        {BARS.map((h, i) => (
          <i key={i} style={{ height: `${h * 100}%` }} className={i < 20 ? 'is-played' : undefined} />
        ))}
      </div>
      <div className="vg-file">
        <span className="vg-file-play">
          <Play size={14} strokeWidth={2} />
        </span>
        <span className="vg-file-name">
          <b>chapter-one.mp3</b>
          <small>Sonia · en-GB · 1.25×</small>
        </span>
        <span className="vg-file-dl">
          <Download size={16} strokeWidth={1.75} />
        </span>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: (
      <>
        Write or <em>paste</em>
      </>
    ),
    body: 'Type a script or paste up to 50,000 characters: a paragraph, a lesson, a whole chapter.',
    Art: VWrite,
  },
  {
    title: (
      <>
        Pick a <em>voice</em>
      </>
    ),
    body: `Choose from ${VOICE_COUNT} neural voices in ${LANGUAGE_COUNT} languages, and preview any of them before you commit.`,
    Art: VVoice,
  },
  {
    title: (
      <>
        Tune the <em>delivery</em>
      </>
    ),
    body: 'Speed from 0.5× to 2×, pitch within ±50 Hz, volume within ±50%. Preview the settings, then adjust.',
    Art: VTune,
  },
  {
    title: (
      <>
        Generate &amp; <em>download</em>
      </>
    ),
    body: 'Render, listen in the browser and download a clean MP3 with SRT and VTT subtitles. Every render is saved to your library.',
    Art: VGenerate,
  },
];

export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        const section = root.current;
        const pinEl = pin.current;
        const vp = viewport.current;
        const trackEl = track.current;
        const barEl = bar.current;
        if (!section || !pinEl || !vp || !trackEl) return;
        section.classList.add('is-pinned');
        const cards = Array.from(trackEl.querySelectorAll<HTMLElement>('.tour-card'));
        const dist = () => Math.max(0, trackEl.scrollWidth - vp.clientWidth);
        const mark = () => {
          const r0 = vp.getBoundingClientRect();
          const focus = r0.left + Math.min(r0.width * 0.45, 420);
          cards.forEach((c) => {
            const r = c.getBoundingClientRect();
            c.classList.toggle('is-current', r.left <= focus && r.right > focus);
          });
        };

        gsap.to(trackEl, {
          x: () => -dist(),
          ease: 'none',
          scrollTrigger: {
            trigger: pinEl,
            start: 'top top',
            end: () => `+=${dist()}`,
            pin: true,
            scrub: 0.6,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              if (barEl) barEl.style.transform = `scaleX(${self.progress.toFixed(4)})`;
              mark();
            },
            onRefresh: mark,
          },
        });

        const refresh = () => ScrollTrigger.refresh();
        document.fonts?.ready.then(refresh).catch(() => {});
        window.addEventListener('load', refresh);
        return () => {
          window.removeEventListener('load', refresh);
          section.classList.remove('is-pinned');
          cards.forEach((c) => c.classList.remove('is-current'));
          if (barEl) barEl.style.transform = '';
        };
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="sec inv tour" id="how-it-works" aria-labelledby="how-title">
      <div ref={pin} className="tour-pin">
        <div className="tour-intro">
          <Eyebrow num="02">How it works</Eyebrow>
          <h2 className="h2" id="how-title" data-split>
            <Split>
              From script to <em>sound</em> in four steps.
            </Split>
          </h2>
          <p className="lede">No timeline to learn and nothing to install. Paste, pick, tune, generate.</p>
          <p className="tour-hint" aria-hidden="true">
            <span className="tour-hint-desk">Keep scrolling</span>
            <span className="tour-hint-mob">Swipe the steps</span>
            <ArrowRight size={14} strokeWidth={1.75} />
          </p>
        </div>
        <div ref={viewport} className="tour-viewport">
          <ol ref={track} className="tour-track">
            {STEPS.map((s, i) => (
              <li key={i} className="tour-card">
                <div className="tour-meta">
                  <span>Step {String(i + 1).padStart(2, '0')}</span>
                  <span>
                    {String(i + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
                  </span>
                </div>
                <div className="tour-art">
                  <s.Art />
                </div>
                <h3 className="tour-title">{s.title}</h3>
                <p className="tour-body">{s.body}</p>
              </li>
            ))}
            <li className="tour-outro">
              <p className="tour-outro-title">
                Ready when <em>you</em> are.
              </p>
              <AuthCta
                signedOut={{ href: '/sign-up', label: 'Start for free' }}
                signedIn={{ href: '/studio', label: 'Open Studio' }}
                className="btn btn-primary btn-lg"
              />
            </li>
          </ol>
        </div>
        <div className="tour-progress" aria-hidden="true">
          <span ref={bar} />
        </div>
      </div>
    </section>
  );
}
