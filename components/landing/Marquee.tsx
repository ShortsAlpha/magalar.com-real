import { LANGUAGE_COUNT, VOICE_COUNT } from '@/lib/voices';

/** `lang` marks native-script language names (set in the serif italic). */
const ITEMS: { t: string; lang?: string }[] = [
  { t: `${VOICE_COUNT} neural voices` },
  { t: 'Türkçe', lang: 'tr' },
  { t: `${LANGUAGE_COUNT} languages` },
  { t: 'Deutsch', lang: 'de' },
  { t: 'Dialogue studio' },
  { t: '日本語', lang: 'ja' },
  { t: '50,000 characters' },
  { t: 'Français', lang: 'fr' },
  { t: 'Word-timed subtitles' },
  { t: 'العربية', lang: 'ar' },
  { t: 'DOCX → ZIP' },
  { t: 'Español', lang: 'es' },
  { t: 'Personal library' },
  { t: 'हिन्दी', lang: 'hi' },
  { t: 'SRT · VTT' },
  { t: '한국어', lang: 'ko' },
  { t: 'One seamless MP3' },
  { t: 'Português', lang: 'pt' },
];

function Group({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="marquee-group" aria-hidden={hidden || undefined}>
      {ITEMS.map((it) => (
        <li key={it.t} className={it.lang ? 'is-serif' : undefined}>
          <span lang={it.lang}>{it.t}</span>
          <i className="marquee-sep" aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
}

export function Marquee() {
  return (
    <section className="marquee" aria-label="Capabilities">
      <div className="marquee-track">
        <Group />
        <Group hidden />
      </div>
    </section>
  );
}
