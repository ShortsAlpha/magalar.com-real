import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import AuthShell from '@/components/auth/AuthShell';
import { authAppearance } from '@/components/auth/appearance';

export const metadata: Metadata = {
    title: 'Sign in',
    robots: { index: false, follow: false },
};

export default function SignInPage() {
    return (
        <AuthShell headline="Your words," accent="voiced.">
            <SignIn appearance={authAppearance} signUpUrl="/sign-up" fallbackRedirectUrl="/studio" />
        </AuthShell>
    );
}
