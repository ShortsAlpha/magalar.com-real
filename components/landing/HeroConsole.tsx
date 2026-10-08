'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

/* --------------------------------------------------------------------------
   Hero visual: a precise, monochrome mock of the Magalar studio.
   Loop: tune → generate (12 chunks in parallel) → stitch → play → done.
   A canvas waveform reacts subtly to the pointer. Static frame on SSR and
   under prefers-reduced-motion.
   -------------------------------------------------------------------------- */

const SCRIPT =
  'Every great film starts with a voice. Paste your script, choose a narrator and tune the delivery until it sounds right. Magalar splits long text at sentence boundaries, renders every chunk in parallel and stitches the result into one seamless MP3.';
const WORDS = SCRIPT.split(' ');
const CHARS = SCRIPT.length.toLocaleString('en-US');

const CAST = [
  { name: 'Aria', locale: 'en-US', gender: 'Female', style: 'Expressive', speed: 1.0, pitch: 0, volume: 0 },
  { name: 'Ryan', locale: 'en-GB', gender: 'Male', style: 'British', speed: 1.1, pitch: -4, volume: 10 },
  { name: 'Natasha', locale: 'en-AU', gender: 'Female', style: 'Aussie', speed: 0.95, pitch: 3, volume: 5 },
  { name: 'Connor', locale: 'en-IE', gender: 'Male', style: 'Irish', speed: 1.05, pitch: -2, volume: 0 },
  { name: 'Clara', locale: 'en-CA', gender: 'Female', style: 'Canadian', speed: 1.15, pitch: 6, volume: 15 },
] as const;

const N = 12; // chunks
const T = { gen: 1700, stitch: 4500, play: 5100, done: 10600, end: 12400 } as const;
const STATIC_PLAY = 0.42;

