import { AudioLines, FileArchive, MessagesSquare, ScrollText } from 'lucide-react';
import { Eyebrow, Split } from './Split';

const FEATURES = [
  {
    n: '01',
    icon: AudioLines,
    title: 'Single voice',
    body: 'Pick one of 23 natural English voices and preview it. Dial in speed, pitch and volume, preview the result, then generate an MP3 you can play in the browser and download.',
    specs: ['23 voices', '0.5–2× speed', '±50 Hz pitch', '±50% volume'],
    art: 'single',
  },
  {
    n: '02',
    icon: MessagesSquare,
    title: 'Dialogue studio',
    body: 'Build a script from blocks and give every block its own voice. Interviews, stories and explainers render as one continuous audio file.',
    specs: ['Multi-speaker', 'Voice per block', 'One file'],
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
    body: 'Drop in one or many .docx scripts. Every scene is voiced, every embedded image is extracted, and each document comes back as its own ZIP.',
    specs: ['Batch queue', 'Scene parsing', 'ZIP per document'],
    art: 'docx',
  },
] as const;

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
              Four ways to give text a <em>voice.</em>
            </Split>
          </h2>
          <p className="lede" data-reveal>
            One studio for a single narrator, a full cast, a 50,000-character manuscript or a folder full of scripts.
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
