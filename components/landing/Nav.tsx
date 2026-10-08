'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { UserButton, useAuth } from '@clerk/nextjs';
import { ArrowRight, ArrowUp } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { LANGUAGE_COUNT, VOICE_COUNT } from '@/lib/voices';

export const NAV_LINKS = [
  { href: '#try', label: 'Try it' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#voices', label: 'Voices' },
  { href: '#docx', label: 'DOCX Automator' },
  { href: '#faq', label: 'FAQ' },
] as const;

export function Nav() {
  const { isLoaded, isSignedIn } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;

  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const openRef = useRef(false);
  const barRef = useRef<HTMLSpanElement>(null);
  const topRef = useRef<HTMLAnchorElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /* Scroll: hide on scroll-down, progress hairline, back-to-top ring. */
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      setScrolled(y > 8);
      if (!openRef.current) {
        if (y > 640 && y > lastY + 4) setHidden(true);
        else if (y < lastY - 4 || y <= 640) setHidden(false);
      }
      lastY = y;
      if (barRef.current) barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      const top = topRef.current;
      if (top) {
        top.classList.toggle('is-visible', y > 900);
        top.style.setProperty('--p', (1 - p).toFixed(4));
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    const first = requestAnimationFrame(update);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  /* Active section highlight. */
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(`#${e.target.id}`);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    NAV_LINKS.forEach((l) => {
      const s = document.getElementById(l.href.slice(1));
      if (s) io.observe(s);
    });
    return () => io.disconnect();
  }, []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) burgerRef.current?.focus();
  }, []);

  /* Mobile menu side effects: scroll lock, inert page, Escape, resize. */
  useEffect(() => {
    if (!open) return;
    const main = document.querySelector<HTMLElement>('.lp main');
    const foot = document.querySelector<HTMLElement>('.lp .footer');
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (main) main.inert = true;
    if (foot) foot.inert = true;
    const first = menuRef.current?.querySelector<HTMLElement>('a');
    const f = requestAnimationFrame(() => first?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) close();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(f);
      document.documentElement.style.overflow = prevOverflow;
      if (main) main.inert = false;
      if (foot) foot.inert = false;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  return (
    <>
      <header
        className="nav"
        data-hidden={hidden && !open ? '' : undefined}
        data-scrolled={scrolled || open ? '' : undefined}
        data-open={open ? '' : undefined}
      >
        <div className="wrap nav-inner">
          <Link href="/" className="nav-brand" aria-label="Magalar home">
            <Logo size={22} />
          </Link>

          <nav className="nav-links" aria-label="Primary">
            <ul>
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} aria-current={active === l.href ? 'true' : undefined}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="nav-actions">
            {signedIn ? (
              <>
                <Link href="/studio" className="btn btn-primary btn-sm">
                  Open Studio
                </Link>
                <span className="nav-user">
                  <UserButton />
                </span>
              </>
            ) : (
              <>
                <Link href="/sign-in" className="nav-login">
                  Log in
                </Link>
                <Link href="/sign-up" className="btn btn-primary btn-sm nav-cta">
                  Get started
                </Link>
              </>
            )}
            <button
              ref={burgerRef}
              type="button"
              className="burger"
              aria-expanded={open}
              aria-controls="lp-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((o) => !o)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
        <div className="nav-progress" aria-hidden="true">
          <span ref={barRef} />
        </div>
      </header>

      <div
        id="lp-menu"
        ref={menuRef}
        className="menu"
        data-open={open ? '' : undefined}
        inert={!open}
        aria-hidden={!open}
      >
        <nav aria-label="Mobile" className="menu-links">
          <ul>
            {NAV_LINKS.map((l, i) => (
              <li key={l.href} style={{ '--i': i } as CSSProperties}>
                <a href={l.href} onClick={() => close()}>
                  <span className="menu-num">{String(i + 1).padStart(2, '0')}</span>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="menu-foot">
          {signedIn ? (
            <Link href="/studio" className="btn btn-primary btn-block" onClick={() => close()}>
              <span>Open Studio</span>
              <ArrowRight className="btn-arrow" size={18} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link href="/sign-up" className="btn btn-primary btn-block" onClick={() => close()}>
                <span>Get started</span>
                <ArrowRight className="btn-arrow" size={18} strokeWidth={1.75} aria-hidden="true" />
              </Link>
              <Link href="/sign-in" className="btn btn-ghost btn-block" onClick={() => close()}>
                Log in
              </Link>
            </>
          )}
          <p className="mono-note">
            {VOICE_COUNT} voices · {LANGUAGE_COUNT} languages · MP3 · SRT
          </p>
        </div>
      </div>

      <a ref={topRef} href="#top" className="to-top" aria-label="Back to top">
        <svg className="to-top-ring" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="22.5" pathLength={1} />
        </svg>
        <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
      </a>
    </>
  );
}