type Phase = 'tune' | 'gen' | 'stitch' | 'play' | 'done';
type ChunkState = 'p' | 'a' | 'd';

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-loop chunk schedule: dispatched almost together, finishing out of order. */
function plan(loop: number) {
  const r = rng(loop * 7919 + 13);
  const start: number[] = [];
  const end: number[] = [];
  for (let k = 0; k < N; k++) {
    const s = T.gen + 120 + k * 60 + r() * 140;
    start.push(s);
    end.push(Math.min(T.stitch - 120, s + 700 + r() * 1900));
  }
  return { start, end };
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

type Frame = {
  loop: number;
  t: number;
  phase: Phase;
  tune: number;
  chunks: ChunkState[];
  doneAt: number[];
  play: number;
};

const plans = new Map<number, ReturnType<typeof plan>>();
function getPlan(loop: number) {
  let p = plans.get(loop);
  if (!p) {
    p = plan(loop);
    plans.set(loop, p);
    if (plans.size > 4) plans.delete(plans.keys().next().value as number);
  }
  return p;
}

function frameAt(elapsed: number): Frame {
  const loop = Math.floor(elapsed / T.end);
  const t = elapsed - loop * T.end;
  const phase: Phase = t < T.gen ? 'tune' : t < T.stitch ? 'gen' : t < T.play ? 'stitch' : t < T.done ? 'play' : 'done';
  const p = getPlan(loop);
  const chunks: ChunkState[] = [];
  for (let k = 0; k < N; k++) chunks.push(t < p.start[k] ? 'p' : t < p.end[k] ? 'a' : 'd');
  return {
    loop,
    t,
    phase,
    tune: ease((t - 250) / 1200),
    chunks,
    doneAt: p.end,
    play: phase === 'play' ? (t - T.play) / (T.done - T.play) : phase === 'done' ? 1 : 0,
  };
}

const STATIC_ELAPSED = T.play + STATIC_PLAY * (T.done - T.play);

type Snap = { loop: number; phase: Phase; tune: number; chunks: string; lit: number; play: number };
function toSnap(f: Frame): Snap {
  return {
    loop: f.loop,
    phase: f.phase,
    tune: Math.round(f.tune * 40) / 40,
    chunks: f.chunks.join(''),
    lit: f.phase === 'play' ? Math.floor(f.play * WORDS.length) : f.phase === 'done' ? WORDS.length : -1,
    play: Math.floor(f.play * 40) / 40,
  };
}
const snapKey = (s: Snap) => `${s.loop}|${s.phase}|${s.tune}|${s.chunks}|${s.lit}|${s.play}`;

const fmt = (sec: number) => `00:${String(Math.max(0, Math.floor(sec))).padStart(2, '0')}`;
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`;

/** Speech-like amplitude envelope: syllable bumps, word gaps and sentence pauses. */
function buildAmps(count: number) {
  const r = rng(424242);
  const a = new Float32Array(count);
  let i = 0;
  while (i < count) {
    const len = 3 + Math.floor(r() * 7);
    const peak = 0.35 + r() * 0.65;
    for (let k = 0; k < len && i < count; k++, i++) {
      const bump = Math.sin((Math.PI * (k + 0.5)) / len);
      a[i] = Math.max(0.06, peak * (0.55 + 0.45 * bump) * (0.75 + r() * 0.25));
    }
    const gap = r() < 0.12 ? 4 + Math.floor(r() * 3) : r() < 0.6 ? 1 : 0;
    for (let k = 0; k < gap && i < count; k++, i++) a[i] = 0.03 + r() * 0.03;
  }
  return a;
}

export function HeroConsole() {
  const [snap, setSnap] = useState<Snap>(() => toSnap(frameAt(STATIC_ELAPSED)));
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let amps = new Float32Array(0);
    let elapsed = STATIC_ELAPSED;
    let last = 0;
    let raf = 0;
    let running = false;
    let inView = true;
    let lastKey = snapKey(toSnap(frameAt(elapsed)));
    const ptr = { x: -1, tx: -1, k: 0, tk: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      amps = buildAmps(Math.max(24, Math.floor(W / 4)));
    };

    const draw = (f: Frame) => {
      ctx.clearRect(0, 0, W, H);
      const n = amps.length;
      const step = W / n;
      const bw = Math.max(1, Math.min(2, step * 0.55));
      const mid = H / 2;
      const playX = f.play * W;
      ptr.x += (ptr.tx - ptr.x) * 0.12;
      ptr.k += (ptr.tk - ptr.k) * 0.08;

      for (let i = 0; i < n; i++) {
        const x = i * step + (step - bw) / 2;
        const c = Math.min(N - 1, Math.floor((i / n) * N));
        let amp = amps[i];
        let alpha = 0.42;

        if (f.phase === 'tune') {
          amp = 0.02;
          alpha = 0.22;
        } else if (f.phase === 'gen') {
          const s = f.chunks[c];
          if (s === 'p') {
            amp = 0.02;
            alpha = 0.22;
          } else if (s === 'a') {
            amp = amps[i] * (0.12 + 0.1 * Math.sin(f.t / 90 + i * 0.7));
            alpha = 0.3;
          } else {
            amp = amps[i] * ease((f.t - f.doneAt[c]) / 260);
            alpha = 0.45;
          }
        } else if (f.phase === 'play') {
          alpha = x < playX ? 1 : 0.38;
        } else if (f.phase === 'done') {
          alpha = 0.9;
        }

        if (ptr.k > 0.01 && f.phase !== 'tune') {
          const d = (x - ptr.x) / 46;
          amp *= 1 + 0.55 * ptr.k * Math.exp(-d * d);
        }
        const h = Math.max(1.5, Math.min(1, amp) * (H - 6));
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(x, mid - h / 2, bw, h);
      }

      // stitch seams fading out
      if (f.phase === 'stitch') {
        const k = 1 - (f.t - T.stitch) / (T.play - T.stitch);
        ctx.fillStyle = `rgba(255,255,255,${(0.6 * k).toFixed(3)})`;
        for (let c = 1; c < N; c++) ctx.fillRect(Math.round((c / N) * W), 0, 1, H);
      }
      // playhead
      if (f.phase === 'play') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(playX), 0, 1, H);
      }
      // hover line
      if (ptr.k > 0.02) {
        ctx.fillStyle = `rgba(255,255,255,${(0.28 * ptr.k).toFixed(3)})`;
        ctx.fillRect(Math.round(ptr.x), 0, 1, H);
      }
    };

    const loop = (now: number) => {
      raf = 0;
      if (!running) return;
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      elapsed += dt;
      const f = frameAt(elapsed);
      draw(f);
      const s = toSnap(f);
      const key = snapKey(s);
      if (key !== lastKey) {
        lastKey = key;
        setSnap(s);
      }
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduced) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const sync = () => (inView && !document.hidden ? start() : stop());

    resize();
    draw(frameAt(elapsed));

    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(frameAt(elapsed));
    });
    ro.observe(canvas);

    const io = new IntersectionObserver((e) => {
      inView = e[0].isIntersecting;
      sync();
    });
    io.observe(root);
    document.addEventListener('visibilitychange', sync);

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      ptr.tx = e.clientX - r.left;
      if (ptr.x < 0) ptr.x = ptr.tx;
      ptr.tk = 1;
    };
    const onLeave = () => {
      ptr.tk = 0;
    };
    if (!reduced) {
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerleave', onLeave);
    }
    sync();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  const voice = CAST[snap.loop % CAST.length];
  const prev = CAST[(snap.loop + CAST.length - 1) % CAST.length];
  const lerp = (a: number, b: number) => a + (b - a) * snap.tune;
  const speed = lerp(prev.speed, voice.speed);
  const pitch = Math.round(lerp(prev.pitch, voice.pitch));
  const volume = Math.round(lerp(prev.volume, voice.volume));
  const total = Math.round(WORDS.length / 2.6 / voice.speed);
  const done = snap.chunks.split('').filter((c) => c === 'd').length;
  const inFlight = snap.chunks.split('').filter((c) => c === 'a').length;

  const status =
    snap.phase === 'tune'
      ? 'Ready'
      : snap.phase === 'gen'
        ? `Generating ${done}/${N}`
        : snap.phase === 'stitch'
          ? `Stitching ${N} → 1`
          : snap.phase === 'play'
            ? 'Playing'
            : 'Done';

  const sliders = [
    { label: 'Speed', value: `${speed.toFixed(2)}×`, pos: (speed - 0.5) / 1.5 },
    { label: 'Pitch', value: signed(pitch, ' Hz'), pos: (pitch + 50) / 100 },
    { label: 'Volume', value: signed(volume, '%'), pos: (volume + 50) / 100 },
  ];

  return (
    <div
      ref={rootRef}
      className="cs"
      data-phase={snap.phase}
      role="img"
      aria-label="Animated preview of the Magalar studio: a script is assigned a voice, tuned for speed, pitch and volume, rendered as twelve chunks in parallel, stitched into one MP3 and played back."
    >
      <div className="cs-bar" aria-hidden="true">
        <span className="cs-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="cs-file">
          studio <b>/</b> launch-film.mp3
        </span>
        <span className="cs-status" data-phase={snap.phase}>
          <i className="cs-led" />
          {status}
        </span>
      </div>

      <div className="cs-body" aria-hidden="true">
        <div className="cs-script">
          <div className="cs-label">
            <span>Script</span>
            <span>{CHARS} / 50,000</span>
          </div>
          <p className="cs-text" data-karaoke={snap.lit >= 0 && snap.phase === 'play' ? '' : undefined}>
            {WORDS.map((w, i) => (
              <Fragment key={i}>
                <span className={i < snap.lit ? 'is-lit' : i === snap.lit ? 'is-now' : undefined}>{w}</span>{' '}
              </Fragment>
            ))}
          </p>
        </div>

        <div className="cs-side">
          <div className="cs-voice" key={snap.loop}>
            <span className="cs-avatar">{voice.name[0]}</span>
            <span className="cs-voice-meta">
              <b>{voice.name}</b>
              <small>
                {voice.locale} · {voice.gender} · {voice.style}
              </small>
            </span>
            <span className="cs-chev" />
          </div>

          <div className="cs-sliders">
            {sliders.map((s) => (
              <div className="cs-slider" key={s.label}>
                <div className="cs-slider-top">
                  <span>{s.label}</span>
                  <b>{s.value}</b>
                </div>
                <div className="cs-track">
                  <span className="cs-fill" style={{ transform: `scaleX(${s.pos.toFixed(3)})` }} />
                  <span className="cs-knob" style={{ left: `${(s.pos * 100).toFixed(2)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="cs-generate" data-phase={snap.phase}>
            <span>
              {snap.phase === 'tune'
                ? 'Generate'
                : snap.phase === 'gen' || snap.phase === 'stitch'
                  ? 'Generating…'
                  : 'Download MP3'}
            </span>
            <span className="cs-gen-meta">{snap.phase === 'gen' ? `${inFlight} in flight` : 'MP3'}</span>
          </div>
        </div>
      </div>

      <div className="cs-wave" aria-hidden="true">
        <div className="cs-wave-top">
          <span>{fmt(snap.phase === 'play' || snap.phase === 'done' ? snap.play * total : 0)}</span>
          <span className="cs-wave-name">
            {voice.name} · {voice.locale}
          </span>
          <span>{snap.phase === 'tune' || snap.phase === 'gen' ? '--:--' : fmt(total)}</span>
        </div>
        <canvas ref={canvasRef} className="cs-canvas" />
        <div className="cs-chunks">
          <span className="cs-chunks-label">Chunks</span>
          <ol>
            {snap.chunks.split('').map((c, i) => (
              <li key={i} data-s={c}>
                {String(i + 1).padStart(2, '0')}
              </li>
            ))}
          </ol>
          <span className="cs-chunks-count">{snap.phase === 'tune' ? `0/${N}` : `${done}/${N}`}</span>
        </div>
      </div>
    </div>
  );
}
