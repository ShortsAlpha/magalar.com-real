import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

const PRODUCT = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#voices', label: 'Voices' },
  { href: '#long-form', label: 'Long-form' },
  { href: '#docx', label: 'DOCX Automator' },
  { href: '#faq', label: 'FAQ' },
];

const ACCOUNT = [
  { href: '/sign-in', label: 'Log in' },
  { href: '/sign-up', label: 'Sign up' },
  { href: '/studio', label: 'Studio' },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" aria-label="Magalar home" className="footer-logo">
              <Logo size={26} />
            </Link>
            <p>Studio-grade text to speech. Write it, and hear it read the way you meant it.</p>
          </div>
          <nav className="footer-cols" aria-label="Footer">
            <div>
              <p className="footer-h">Product</p>
              <ul>
                {PRODUCT.map((l) => (
                  <li key={l.href}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="footer-h">Account</p>
              <ul>
                {ACCOUNT.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
        <p className="footer-word" aria-hidden="true">
          Magalar
        </p>
        <div className="footer-bottom">
          <span>© 2026 Magalar</span>
          <span>English neural voices · MP3 · ZIP</span>
        </div>
      </div>
    </footer>
  );
}
