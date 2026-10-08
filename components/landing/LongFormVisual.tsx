'use client';

import { useEffect, useRef, type CSSProperties } from 'react';

const LANES = [
  { d: 1.5, w: 0.08 },
  { d: 2.1, w: 0.0 },
  { d: 1.2, w: 0.16 },
  { d: 2.4, w: 0.04 },
  { d: 1.7, w: 0.12 },
  { d: 1.9, w: 0.2 },
];
const FINISH = Math.max(...LANES.map((l) => l.d + l.w)); // seconds

const WAVE = Array.from({ length: 72 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.9) * 0.55 + Math.sin(i * 0.23 + 1) * 0.45);
  return Math.round((0.14 + v * 0.86) * 100);
});

/**
 * Split → parallel → stitch diagram. The SSR state is the finished diagram; with JS and
 * motion allowed it replays whenever it scrolls into view.
 */
export function LongFormVisual() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timers: number[] = [];
    let inView = false;
    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const cycle = () => {
      clear();
      if (!inView) return;
      el.dataset.run = 'idle';
      timers.push(
        window.setTimeout(() => {
          el.dataset.run = 'go';
        }, 120),
      );
      timers.push(window.setTimeout(cycle, (FINISH + 4.2) * 1000));
    };
    if (el.getBoundingClientRect().top > window.innerHeight) el.dataset.run = 'idle';
    const io = new IntersectionObserver(
      (entries) => {
        const was = inView;
        inView = entries[0].isIntersecting;
        if (inView && !was) cycle();
        if (!inView) clear();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clear();
      el.dataset.run = 'done';
    };
  }, []);

  return (
    <div
      ref={ref}
      className="lf-vis"
      data-run="done"
      style={{ '--finish': `${FINISH}s` } as CSSProperties}
      role="img"
      aria-label="Diagram: a long script is split at sentence boundaries into chunks, the chunks are synthesized in parallel, then stitched into one seamless MP3."
    >
      <div className="lf-col lf-text" aria-hidden="true">
        <p className="lf-col-label">
          <span>01</span> Split at sentences
        </p>
        <div className="lf-doc">
          {LANES.map((_, i) => (
            <div className="lf-para" key={i} style={{ '--i': i } as CSSProperties}>
              <span className="lf-tag">{String(i + 1).padStart(2, '0')}</span>
              <span className="lf-lines">
                <i style={{ width: `${88 - ((i * 13) % 20)}%` }} />
                <i style={{ width: `${54 + ((i * 17) % 34)}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="lf-col lf-par" aria-hidden="true">
        <p className="lf-col-label">
          <span>02</span> Synthesize in parallel
        </p>
        <ol className="lf-lanes">
          {LANES.map((l, i) => (
            <li key={i}>
              <span className="lf-lane-id">{String(i + 1).padStart(2, '0')}</span>
              <span className="lf-lane">
                <i style={{ '--d': `${l.d}s`, '--w': `${l.w}s` } as CSSProperties} />
              </span>
              <span className="lf-lane-ok" style={{ '--t': `${l.d + l.w}s` } as CSSProperties}>
                ✓
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="lf-col lf-out" aria-hidden="true">
        <p className="lf-col-label">
          <span>03</span> Stitch into one MP3
        </p>
        <div className="lf-merged">
          <div className="lf-wave">
            {WAVE.map((h, i) => (
              <i key={i} style={{ height: `${h}%`, '--k': `${i * 9}ms` } as CSSProperties} />
            ))}
          </div>
          <div className="lf-seams">
            {LANES.slice(1).map((_, i) => (
              <i key={i} style={{ left: `${((i + 1) / LANES.length) * 100}%` }} />
            ))}
          </div>
        </div>
        <p className="lf-file">
          <b>manuscript.mp3</b>
          <span>6 chunks → 1 file</span>
        </p>
      </div>
    </div>
  );
}
