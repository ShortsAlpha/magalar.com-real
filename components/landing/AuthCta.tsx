'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight } from 'lucide-react';

type Target = { href: string; label: string };

/**
 * Auth-aware call to action. Renders the signed-out target on the server and until Clerk
 * has loaded (so the HTML is always useful), then swaps to the signed-in target.
 */
export function AuthCta({
  signedOut,
  signedIn = { href: '/studio', label: 'Open Studio' },
  className = 'btn btn-primary',
  arrow = true,
  magnetic = false,
}: {
  signedOut: Target;
  signedIn?: Target;
  className?: string;
  arrow?: boolean;
  magnetic?: boolean;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const t = isLoaded && isSignedIn ? signedIn : signedOut;
  return (
    <Link href={t.href} className={className} data-magnetic={magnetic ? '' : undefined}>
      <span>{t.label}</span>
      {arrow ? <ArrowRight className="btn-arrow" size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
    </Link>
  );
}
