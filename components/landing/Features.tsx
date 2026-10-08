import type { CSSProperties } from 'react';
import {
  AudioLines,
  Captions,
  Download,
  FileArchive,
  Library,
  MessagesSquare,
  PenLine,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { LANGUAGE_COUNT, VOICE_COUNT } from '@/lib/voices';
import { Eyebrow, Split } from './Split';

const FEATURES = [
  {
    n: '01',
    icon: AudioLines,
    title: 'Single voice',
    body: `Pick one of ${VOICE_COUNT} neural voices in ${LANGUAGE_COUNT} languages and preview it. Dial in speed, pitch and volume, then generate an MP3 you can play in the browser and download.`,
    specs: [`${VOICE_COUNT} voices`, `${LANGUAGE_COUNT} languages`, '0.5–2× speed', '±50 Hz pitch'],
    art: 'single',
  },
  {
    n: '02',
    icon: MessagesSquare,
    title: 'Dialogue studio',
    body: 'Build a script from blocks and give every block its own voice, even in different languages. Interviews, stories and explainers render as one continuous audio file.',
    specs: ['Multi-speaker', 'Voice per block', 'Mixed languages', 'One file'],
    art: 'dialogue',
  },
  {
    n: '03',
    icon: ScrollText,
    title: 'Long-form',
    body: 'Up to 50,000 characters in a single render. Text is split at sentence boundaries, synthesized in parallel and stitched into one seamless MP3.',
    specs: ['50,000 characters', 'Parallel chunks', 'Seamless stitch'],
    art: 'long',
  },
  {
    n: '04',
    icon: FileArchive,
    title: 'DOCX Automator',
    body: 'Drop in one or many .docx scripts. Every scene is voiced and subtitled, every embedded image is extracted, and each document comes back as its own ZIP.',
    specs: ['Batch queue', 'Scene parsing', 'ZIP per document'],
    art: 'docx',
  },
  {
    n: '05',
    icon: Captions,
    title: 'Subtitles',
    body: 'Every render ships with SRT and VTT files, timed from the voice’s own word boundaries and broken into readable lines. Drop them into any editor or player.',
    specs: ['SRT', 'VTT', 'Word-timed', 'Every render'],
    art: 'subs',
  },
  {
    n: '06',
    icon: Library,
    title: 'Personal library',
    body: 'Every render is saved to your private library. Play it back, re-download the audio and subtitles, rename it or delete it. Files stay until you delete them.',
    specs: ['Auto-saved', 'Re-download', 'Rename', 'Delete'],
    art: 'library',
  },
] as const;

/* Deterministic bars for the subtitle vignette. */
const SUB_BARS = Array.from({ length: 56 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.83) * 0.6 + Math.sin(i * 0.29 + 2) * 0.4);
  const gap = i === 18 || i === 19 || i === 38 ? 0.12 : 1;
  return Math.round(Math.max(0.1, (0.2 + v * 0.8) * gap) * 100);
});
const CUES = [
  { t: 'Every word,', time: '00:00:00,120' },
  { t: 'timed to the voice', time: '00:00:01,480' },
  { t: 'that speaks it.', time: '00:00:03,060' },
];
const LIB = [
  { name: 'launch-film.mp3', meta: 'Emel · tr-TR · 01:12' },
  { name: 'chapter-one.mp3', meta: 'Sonia · en-GB · 08:41' },
  { name: 'module-01.zip', meta: 'DOCX · 6 scenes' },
];

function Art({ kind }: { kind: (typeof FEATURES)[number]['art'] }) {
  if (kind === 'single') {
    return (
      <div className="fa fa-single" aria-hidden="true">
        {[0.33, 0.5, 0.62].map((v, i) => (
          <span key={i} className="fa-slider">
            <i style={{ left: `${v * 100}%` }} />
          </span>
        ))}
      </div>
    );
  }
  if (kind === 'dialogue') {
    return (
      <div className="fa fa-dialogue" aria-hidden="true">
        <span className="fa-line">
          <b>A</b>
          <i style={{ width: '62%' }} />
        </span>
        <span className="fa-line is-b">
          <b>B</b>
          <i style={{ width: '48%' }} />
        </span>
        <span className="fa-line">
          <b>A</b>
          <i style={{ width: '74%' }} />
        </span>
      </div>
    );
  }
  if (kind === 'long') {
    return (
      <div className="fa fa-long" aria-hidden="true">
        <span className="fa-cells">
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i * 137) % 900}ms` }} />
          ))}
        </span>
        <span className="fa-merged" />
      </div>
    );
  }
  if (kind === 'subs') {
    return (
      <div className="fa fa-subs" aria-hidden="true">
        <span className="fa-sbars">
          {SUB_BARS.map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
          <span className="fa-shead" />
        </span>
        <span className="fa-cues">
          {CUES.map((c, i) => (
            <i key={i} style={{ '--c': i } as CSSProperties} />
          ))}
        </span>
        <span className="fa-caption">
          {CUES.map((c, i) => (
            <span key={i} style={{ '--c': i } as CSSProperties}>
              <small>{c.time}</small>
              {c.t}
            </span>
          ))}
        </span>
      </div>
    );
  }
  if (kind === 'library') {
    return (
      <div className="fa fa-lib" aria-hidden="true">
        {LIB.map((r, i) => (
          <span key={r.name} className="fa-row" style={{ '--c': i } as CSSProperties}>
            <span className="fa-rname">
              <b>{r.name}</b>
              <small>{r.meta}</small>
            </span>
            <span className="fa-ricons">
              <Download size={13} strokeWidth={1.75} />
              <PenLine size={13} strokeWidth={1.75} />
              <Trash2 size={13} strokeWidth={1.75} />
            </span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="fa fa-docx" aria-hidden="true">
      <span className="fa-doc">.docx</span>
      <span className="fa-arrow" />
      <span className="fa-zip">.zip</span>
    </div>
  );
}

export function Features() {
  return (
    <section className="sec" id="features" aria-labelledby="features-title">
      <div className="wrap">
        <header className="sec-head">
          <Eyebrow num="01">Features</Eyebrow>
          <h2 className="h2" id="features-title" data-split>
            <Split>
              Every way to give text a <em>voice.</em>
            </Split>
          </h2>
          <p className="lede" data-reveal>
            One studio for a single narrator, a full cast, a 50,000-character manuscript or a folder full of scripts, with
            subtitles and a library for everything you render.
          </p>
        </header>

        <ul className="features">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <li key={f.n} className="feature-cell" data-reveal>
                <div className="feature" data-tilt>
                  <div className="feature-top">
                    <span className="feature-icon">
                      <Icon size={22} strokeWidth={1.4} aria-hidden="true" />
                    </span>
                    <span className="feature-num">{f.n}</span>
                  </div>
                  <Art kind={f.art} />
                  <h3 className="feature-title">{f.title}</h3>
                  <p className="feature-body">{f.body}</p>
                  <ul className="feature-specs" aria-label={`${f.title} specs`}>
                    {f.specs.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
