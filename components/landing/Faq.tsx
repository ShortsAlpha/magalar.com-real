import { Plus } from 'lucide-react';
import { Eyebrow, Split } from './Split';

const FAQ = [
  {
    q: 'How long can a single render be?',
    a: 'Up to 50,000 characters. Long text is split at sentence boundaries, the chunks are synthesized in parallel, and the results are stitched back into one seamless MP3.',
  },
  {
    q: 'Which voices and languages are available?',
    a: '23 natural English neural voices with American, British, Australian, Canadian and Irish accents. Magalar is English-only for now.',
  },
  {
    q: 'What can I adjust?',
    a: 'Speed from 0.5× to 2×, pitch by up to ±50 Hz and volume by up to ±50%. You can preview voices and settings before you generate.',
  },
  {
    q: 'What file formats do I get?',
    a: 'Single-voice, long-form and dialogue renders come back as MP3s you can play in the browser and download. The DOCX Automator returns one ZIP per document, containing numbered MP3s and the extracted images.',
  },
  {
    q: 'How should I format a .docx for the Automator?',
    a: 'Start each scene with a line like “Scene 1”, then put the narration after a “Spoken script:” line. Images embedded in a scene are extracted and named after it (01_1.png, 01_2.png…). Notes and visual suggestions are not voiced.',
  },
  {
    q: 'Can I use several voices in one file?',
    a: 'Yes. In the dialogue studio you build a script from blocks, assign a voice to each block and render everything as one continuous audio file.',
  },
  {
    q: 'Do I need an account? What does it cost?',
    a: 'You need a free account to open the studio. Sign up with email or a social login. Magalar is free during early access.',
  },
  {
    q: 'What happens to my files?',
    a: 'Rendered audio is stored privately on Cloudflare R2 and delivered through private download links that expire. Rendering runs on serverless workers.',
  },
];

export function Faq() {
  return (
    <section className="sec faq" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <header className="faq-head">
          <Eyebrow num="05">FAQ</Eyebrow>
          <h2 className="h2" id="faq-title" data-split>
            <Split>
              Questions, <em>answered.</em>
            </Split>
          </h2>
          <p className="lede">The short version: English voices, MP3 and ZIP out, up to 50,000 characters in.</p>
        </header>
        <div className="faq-list">
          {FAQ.map((f, i) => (
            <details key={f.q} className="qa" name="lp-faq" open={i === 0}>
              <summary>
                <span className="qa-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="qa-q">{f.q}</span>
                <Plus className="qa-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
              </summary>
              <div className="qa-a">
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
