import catalog from './voices.json';

/**
 * Full edge-tts neural voice catalog (generated from edge_tts.list_voices()).
 * Regenerate lib/voices.json when Microsoft adds voices; the shape below must stay stable.
 */
export type Voice = {
  id: string; // e.g. "tr-TR-EmelNeural" — sent to the backend as `voice`
  name: string; // "Emel"
  locale: string; // "tr-TR"
  gender: 'F' | 'M';
  tags?: string[]; // personality / content tags, e.g. ["Friendly", "News"]
  multilingual?: boolean; // can speak many languages from one voice
};

export const VOICES: Voice[] = catalog as Voice[];

const BY_ID = new Map(VOICES.map((v) => [v.id, v]));
export const getVoiceById = (id: string): Voice | undefined => BY_ID.get(id);

/** "tr-TR" → "tr", "zh-CN-liaoning" → "zh", "fil-PH" → "fil" */
export const languageOf = (locale: string) => locale.split('-')[0];
/** "tr-TR" → "TR", "zh-CN-liaoning" → "CN", "iu-Latn-CA" → "CA" */
export const regionOf = (locale: string) => locale.split('-').find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p)) ?? '';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** "tr" → "Turkish" */
export const languageName = (lang: string) => languageNames.of(lang) ?? lang;
/** "TR" → "Türkiye" */
export const regionName = (region: string) => (region ? (regionNames.of(region) ?? region) : '');
/** "en-GB" → "English (United Kingdom)"; dialect locales keep their suffix: "zh-CN-liaoning" → "Chinese (China, Liaoning)" */
export function localeLabel(locale: string) {
  const parts = locale.split('-');
  const region = regionOf(locale);
  const extra = parts.slice(1).filter((p) => p !== region && !/^[A-Z][a-z]{3}$/.test(p));
  const inner = [regionName(region), ...extra.map((e) => e.charAt(0).toUpperCase() + e.slice(1))].filter(Boolean).join(', ');
  return inner ? `${languageName(languageOf(locale))} (${inner})` : languageName(languageOf(locale));
}

export type Language = { code: string; name: string; voiceCount: number; locales: string[] };

