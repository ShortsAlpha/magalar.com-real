'use client';

import { useEffect } from 'react';

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Progressive-enhancement motion layer for the landing page. Renders nothing.
 *
 * - Reveals: only elements that are still BELOW the fold at mount get the hidden
 *   "armed" state, so nothing visible ever flashes away, and if JS never runs every
 *   element simply stays visible.
 * - Count-ups, magnetic buttons and card tilt.
 * - Everything is skipped under prefers-reduced-motion.
 */
export function Motion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.lp');
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: Array<() => void> = [];

    /* ---------- In-page anchors: smooth scroll + move focus to the section ---------- */
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (!a || !root.contains(a)) return;
      const id = (a.getAttribute('href') ?? '').slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      // Two frames: lets the mobile menu close and release its scroll lock first.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const top = id === 'top' ? 0 : target.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
          if (id !== 'top') {
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
          }
        }),
      );
      history.pushState(null, '', `#${id}`);
    };
    document.addEventListener('click', onClick);
    cleanups.push(() => document.removeEventListener('click', onClick));

    if (reduced) return () => cleanups.forEach((f) => f());
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const vh = window.innerHeight;
    const hasIO = 'IntersectionObserver' in window;

    /* ---------- Reveals ---------- */
    if (hasIO) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              io.unobserve(e.target);
            }
          }
        },
        { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
      );
      root.querySelectorAll<HTMLElement>('[data-reveal], [data-split]').forEach((el) => {
        if (el.getBoundingClientRect().top < vh * 0.92) return; // already on screen: leave it alone
        if (el.hasAttribute('data-reveal') && el.parentElement) {
          const sibs = Array.from(el.parentElement.children).filter((c) => c.hasAttribute('data-reveal'));
          const idx = sibs.indexOf(el);
          if (sibs.length > 1 && idx > 0) el.style.setProperty('--rd', `${Math.min(idx * 0.07, 0.42)}s`);
        }
        el.classList.add('is-armed');
        io.observe(el);
      });
      cleanups.push(() => io.disconnect());
    }

    /* ---------- Count-ups ---------- */
    if (hasIO) {
      const raf: number[] = [];
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            const el = e.target as HTMLElement;
            const to = Number(el.dataset.count);
            const t0 = performance.now();
            const dur = 2000;
            const tick = (now: number) => {
              const p = Math.min(1, (now - t0) / dur);
              el.textContent = Math.round(to * easeOutExpo(p)).toLocaleString('en-US');
              if (p < 1) raf.push(requestAnimationFrame(tick));
            };
            raf.push(requestAnimationFrame(tick));
          }
        },
        { threshold: 0.5 },
      );
      root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
        if (el.getBoundingClientRect().top < vh) return;
        el.textContent = '0';
        io.observe(el);
      });
      cleanups.push(() => {
        io.disconnect();
        raf.forEach(cancelAnimationFrame);
        root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
          el.textContent = Number(el.dataset.count).toLocaleString('en-US');
        });
      });
    }

    if (!fine) return () => cleanups.forEach((f) => f());

    /* ---------- Magnetic buttons ---------- */
    let mx = 0;
    let my = 0;
    let mraf = 0;
    const active = new Set<HTMLElement>();
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (mraf) return;
      mraf = requestAnimationFrame(() => {
        mraf = 0;
        root.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return;
          const dx = mx - (r.left + r.width / 2);
          const dy = my - (r.top + r.height / 2);
          const reach = Math.max(r.width, r.height) * 0.75 + 40;
          if (Math.hypot(dx, dy) < reach) {
            el.style.transform = `translate(${(dx * 0.22).toFixed(1)}px, ${(dy * 0.28).toFixed(1)}px)`;
            active.add(el);
          } else if (active.has(el)) {
            el.style.transform = '';
            active.delete(el);
          }
        });
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(mraf);
      active.forEach((el) => (el.style.transform = ''));
    });

    /* ---------- Tilt ---------- */
    root.querySelectorAll<HTMLElement>('[data-tilt]').forEach((card) => {
      let raf = 0;
      const move = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          card.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`);
          card.style.setProperty('--ry', `${((x - 0.5) * 6).toFixed(2)}deg`);
        });
      };
      const leave = () => {
        cancelAnimationFrame(raf);
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      };
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerleave', leave);
      cleanups.push(() => {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerleave', leave);
        leave();
      });
    });

    return () => cleanups.forEach((f) => f());
  }, []);

  return null;
}
