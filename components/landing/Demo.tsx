'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { LANGUAGES, LANGUAGE_COUNT, VOICE_COUNT, getVoiceById, languageOf } from '@/lib/voices';
import { Eyebrow, Split } from './Split';
import { LangCombo } from './LangCombo';
import {
  TRY_VOICE_EVENT,
  defaultVoiceFor,
  demoLineFor,
  genderLabel,
  isDemoLine,
  pauseOtherAudio,
  regionLabel,
  sortedVoicesFor,
  type Labels,
} from './catalog';

/* --------------------------------------------------------------------------
   "Try it" — public, no-sign-up demo (contract §5).
   POST {BACKEND}/demo {text, voice, turnstile_token} → audio/mpeg bytes.
   Turnstile loads lazily when the section nears the viewport and never blocks
   render; every request gets a fresh token and the widget is reset after use.
   -------------------------------------------------------------------------- */

const MAX = 200;
const BARS = 96;
const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').replace(/\/+$/, '');
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 90_000;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  execute: (id: string) => void;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
const tsGlobal = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

let tsPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  const ready = tsGlobal();
  if (ready) return Promise.resolve(ready);
  if (tsPromise) return tsPromise;
  tsPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      const t = tsGlobal();
      if (t) resolve(t);
      else reject(new Error('turnstile-missing'));
    };
    s.onerror = () => {
      tsPromise = null;
      s.remove();
      reject(new Error('turnstile-load'));
    };
    document.head.appendChild(s);
  });
  return tsPromise;
}

type Phase = 'idle' | 'verify' | 'gen' | 'ready' | 'error';
type ErrKind = 'empty' | 'limit' | 'verify' | 'unavailable' | 'network' | 'bad' | 'server' | 'blocked';
type Err = { kind: ErrKind; minutes?: number; message?: string };
type Clip = { url: string; voice: string; chars: number; peaks: number[] };

/* Deterministic placeholder silhouette (idle state, and fallback if decoding fails). */
function seeded(seed: number, n: number) {
  let s = seed | 0;
  const r = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const env = Math.sin((Math.PI * (i + 0.5)) / n) ** 0.6;
    out.push(Math.max(0.08, (0.25 + r() * 0.75) * env));
  }
  return out;
}
const IDLE = seeded(7, BARS);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
}

/** Real waveform peaks from the rendered MP3 (RMS per bucket, normalised). */
async function peaksFrom(blob: Blob, n: number): Promise<number[] | null> {
  try {
    const w = window as unknown as {
      OfflineAudioContext?: typeof OfflineAudioContext;
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    };
    const Ctx = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 1, 24000);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / n));
    const out: number[] = [];
    let max = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const start = i * size;
      for (let k = 0; k < size && start + k < data.length; k++) sum += data[start + k] ** 2;
      const rms = Math.sqrt(sum / size);
      out.push(rms);
      if (rms > max) max = rms;
    }
    return out.map((v) => Math.max(0.06, Math.sqrt(max ? v / max : 0)));
  } catch {
    return null;
  }
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function errText(e: Err): string {
  switch (e.kind) {
    case 'empty':
      return 'Type a line first, up to 200 characters.';
    case 'limit':
      return `You've hit the demo limit, try again in ${e.minutes ?? 10} min.`;
    case 'verify':
      return "We couldn't verify this browser. Please try again.";
    case 'blocked':
      return "The verification step couldn't load. Check your connection or allow challenges.cloudflare.com, then try again.";
    case 'unavailable':
      return 'The demo is taking a short break right now. The full studio is still open.';
    case 'network':
      return "Couldn't reach Magalar. Check your connection and try again.";
    case 'bad':
      return e.message || 'That text could not be rendered. Try a shorter line or another voice.';
    default:
      return 'Something went wrong on our side. Please try again in a moment.';
  }
}