/** Languages sorted by name, with voice counts. */
export const LANGUAGES: Language[] = (() => {
  const map = new Map<string, Language>();
  for (const v of VOICES) {
    const code = languageOf(v.locale);
    const entry = map.get(code) ?? { code, name: languageName(code), voiceCount: 0, locales: [] };
    entry.voiceCount += 1;
    if (!entry.locales.includes(v.locale)) entry.locales.push(v.locale);
    map.set(code, entry);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

export const VOICE_COUNT = VOICES.length; // 322
export const LANGUAGE_COUNT = LANGUAGES.length; // 75
export const LOCALE_COUNT = new Set(VOICES.map((v) => v.locale)).size; // 142

export const voicesForLanguage = (lang: string) => VOICES.filter((v) => languageOf(v.locale) === lang);

export const DEFAULT_VOICE_ID = 'en-US-AriaNeural';

/** Hand-picked voices to feature first in pickers and on the landing page. */
export const FEATURED_VOICE_IDS = [
  'en-US-AriaNeural',
  'en-US-AndrewMultilingualNeural',
  'en-GB-SoniaNeural',
  'tr-TR-EmelNeural',
  'tr-TR-AhmetNeural',
  'de-DE-SeraphinaMultilingualNeural',
  'fr-FR-VivienneMultilingualNeural',
  'es-ES-ElviraNeural',
  'it-IT-GiuseppeMultilingualNeural',
  'pt-BR-ThalitaMultilingualNeural',
  'ja-JP-NanamiNeural',
  'ko-KR-SunHiNeural',
  'zh-CN-XiaoxiaoNeural',
  'ar-SA-ZariyahNeural',
  'hi-IN-SwaraNeural',
] as const;

/** Short line each voice reads when previewed, in its own language (falls back to English). */
const PREVIEW_TEXT: Record<string, string> = {
  en: 'Hello! This is what my voice sounds like.',
  tr: 'Merhaba! Benim sesim böyle duyuluyor.',
  de: 'Hallo! So klingt meine Stimme.',
  fr: 'Bonjour ! Voici à quoi ressemble ma voix.',
  es: '¡Hola! Así suena mi voz.',
  it: 'Ciao! Ecco come suona la mia voce.',
  pt: 'Olá! É assim que a minha voz soa.',
  nl: 'Hallo! Zo klinkt mijn stem.',
  pl: 'Cześć! Tak brzmi mój głos.',
  ru: 'Привет! Вот так звучит мой голос.',
  uk: 'Привіт! Ось так звучить мій голос.',
  ar: 'مرحبًا! هكذا يبدو صوتي.',
  he: 'שלום! כך נשמע הקול שלי.',
  fa: 'سلام! صدای من این‌گونه است.',
  hi: 'नमस्ते! मेरी आवाज़ ऐसी सुनाई देती है।',
  bn: 'নমস্কার! আমার কণ্ঠস্বর এমন শোনায়।',
  ur: 'ہیلو! میری آواز ایسی سنائی دیتی ہے۔',
  ja: 'こんにちは！これが私の声です。',
  ko: '안녕하세요! 제 목소리는 이렇게 들립니다.',
  zh: '你好！这就是我的声音。',
  id: 'Halo! Beginilah suara saya.',
  ms: 'Helo! Beginilah bunyi suara saya.',
  vi: 'Xin chào! Đây là giọng nói của tôi.',
  th: 'สวัสดี! นี่คือเสียงของฉัน',
  sv: 'Hej! Så här låter min röst.',
  da: 'Hej! Sådan lyder min stemme.',
  nb: 'Hei! Slik høres stemmen min ut.',
  fi: 'Hei! Tältä minun ääneni kuulostaa.',
  el: 'Γεια σας! Έτσι ακούγεται η φωνή μου.',
  cs: 'Ahoj! Takhle zní můj hlas.',
  sk: 'Ahoj! Takto znie môj hlas.',
  hu: 'Szia! Így szól a hangom.',
  ro: 'Bună! Așa sună vocea mea.',
  bg: 'Здравейте! Ето как звучи гласът ми.',
  hr: 'Bok! Ovako zvuči moj glas.',
  sr: 'Здраво! Овако звучи мој глас.',
  bs: 'Zdravo! Ovako zvuči moj glas.',
  sl: 'Živijo! Tako zveni moj glas.',
  mk: 'Здраво! Вака звучи мојот глас.',
  sq: 'Përshëndetje! Kështu tingëllon zëri im.',
  ca: 'Hola! Així sona la meva veu.',
  gl: 'Ola! Así soa a miña voz.',
  fil: 'Kumusta! Ganito ang tunog ng boses ko.',
  sw: 'Habari! Hivi ndivyo sauti yangu inavyosikika.',
  af: 'Hallo! So klink my stem.',
  ta: 'வணக்கம்! என் குரல் இப்படித்தான் ஒலிக்கும்.',
  te: 'నమస్కారం! నా గొంతు ఇలా వినిపిస్తుంది.',
  az: 'Salam! Mənim səsim belə səslənir.',
  kk: 'Сәлеметсіз бе! Менің дауысым осылай естіледі.',
  uz: 'Salom! Mening ovozim shunday eshitiladi.',
  ka: 'გამარჯობა! ასე ჟღერს ჩემი ხმა.',
  et: 'Tere! Nii kõlab minu hääl.',
  lv: 'Sveiki! Lūk, kā skan mana balss.',
  lt: 'Labas! Štai kaip skamba mano balsas.',
  is: 'Halló! Svona hljómar röddin mín.',
  ga: 'Dia duit! Seo mar a fhuaimníonn mo ghuth.',
  cy: 'Helo! Dyma sut mae fy llais yn swnio.',
};

export const previewTextFor = (voice: Pick<Voice, 'locale'>) =>
  PREVIEW_TEXT[languageOf(voice.locale)] ?? PREVIEW_TEXT.en;
