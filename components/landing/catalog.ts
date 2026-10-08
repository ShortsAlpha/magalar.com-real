/**
 * Landing-page helpers on top of the shared, read-only voice catalog (lib/voices.ts).
 *
 * Language and region names come from Intl.DisplayNames, whose output differs between
 * Node's ICU and each browser's ("Hong Kong SAR China" vs "Hong Kong"). To keep hydration
 * exact, the server builds a `Labels` snapshot once (app/page.tsx) and passes it to the
 * client components, which render names and orderings only from that snapshot.
 */
import {
  FEATURED_VOICE_IDS,
  LANGUAGES,
  VOICES,
  languageName,
  languageOf,
  localeLabel,
  previewTextFor,
  regionName,
  regionOf,
  type Voice,
} from '@/lib/voices';

/** Languages surfaced first in every picker, in this order. */
export const FEATURED_LANGS = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi'] as const;

export type Labels = {
  /** language code → English name ("tr" → "Turkish") */
  name: Record<string, string>;
  /** language code → endonym ("tr" → "Türkçe"), empty when it adds nothing */
  native: Record<string, string>;
  /** locale → region label ("tr-TR" → "Türkiye", "zh-CN-liaoning" → "China, Liaoning") */
  region: Record<string, string>;
  /** all language codes, sorted by English name */
  order: string[];
};

export type Lang = { code: string; name: string; native: string; voiceCount: number; locales: string[] };

function endonym(code: string) {
  let n = '';
  try {
    n = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? '';
  } catch {
    n = '';
  }
  if (n) n = n.charAt(0).toLocaleUpperCase(code) + n.slice(1);
  if (n.toLowerCase() === languageName(code).toLowerCase() || n === code) n = '';
  return n;
}

function rawRegionLabel(locale: string) {
  const full = localeLabel(locale);
  const m = /\((.*)\)$/.exec(full);
  return m ? m[1] : regionName(regionOf(locale)) || full;
}

/** Server-side: snapshot every Intl-derived label the landing needs. */
export function buildLabels(): Labels {
  const name: Record<string, string> = {};
  const native: Record<string, string> = {};
  const region: Record<string, string> = {};
  for (const l of LANGUAGES) {
    name[l.code] = l.name;
    native[l.code] = endonym(l.code);
    for (const loc of l.locales) region[loc] = rawRegionLabel(loc);
  }
  return { name, native, region, order: LANGUAGES.map((l) => l.code) };
}

type LangIndex = { all: Lang[]; featured: Lang[]; other: Lang[]; byCode: Map<string, Lang> };
const indexCache = new WeakMap<Labels, LangIndex>();

/** Languages in snapshot order, split into featured and the rest. */
export function languagesFrom(L: Labels): LangIndex {
  let idx = indexCache.get(L);
  if (!idx) {
    const base = new Map(LANGUAGES.map((l) => [l.code, l]));
    const all: Lang[] = [];
    for (const code of L.order) {
      const l = base.get(code);
      if (l)
        all.push({
          code,
          name: L.name[code] ?? code,
          native: L.native[code] ?? '',
          voiceCount: l.voiceCount,
          locales: l.locales,
        });
    }
    const byCode = new Map(all.map((l) => [l.code, l]));
    const featuredSet = new Set<string>(FEATURED_LANGS);
    idx = {
      all,
      byCode,
      featured: FEATURED_LANGS.map((c) => byCode.get(c)).filter((l): l is Lang => Boolean(l)),
      other: all.filter((l) => !featuredSet.has(l.code)),
    };
    indexCache.set(L, idx);
  }
  return idx;
}

export const regionLabel = (locale: string, L: Labels) => L.region[locale] ?? locale;

/** Locale shown first for languages spoken in many regions. */
const PRIMARY_LOCALE: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  ar: 'ar-SA',
  zh: 'zh-CN',
  nl: 'nl-NL',
  it: 'it-IT',
  ta: 'ta-IN',
  bn: 'bn-IN',
  sw: 'sw-KE',
  ur: 'ur-PK',
  ko: 'ko-KR',
};

