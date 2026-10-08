import type { ComponentProps } from 'react';
import type { SignIn } from '@clerk/nextjs';

/** Clerk `appearance` type as accepted by the installed @clerk/nextjs (Core 3). */
export type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>['appearance']>;

const hairline = '1px solid rgba(255, 255, 255, 0.10)';

/** Shared monochrome variables: black surfaces, white primary, neutral inputs, no color accents. */
const variables: ClerkAppearance['variables'] = {
    colorPrimary: '#ffffff',
    colorPrimaryForeground: '#000000',
    colorBackground: '#0a0a0a',
    colorForeground: '#fafafa',
    colorMuted: '#111111',
    colorMutedForeground: '#a3a3a3',
    colorNeutral: '#ffffff',
    colorInput: '#111111',
    colorInputForeground: '#fafafa',
    colorBorder: 'rgba(255, 255, 255, 0.12)',
    colorRing: 'rgba(255, 255, 255, 0.35)',
    colorShadow: 'rgba(0, 0, 0, 0.6)',
    colorModalBackdrop: 'rgba(0, 0, 0, 0.8)',
    colorDanger: '#f87171',
    colorSuccess: '#4ade80',
    colorWarning: '#d4d4d4',
    fontFamily: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif',
    fontFamilyButtons: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif',
    fontFamilyMono: 'var(--font-geist-mono), ui-monospace, monospace',
    borderRadius: '0.5rem',
};

/** <SignIn/> and <SignUp/> */
export const authAppearance: ClerkAppearance = {
    variables,
    options: {
        logoPlacement: 'none',
        shimmer: false,
        socialButtonsVariant: 'blockButton',
    },
    elements: {
        rootBox: { width: '100%' },
        cardBox: {
            width: '100%',
            maxWidth: '400px',
            boxShadow: 'none',
            border: hairline,
            borderRadius: '14px',
        },
        card: {
            backgroundColor: '#0a0a0a',
            boxShadow: 'none',
            border: 'none',
        },
        headerTitle: { fontSize: '20px', fontWeight: 500, letterSpacing: '-0.02em', color: '#ffffff' },
        headerSubtitle: { color: '#a3a3a3' },
        socialButtonsBlockButton: {
            backgroundColor: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: 'none',
            color: '#ffffff',
        },
        dividerLine: { backgroundColor: 'rgba(255, 255, 255, 0.10)' },
        dividerText: {
            color: '#737373',
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontSize: '10px',
        },
        formFieldLabel: { color: '#d4d4d4', fontWeight: 500 },
        formFieldInput: {
            backgroundColor: '#111111',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: 'none',
            color: '#fafafa',
        },
        formButtonPrimary: {
            backgroundColor: '#ffffff',
            color: '#000000',
            boxShadow: 'none',
            border: 'none',
            fontWeight: 500,
            textTransform: 'none',
            '&:hover': { backgroundColor: '#e5e5e5' },
            '&:focus-visible': { boxShadow: '0 0 0 2px #0a0a0a, 0 0 0 3px rgba(255, 255, 255, 0.7)' },
        },
        footer: {
            // Clerk's default footer is tinted — flatten it to the card color.
            background: '#0a0a0a',
            backgroundImage: 'none',
            borderTop: hairline,
        },
        footerActionText: { color: '#a3a3a3' },
        footerActionLink: { color: '#ffffff', fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: '4px' },
        identityPreview: { backgroundColor: '#111111', border: hairline },
        identityPreviewEditButton: { color: '#ffffff' },
        formResendCodeLink: { color: '#ffffff' },
        otpCodeFieldInput: { backgroundColor: '#111111', borderColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' },
    },
};

/** <UserButton/> in the studio sidebar / top bar */
export const userButtonAppearance: ClerkAppearance = {
    variables,
    elements: {
        avatarBox: { width: '28px', height: '28px', border: '1px solid rgba(255, 255, 255, 0.15)' },
        userButtonPopoverCard: { backgroundColor: '#0a0a0a', border: hairline, boxShadow: '0 16px 48px rgba(0,0,0,0.6)' },
        userButtonPopoverFooter: { background: '#0a0a0a', backgroundImage: 'none', borderTop: hairline },
        userButtonPopoverActionButton: { color: '#e5e5e5' },
    },
};
