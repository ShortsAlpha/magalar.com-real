import Link from 'next/link';
import { AuthCta } from './AuthCta';
import { Split } from './Split';

export function FinalCta() {
  return (
    <section className="sec inv cta" id="start" aria-labelledby="cta-title">
      <div className="wrap cta-inner">
        <p className="cta-kicker" data-reveal>
          <i className="cta-dot" aria-hidden="true" /> Free during early access
        </p>
        <h2 className="cta-title" id="cta-title" data-split>
          <Split>
            Give your words a <em>voice.</em>
          </Split>
        </h2>
        <div className="cta-actions" data-reveal>
          <AuthCta
            signedOut={{ href: '/sign-up', label: 'Create your free account' }}
            signedIn={{ href: '/studio', label: 'Open Studio' }}
            className="btn btn-primary btn-xl"
            magnetic
          />
          <Link href="/sign-in" className="btn btn-ghost btn-xl">
            Log in
          </Link>
        </div>
        <p className="cta-note" data-reveal>
          Email or social sign-in · 23 voices · No software to install
        </p>
      </div>
    </section>
  );
}
