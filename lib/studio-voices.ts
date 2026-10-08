import {
    DEFAULT_VOICE_ID,
    FEATURED_VOICE_IDS,
    getVoiceById,
    LANGUAGES,
    languageName,
    languageOf,
    localeLabel,
    VOICES,
    type Language,
    type Voice,
} from './voices';

/**
 * Studio-side helpers on top of the read-only catalog in `lib/voices.ts`.
 */

export const ALL_LANGUAGES = 'all';

const FALLBACK_VOICE: Voice = getVoiceById(DEFAULT_VOICE_ID) ?? VOICES[0];

/** Never-undefined lookup (unknown ids fall back to the default voice). */
export const resolveVoice = (id: string | null | undefined): Voice => (id && getVoiceById(id)) || FALLBACK_VOICE;

export const FEATURED_IDS: ReadonlySet<string> = new Set<string>(FEATURED_VOICE_IDS);
export const FEATURED_RANK: ReadonlyMap<string, number> = new Map(FEATURED_VOICE_IDS.map((id, i) => [id, i]));

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
export const getLanguage = (code: string): Language | undefined => LANGUAGE_BY_CODE.get(code);
export const isKnownLanguage = (code: string | null | undefined): code is string => !!code && LANGUAGE_BY_CODE.has(code);

/** Languages surfaced at the top of the language picker (from the featured voices, in order: en, tr, de, …). */
export const POPULAR_LANGUAGE_CODES: readonly string[] = Array.from(
    new Set(FEATURED_VOICE_IDS.map((id) => languageOf(getVoiceById(id)?.locale ?? id))),
).filter((code) => LANGUAGE_BY_CODE.has(code));

/** Endonym ("Türkçe", "日本語"), or null when Intl doesn't know it or it equals the English name. */
function endonym(code: string): string | null {
    try {
        const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        if (!name || name === code) return null;
        const pretty = name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
        return pretty.toLowerCase() === languageName(code).toLowerCase() ? null : pretty;
    } catch {
        return null;
    }
}

/** Lower-case, accent-free form for search ("Türkçe" → "turkce", "Ελληνικά" keeps its letters). */
export function fold(s: string): string {
    return s
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ı/g, 'i')
        .toLowerCase();
}

export interface LanguageEntry extends Language {
    native: string | null;
    search: string;
}

export const LANGUAGE_ENTRIES: LanguageEntry[] = LANGUAGES.map((l) => {
    const native = endonym(l.code);
    return {
        ...l,
        native,
        search: fold([l.name, native ?? '', l.code, ...l.locales.map(localeLabel)].join(' ')),
    };
});

export interface VoiceEntry {
    voice: Voice;
    language: string;
    label: string;
    featured: boolean;
    search: string;
}

/** Pre-computed, sorted (language name → locale label → name) list for fast filtering. */
export const VOICE_ENTRIES: VoiceEntry[] = VOICES.map((voice) => {
    const label = localeLabel(voice.locale);
    const language = languageOf(voice.locale);
    return {
        voice,
        language,
        label,
        featured: FEATURED_IDS.has(voice.id),
        search: fold(
            [
                voice.name,
                label,
                voice.id,
                ...(voice.tags ?? []),
                voice.gender === 'F' ? 'female' : 'male',
                voice.multilingual ? 'multilingual' : '',
                LANGUAGE_ENTRIES.find((l) => l.code === language)?.native ?? '',
            ].join(' '),
        ),
    };
}).sort(
    (a, b) =>
        languageName(a.language).localeCompare(languageName(b.language)) ||
        a.label.localeCompare(b.label) ||
        a.voice.name.localeCompare(b.voice.name),
);

export const genderLabel = (g: Voice['gender']) => (g === 'F' ? 'Female' : 'Male');

/** "Turkish (Türkiye) · F" */
export const voiceMetaLine = (voice: Voice) => `${localeLabel(voice.locale)} · ${voice.gender}`;

/** First few personality / content tags for a voice. */
export const displayTags = (voice: Voice, max = 3): string[] => (voice.tags ?? []).slice(0, max);
