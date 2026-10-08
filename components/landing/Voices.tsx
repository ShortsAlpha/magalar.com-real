'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import { VOICES } from '@/lib/constants';
import { Eyebrow, Split } from './Split';

/** Voices with a real, unedited one-sentence sample rendered by Magalar (public/samples). */
const SAMPLES = new Set([
  'en-US-AriaNeural',
  'en-GB-RyanNeural',
  'en-AU-NatashaNeural',
  'en-CA-ClaraNeural',
  'en-IE-ConnorNeural',
  'en-US-AndrewNeural',
]);

const ACCENTS = [
  { code: 'all', label: 'All' },
  { code: 'US', label: 'American' },
  { code: 'UK', label: 'British' },
  { code: 'AU', label: 'Australian' },
  { code: 'CA', label: 'Canadian' },
  { code: 'IE', label: 'Irish' },
] as const;
type Accent = (typeof ACCENTS)[number]['code'];

const ACCENT_NAME: Record<string, string> = {
  US: 'American',
  UK: 'British',
  AU: 'Australian',
  CA: 'Canadian',
  IE: 'Irish',
};

const locale = (id: string) => id.split('-').slice(0, 2).join('-');

export function Voices() {
  const [accent, setAccent] = useState<Accent>('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const list = useMemo(
    () => VOICES.map((v, i) => ({ ...v, index: i + 1 })).filter((v) => accent === 'all' || v.country === accent),
    [accent],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: VOICES.length };
    VOICES.forEach((v) => (c[v.country] = (c[v.country] ?? 0) + 1));
    return c;
  }, []);

  // A single <audio> element; `playing` drives its src and play/pause state.
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
              Twenty-three voices. Five <em>accents.</em>
            </Split>
          </h2>
          <p className="lede" data-reveal>
            Natural English neural voices from the US, the UK, Australia, Canada and Ireland. Press play on the marked
            voices to hear an unedited one-sentence sample. Every voice can be previewed in the studio.
          </p>
        </header>

        <div className="voices-bar">
          <div className="chips" role="group" aria-label="Filter voices by accent">
            {ACCENTS.map((a) => (
              <button
                key={a.code}
                type="button"
                className="chip"
                aria-pressed={accent === a.code}
                onClick={() => setAccent(a.code)}
              >
                {a.label}
                <span className="chip-count">{counts[a.code] ?? 0}</span>
              </button>
            ))}
          </div>
          <p className="voices-count" aria-live="polite">
            {list.length} {list.length === 1 ? 'voice' : 'voices'}
            {accent !== 'all' ? ` · ${ACCENT_NAME[accent]}` : ''}
          </p>
        </div>

        <ul className="voices" key={accent}>
          {list.map((v, i) => {
            const sample = SAMPLES.has(v.id);
            const isOn = playing === v.id;
            return (
              <li
                key={v.id}
                className="voice"
                data-playing={isOn ? '' : undefined}
                style={{ '--i': Math.min(i, 12) } as CSSProperties}
              >
                <div className="voice-top">
                  <span>{String(v.index).padStart(2, '0')}</span>
                  <span>{locale(v.id)}</span>
                </div>
                <p className="voice-name">{v.name}</p>
                <p className="voice-style">{v.style}</p>
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
                      `${ACCENT_NAME[v.country]} · ${v.gender}`
                    )}
                  </span>
                  {sample ? (
                    <button
                      type="button"
                      className="voice-play"
                      aria-pressed={isOn}
                      aria-label={`${isOn ? 'Pause' : 'Play'} ${v.name} sample`}
                      onClick={() => toggle(v.id)}
                    >
                      {isOn ? (
                        <Pause size={14} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <Play size={14} strokeWidth={2} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span className="voice-glyph" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
                {sample ? (
                  <span className="voice-progress" aria-hidden="true">
                    <span style={{ transform: `scaleX(${isOn ? progress : 0})` }} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <audio
          ref={audioRef}
          src={playing ? `/samples/${playing}.mp3` : undefined}
          preload="none"
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
          Sample available · Samples rendered by Magalar at default speed, pitch and volume.
        </p>
      </div>
    </section>
  );
}