const FEATURED_RANK = new Map<string, number>(FEATURED_VOICE_IDS.map((id, i) => [id, i]));
/** Deterministic (ICU-independent) string order, so server and client agree. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Voices of a language: primary locale first, then by region label, featured voices first, then by name. */
export function sortedVoicesFor(lang: string, L: Labels): Voice[] {
  const primary = PRIMARY_LOCALE[lang];
  return VOICES.filter((v) => languageOf(v.locale) === lang).sort((a, b) => {
    const pa = a.locale === primary ? 0 : 1;
    const pb = b.locale === primary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.locale !== b.locale) return cmp(regionLabel(a.locale, L), regionLabel(b.locale, L)) || cmp(a.locale, b.locale);
    const fa = FEATURED_RANK.get(a.id) ?? 99;
    const fb = FEATURED_RANK.get(b.id) ?? 99;
    if (fa !== fb) return fa - fb;
    return cmp(a.name, b.name);
  });
}

export function defaultVoiceFor(lang: string, L: Labels): string {
  const featured = FEATURED_VOICE_IDS.find((id) => languageOf(id) === lang);
  if (featured) return featured;
  return sortedVoicesFor(lang, L)[0]?.id ?? 'en-US-AriaNeural';
}

export const genderLabel = (g: Voice['gender']) => (g === 'F' ? 'Female' : 'Male');

/* --------------------------------------------------------------------------
   Demo lines: one natural sentence per language, each well under 200 chars.
   Anything missing falls back to the catalog's preview line.
   -------------------------------------------------------------------------- */
const DEMO_LINES: Record<string, string> = {
  en: 'Every great story deserves a great voice. Type anything you like, pick a voice, and hear it come to life in seconds.',
  tr: 'Merhaba! Yazdığınız her cümle, birkaç saniye içinde doğal ve sıcak bir sese dönüşüyor. Hemen deneyin.',
  de: 'Guten Tag! Schreiben Sie einen Satz, wählen Sie eine Stimme und hören Sie in Sekunden, wie natürlich er klingt.',
  fr: 'Bonjour ! Écrivez une phrase, choisissez une voix et écoutez-la prendre vie en quelques secondes.',
  es: '¡Hola! Escribe una frase, elige una voz y escucha cómo cobra vida en unos segundos.',
  it: 'Ciao! Scrivi una frase, scegli una voce e ascoltala prendere vita in pochi secondi.',
  pt: 'Olá! Escreva uma frase, escolha uma voz e ouça o seu texto ganhar vida em poucos segundos.',
  nl: 'Hallo! Typ een zin, kies een stem en hoor binnen een paar seconden hoe natuurlijk die klinkt.',
  pl: 'Cześć! Wpisz dowolne zdanie, wybierz głos i posłuchaj, jak naturalnie brzmi już po kilku sekundach.',
  ru: 'Здравствуйте! Напишите любую фразу, выберите голос и услышьте, как естественно она звучит.',
  uk: 'Вітаю! Напишіть будь-яке речення, оберіть голос і почуйте, як природно воно звучить.',
  ja: 'こんにちは。お好きな文章を入力して声を選ぶだけで、数秒で自然な音声になります。',
  ko: '안녕하세요! 문장을 입력하고 목소리를 고르면, 몇 초 만에 자연스러운 음성으로 들려드립니다.',
  zh: '你好！输入一句话，选择一个声音，几秒钟后就能听到自然流畅的朗读。',
  ar: 'مرحبًا! اكتب أي جملة، واختر صوتًا، واستمع إليها بصوت طبيعي وواضح خلال ثوانٍ.',
  hi: 'नमस्ते! कोई भी वाक्य लिखिए, एक आवाज़ चुनिए और कुछ ही सेकंड में उसे स्वाभाविक रूप से सुनिए।',
  sv: 'Hej! Skriv en mening, välj en röst och hör hur naturligt den låter på bara några sekunder.',
  id: 'Halo! Tulis satu kalimat, pilih suara, lalu dengarkan hasilnya yang alami dalam hitungan detik.',
  vi: 'Xin chào! Hãy nhập một câu, chọn giọng đọc và nghe nó vang lên thật tự nhiên chỉ sau vài giây.',
  el: 'Γεια σας! Γράψτε μια πρόταση, διαλέξτε φωνή και ακούστε την να ζωντανεύει σε λίγα δευτερόλεπτα.',
  he: 'שלום! כתבו משפט, בחרו קול ושמעו אותו מתעורר לחיים תוך שניות.',
  fa: 'سلام! یک جمله بنویسید، صدایی انتخاب کنید و در چند ثانیه آن را با صدایی طبیعی بشنوید.',
  az: 'Salam! Bir cümlə yazın, səs seçin və bir neçə saniyəyə təbii səslənməsini dinləyin.',
};

