import { Accessibility, BookOpen, Clapperboard, GraduationCap, Mic2, Presentation } from 'lucide-react';
import { Eyebrow, Split } from './Split';

const CASES = [
  {
    icon: Clapperboard,
    title: 'Video voiceovers',
    body: 'Narration for YouTube, explainers and product films, voiced scene by scene.',
  },
  {
    icon: GraduationCap,
    title: 'E-learning',
    body: 'Turn lesson scripts into consistent course audio with the DOCX Automator.',
  },
  {
    icon: BookOpen,
    title: 'Audiobooks & long reads',
    body: 'Whole chapters of up to 50,000 characters, rendered as one MP3.',
  },
  {
    icon: Mic2,
    title: 'Podcasts & dialogue',
    body: 'Cast a different voice for every speaker and export a single file.',
  },
  {
    icon: Accessibility,
    title: 'Accessibility',
    body: 'Offer a listenable version of articles, documentation and announcements.',
  },
  {
    icon: Presentation,
    title: 'Slideshows',
    body: 'Numbered MP3s and extracted images, ready to drop onto slides in order.',
  },
];

export function UseCases() {
  return (
    <section className="sec" id="use-cases" aria-labelledby="cases-title">
      <div className="wrap">
        <header className="sec-head">
          <Eyebrow>Use cases</Eyebrow>
          <h2 className="h2" id="cases-title" data-split>
            <Split>
              Made for anything that should be <em>heard.</em>
            </Split>
          </h2>
        </header>
        <ul className="cases">
          {CASES.map((c, i) => {
            const Icon = c.icon;
            return (
              <li key={c.title} className="case" data-reveal>
                <span className="case-n">{String(i + 1).padStart(2, '0')}</span>
                <Icon className="case-icon" size={26} strokeWidth={1.3} aria-hidden="true" />
                <h3 className="case-title">{c.title}</h3>
                <p className="case-body">{c.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
