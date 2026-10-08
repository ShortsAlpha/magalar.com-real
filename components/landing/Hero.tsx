import { LANGUAGE_COUNT, LOCALE_COUNT, VOICE_COUNT } from '@/lib/voices';
import { AuthCta } from './AuthCta';
import { HeroConsole } from './HeroConsole';

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="wrap">
        <div className="hero-kicker">
          <span className="hero-tag">
            <i className="rec-dot" aria-hidden="true" />
            Text to speech, studio grade
          </span>
          <span className="hero-kicker-right">
            {LANGUAGE_COUNT} languages · {LOCALE_COUNT} locales · Neural voices
          </span>
        </div>

        <h1 className="hero-title" id="hero-title">
          <span className="ht-line">
            <span className="ht-in" style={{ animationDelay: '.05s' }}>
              Every word,
            </span>
          </span>
          <span className="ht-line">
            <span className="ht-in" style={{ animationDelay: '.16s' }}>
              <em>beautifully</em> spoken.
            </span>
          </span>
        </h1>

        <div className="hero-row">
          <p className="hero-sub hero-fade" style={{ animationDelay: '.35s' }}>
            Magalar turns scripts into natural, studio-grade speech in {LANGUAGE_COUNT} languages, with subtitles for
            every render. One narrator or a full cast, a paragraph or a 50,000-character manuscript, a single file or a
            whole folder of .docx scripts.
          </p>
          <div className="hero-actions hero-fade" style={{ animationDelay: '.45s' }}>
            <div className="hero-ctas">
              <AuthCta
                signedOut={{ href: '/sign-up', label: 'Start for free' }}
                signedIn={{ href: '/studio', label: 'Open Studio' }}
                className="btn btn-primary btn-lg"
                magnetic
              />
              <a href="#try" className="btn btn-ghost btn-lg">
                Try it, no sign-up
              </a>
            </div>
            <p className="hero-specs">
              <span>{VOICE_COUNT} voices</span>
              <span>{LANGUAGE_COUNT} languages</span>
              <span>50,000 characters</span>
              <span>MP3 · SRT · VTT</span>
            </p>
          </div>
        </div>
      </div>

      <div className="wrap hero-stage hero-fade" style={{ animationDelay: '.55s' }}>
        <HeroConsole />
      </div>
    </section>
  );
}
