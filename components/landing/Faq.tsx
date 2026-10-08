import { Plus } from 'lucide-react';
import { LANGUAGE_COUNT, LOCALE_COUNT, VOICE_COUNT } from '@/lib/voices';
import { Eyebrow, Split } from './Split';

const FAQ = [
  {
    q: 'Which languages and voices are available?',
    a: `${VOICE_COUNT} natural neural voices across ${LANGUAGE_COUNT} languages and ${LOCALE_COUNT} locales: English, Turkish, German, French, Spanish, Japanese, Arabic, Hindi and many more, often with several regional accents. A handful of multilingual voices can read many languages in one consistent voice.`,
  },
  {
    q: 'Can I try it without an account?',
    a: 'Yes. The demo near the top of the page renders up to 200 characters with any voice, no sign-up needed. It allows a few short tries per hour per visitor, and demo audio is never stored. A free account unlocks the full studio.',
  },
  {
    q: 'How long can a single render be?',
    a: 'Up to 50,000 characters. Long text is split at sentence boundaries (in any script, including Chinese, Japanese, Arabic and Hindi), the chunks are synthesized in parallel, and the results are stitched back into one seamless MP3.',
  },
  {
    q: 'Do I get subtitles?',
    a: 'Yes, with every render. You get an SRT and a VTT file built from the voice’s own word timings and split into readable lines of a few seconds each. Long-form and dialogue subtitles are timed against the final stitched MP3, and the DOCX Automator adds an .srt and a .vtt for every scene.',
  },
  {
    q: 'What is the library?',
    a: 'Every render is saved to your personal library automatically. Search it, play renders back, re-download the MP3, subtitles or ZIP, rename them or delete them. Only you can see your library.',
  },
  {
    q: 'How long are my files kept?',
    a: 'Until you delete them. Renders are stored privately on Cloudflare R2 and delivered through private download links that expire after an hour; a fresh link is created whenever you open your library. Deleting a render removes its audio, subtitles and ZIP.',
  },
  {
    q: 'What can I adjust?',
    a: 'Speed from 0.5× to 2×, pitch by up to ±50 Hz and volume by up to ±50%. You can preview voices and settings before you generate.',
  },
  {
    q: 'What file formats do I get?',
    a: 'Single-voice, long-form and dialogue renders come back as an MP3 plus SRT and VTT subtitles. The DOCX Automator returns one ZIP per document, containing numbered MP3s, matching subtitle files and the extracted images.',
  },
  {
    q: 'How should I format a .docx for the Automator?',
    a: 'Start each scene with a line like “Scene 1”, then put the narration after a “Spoken script:” line. Images embedded in a scene are extracted and named after it (01_1.png, 01_2.png…). Notes and visual suggestions are not voiced.',
  },
  {
    q: 'Can I use several voices in one file?',
    a: 'Yes. In the dialogue studio you build a script from blocks, assign a voice to each block (in any language) and render everything as one continuous audio file with one set of subtitles.',
  },
  {
    q: 'Do I need an account? What does it cost?',
    a: 'You can try the demo without one. To open the studio, create a free account with email or a social login. Magalar is free during early access.',
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
          <p className="lede">
            The short version: {LANGUAGE_COUNT} languages, MP3 with subtitles out, up to 50,000 characters in.
          </p>
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
