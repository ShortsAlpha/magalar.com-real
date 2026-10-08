import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';
import AuthShell from '@/components/auth/AuthShell';
import { authAppearance } from '@/components/auth/appearance';

export const metadata: Metadata = {
    title: 'Create account',
    robots: { index: false, follow: false },
};

export default function SignUpPage() {
    return (
        <AuthShell headline="Studio-grade speech," accent="in seconds.">
            <SignUp appearance={authAppearance} signInUrl="/sign-in" fallbackRedirectUrl="/studio" />
        </AuthShell>
    );
}
