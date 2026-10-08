'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Pause, Play, Search } from 'lucide-react';
import { LANGUAGE_COUNT, LOCALE_COUNT, VOICES, VOICE_COUNT, getVoiceById, languageOf } from '@/lib/voices';
import { Eyebrow, Split } from './Split';
import {
  FEATURED_SAMPLES,
  SAMPLE_IDS,
  genderLabel,
  languagesFrom,
  pauseOtherAudio,
  regionLabel,
  requestDemoVoice,
  sortedVoicesFor,
  type Labels,
  type Lang,
} from './catalog';

const INITIAL_LANG = 'tr';
const COLLAPSED = 10;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Language codes that have at least one voice whose name matches. */
function langsWithVoice(q: string) {
  const out = new Set<string>();
  for (const v of VOICES) if (fold(v.name).includes(q)) out.add(languageOf(v.locale));
  return out;
}

function PlayIcon({ on }: { on: boolean }) {
  return on ? (
    <Pause size={14} strokeWidth={2} aria-hidden="true" />
  ) : (
    <Play size={14} strokeWidth={2} aria-hidden="true" />
  );
}

export function Voices({ labels }: { labels: Labels }) {
  const uid = useId();
  const [lang, setLang] = useState(INITIAL_LANG);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* ---------- index ---------- */
  const langs = languagesFrom(labels);
  const groups = useMemo(() => {
    const { all, featured, other } = languagesFrom(labels);
    const q = fold(query.trim());
    if (!q) {
      return [
        { label: 'Featured', items: featured },
        { label: 'All languages A–Z', items: other },
      ];
    }
    const byVoice = langsWithVoice(q);
    const items = all.filter(
      (l) => fold(l.name).includes(q) || fold(l.native).includes(q) || l.code === q || byVoice.has(l.code),
    );
    return [{ label: `${items.length} ${items.length === 1 ? 'match' : 'matches'}`, items }];
  }, [query, labels]);
  const matchCount = groups.reduce((n, g) => n + g.items.length, 0);

  const pick = (l: Lang) => {
    setLang(l.code);
    setExpanded(false);
    // On stacked layouts, bring the voices into view.
    const panel = panelRef.current;
    if (panel && window.innerWidth < 1024) {
      const top = panel.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.55) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: window.scrollY + top - 80, behavior: reduced ? 'auto' : 'smooth' });
      }
    }
  };

  /* ---------- panel ---------- */
  const current = langs.byCode.get(lang) ?? langs.all[0];
  const native = current.native;
  const voices = useMemo(() => sortedVoicesFor(current.code, labels), [current.code, labels]);
  const shown = expanded ? voices : voices.slice(0, COLLAPSED);
  const query1 = fold(query.trim());

  /* ---------- audio ---------- */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.play().catch((err: unknown) => {
        // AbortError just means a newer selection replaced this one.
        if (!(err instanceof DOMException && err.name === 'AbortError')) setPlaying(null);
      });
    } else a.pause();
  }, [playing]);

  const toggle = (id: string) => {
    setProgress(0);
    setPlaying((cur) => (cur === id ? null : id));
  };

  return (
    <section className="sec" id="voices" aria-labelledby="voices-title">
      <div className="wrap">
        <header className="sec-head">
          <Eyebrow num="03">Voices</Eyebrow>
          <h2 className="h2" id="voices-title" data-split>
            <Split>
              {VOICE_COUNT} voices. {LANGUAGE_COUNT} <em>languages.</em>
            </Split>
          </h2>
          <p className="lede" data-reveal>
            Natural neural voices across {LOCALE_COUNT} locales, from Istanbul to Tokyo. Press play on an unedited
            sample, open any language to browse its voices, then try one in the demo.
          </p>
        </header>

        {/* ---------- Featured samples ---------- */}
        <div className="vx-bar">
          <p className="vx-label">
            <span className="eb-dot" aria-hidden="true" /> Listen
          </p>
          <p className="voices-count">{FEATURED_SAMPLES.length} samples · default settings</p>
        </div>
        <ul className="voices samples" aria-label="Voice samples">
          {FEATURED_SAMPLES.map((s, i) => {
            const v = getVoiceById(s.id);
            if (!v) return null;
            const code = languageOf(v.locale);
            const isOn = playing === v.id;
            return (
              <li
                key={v.id}
                className="voice"
                data-playing={isOn ? '' : undefined}
                style={{ '--i': Math.min(i, 12) } as CSSProperties}
              >
                <div className="voice-top">
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <span>{v.locale}</span>
                </div>
                <p className="voice-name">{v.name}</p>
                <p className="voice-style">{code === 'en' ? `English, ${regionLabel(v.locale, labels)}` : labels.name[code]}</p>
                {s.line ? (
                  <p className="voice-line" lang={v.locale} dir="auto">
                    {s.line}
                  </p>
                ) : null}
                <div className="voice-foot">
                  <span className="voice-meta">
                    {isOn ? (
                      <>
                        <span className="eq" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                        Playing
                      </>
                    ) : (
                      `${genderLabel(v.gender)}${v.multilingual ? ' · Multilingual' : ''}`
                    )}
                  </span>
                  <button
                    type="button"
                    className="voice-play"
                    aria-pressed={isOn}
                    aria-label={`${isOn ? 'Pause' : 'Play'} ${v.name} (${labels.name[code]}) sample`}
                    onClick={() => toggle(v.id)}
                  >
                    <PlayIcon on={isOn} />
                  </button>
                </div>
                <span className="voice-progress" aria-hidden="true">
                  <span style={{ transform: `scaleX(${isOn ? progress : 0})` }} />
                </span>
              </li>
            );
          })}
        </ul>

        {/* ---------- Language browser ---------- */}
        <div className="lb" data-reveal>
          <div className="lb-index">
            <div className="lb-search">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <label htmlFor={`${uid}-q`} className="sr-only">
                Search languages or voices
              </label>
              <input
                id={`${uid}-q`}
                type="search"
                placeholder={`Search ${LANGUAGE_COUNT} languages or voices`}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="lb-meta" aria-live="polite">
              {query1
                ? `${matchCount} ${matchCount === 1 ? 'language' : 'languages'}`
                : `${LANGUAGE_COUNT} languages · ${LOCALE_COUNT} locales`}
            </p>
            <div className="lb-scroll">
              {matchCount === 0 ? (
                <p className="lb-empty">No language or voice matches “{query.trim()}”.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="lb-group">
                    <p className="lb-glabel">{g.label}</p>
                    <ul className="lb-list">
                      {g.items.map((l) => {
                        const nn = l.native;
                        return (
                          <li key={l.code}>
                            <button
                              type="button"
                              className="lb-lang"
                              aria-pressed={l.code === current.code}
                              aria-controls={`${uid}-panel`}
                              onClick={() => pick(l)}
                            >
                              <span className="lb-lname">{l.name}</span>
                              {nn ? (
                                <span className="lb-lnative" lang={l.code}>
                                  {nn}
                                </span>
                              ) : null}
                              <span className="lb-lcount" aria-label={`${l.voiceCount} voices`}>
                                {l.voiceCount}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            ref={panelRef}
            id={`${uid}-panel`}
            className="lb-panel"
            role="region"
            aria-labelledby={`${uid}-ptitle`}
            key={current.code}
          >
            <div className="lb-phead">
              <div>
                <p className="lb-pkicker">
                  {current.code} · {current.locales.length} {current.locales.length === 1 ? 'locale' : 'locales'}
                </p>
                <h3 className="lb-ptitle" id={`${uid}-ptitle`}>
                  {current.name}
                  {native ? (
                    <>
                      {' '}
                      <em lang={current.code}>{native}</em>
                    </>
                  ) : null}
                </h3>
              </div>
              <p className="lb-pcount">
                <b>{voices.length}</b> {voices.length === 1 ? 'voice' : 'voices'}
              </p>
            </div>

            <ul className="lb-voices">
              {shown.map((v) => {
                const sample = SAMPLE_IDS.has(v.id);
                const isOn = playing === v.id;
                const hit = query1 && fold(v.name).includes(query1);
                return (
                  <li
                    key={v.id}
                    className="lb-voice"
                    data-playing={isOn ? '' : undefined}
                    data-hit={hit ? '' : undefined}
                  >
                    <span className="lb-vname">
                      <b>{v.name}</b>
                      {v.multilingual ? <span className="lb-badge">Multilingual</span> : null}
                    </span>
                    <span className="lb-vloc">
                      {regionLabel(v.locale, labels)} <small>{v.locale}</small>
                    </span>
                    <span className="lb-vmeta">
                      <span className="lb-vgen">{genderLabel(v.gender)}</span>
                      <span className="lb-vtags">{v.tags?.slice(0, 3).join(' · ')}</span>
                    </span>
                    <span className="lb-vact">
                      {sample ? (
                        <button
                          type="button"
                          className="voice-play is-sm"
                          aria-pressed={isOn}
                          aria-label={`${isOn ? 'Pause' : 'Play'} ${v.name} sample`}
                          onClick={() => toggle(v.id)}
                        >
                          <PlayIcon on={isOn} />
                        </button>
                      ) : null}
                      <a
                        href="#try"
                        className="lb-try"
                        aria-label={`Try ${v.name} (${regionLabel(v.locale, labels)}) in the demo`}
                        onClick={() => requestDemoVoice(v.id)}
                      >
                        Try
                        <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
            {voices.length > COLLAPSED ? (
              <button type="button" className="lb-more" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
                {expanded ? 'Show fewer' : `Show all ${voices.length} ${current.name} voices`}
              </button>
            ) : null}
          </div>
        </div>

        <audio
          ref={audioRef}
          src={playing ? `/samples/${playing}.mp3` : undefined}
          preload="none"
          onPlay={(e) => pauseOtherAudio(e.currentTarget)}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
          onEnded={() => {
            setPlaying(null);
            setProgress(0);
          }}
          onPause={(e) => {
            if (!e.currentTarget.ended && e.currentTarget.paused && e.currentTarget.currentTime > 0) setPlaying(null);
          }}
          hidden
        />
        <p className="voices-note">
          <span className="voices-note-mark" aria-hidden="true">
            <Play size={10} strokeWidth={2.4} />
          </span>
          Samples are unedited renders by Magalar. Every voice can be tried in the demo or previewed in the studio.
        </p>
      </div>
    </section>
  );
}
