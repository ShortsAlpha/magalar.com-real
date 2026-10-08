'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, Check, FileArchive, FileUp, Image as ImageIcon, ListTree } from 'lucide-react';

const NODES = [
  { icon: FileUp, title: 'Upload .docx', detail: 'One file or a batch' },
  { icon: ListTree, title: 'Parse scenes', detail: '“Scene N” · “Spoken script:”' },
  { icon: AudioLines, title: 'Voice every scene', detail: '01.mp3 · 01.srt · 01.vtt' },
  { icon: ImageIcon, title: 'Extract images', detail: '01_1.png, 03_1.png …' },
  { icon: FileArchive, title: 'Download ZIP', detail: 'One ZIP per document' },
];

const STATUS = [
  'Queued · module-01.docx, module-02.docx, module-03.docx',
  'Parsing module-01.docx · scenes found',
  'Voicing each scene as a numbered MP3 with subtitles',
  'Extracting embedded images per scene',
  'module-01.zip ready · module-02.docx up next',
];

const STEP_MS = 1150;
const DONE = NODES.length;

export function Pipeline() {
  // SSR / no-JS / reduced motion: the finished run.
  const [step, setStep] = useState(DONE);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    let inView = false;
    const run = (i: number) => {
      if (!inView || document.hidden) return;
      setStep(i);
      if (i < DONE) timer = window.setTimeout(() => run(i + 1), i < 0 ? 700 : STEP_MS);
      else timer = window.setTimeout(() => run(-1), 3200);
    };
    const io = new IntersectionObserver(
      (entries) => {
        const was = inView;
        inView = entries[0].isIntersecting;
        if (inView && !was) {
          clearTimeout(timer);
          run(-1);
        } else if (!inView) {
          clearTimeout(timer);
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const status = step < 0 ? 'Waiting for documents…' : STATUS[Math.min(step, DONE - 1)];
  const done = step >= DONE;

  return (
    <div ref={ref} className="pipe" data-step={step}>
      <ol className="pipe-nodes">
        {NODES.map((n, i) => {
          const Icon = n.icon;
          const state = i < step ? 'done' : i === step ? 'live' : 'idle';
          return (
            <li key={n.title} className="pipe-node" data-state={state} style={{ '--i': i } as CSSProperties}>
              <span className="pipe-icon" aria-hidden="true">
                {state === 'done' ? <Check size={18} strokeWidth={1.75} /> : <Icon size={18} strokeWidth={1.5} />}
              </span>
              <span className="pipe-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="pipe-title">{n.title}</span>
              <span className="pipe-detail">{n.detail}</span>
              {i < NODES.length - 1 ? <span className="pipe-link" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="pipe-foot">
        <p className="pipe-status" data-done={done ? '' : undefined}>
          <i className="pipe-led" aria-hidden="true" />
          <span>{status}</span>
        </p>
        <ul className="pipe-queue" aria-label="Example batch queue">
          <li data-state={step >= DONE - 1 ? 'done' : step >= 0 ? 'live' : 'idle'}>
            <span>module-01.docx</span>
            <span>{step >= DONE - 1 ? 'ZIP ready' : step >= 0 ? 'Processing' : 'Queued'}</span>
          </li>
          <li data-state={step >= DONE ? 'live' : 'idle'}>
            <span>module-02.docx</span>
            <span>{step >= DONE ? 'Processing' : 'Queued'}</span>
          </li>
          <li data-state="idle">
            <span>module-03.docx</span>
            <span>Queued</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