export function Demo({ labels }: { labels: Labels }) {
  const uid = useId();
  const { isLoaded, isSignedIn } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;

  const [lang, setLang] = useState('en');
  const [voice, setVoice] = useState(() => defaultVoiceFor('en', labels));
  const [text, setText] = useState(() => demoLineFor('en'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<Err | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [duration, setDuration] = useState(0);

  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const tsBoxRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const widgetPromiseRef = useRef<Promise<{ ts: TurnstileApi; id: string }> | null>(null);
  const pendingRef = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const limitUntilRef = useRef(0);
  const touchedRef = useRef(false);
  const busy = phase === 'verify' || phase === 'gen';

  const voices = useMemo(() => sortedVoicesFor(lang, labels), [lang, labels]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof voices>();
    voices.forEach((v) => m.set(v.locale, [...(m.get(v.locale) ?? []), v]));
    return [...m.entries()];
  }, [voices]);

  /* ---------- language / voice ---------- */
  const applyLang = useCallback(
    (code: string, voiceId?: string) => {
      setLang(code);
      setVoice(voiceId ?? defaultVoiceFor(code, labels));
      // Prefill a line in the new language unless the visitor has written their own.
      setText((cur) => (touchedRef.current ? cur : demoLineFor(code)));
    },
    [labels],
  );

  // "Try this voice" from the Voices section.
  useEffect(() => {
    const onTry = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const v = id ? getVoiceById(id) : undefined;
      if (!v) return;
      applyLang(languageOf(v.locale), v.id);
    };
    window.addEventListener(TRY_VOICE_EVENT, onTry);
    return () => window.removeEventListener(TRY_VOICE_EVENT, onTry);
  }, [applyLang]);

  /* ---------- Turnstile: lazy load + render near the viewport ---------- */
  const renderWidget = useCallback(async () => {
    const ts = await loadTurnstile();
    if (widgetRef.current) return { ts, id: widgetRef.current };
    const box = tsBoxRef.current;
    if (!box) throw new Error('turnstile-box');
    const id = ts.render(box, {
      sitekey: SITE_KEY,
      action: 'demo',
      theme: 'dark',
      size: box.clientWidth < 300 ? 'compact' : 'flexible',
      appearance: 'interaction-only',
      execution: 'execute',
      callback: (token: string) => {
        pendingRef.current?.resolve(token);
        pendingRef.current = null;
      },
      'error-callback': (code?: string) => {
        // e.g. 110200 = hostname not allowed for this site key (see Cloudflare Turnstile error codes)
        console.warn('Turnstile error', code);
        pendingRef.current?.reject(new Error('turnstile-error'));
        pendingRef.current = null;
        return true;
      },
      'timeout-callback': () => {
        pendingRef.current?.reject(new Error('turnstile-timeout'));
        pendingRef.current = null;
      },
      'expired-callback': () => {},
      'before-interactive-callback': () => setInteractive(true),
      'after-interactive-callback': () => setInteractive(false),
    });
    if (!id) throw new Error('turnstile-render');
    widgetRef.current = id;
    return { ts, id };
  }, []);

  const ensureWidget = useCallback(() => {
    if (!widgetPromiseRef.current) {
      widgetPromiseRef.current = renderWidget().catch((e: unknown) => {
        widgetPromiseRef.current = null;
        throw e;
      });
    }
    return widgetPromiseRef.current;
  }, [renderWidget]);

  const resetWidget = useCallback(() => {
    pendingRef.current = null;
    setInteractive(false);
    const ts = tsGlobal();
    if (ts && widgetRef.current) {
      try {
        ts.reset(widgetRef.current);
      } catch {
        /* widget already gone */
      }
    }
  }, []);

  const getToken = useCallback(async () => {
    const { ts, id } = await ensureWidget();
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current = null;
        reject(new Error('turnstile-timeout'));
      }, TOKEN_TIMEOUT_MS);
      pendingRef.current = {
        resolve: (t) => {
          clearTimeout(timer);
          resolve(t);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      ts.execute(id);
    });
  }, [ensureWidget]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let done = false;
    const warm = () => {
      if (done) return;
      done = true;
      // Adapt to the visitor's language, unless they already chose something.
      if (!touchedRef.current) {
        const nav = (navigator.language || '').split('-')[0].toLowerCase();
        if (nav && nav !== 'en' && LANGUAGES.some((l) => l.code === nav)) applyLang(nav);
      }
      if (SITE_KEY) ensureWidget().catch(() => {});
    };
    if (typeof IntersectionObserver === 'undefined') {
      const t = window.setTimeout(warm, 1500);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          warm();
        }
      },
      { rootMargin: '250px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [applyLang, ensureWidget]);

  /* ---------- cleanup ---------- */
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const ts = tsGlobal();
      if (ts && widgetRef.current) {
        try {
          ts.remove(widgetRef.current);
        } catch {
          /* noop */
        }
      }
      widgetRef.current = null;
      widgetPromiseRef.current = null;
    },
    [],
  );

  /* ---------- generate ---------- */
  const generate = async () => {
    if (busy) return;
    const t = text.trim();
    if (!t) {
      setErr({ kind: 'empty' });
      setPhase('error');
      textRef.current?.focus();
      return;
    }
    const left = limitUntilRef.current - Date.now();
    if (left > 0) {
      setErr({ kind: 'limit', minutes: Math.max(1, Math.ceil(left / 60000)) });
      setPhase('error');
      return;
    }
    if (!BACKEND || !SITE_KEY) {
      setErr({ kind: 'unavailable' });
      setPhase('error');
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    audioRef.current?.pause();
    setErr(null);
    setPhase('verify');

    let token: string;
    try {
      token = await getToken();
    } catch (e) {
      if (ac.signal.aborted) return;
      resetWidget();
      const msg = e instanceof Error ? e.message : '';
      setErr({ kind: msg === 'turnstile-load' || msg === 'turnstile-missing' ? 'blocked' : 'verify' });
      setPhase('error');
      return;
    }
    if (ac.signal.aborted) return;
    setPhase('gen');

    try {
      const res = await fetch(`${BACKEND}/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, voice, turnstile_token: token }),
        signal: ac.signal,
      });
      const type = res.headers.get('content-type') ?? '';

      if (!res.ok || type.includes('json')) {
        const data = (await res.json().catch(() => null)) as {
          message?: unknown;
          retry_after?: unknown;
          status?: unknown;
        } | null;
        const message = typeof data?.message === 'string' ? data.message : undefined;
        let e: Err;
        if (res.status === 429) {
          const header = Number(res.headers.get('retry-after'));
          const raw = Number(data?.retry_after);
          const secs = Number.isFinite(raw) && raw > 0 ? raw : Number.isFinite(header) && header > 0 ? header : 600;
          limitUntilRef.current = Date.now() + secs * 1000;
          e = { kind: 'limit', minutes: Math.max(1, Math.ceil(secs / 60)) };
        } else if (res.status === 403) e = { kind: 'verify' };
        else if (res.status === 503 || res.status === 404 || res.status === 501) e = { kind: 'unavailable' };
        else if (res.status === 400 || res.status === 413 || res.status === 422) e = { kind: 'bad', message };
        else e = { kind: 'server' };
        setErr(e);
        setPhase('error');
        return;
      }

      const blob = await res.blob();
      if (!blob.size) throw new Error('empty-audio');
      if (ac.signal.aborted) return;
      const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'audio/mpeg' }));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      const peaks = (await peaksFrom(blob, BARS)) ?? seeded(hash(t + voice), BARS);
      if (ac.signal.aborted) return;
      setDuration(0);
      setClip({ url, voice, chars: t.length, peaks });
      setPhase('ready');
    } catch (e) {
      if (ac.signal.aborted) return;
      setErr({ kind: e instanceof TypeError ? 'network' : 'server' });
      setPhase('error');
    } finally {
      resetWidget();
    }
  };

  /* ---------- player ---------- */
  // Autoplay a fresh clip; if the browser refuses, the play button is right there.
  useEffect(() => {
    const a = audioRef.current;
    if (!clip || !a) return;
    a.currentTime = 0;
    waveRef.current?.style.setProperty('--p', '0');
    a.play().catch(() => {});
  }, [clip]);

  // Smooth progress while playing (CSS var + text, no re-render per frame).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && a.duration) {
        const p = a.currentTime / a.duration;
        waveRef.current?.style.setProperty('--p', p.toFixed(4));
        waveRef.current?.setAttribute('aria-valuenow', String(Math.round(a.currentTime)));
        waveRef.current?.setAttribute('aria-valuetext', `${fmt(a.currentTime)} of ${fmt(a.duration)}`);
        if (timeRef.current) timeRef.current.textContent = fmt(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const syncStatic = () => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    waveRef.current?.style.setProperty('--p', (a.currentTime / a.duration).toFixed(4));
    if (timeRef.current) timeRef.current.textContent = fmt(a.currentTime);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !clip) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seekTo = (ratio: number) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    a.currentTime = Math.min(a.duration, Math.max(0, ratio * a.duration));
    syncStatic();
  };

  /* ---------- derived UI ---------- */
  const v = getVoiceById(voice);
  const clipVoice = clip ? getVoiceById(clip.voice) : undefined;
  const chars = text.length;
  const status =
    phase === 'verify'
      ? 'Verifying'
      : phase === 'gen'
        ? 'Generating'
        : phase === 'error'
          ? err?.kind === 'limit'
            ? 'Limit reached'
            : 'Try again'
          : clip
            ? playing
              ? 'Playing'
              : 'Ready'
            : 'Idle';
  const liveMsg =
    phase === 'verify'
      ? interactive
        ? 'One quick check: confirm you are human below.'
        : 'Verifying your browser…'
      : phase === 'gen'
        ? `Generating with ${v?.name ?? 'the selected voice'}…`
        : phase === 'error' && err
          ? errText(err)
          : phase === 'ready' && clipVoice
            ? `Ready: ${clip?.chars} characters in ${clipVoice.name}'s voice.`
            : '';
  const showNudge = (phase === 'error' && (err?.kind === 'limit' || err?.kind === 'unavailable')) || played;
  const peaks = clip?.peaks ?? IDLE;

  const labelLang = `${uid}-lang`;
  const labelVoice = `${uid}-voice`;
  const counterId = `${uid}-count`;

  return (
    <section ref={sectionRef} className="sec inv demo-sec" id="try" aria-labelledby="try-title">
      <div className="wrap">
        <header className="sec-head">
          <Eyebrow>Try it · No sign-up</Eyebrow>
          <h2 className="h2" id="try-title" data-split>
            <Split>
              Type a line. Hear it <em>now.</em>
            </Split>
          </h2>
          <p className="lede" data-reveal>
            No account and no card. Write up to {MAX} characters, choose any of {VOICE_COUNT} voices in{' '}
            {LANGUAGE_COUNT} languages, and press Generate.
          </p>
        </header>

        <div className="demo" data-phase={phase} data-reveal>
          <div className="demo-bar">
            <span className="cs-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="demo-file">
              demo <b>/</b> {v ? `${v.name.toLowerCase()}-${v.locale.toLowerCase()}` : 'untitled'}.mp3
            </span>
            <span className="demo-status" data-phase={phase} data-playing={playing ? '' : undefined}>
              <i className="demo-led" aria-hidden="true" />
              {status}
            </span>
          </div>

          <form
            className="demo-body"
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <div className="demo-compose">
              <div className="demo-label">
                <label htmlFor={`${uid}-text`}>Your text</label>
                <span id={counterId} className="demo-count" data-near={chars > MAX - 20 ? '' : undefined}>
                  <span className="sr-only">Characters used: </span>
                  {chars} / {MAX}
                </span>
              </div>
              <textarea
                ref={textRef}
                id={`${uid}-text`}
                className="demo-text"
                dir="auto"
                lang={lang}
                rows={4}
                maxLength={MAX}
                value={text}
                spellCheck={false}
                aria-describedby={counterId}
                onChange={(e) => {
                  touchedRef.current = e.target.value.trim() !== '' && !isDemoLine(e.target.value);
                  setText(e.target.value.slice(0, MAX));
                  if (phase === 'error' && err?.kind === 'empty') {
                    setErr(null);
                    setPhase(clip ? 'ready' : 'idle');
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void generate();
                  }
                }}
              />
              <p className="demo-hint">
                <kbd>Ctrl</kbd>
                <kbd>Enter</kbd>
                <span>to generate</span>
              </p>
            </div>

            <div className="demo-side">
              <div className="demo-field">
                <span className="demo-flabel" id={labelLang}>
                  Language
                </span>
                <LangCombo value={lang} onChange={(c) => applyLang(c)} labelId={labelLang} labels={labels} />
              </div>

              <div className="demo-field">
                <label className="demo-flabel" id={labelVoice} htmlFor={`${uid}-vsel`}>
                  Voice <span>{voices.length}</span>
                </label>
                <div className="demo-select">
                  <select id={`${uid}-vsel`} value={voice} onChange={(e) => setVoice(e.target.value)}>
                    {groups.length > 1
                      ? groups.map(([locale, list]) => (
                          <optgroup key={locale} label={regionLabel(locale, labels)}>
                            {list.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name} · {genderLabel(o.gender)}
                                {o.multilingual ? ' · Multilingual' : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      : voices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} · {genderLabel(o.gender)}
                            {o.multilingual ? ' · Multilingual' : ''}
                          </option>
                        ))}
                  </select>
                  <span className="lc-chev" aria-hidden="true" />
                </div>
                {v ? (
                  <p className="demo-vmeta">
                    {regionLabel(v.locale, labels)} · {v.locale}
                  </p>
                ) : null}
              </div>

              <button type="submit" className="demo-go" disabled={busy} aria-describedby={`${uid}-live`}>
                <span>{phase === 'verify' ? 'Verifying…' : phase === 'gen' ? 'Generating…' : 'Generate'}</span>
                <span className="demo-go-meta">{busy ? <i className="demo-spin" aria-hidden="true" /> : 'Free'}</span>
              </button>
              <div ref={tsBoxRef} className="demo-ts" data-on={interactive ? '' : undefined} />
            </div>
          </form>

          <div className="demo-player" data-has={clip ? '' : undefined} data-playing={playing ? '' : undefined}>
            <button
              type="button"
              className="demo-play"
              onClick={toggle}
              disabled={!clip}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <Pause size={18} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Play size={18} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            <div className="demo-track">
              <div className="demo-track-top" aria-hidden="true">
                <span ref={timeRef}>00:00</span>
                <span className="demo-track-name">
                  {clipVoice ? `${clipVoice.name} · ${clipVoice.locale}` : 'Your clip appears here'}
                </span>
                <span>{clip && duration ? fmt(duration) : '--:--'}</span>
              </div>
              <div
                ref={waveRef}
                className="demo-wave"
                role="slider"
                tabIndex={clip ? 0 : -1}
                aria-label="Seek"
                aria-disabled={!clip}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={0}
                style={{ '--p': 0 } as CSSProperties}
                onPointerDown={(e) => {
                  if (!clip) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  seekTo((e.clientX - r.left) / r.width);
                }}
                onKeyDown={(e) => {
                  const a = audioRef.current;
                  if (!clip || !a || !a.duration) return;
                  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
                  if (step) {
                    e.preventDefault();
                    seekTo((a.currentTime + step) / a.duration);
                  } else if (e.key === 'Home' || e.key === 'End') {
                    e.preventDefault();
                    seekTo(e.key === 'Home' ? 0 : 1);
                  } else if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                <span className="demo-bars" aria-hidden="true">
                  {peaks.map((h, i) => (
                    <i key={i} style={{ '--h': h.toFixed(3), '--k': i } as CSSProperties} />
                  ))}
                </span>
                <span className="demo-bars is-top" aria-hidden="true">
                  {peaks.map((h, i) => (
                    <i key={i} style={{ '--h': h.toFixed(3) } as CSSProperties} />
                  ))}
                </span>
                <span className="demo-head" aria-hidden="true" />
              </div>
            </div>
            <audio
              ref={audioRef}
              src={clip?.url}
              preload="auto"
              onPlay={(e) => {
                pauseOtherAudio(e.currentTarget);
                setPlaying(true);
              }}
              onPlaying={() => setPlayed(true)}
              onPause={() => {
                setPlaying(false);
                syncStatic();
              }}
              onEnded={() => {
                setPlaying(false);
                waveRef.current?.style.setProperty('--p', '1');
              }}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              hidden
            />
          </div>

          <div className="demo-foot">
            <p id={`${uid}-live`} className="demo-msg" role="status" aria-live="polite" data-kind={err?.kind}>
              {liveMsg || 'A few short tries per hour without an account. Demo audio is never stored.'}
            </p>
            {showNudge ? (
              <p className="demo-nudge">
                {signedIn ? (
                  <Link href="/studio">
                    Need longer renders, subtitles and your library? <b>Open Studio</b>
                    <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link href="/sign-up">
                    Want 50,000 characters, subtitles and a library? <b>Create a free account</b>
                    <ArrowRight size={15} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                )}
              </p>
            ) : null}
          </div>
        </div>

        <ul className="demo-notes" aria-label="Demo details">
          <li>Up to {MAX} characters per try</li>
          <li>A few tries per hour, no account</li>
          <li>Audio is not stored</li>
          <li>Protected by Cloudflare Turnstile</li>
        </ul>
      </div>
    </section>
  );
}