export function demoLineFor(lang: string) {
  return DEMO_LINES[lang] ?? previewTextFor({ locale: lang });
}
export const isDemoLine = (text: string) =>
  Object.values(DEMO_LINES).includes(text) || LANGUAGES.some((l) => previewTextFor({ locale: l.code }) === text);

/* --------------------------------------------------------------------------
   Real, unedited samples rendered by Magalar (public/samples/<id>.mp3).
   `line` is what the voice says, when we have the transcript.
   -------------------------------------------------------------------------- */
export type Sample = { id: string; line?: string };

export const SAMPLES: Sample[] = [
  { id: 'tr-TR-EmelNeural', line: 'Merhaba, ben Emel. Yazdığınız her metni sıcak ve doğal bir sesle sizin için okuyabilirim.' },
  { id: 'tr-TR-AhmetNeural', line: 'Uzun bir makaleyi ya da kitap bölümünü yapıştırın, gerisini Magalar halletsin.' },
  { id: 'en-US-AriaNeural' },
  {
    id: 'de-DE-SeraphinaMultilingualNeural',
    line: 'Guten Tag! Ich lese Ihre Texte klar, natürlich und mit der richtigen Betonung vor.',
  },
  {
    id: 'fr-FR-VivienneMultilingualNeural',
    line: "Bonjour ! Confiez-moi votre texte, et je vous le lirai d'une voix naturelle et posée.",
  },
  { id: 'es-ES-ElviraNeural', line: '¡Hola! Convierte cualquier texto en una narración natural, lista para tu próximo vídeo.' },
  { id: 'ja-JP-NanamiNeural', line: 'こんにちは。どんな文章でも、自然で聞きやすい声でお読みします。' },
  { id: 'ar-SA-ZariyahNeural', line: 'مرحبًا! أحوّل نصوصك إلى صوت طبيعي وواضح خلال ثوانٍ.' },
  { id: 'hi-IN-SwaraNeural', line: 'नमस्ते! आपका कोई भी लेख मैं साफ़ और स्वाभाविक आवाज़ में पढ़ सकती हूँ।' },
  { id: 'en-GB-RyanNeural' },
  { id: 'en-US-AndrewNeural' },
  { id: 'en-AU-NatashaNeural' },
  { id: 'en-CA-ClaraNeural' },
  { id: 'en-IE-ConnorNeural' },
];
export const SAMPLE_IDS = new Set(SAMPLES.map((s) => s.id));
/** Featured on the landing as cards; the rest stay playable inside the language browser. */
export const FEATURED_SAMPLES = SAMPLES.slice(0, 12);

/* --------------------------------------------------------------------------
   Cross-component: "try this voice" from the Voices browser into the demo.
   -------------------------------------------------------------------------- */
export const TRY_VOICE_EVENT = 'lp:try-voice';
export function requestDemoVoice(id: string) {
  window.dispatchEvent(new CustomEvent<string>(TRY_VOICE_EVENT, { detail: id }));
}

/** Only one landing audio element plays at a time. */
export function pauseOtherAudio(except: HTMLAudioElement) {
  document.querySelectorAll<HTMLAudioElement>('.lp audio').forEach((a) => {
    if (a !== except && !a.paused) a.pause();
  });
}
